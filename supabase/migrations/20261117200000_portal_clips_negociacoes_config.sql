-- Clips, negociações de preço, produto oculto e configurações do portal.

-- Produto oculto no catálogo (decisão da equipe; não mexe no G360).
alter table public.portal_produtos_exibicao add column if not exists oculto boolean not null default false;

-- Configurações da loja. Só a função painel-g360 grava; o site lê a parte pública pela RPC.
create table if not exists public.portal_config (
  loja text primary key check (loja ~ '^[a-f0-9]{16}$'),
  so_estoque boolean not null default false,
  margem_minima numeric(5,2) not null default 15 check (margem_minima between 0 and 100),
  atualizado_em timestamptz not null default now()
);
alter table public.portal_config enable row level security;
revoke all on public.portal_config from public, anon, authenticated;

create or replace function public.portal_config_publica(p_loja text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('so_estoque', coalesce((select c.so_estoque from public.portal_config c where c.loja = p_loja), false))
$$;
revoke all on function public.portal_config_publica(text) from public;
grant execute on function public.portal_config_publica(text) to anon, authenticated;

-- Clips (vídeos verticais dos produtos). Leitura pública só dos ativos; gravação pela função painel-g360.
create table if not exists public.portal_clips (
  id uuid primary key default gen_random_uuid(),
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  produto_id bigint not null check (produto_id > 0),
  codigo text not null check (char_length(codigo) between 1 and 40),
  titulo text check (titulo is null or char_length(titulo) <= 120),
  caminho text not null check (caminho ~ '^[a-f0-9]{16}/[0-9a-f-]{36}\.(mp4|webm|mov)$'),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index if not exists portal_clips_loja_idx on public.portal_clips (loja, ativo, criado_em desc);
alter table public.portal_clips enable row level security;
revoke all on public.portal_clips from public, anon, authenticated;
grant select on public.portal_clips to anon, authenticated;
create policy portal_clips_leitura on public.portal_clips for select to anon, authenticated using (ativo);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-clips', 'portal-clips', true, 52428800, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Negociações de preço: o comprador pede, a equipe aprova (vira preço congelado no G360) ou recusa.
create table if not exists public.portal_negociacoes (
  id uuid primary key default gen_random_uuid(),
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  comprador_codigo bigint not null check (comprador_codigo > 0),
  comprador_nome text check (comprador_nome is null or char_length(comprador_nome) <= 200),
  produto_id bigint not null check (produto_id > 0),
  codigo text not null check (char_length(codigo) between 1 and 40),
  produto_nome text not null check (char_length(produto_nome) between 1 and 200),
  unidade text check (unidade is null or char_length(unidade) <= 40),
  preco_atual text check (preco_atual is null or preco_atual ~ '^[0-9]{1,11}(\.[0-9]{1,7})?$'),
  preco_desejado text not null check (preco_desejado ~ '^[0-9]{1,11}(\.[0-9]{1,4})?$'),
  quantidade text check (quantidade is null or quantidade ~ '^[0-9]{1,7}(\.[0-9]{1,4})?$'),
  mensagem text check (mensagem is null or char_length(mensagem) <= 400),
  status text not null default 'aberta' check (status in ('aberta', 'aprovada', 'recusada', 'cancelada')),
  preco_aprovado text check (preco_aprovado is null or preco_aprovado ~ '^[0-9]{1,11}(\.[0-9]{1,7})?$'),
  valido_ate date,
  resposta text check (resposta is null or char_length(resposta) <= 400),
  decidido_por text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists portal_negociacoes_loja_idx on public.portal_negociacoes (loja, status, criado_em desc);
alter table public.portal_negociacoes enable row level security;
revoke all on public.portal_negociacoes from public, anon, authenticated;
grant select, insert on public.portal_negociacoes to authenticated;
grant update (status, atualizado_em) on public.portal_negociacoes to authenticated;

create policy negociacoes_ler_do_comprador on public.portal_negociacoes for select to authenticated using (
  (select g360_ponte_privado.sessao_valida())
  and loja = (select auth.jwt() -> 'app_metadata' ->> 'g360_loja')
  and comprador_codigo::text = (select auth.jwt() -> 'app_metadata' ->> 'g360_comprador'));
create policy negociacoes_pedir on public.portal_negociacoes for insert to authenticated with check (
  (select g360_ponte_privado.sessao_valida())
  and loja = (select auth.jwt() -> 'app_metadata' ->> 'g360_loja')
  and comprador_codigo::text = (select auth.jwt() -> 'app_metadata' ->> 'g360_comprador')
  and status = 'aberta' and preco_aprovado is null and valido_ate is null and resposta is null and decidido_por is null);
-- O comprador só pode cancelar um pedido ainda aberto.
create policy negociacoes_cancelar on public.portal_negociacoes for update to authenticated using (
  (select g360_ponte_privado.sessao_valida())
  and loja = (select auth.jwt() -> 'app_metadata' ->> 'g360_loja')
  and comprador_codigo::text = (select auth.jwt() -> 'app_metadata' ->> 'g360_comprador')
  and status = 'aberta') with check (status = 'cancelada');

-- Unidade alternativa negociada (id do catálogo; nulo = unidade base). Aplicada como portal_negociacoes_unidade_id.
alter table public.portal_negociacoes add column if not exists unidade_id text check (unidade_id is null or char_length(unidade_id) between 1 and 100);

-- O painel decide cadastros pela função painel-g360; a RPC antiga (login separado do painel) deixa de ser chamável.
revoke execute on function public.portal_cadastro_decidir(uuid, text, text) from public, anon, authenticated;
