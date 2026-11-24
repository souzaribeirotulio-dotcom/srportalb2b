-- Avisos no celular para o EXECUTIVO de contas ("Você vendeu!").
-- Aparelhos do executivo: lidos e gravados só pela função push-g360, com a chave secreta,
-- depois de conferir a sessão do executivo no Supabase Auth. RLS ligada e nenhuma política:
-- o navegador não lê nem grava aqui.
create table if not exists public.executivo_push_inscricoes (
  id bigint generated always as identity primary key,
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  executivo_id uuid not null references public.executivos (id) on delete cascade,
  endpoint text not null check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  aparelho text not null default '' check (length(aparelho) <= 60),
  criado_em timestamptz not null default now(),
  unique (loja, executivo_id, endpoint)
);
alter table public.executivo_push_inscricoes enable row level security;
revoke all on public.executivo_push_inscricoes from anon, authenticated;

-- Cada comissão avisa uma vez só. Coluna interna (o navegador não lê).
alter table public.comissoes add column if not exists avisado_em timestamptz;
-- As que já existem não geram aviso.
update public.comissoes set avisado_em = coalesce(pedido_em, criado_em) where avisado_em is null;
