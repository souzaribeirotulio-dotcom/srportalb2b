-- Avisos no celular para os GESTORES (app da equipe, /painel).
-- Tudo aqui é lido e gravado só pela função push-g360, com a chave secreta.
-- RLS ligada e nenhuma política: o navegador não lê nem grava nestas tabelas.

-- Operadores do G360 que já entraram no painel. "gestor" é marcado pela Souza Ribeiro
-- (SQL Editor): só gestor recebe os avisos de venda, negociação e cadastro.
create table if not exists public.painel_operadores (
  loja text not null,
  codigo bigint not null,
  usuario text not null default '',
  nome text not null default '',
  gestor boolean not null default false,
  visto_em timestamptz not null default now(),
  primary key (loja, codigo)
);

-- Aparelhos dos gestores que ativaram os avisos.
create table if not exists public.painel_push_inscricoes (
  id bigint generated always as identity primary key,
  loja text not null,
  operador_codigo bigint not null,
  endpoint text not null check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  aparelho text not null default '' check (length(aparelho) <= 60),
  criado_em timestamptz not null default now(),
  unique (loja, operador_codigo, endpoint)
);

-- Registro do que já foi avisado (cada venda, negociação ou cadastro é avisado uma vez só).
create table if not exists public.push_avisos_enviados (
  loja text not null,
  tipo text not null check (tipo in ('pedido','negociacao','cadastro')),
  ref text not null,
  enviado_em timestamptz not null default now(),
  primary key (loja, tipo, ref)
);

alter table public.painel_operadores enable row level security;
alter table public.painel_push_inscricoes enable row level security;
alter table public.push_avisos_enviados enable row level security;
revoke all on public.painel_operadores, public.painel_push_inscricoes, public.push_avisos_enviados from anon, authenticated;
