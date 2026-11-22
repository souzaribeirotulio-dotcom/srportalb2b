-- Permissões próprias do painel (só restringem: o que o G360 nega continua negado).
-- permissoes_definidas = false → vale o padrão (as áreas do dia a dia, sem Vendas, Estoque, Avisos e Permissões).
alter table public.painel_operadores add column if not exists permissoes_definidas boolean not null default false;

create or replace function public.painel_permissoes_padrao() returns text[] language sql immutable as $$
  select array['visita','cli','neg','prod','cong','mrg','intel','souzinha','cfg','ocor']::text[];
$$;

create or replace function public.painel_permissoes_efetivas(p_loja text, p_codigo bigint) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((select case when o.permissoes_definidas then o.permissoes else public.painel_permissoes_padrao() end
                   from public.painel_operadores o where o.loja = p_loja and o.codigo = p_codigo),
                  public.painel_permissoes_padrao());
$$;
revoke all on function public.painel_permissoes_efetivas(text, bigint) from public, anon, authenticated;

-- Quem administra as permissões na produção é marcado à parte (SQL Editor), com o código do operador no G360:
-- update public.painel_operadores set permissoes = array[...], permissoes_definidas = true, gestor = true
--  where loja = '<preencha>' and codigo = <preencha>;
