-- Margens (27/11/2026): a equipe marca cada margem baixa como "precisa ajustar" ou "margem ok".
-- "Margem ok" não volta para a lista nas próximas conferências, a não ser que a margem caia mais 1 ponto
-- ou mais abaixo da que estava quando foi marcada. Só a função margens-g360 lê e grava.
create table if not exists public.margens_marcas (
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  produto_id integer not null,
  status text not null check (status in ('ajustar', 'ok')),
  margem_marcada numeric,
  marcado_por text check (marcado_por is null or char_length(marcado_por) <= 80),
  marcado_em timestamptz not null default now(),
  primary key (loja, produto_id)
);
alter table public.margens_marcas enable row level security;
revoke all on public.margens_marcas from public, anon, authenticated;
