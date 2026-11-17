-- Fichas de cliente do painel (Novo/Editar cliente) e lista de vendedores.
-- A ficha é só do portal: não cria nem altera nada no G360.
alter table public.portal_cadastros
  add column if not exists codigo_g360 integer check (codigo_g360 is null or codigo_g360 > 0),
  add column if not exists vendedor text check (vendedor is null or char_length(vendedor) <= 80),
  add column if not exists criado_por text not null default 'portal' check (criado_por in ('portal', 'equipe'));

-- Um CNPJ/CPF por loja.
create unique index if not exists portal_cadastros_loja_documento_uq on public.portal_cadastros (loja, documento);
create index if not exists portal_cadastros_loja_codigo_idx on public.portal_cadastros (loja, codigo_g360);

create table if not exists public.portal_vendedores (
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  nome text not null check (char_length(nome) between 1 and 80),
  ordem integer not null default 0,
  primary key (loja, nome)
);
-- Sem política: só a função painel-g360 (chave secreta) lê e grava.
alter table public.portal_vendedores enable row level security;

-- portal_cadastro_solicitar passou a recusar documento que já tenha ficha em qualquer situação
-- (aplicada como portal_cadastro_solicitar_documento_unico; mesma função de 20261117120000 com o "status = 'pendente'" retirado).
