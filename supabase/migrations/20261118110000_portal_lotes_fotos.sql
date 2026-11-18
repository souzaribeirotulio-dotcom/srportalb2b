-- Planilhas de fotos entregues aos funcionários (lotes de códigos), para não repetir produto entre lotes.
create table if not exists public.portal_lotes_fotos (
  id uuid primary key default gen_random_uuid(),
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  numero integer not null check (numero > 0),
  responsavel text check (responsavel is null or char_length(responsavel) <= 80),
  codigos text[] not null check (cardinality(codigos) between 1 and 500),
  criado_em timestamptz not null default statement_timestamp(),
  unique (loja, numero)
);
alter table public.portal_lotes_fotos enable row level security;
revoke all on public.portal_lotes_fotos from anon, authenticated;
