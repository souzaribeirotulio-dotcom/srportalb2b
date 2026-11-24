-- Executivos de contas, etapa 3: comissão automática de cada pedido feito pelo portal.
-- Base: soma dos itens do pedido (valor dos produtos, sem frete e sem taxa de pagamento),
-- como o G360 devolveu no envio. Só para cliente com vínculo ATIVO na data do pedido.
-- A comissão nasce "prevista"; a equipe confere no G360 e marca faturada, liberada e paga.

alter table public.comissoes add column if not exists pedido_numero text
  check (pedido_numero is null or char_length(pedido_numero) <= 40);
grant select (pedido_numero) on public.comissoes to authenticated;

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
  insert into public.comissoes (loja, executivo_id, vinculo_id, cliente_codigo, pedido_ref, pedido_numero, pedido_data, competencia, base, percentual, valor)
  values (p_loja, v.executivo_id, v.vid, p_comprador, 'P' || p_pedido_id, left(p_numero, 40), v_data, date_trunc('month', v_data)::date,
          round(v_base, 2), v_pct, round(v_base * v_pct / 100, 2))
  on conflict (loja, pedido_ref) do nothing;
end $$;
revoke all on function public.portal_comissao_inserir(text, bigint, bigint, text, jsonb, timestamptz) from public, anon, authenticated;

-- Pedido registrado pelo portal → comissão. Erro aqui nunca impede o registro do pedido.
create or replace function public.portal_eventos_comissao() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.tipo = 'pedido' then
    begin
      perform public.portal_comissao_inserir(new.loja, new.comprador_codigo, new.pedido_id, new.pedido_numero, new.itens, new.criado_em);
    exception when others then null;
    end;
  end if;
  return new;
end $$;
revoke all on function public.portal_eventos_comissao() from public, anon, authenticated;
drop trigger if exists portal_eventos_comissao on public.portal_eventos;
create trigger portal_eventos_comissao after insert on public.portal_eventos
  for each row execute function public.portal_eventos_comissao();

-- Reprocessa os pedidos de um período (ex.: vínculo corrigido depois). Não duplica nem muda o que já existe.
create or replace function public.portal_comissoes_recalcular(p_loja text, p_desde date) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n0 int; n1 int;
begin
  select count(*) into n0 from public.comissoes where loja = p_loja;
  for r in select * from public.portal_eventos
            where loja = p_loja and tipo = 'pedido' and criado_em >= (p_desde::timestamp at time zone 'America/Sao_Paulo') loop
    perform public.portal_comissao_inserir(r.loja, r.comprador_codigo, r.pedido_id, r.pedido_numero, r.itens, r.criado_em);
  end loop;
  select count(*) into n1 from public.comissoes where loja = p_loja;
  return n1 - n0;
end $$;
revoke all on function public.portal_comissoes_recalcular(text, date) from public, anon, authenticated;
grant execute on function public.portal_comissoes_recalcular(text, date) to service_role;
