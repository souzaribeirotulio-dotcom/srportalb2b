-- Condições de pagamento no portal: a equipe escolhe quais aparecem (para todos ou por cliente).
-- O G360 continua decidindo o que é liberado; o portal só esconde.
create table if not exists public.portal_condicoes_vistas (
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  comprador_codigo bigint not null check (comprador_codigo > 0),
  condicao_id integer not null check (condicao_id > 0),
  descricao text not null check (char_length(descricao) between 1 and 120),
  visto_em timestamptz not null default statement_timestamp(),
  primary key (loja, comprador_codigo, condicao_id)
);
alter table public.portal_condicoes_vistas enable row level security;
revoke all on public.portal_condicoes_vistas from public, anon, authenticated;

-- comprador_codigo 0 = vale para todos os clientes.
create table if not exists public.portal_condicoes_ocultas (
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  comprador_codigo bigint not null check (comprador_codigo >= 0),
  condicoes integer[] not null default '{}',
  atualizado_em timestamptz not null default statement_timestamp(),
  primary key (loja, comprador_codigo)
);
alter table public.portal_condicoes_ocultas enable row level security;
revoke all on public.portal_condicoes_ocultas from public, anon, authenticated;

-- Chamada pelo comprador no fechamento do pedido, com as condições que GET opcoes devolveu:
-- guarda o que o G360 liberou para ele (para a equipe ver na ficha) e devolve as que a equipe escondeu.
create or replace function public.portal_condicoes_sincronizar(p_condicoes jsonb)
returns integer[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loja text := (select auth.jwt() -> 'app_metadata' ->> 'g360_loja');
  v_comp text := (select auth.jwt() -> 'app_metadata' ->> 'g360_comprador');
  v_ocultas integer[];
begin
  if not (select g360_ponte_privado.sessao_valida()) then raise exception 'sessao'; end if;
  if v_loja is null or v_loja !~ '^[a-f0-9]{16}$' or v_comp !~ '^[0-9]{1,18}$' then raise exception 'identidade'; end if;
  if jsonb_typeof(p_condicoes) = 'array' and jsonb_array_length(p_condicoes) <= 50 then
    delete from public.portal_condicoes_vistas where loja = v_loja and comprador_codigo = v_comp::bigint;
    insert into public.portal_condicoes_vistas (loja, comprador_codigo, condicao_id, descricao)
    select v_loja, v_comp::bigint, (c ->> 'id')::integer, left(btrim(c ->> 'descricao'), 120)
    from jsonb_array_elements(p_condicoes) c
    where (c ->> 'id') ~ '^[1-9][0-9]{0,8}$' and char_length(btrim(coalesce(c ->> 'descricao', ''))) between 1 and 120
    on conflict do nothing;
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ocultas
  from public.portal_condicoes_ocultas o, unnest(o.condicoes) x
  where o.loja = v_loja and o.comprador_codigo in (0, v_comp::bigint);
  return v_ocultas;
end;
$$;
revoke all on function public.portal_condicoes_sincronizar(jsonb) from public, anon;
grant execute on function public.portal_condicoes_sincronizar(jsonb) to authenticated;
