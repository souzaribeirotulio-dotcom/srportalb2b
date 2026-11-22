-- Quem entra no painel pela primeira vez não vê nada até um gestor liberar.
create or replace function public.painel_permissoes_padrao() returns text[] language sql immutable as $$
  select '{}'::text[];
$$;

-- Permissões cadastradas ANTES do primeiro acesso, pelo usuário do G360 (aplicadas no primeiro login).
create table if not exists public.painel_permissoes_pre (
  loja text not null,
  usuario text not null check (usuario = upper(btrim(usuario)) and length(usuario) between 1 and 60),
  permissoes text[] not null default '{}',
  criado_em timestamptz not null default now(),
  criado_por bigint,
  primary key (loja, usuario)
);
alter table public.painel_permissoes_pre enable row level security;
revoke all on public.painel_permissoes_pre from anon, authenticated;
