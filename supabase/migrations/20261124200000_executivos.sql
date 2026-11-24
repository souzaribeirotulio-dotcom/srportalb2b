-- Programa "Executivo de Contas": parceiros que indicam clientes novos e ganham comissão
-- sobre os pedidos feitos pelo portal por esses clientes.
-- Gravação: só a função executivos-g360 (chave secreta), depois de conferir o operador no G360
-- e a permissão própria 'executivos'. Leitura pelo navegador: só o próprio executivo, logado
-- com a conta dele (auth.uid() = executivos.user_id), e só as linhas dele.

-- Operadores do painel e permissões próprias (já existem na produção; aqui só cria o que faltar).
create table if not exists public.painel_operadores (
  loja text not null,
  codigo bigint not null,
  usuario text not null default '',
  nome text not null default '',
  gestor boolean not null default false,
  visto_em timestamptz not null default now(),
  primary key (loja, codigo)
);
alter table public.painel_operadores enable row level security;
revoke all on public.painel_operadores from anon, authenticated;
alter table public.painel_operadores add column if not exists permissoes text[] not null default '{}';
alter table public.painel_operadores add column if not exists permissoes_definidas boolean not null default false;
do $do$ begin
  if not exists (select 1 from pg_proc where proname = 'painel_permissoes_padrao') then
    execute $f$create function public.painel_permissoes_padrao() returns text[] language sql immutable as 'select ''{}''::text[]'$f$;
  end if;
  if not exists (select 1 from pg_proc where proname = 'painel_permissoes_efetivas') then
    execute $f$create function public.painel_permissoes_efetivas(p_loja text, p_codigo bigint) returns text[]
      language sql stable security definer set search_path = '' as $g$
        select coalesce((select case when o.permissoes_definidas then o.permissoes else public.painel_permissoes_padrao() end
                         from public.painel_operadores o where o.loja = p_loja and o.codigo = p_codigo),
                        public.painel_permissoes_padrao());
      $g$
    $f$;
    execute 'revoke all on function public.painel_permissoes_efetivas(text, bigint) from public, anon, authenticated';
  end if;
end $do$;

-- Executivos
create table if not exists public.executivos (
  id uuid primary key default gen_random_uuid(),
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  codigo text not null check (codigo ~ '^[A-Z0-9]{3,20}$'),
  nome text not null check (char_length(nome) between 2 and 120),
  documento text not null check (documento ~ '^[A-Z0-9]{11,14}$'),
  whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9]{10,11}$'),
  email text not null check (char_length(email) between 5 and 160),
  percentual numeric(5,2) check (percentual is null or (percentual >= 0 and percentual <= 50)),
  vendedor_g360 integer check (vendedor_g360 is null or vendedor_g360 > 0),
  vendedor_nome text check (vendedor_nome is null or char_length(vendedor_nome) <= 120),
  ativo boolean not null default true,
  user_id uuid unique references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (loja, codigo)
);

-- Vínculo executivo -> cliente indicado
create table if not exists public.executivo_clientes (
  id uuid primary key default gen_random_uuid(),
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  executivo_id uuid not null references public.executivos (id) on delete cascade,
  cadastro_id uuid references public.portal_cadastros (id) on delete set null,
  cliente_codigo bigint check (cliente_codigo is null or cliente_codigo > 0),
  documento text not null check (documento ~ '^[A-Z0-9]{11,14}$'),
  razao_social text not null default '' check (char_length(razao_social) <= 200),
  situacao text not null default 'aguardando'
    check (situacao in ('aguardando', 'ativo', 'recusado', 'removido', 'sem_comissao')),
  inicio date,
  fim date,
  motivo text check (motivo is null or char_length(motivo) <= 300),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (fim is null or inicio is null or fim >= inicio)
);
-- Um cliente só pode estar vinculado a um executivo por vez.
create unique index if not exists executivo_clientes_um_ativo on public.executivo_clientes (loja, documento)
  where situacao in ('aguardando', 'ativo');
