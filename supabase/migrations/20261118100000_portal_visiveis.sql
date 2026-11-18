-- Lista do que aparece no portal, calculada no navegador do comprador ao contar o estoque
-- (só códigos de produto, sem quantidade nem preço). O painel lê pela função painel-g360.
create table if not exists public.portal_visiveis (
  loja text primary key check (loja ~ '^[a-f0-9]{16}$'),
  visiveis text[] not null default '{}',
  estoque_baixo text[] not null default '{}',
  sem_estoque text[] not null default '{}',
  estoque_minimo numeric not null default 0,
  comprador_codigo bigint,
  atualizado_em timestamptz not null default statement_timestamp()
);
alter table public.portal_visiveis enable row level security;
revoke all on public.portal_visiveis from anon, authenticated;

-- Grava a lista pela sessão do comprador vinculada pela ponte (no máximo a cada 10 minutos por loja).
create or replace function public.portal_visiveis_gravar(p_visiveis text[], p_estoque_baixo text[], p_sem_estoque text[], p_estoque_minimo numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loja text := (select auth.jwt() -> 'app_metadata' ->> 'g360_loja');
  v_comp text := (select auth.jwt() -> 'app_metadata' ->> 'g360_comprador');
begin
  if not (select g360_ponte_privado.sessao_valida()) then raise exception 'sessao'; end if;
  if v_loja is null or v_loja !~ '^[a-f0-9]{16}$' then raise exception 'loja'; end if;
  if coalesce(cardinality(p_visiveis), 0) + coalesce(cardinality(p_estoque_baixo), 0) + coalesce(cardinality(p_sem_estoque), 0) > 30000 then raise exception 'grande'; end if;
  if exists (select 1 from unnest(coalesce(p_visiveis, '{}') || coalesce(p_estoque_baixo, '{}') || coalesce(p_sem_estoque, '{}')) c where c is null or char_length(c) not between 1 and 40) then raise exception 'codigo'; end if;
  if exists (select 1 from public.portal_visiveis where loja = v_loja and atualizado_em > statement_timestamp() - interval '10 minutes') then return; end if;
  insert into public.portal_visiveis (loja, visiveis, estoque_baixo, sem_estoque, estoque_minimo, comprador_codigo, atualizado_em)
  values (v_loja, coalesce(p_visiveis, '{}'), coalesce(p_estoque_baixo, '{}'), coalesce(p_sem_estoque, '{}'), greatest(coalesce(p_estoque_minimo, 0), 0),
          case when v_comp ~ '^[0-9]{1,18}$' then v_comp::bigint end, statement_timestamp())
  on conflict (loja) do update set visiveis = excluded.visiveis, estoque_baixo = excluded.estoque_baixo, sem_estoque = excluded.sem_estoque,
    estoque_minimo = excluded.estoque_minimo, comprador_codigo = excluded.comprador_codigo, atualizado_em = excluded.atualizado_em;
end;
$$;
revoke all on function public.portal_visiveis_gravar(text[], text[], text[], numeric) from public, anon;
grant execute on function public.portal_visiveis_gravar(text[], text[], text[], numeric) to authenticated;
