-- Banners do topo do catálogo. A equipe cadastra no painel (função painel-g360, chave secreta);
-- o portal só lê os ativos dentro do período. As imagens ficam num bucket público.
create table if not exists public.portal_banners (
  id uuid primary key default gen_random_uuid(),
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  titulo text not null check (char_length(titulo) between 1 and 120),
  img_desktop text not null check (img_desktop ~ '^[a-f0-9]{16}/[0-9a-f-]{36}\.(jpg|webp|png)$'),
  img_celular text check (img_celular is null or img_celular ~ '^[a-f0-9]{16}/[0-9a-f-]{36}\.(jpg|webp|png)$'),
  destino_tipo text not null default 'nenhum' check (destino_tipo in ('nenhum', 'categoria', 'busca', 'produto', 'lista', 'cadastro')),
  destino_valor text check (destino_valor is null or char_length(destino_valor) <= 120),
  ordem integer not null default 0,
  inicio date,
  fim date,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  check (fim is null or inicio is null or fim >= inicio)
);
create index if not exists portal_banners_loja_idx on public.portal_banners (loja, ativo, ordem);
alter table public.portal_banners enable row level security;
revoke all on public.portal_banners from public, anon, authenticated;
grant select on public.portal_banners to anon, authenticated;
drop policy if exists portal_banners_leitura on public.portal_banners;
-- Período no horário de Brasília: o banner do Natal sai no dia 26 de manhã para todos.
create policy portal_banners_leitura on public.portal_banners for select to anon, authenticated
  using (ativo
    and (inicio is null or inicio <= (now() at time zone 'America/Sao_Paulo')::date)
    and (fim is null or fim >= (now() at time zone 'America/Sao_Paulo')::date));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-banners', 'portal-banners', true, 3145728, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