create index if not exists executivo_clientes_exec on public.executivo_clientes (executivo_id);
create index if not exists executivo_clientes_cliente on public.executivo_clientes (loja, cliente_codigo);

-- Comissões: uma linha por pedido do portal de cliente vinculado.
create table if not exists public.comissoes (
  id uuid primary key default gen_random_uuid(),
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  executivo_id uuid not null references public.executivos (id) on delete cascade,
  vinculo_id uuid references public.executivo_clientes (id) on delete set null,
  cliente_codigo bigint not null,
  pedido_ref text not null check (char_length(pedido_ref) between 1 and 40),
  pedido_data date not null,
  competencia date not null check (extract(day from competencia) = 1),
  base numeric(14,2) not null check (base >= 0),
  percentual numeric(5,2) not null check (percentual >= 0 and percentual <= 50),
  valor numeric(14,2) not null check (valor >= 0),
  situacao text not null default 'prevista'
    check (situacao in ('prevista', 'faturada', 'liberada', 'paga', 'cancelada')),
  faturado_em date,
  liberada_em date,
  paga_em date,
  observacao text check (observacao is null or char_length(observacao) <= 300),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (loja, pedido_ref)
);
create index if not exists comissoes_exec_mes on public.comissoes (executivo_id, competencia);

-- Regras do programa (uma linha por loja)
create table if not exists public.comissao_config (
  loja text primary key check (loja ~ '^[a-f0-9]{16}$'),
  percentual numeric(5,2) not null default 3 check (percentual >= 0 and percentual <= 50),
  liberar_em text not null default 'pagamento' check (liberar_em in ('faturamento', 'pagamento')),
  so_novos boolean not null default true,
  prazo_meses integer default 12 check (prazo_meses is null or prazo_meses between 1 and 120),
  atualizado_em timestamptz not null default now()
);

-- Código do executivo informado no "Quero ser cliente" (opcional, só texto; a equipe confere).
alter table public.portal_cadastros add column if not exists executivo_codigo text
  check (executivo_codigo is null or executivo_codigo ~ '^[A-Z0-9]{3,20}$');

-- RLS: tudo ligado. O navegador só LÊ, e só o próprio executivo.
alter table public.executivos enable row level security;
alter table public.executivo_clientes enable row level security;
alter table public.comissoes enable row level security;
alter table public.comissao_config enable row level security;
revoke all on public.executivos, public.executivo_clientes, public.comissoes, public.comissao_config from anon, authenticated;
grant select (id, codigo, nome, ativo) on public.executivos to authenticated;
grant select (id, executivo_id, razao_social, situacao, inicio, fim, criado_em) on public.executivo_clientes to authenticated;
grant select (id, executivo_id, pedido_data, competencia, base, percentual, valor, situacao, paga_em) on public.comissoes to authenticated;

-- Executivo da sessão (função à parte: as políticas não precisam ler colunas que o navegador não vê).
create or replace function public.executivo_da_sessao() returns uuid
language sql stable security definer set search_path = '' as $$
  select e.id from public.executivos e where e.user_id = (select auth.uid()) and e.ativo limit 1;
$$;
revoke all on function public.executivo_da_sessao() from public, anon;
grant execute on function public.executivo_da_sessao() to authenticated;

drop policy if exists executivo_le_o_seu on public.executivos;
create policy executivo_le_o_seu on public.executivos for select to authenticated
  using (id = (select public.executivo_da_sessao()));

drop policy if exists executivo_le_seus_clientes on public.executivo_clientes;
create policy executivo_le_seus_clientes on public.executivo_clientes for select to authenticated
  using (executivo_id = (select public.executivo_da_sessao()));

drop policy if exists executivo_le_suas_comissoes on public.comissoes;
create policy executivo_le_suas_comissoes on public.comissoes for select to authenticated
  using (executivo_id = (select public.executivo_da_sessao()));
