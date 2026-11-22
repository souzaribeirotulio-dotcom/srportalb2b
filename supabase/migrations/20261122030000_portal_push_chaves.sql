-- Par de chaves VAPID dos avisos no celular. Gerado e lido só pela função push-g360,
-- com a chave secreta. RLS ligada e nenhuma política: o navegador não lê nem grava aqui.
create table if not exists public.push_chaves (
  id smallint primary key default 1 check (id = 1),
  publica text not null,
  privada text not null,
  criado_em timestamptz not null default now()
);
alter table public.push_chaves enable row level security;
revoke all on public.push_chaves from anon, authenticated;
