-- Carrinho do comprador guardado no Supabase, para aparecer em qualquer navegador em que ele entrar.
-- Só produto, unidade, quantidade e nome: preço e estoque são buscados de novo na API.
-- Acesso só pelas duas funções abaixo, com a sessão vinculada pela ponte (mesmo recorte da Minha Lista).
create table if not exists public.portal_carrinhos (
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  comprador_codigo bigint not null check (comprador_codigo > 0),
  linhas jsonb not null default '[]' check (jsonb_typeof(linhas) = 'array' and jsonb_array_length(linhas) <= 100),
  em bigint not null check (em > 0),            -- momento da última mudança (ms), para valer a mais nova
  atualizado_em timestamptz not null default statement_timestamp(),
  primary key (loja, comprador_codigo)
);
alter table public.portal_carrinhos enable row level security;
revoke all on public.portal_carrinhos from public, anon, authenticated;

create or replace function public.portal_carrinho_ler()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_loja text := (select auth.jwt() -> 'app_metadata' ->> 'g360_loja');
  v_comp text := (select auth.jwt() -> 'app_metadata' ->> 'g360_comprador');
  v jsonb;
begin
  if not (select g360_ponte_privado.sessao_valida()) then raise exception 'sessao'; end if;
  if v_loja is null or v_loja !~ '^[a-f0-9]{16}$' or v_comp !~ '^[0-9]{1,18}$' then raise exception 'identidade'; end if;
  select jsonb_build_object('linhas', c.linhas, 'em', c.em) into v
  from public.portal_carrinhos c where c.loja = v_loja and c.comprador_codigo = v_comp::bigint;
  return v;
end;
$$;

create or replace function public.portal_carrinho_gravar(p_linhas jsonb, p_em bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loja text := (select auth.jwt() -> 'app_metadata' ->> 'g360_loja');
  v_comp text := (select auth.jwt() -> 'app_metadata' ->> 'g360_comprador');
  v_agora bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_linhas jsonb;
begin
  if not (select g360_ponte_privado.sessao_valida()) then raise exception 'sessao'; end if;
  if v_loja is null or v_loja !~ '^[a-f0-9]{16}$' or v_comp !~ '^[0-9]{1,18}$' then raise exception 'identidade'; end if;
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) > 100 or p_em is null or p_em <= 0 then raise exception 'dados'; end if;
  -- Guarda só os campos previstos, com tipos conferidos.
  select coalesce(jsonb_agg(jsonb_build_object(
           'produto_id', (l ->> 'produto_id')::bigint,
           'unidade', case when jsonb_typeof(l -> 'unidade') in ('string', 'number') then left(l ->> 'unidade', 40) end,
           'quantidade', l ->> 'quantidade',
           'nome', left(coalesce(l ->> 'nome', ''), 200),
           'codigo', left(coalesce(l ->> 'codigo', ''), 40),
           'unidadeNome', left(coalesce(l ->> 'unidadeNome', ''), 20))), '[]'::jsonb)
    into v_linhas
  from jsonb_array_elements(p_linhas) l
  where jsonb_typeof(l) = 'object'
    and (l ->> 'produto_id') ~ '^[1-9][0-9]{0,17}$'
    and (l ->> 'quantidade') ~ '^[0-9]{1,7}(\.[0-9]{1,4})?$';
  -- Relógio do navegador adiantado não passa na frente para sempre.
  p_em := least(p_em, v_agora + 60000);
  insert into public.portal_carrinhos as c (loja, comprador_codigo, linhas, em, atualizado_em)
  values (v_loja, v_comp::bigint, v_linhas, p_em, statement_timestamp())
  on conflict (loja, comprador_codigo) do update
    set linhas = excluded.linhas, em = excluded.em, atualizado_em = excluded.atualizado_em
    where c.em < excluded.em;
  return found;
end;
$$;

revoke all on function public.portal_carrinho_ler() from public, anon;
revoke all on function public.portal_carrinho_gravar(jsonb, bigint) from public, anon;
grant execute on function public.portal_carrinho_ler() to authenticated;
grant execute on function public.portal_carrinho_gravar(jsonb, bigint) to authenticated;
