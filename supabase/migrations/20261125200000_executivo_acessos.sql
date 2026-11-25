-- Área do executivo: ver se o cliente indicado já entrou no portal e reenviar o link de acesso.
-- executivo_links: registro dos links pedidos pelo executivo (sem documento, sem e-mail). Ninguém lê
-- direto: só a função executivo-link (chave secreta) grava, e executivo_acessos() resume.
create table if not exists public.executivo_links (
  id bigint generated always as identity primary key,
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  executivo_id uuid not null references public.executivos (id) on delete cascade,
  vinculo_id uuid not null references public.executivo_clientes (id) on delete cascade,
  enviado_em timestamptz not null default now()
);
create index if not exists executivo_links_vinculo on public.executivo_links (vinculo_id, enviado_em desc);
alter table public.executivo_links enable row level security;
revoke all on public.executivo_links from public, anon, authenticated;

-- Último acesso ao portal dos clientes aprovados do executivo logado (o recorte vem de executivo_da_sessao()).
create or replace function public.executivo_acessos()
returns table (vinculo_id uuid, primeiro_em timestamptz, ultimo_em timestamptz, acessos integer, link_em timestamptz)
language sql stable security definer set search_path = ''
as $$
  select v.id, a.primeiro_em, a.ultimo_em, a.acessos,
         (select max(l.enviado_em) from public.executivo_links l where l.vinculo_id = v.id)
  from public.executivo_clientes v
  left join public.portal_acessos a on a.loja = v.loja and a.comprador_codigo = v.cliente_codigo
  where v.executivo_id = (select public.executivo_da_sessao())
    and v.situacao in ('ativo', 'sem_comissao')
    and v.cliente_codigo is not null;
$$;
revoke all on function public.executivo_acessos() from public, anon;
grant execute on function public.executivo_acessos() to authenticated;
