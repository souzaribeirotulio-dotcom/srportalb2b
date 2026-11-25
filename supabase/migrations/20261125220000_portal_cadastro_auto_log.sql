-- Registro das ações da função cadastro-g360 (testes do usuário técnico e cadastros automáticos), para limitar a frequência.
-- Sem usuário, senha, documento ou e-mail. Ninguém lê pelo navegador.
create table if not exists public.portal_cadastro_auto_log (
  id bigint generated always as identity primary key,
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  acao text not null check (char_length(acao) between 1 and 30),
  resultado text check (resultado is null or char_length(resultado) <= 60),
  em timestamptz not null default now()
);
create index if not exists portal_cadastro_auto_log_idx on public.portal_cadastro_auto_log (loja, acao, em desc);
alter table public.portal_cadastro_auto_log enable row level security;
revoke all on public.portal_cadastro_auto_log from public, anon, authenticated;
