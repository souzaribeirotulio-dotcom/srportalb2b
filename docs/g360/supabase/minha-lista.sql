-- Execute como mantenedor do projeto em uma migração.
begin;

create schema if not exists g360_ponte_privado;
revoke all on schema g360_ponte_privado from public, anon, authenticated;

create table g360_ponte_privado.sessoes (
  sessao uuid primary key references auth.sessions (id) on delete cascade,
  usuario uuid not null references auth.users (id) on delete cascade,
  expira_em timestamptz not null
);
revoke all on g360_ponte_privado.sessoes from public, anon, authenticated;

-- Só a função do servidor registra uma sessão depois de conferir GET me.
create function public.vincular_sessao_g360(
  p_sessao uuid,
  p_usuario uuid,
  p_expira_em timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_expira_em is null or p_expira_em <= statement_timestamp() or not exists (
    select 1 from auth.sessions s where s.id = p_sessao and s.user_id = p_usuario
  ) then
    raise exception 'Sessão inválida';
  end if;

  insert into g360_ponte_privado.sessoes (sessao, usuario, expira_em)
  values (p_sessao, p_usuario, p_expira_em)
  on conflict (sessao) do nothing;
end;
$$;

revoke all on function public.vincular_sessao_g360(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.vincular_sessao_g360(uuid, uuid, timestamptz)
  to service_role;

create function g360_ponte_privado.sessao_valida()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from g360_ponte_privado.sessoes s
    where s.sessao = ((select auth.jwt()) ->> 'session_id')::uuid
      and s.usuario = (select auth.uid())
      and s.expira_em > statement_timestamp()
  )
$$;

revoke all on function g360_ponte_privado.sessao_valida() from public, anon;
grant execute on function g360_ponte_privado.sessao_valida() to authenticated;

create table public.minha_lista (
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  comprador_codigo bigint not null check (comprador_codigo > 0),
  produto_id bigint not null check (produto_id > 0),
  primary key (loja, comprador_codigo, produto_id)
);

comment on column public.minha_lista.produto_id is
  'id numérico da API, usado como produto_id no carrinho e em produto_ids no histórico.';

alter table public.minha_lista enable row level security;
revoke all on public.minha_lista from public, anon, authenticated;
grant select, insert, delete on public.minha_lista to authenticated;

-- A mesma condição vale para ler, incluir ou remover.
create policy minha_lista_do_comprador
on public.minha_lista
for all to authenticated
using (
  (select g360_ponte_privado.sessao_valida())
  and loja = (select auth.jwt() -> 'app_metadata' ->> 'g360_loja')
  and comprador_codigo::text = (select auth.jwt() -> 'app_metadata' ->> 'g360_comprador')
)
with check (
  (select g360_ponte_privado.sessao_valida())
  and loja = (select auth.jwt() -> 'app_metadata' ->> 'g360_loja')
  and comprador_codigo::text = (select auth.jwt() -> 'app_metadata' ->> 'g360_comprador')
);

create table public.ocorrencias_g360 (
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  comprador_codigo bigint check (comprador_codigo > 0),
  codigo text not null check (codigo ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  request_id text not null check (request_id ~ '^[a-f0-9]{16}$'),
  operacao text not null check (operacao ~ '^(GET|POST|PUT|DELETE) [a-z][a-z0-9/{_}-]{0,79}$'),
  registrada_em timestamptz not null default statement_timestamp()
);

alter table public.ocorrencias_g360 enable row level security;
revoke all on public.ocorrencias_g360 from public, anon, authenticated;
grant insert (loja, comprador_codigo, codigo, request_id, operacao)
  on public.ocorrencias_g360 to authenticated;
grant select on public.ocorrencias_g360 to authenticated;

create policy inserir_ocorrencia_comprador
on public.ocorrencias_g360
for insert to authenticated
with check (
  (select g360_ponte_privado.sessao_valida())
  and loja = (select auth.jwt() -> 'app_metadata' ->> 'g360_loja')
  and comprador_codigo::text = (select auth.jwt() -> 'app_metadata' ->> 'g360_comprador')
  and operacao <> 'POST acessos/links'
);

create policy ler_ocorrencias_painel
on public.ocorrencias_g360
for select to authenticated
using (
  loja = (select auth.jwt() -> 'app_metadata' ->> 'g360_painel_loja')
  and (select auth.jwt() -> 'app_metadata' ->> 'g360_comprador') is null
);

-- A chave de deduplicação fica fora das tabelas que o painel lê.
create table g360_ponte_privado.limite_ocorrencias_link (
  loja text not null,
  dia_utc date not null,
  marcador text not null check (marcador ~ '^[a-f0-9]{64}$'),
  primary key (loja, dia_utc, marcador)
);
revoke all on g360_ponte_privado.limite_ocorrencias_link from public, anon, authenticated;

create function public.registrar_ocorrencia_link_g360(
  p_loja text,
  p_codigo text,
  p_request_id text,
  p_marcador text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into g360_ponte_privado.limite_ocorrencias_link (loja, dia_utc, marcador)
  values (p_loja, (statement_timestamp() at time zone 'UTC')::date, p_marcador)
  on conflict do nothing;

  if found then
    insert into public.ocorrencias_g360 (loja, codigo, request_id, operacao)
    values (p_loja, p_codigo, p_request_id, 'POST acessos/links');
  end if;
end;
$$;

revoke all on function public.registrar_ocorrencia_link_g360(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.registrar_ocorrencia_link_g360(text, text, text, text)
  to service_role;

commit;
