-- Executivos de contas: painel "Suas vendas" na área do executivo.
-- Cada comissão passa a guardar a hora do pedido e o resumo dos produtos (nome e quantidade,
-- sem preço). O executivo lê, pela mesma regra de acesso, só as linhas dele.

alter table public.comissoes add column if not exists pedido_em timestamptz;
alter table public.comissoes add column if not exists itens jsonb
  check (itens is null or (jsonb_typeof(itens) = 'array' and jsonb_array_length(itens) <= 100));
grant select (pedido_em, itens, vinculo_id) on public.comissoes to authenticated;

-- Resumo dos itens: só nome (até 120 letras) e quantidade (texto decimal).
create or replace function public.portal_itens_resumo(p_itens jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('nome', left(coalesce(i->>'nome', i->>'codigo', 'Produto'), 120), 'quantidade', left(i->>'quantidade', 20)) order by n), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_itens) = 'array' then p_itens else '[]'::jsonb end) with ordinality as t(i, n)
   where n <= 100;
$$;
revoke all on function public.portal_itens_resumo(jsonb) from public, anon, authenticated;

create or replace function public.portal_comissao_inserir(p_loja text, p_comprador bigint, p_pedido_id bigint, p_numero text, p_itens jsonb, p_criado timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_data date := (coalesce(p_criado, now()) at time zone 'America/Sao_Paulo')::date;
  v record; v_base numeric; v_pct numeric;
begin
  if p_pedido_id is null or p_comprador is null then return; end if;
  select vc.id as vid, vc.executivo_id, e.percentual as proprio, c.percentual as padrao into v
    from public.executivo_clientes vc
    join public.executivos e on e.id = vc.executivo_id
    left join public.comissao_config c on c.loja = vc.loja
   where vc.loja = p_loja and vc.cliente_codigo = p_comprador and vc.situacao = 'ativo' and e.ativo
     and vc.inicio <= v_data and (vc.fim is null or v_data <= vc.fim)
   order by vc.inicio desc limit 1;
  if not found then return; end if;
  select coalesce(sum((i->>'total')::numeric), 0) into v_base
    from jsonb_array_elements(case when jsonb_typeof(p_itens) = 'array' then p_itens else '[]'::jsonb end) i
   where (i->>'total') ~ '^[0-9]{1,12}(\.[0-9]{1,7})?$';
  if v_base <= 0 then return; end if;
  v_pct := coalesce(v.proprio, v.padrao, 3);
  insert into public.comissoes (loja, executivo_id, vinculo_id, cliente_codigo, pedido_ref, pedido_numero, pedido_data, pedido_em, itens, competencia, base, percentual, valor)
  values (p_loja, v.executivo_id, v.vid, p_comprador, 'P' || p_pedido_id, left(p_numero, 40), v_data, coalesce(p_criado, now()), public.portal_itens_resumo(p_itens),
          date_trunc('month', v_data)::date, round(v_base, 2), v_pct, round(v_base * v_pct / 100, 2))
  on conflict (loja, pedido_ref) do nothing;
end $$;
revoke all on function public.portal_comissao_inserir(text, bigint, bigint, text, jsonb, timestamptz) from public, anon, authenticated;

-- Comissões que já existem: hora e produtos tirados do registro do pedido.
update public.comissoes c
   set pedido_em = e.criado_em, itens = public.portal_itens_resumo(e.itens)
  from public.portal_eventos e
 where e.loja = c.loja and e.tipo = 'pedido' and e.pedido_id is not null and c.pedido_ref = 'P' || e.pedido_id
   and (c.pedido_em is null or c.itens is null);
