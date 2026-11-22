-- Avisos no celular (notificação push) do Portal B2B.
-- Cada linha é um aparelho que o comprador autorizou a receber avisos.
-- Guarda só o endereço de entrega do aviso (endpoint) e as chaves públicas do aparelho:
-- nada de token, senha ou documento.
-- Regra de acesso igual à da Minha Lista: só a sessão vinculada pela ponte, da própria loja
-- e do próprio código de comprador, lê, inclui e remove as suas linhas.
-- Quem envia o aviso é a função enviar-push, com a chave secreta (fora do navegador).
create table if not exists public.push_inscricoes (
  id bigint generated always as identity primary key,
  loja text not null,
  comprador_codigo bigint not null,
  endpoint text not null check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  aparelho text not null default '' check (length(aparelho) <= 60),
  criado_em timestamptz not null default now(),
  unique (loja, comprador_codigo, endpoint)
);

alter table public.push_inscricoes enable row level security;

revoke all on public.push_inscricoes from anon;
grant select, insert, delete on public.push_inscricoes to authenticated;

drop policy if exists push_inscricoes_do_comprador on public.push_inscricoes;
create policy push_inscricoes_do_comprador on public.push_inscricoes
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
