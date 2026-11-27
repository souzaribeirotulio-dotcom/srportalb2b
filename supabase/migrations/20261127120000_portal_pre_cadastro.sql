-- Pré-cadastro em lote (decisão da Souza Ribeiro em 27/11/2026).
-- Clientes ativos do G360 que podem criar a senha no "Quero ser cliente" e entrar
-- direto, e os preços que o painel congela em lote no G360.
-- Só a chave secreta (funções do servidor) lê e grava: nada liberado para o site.
begin;

create table public.portal_pre_cadastro (
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  comprador_codigo bigint not null check (comprador_codigo > 0),
  documento text not null check (documento ~ '^[A-Z0-9]{11,14}$'),
  nome text not null,
  cidade text,
  bairro text,
  vendedores text,
  ultima_compra date,
  itens_lista integer not null default 0,
  itens_congelados integer not null default 0,
  lote text not null,
  acesso_liberado_em timestamptz,
  acesso_obs text,
  senha_criada_em timestamptz,
  criado_em timestamptz not null default now(),
  primary key (loja, comprador_codigo)
);
-- Um mesmo CPF pode ter mais de uma ficha no G360 (ex.: fazendas): o formulário manda esses para a equipe.
create index portal_pre_cadastro_documento on public.portal_pre_cadastro (loja, documento);

create table public.portal_pre_congelados (
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  comprador_codigo bigint not null check (comprador_codigo > 0),
  produto_id bigint not null check (produto_id > 0),
  sku text not null,
  unidade_venda text not null,
  valor text not null check (valor ~ '^(?:0|[1-9][0-9]{0,10})(?:\.[0-9]{1,7})?$'),
  inicio date not null,
  fim date not null check (fim >= inicio),
  nf_origem text,
  data_venda date,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'gravado', 'recusado', 'ignorado')),
  preco_id bigint,
  obs text,
  atualizado_em timestamptz not null default now(),
  primary key (loja, comprador_codigo, produto_id),
  foreign key (loja, comprador_codigo) references public.portal_pre_cadastro (loja, comprador_codigo) on delete cascade
);
create index portal_pre_congelados_situacao on public.portal_pre_congelados (loja, situacao);

alter table public.portal_pre_cadastro enable row level security;
alter table public.portal_pre_congelados enable row level security;
revoke all on public.portal_pre_cadastro from public, anon, authenticated;
revoke all on public.portal_pre_congelados from public, anon, authenticated;

commit;
