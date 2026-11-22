-- Permissões próprias do painel por operador (só restringem; o que o G360 nega continua negado).
alter table public.painel_operadores add column if not exists permissoes text[] not null default '{}';

-- Estoque disponível atual de cada produto (última leitura) e o pico diário (para achar quedas).
create table if not exists public.estoque_atual (
  loja text not null, produto_id bigint not null, codigo text not null default '', nome text not null default '',
  disponivel numeric not null, lido_em timestamptz not null default now(), primary key (loja, produto_id)
);
create table if not exists public.estoque_dia (
  loja text not null, produto_id bigint not null, dia date not null, maximo numeric not null, primary key (loja, produto_id, dia)
);
-- Avisos marcados como vistos (voltam se o produto for reabastecido e cair de novo).
create table if not exists public.estoque_vistos (
  loja text not null, produto_id bigint not null, pico numeric not null, visto_em timestamptz not null default now(), visto_por bigint,
  primary key (loja, produto_id)
);
-- Controle da leitura (uma rodada por vez, no máximo a cada hora).
create table if not exists public.estoque_leitura (
  loja text primary key, iniciada_em timestamptz, concluida_em timestamptz, paginas int not null default 0
);
alter table public.estoque_atual enable row level security;
alter table public.estoque_dia enable row level security;
alter table public.estoque_vistos enable row level security;
alter table public.estoque_leitura enable row level security;
revoke all on public.estoque_atual, public.estoque_dia, public.estoque_vistos, public.estoque_leitura from anon, authenticated;

-- Grava o máximo do dia sem sobrescrever com um valor menor.
create or replace function public.estoque_registrar_dia(p_loja text, p_itens jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.estoque_dia (loja, produto_id, dia, maximo)
  select p_loja, (i->>'produto_id')::bigint, (now() at time zone 'America/Sao_Paulo')::date, (i->>'disponivel')::numeric
  from jsonb_array_elements(p_itens) i
  on conflict (loja, produto_id, dia) do update set maximo = greatest(public.estoque_dia.maximo, excluded.maximo);
$$;
revoke all on function public.estoque_registrar_dia(text, jsonb) from public, anon, authenticated;
