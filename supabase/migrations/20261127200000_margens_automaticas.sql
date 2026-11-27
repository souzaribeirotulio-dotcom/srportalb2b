-- Margens automáticas (27/11/2026): de segunda a sexta, a partir das 18h (Brasília), a função margens-g360
-- confere no G360 a margem de todos os produtos com estoque disponível e guarda o resultado aqui.
-- O painel (aba Margens) só lê o que ficou guardado. Tudo fica fechado ao navegador: só a função lê e grava.

create table if not exists public.margens_rodada (
  loja text primary key check (loja ~ '^[a-f0-9]{16}$'),
  dia date,                       -- dia (Brasília) da rodada em andamento ou concluída
  pagina integer not null default 0,
  paginas integer,
  produtos integer not null default 0, -- com estoque positivo, nesta rodada
  iniciada_em timestamptz,
  concluida_em timestamptz,
  origem text check (origem is null or origem in ('agenda', 'manual')),
  erro text check (erro is null or char_length(erro) <= 300)
);

create table if not exists public.margens_produtos (
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  produto_id integer not null,
  codigo text not null default '',
  nome text not null default '',
  preco text,                     -- texto decimal como veio da API (sem conta no navegador)
  custo numeric,
  margem numeric,
  origem_preco text,
  disponivel numeric not null,
  custo_visivel boolean not null default true,
  verificado_em timestamptz not null default now(),
  primary key (loja, produto_id)
);
create index if not exists margens_produtos_margem_idx on public.margens_produtos (loja, margem);

alter table public.margens_rodada enable row level security;
alter table public.margens_produtos enable row level security;
revoke all on public.margens_rodada, public.margens_produtos from public, anon, authenticated;

-- Chave da agenda: gerada aqui, guardada no Vault e nunca sai do banco.
-- O pg_cron manda a chave no cabeçalho; a função confere pela RPC abaixo (só a chave secreta do servidor chama).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'margens_agenda') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'margens_agenda', 'Chave do agendamento das margens (pg_cron -> margens-g360)');
  end if;
end $$;

create or replace function public.margens_agenda_confere(p_chave text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(length(p_chave) >= 32 and p_chave = (select decrypted_secret from vault.decrypted_secrets where name = 'margens_agenda'), false);
$$;
revoke all on function public.margens_agenda_confere(text) from public, anon, authenticated;
grant execute on function public.margens_agenda_confere(text) to service_role;

-- Agenda: de segunda a sexta, a cada 5 minutos das 18h00 às 18h55 (21h UTC). Cada chamada confere um lote e,
-- quando a rodada do dia termina, as chamadas seguintes não fazem nada.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'margens-g360') then perform cron.unschedule('margens-g360'); end if;
end $$;

select cron.schedule('margens-g360', '*/5 21 * * 1-5', $cron$
  select net.http_post(
    url := 'https://rkhrapgxjbwghdtqjtpp.supabase.co/functions/v1/margens-g360',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'X-Agenda-Chave', (select decrypted_secret from vault.decrypted_secrets where name = 'margens_agenda')),
    body := '{"acao":"agenda"}'::jsonb,
    timeout_milliseconds := 150000
  );
$cron$);
