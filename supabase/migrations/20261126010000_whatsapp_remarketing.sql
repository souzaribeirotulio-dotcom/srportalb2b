-- WhatsApp (remarketing): configuração dos gatilhos, registro dos envios e lista de quem saiu.
-- Só a função whatsapp-g360 lê e grava (chave secreta); o navegador não acessa estas tabelas.
-- Telefone completo não é guardado aqui: os envios guardam só o final (4 dígitos) e um resumo (hash).
alter table public.portal_cadastros
  add column if not exists aceita_whatsapp boolean not null default false,
  add column if not exists aceita_whatsapp_em timestamptz;

create table if not exists public.whatsapp_config (
  loja text primary key check (loja ~ '^[a-f0-9]{16}$'),
  envio_ligado boolean not null default false,
  intervalo_dias integer not null default 3 check (intervalo_dias between 1 and 30),
  gatilhos jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

create table if not exists public.whatsapp_envios (
  id bigint generated always as identity primary key,
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  gatilho text not null check (char_length(gatilho) between 1 and 40),
  ref text not null check (char_length(ref) between 1 and 80),
  empresa text check (empresa is null or char_length(empresa) <= 200),
  telefone_final text check (telefone_final is null or telefone_final ~ '^[0-9]{4}$'),
  destinatario text not null check (destinatario ~ '^[a-f0-9]{64}$'),
  modo text not null check (modo in ('simulado', 'enviado', 'erro')),
  detalhe text check (detalhe is null or char_length(detalhe) <= 300),
  criado_em timestamptz not null default now()
);
-- Cada gatilho manda uma vez por pessoa/situação; simulação não conta (quem apareceu no teste continua elegível).
create unique index if not exists whatsapp_envios_real_unico on public.whatsapp_envios (loja, gatilho, ref) where modo <> 'simulado';
create index if not exists whatsapp_envios_dest_idx on public.whatsapp_envios (loja, destinatario, criado_em desc);
create index if not exists whatsapp_envios_loja_idx on public.whatsapp_envios (loja, criado_em desc);

create table if not exists public.whatsapp_saidas (
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  destinatario text not null check (destinatario ~ '^[a-f0-9]{64}$'),
  telefone_final text check (telefone_final is null or telefone_final ~ '^[0-9]{4}$'),
  motivo text check (motivo is null or char_length(motivo) <= 120),
  criado_em timestamptz not null default now(),
  primary key (loja, destinatario)
);

alter table public.whatsapp_config enable row level security;
alter table public.whatsapp_envios enable row level security;
alter table public.whatsapp_saidas enable row level security;
revoke all on public.whatsapp_config, public.whatsapp_envios, public.whatsapp_saidas from public, anon, authenticated;

-- "Quero ser cliente" grava o aceite do WhatsApp (caixa no formulário, desmarcada por padrão).
create or replace function public.portal_cadastro_solicitar(p_loja text, d jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_doc text := upper(regexp_replace(coalesce(d->>'documento',''), '[^A-Za-z0-9]', '', 'g'));
  v_exec text := upper(regexp_replace(coalesce(d->>'executivo',''), '[^A-Za-z0-9]', '', 'g'));
  v_recentes int;
  v_id uuid;
  v_exec_id uuid;
  v_travado uuid;
begin
  if p_loja !~ '^[a-f0-9]{16}$' then raise exception 'Loja inválida.'; end if;
  if v_doc !~ '^[A-Z0-9]{11,14}$' then raise exception 'Informe um CPF ou CNPJ válido.'; end if;
  if v_exec <> '' and v_exec !~ '^[A-Z0-9]{3,20}$' then v_exec := ''; end if;
  select id into v_travado from portal_cadastros
   where loja = p_loja and documento = v_doc and status = 'pendente' and codigo_g360 is null and auto_status in ('revisar', 'erro')
   order by criado_em desc limit 1;
  if v_travado is not null then
    update portal_cadastros set
      razao_social = left(trim(d->>'razao_social'),200), fantasia = nullif(left(trim(d->>'fantasia'),200),''),
      inscricao_estadual = nullif(left(trim(d->>'inscricao_estadual'),30),''), responsavel = left(trim(d->>'responsavel'),120),
      whats = nullif(regexp_replace(coalesce(d->>'whats',''),'\D','','g'),''), telefone = nullif(regexp_replace(coalesce(d->>'telefone',''),'\D','','g'),''),
      email = lower(left(trim(d->>'email'),160)), cep = nullif(regexp_replace(coalesce(d->>'cep',''),'\D','','g'),''),
      logradouro = nullif(left(trim(d->>'logradouro'),200),''), numero = nullif(left(trim(d->>'numero'),20),''),
      complemento = nullif(left(trim(d->>'complemento'),120),''), bairro = nullif(left(trim(d->>'bairro'),120),''),
      cidade = nullif(left(trim(d->>'cidade'),120),''), uf = nullif(upper(left(trim(d->>'uf'),2)),''),
      origem = coalesce(nullif(left(trim(d->>'origem'),120),''), origem), segmento = coalesce(nullif(left(trim(d->>'segmento'),60),''), segmento),
      aceita_whatsapp = coalesce(d->'aceita_whatsapp' = 'true'::jsonb, false),
      aceita_whatsapp_em = case when coalesce(d->'aceita_whatsapp' = 'true'::jsonb, false) then now() end,
      auto_status = null, auto_obs = null, auto_em = null, criado_em = now()
    where id = v_travado;
    return jsonb_build_object('status', 'pendente');
  end if;
  if exists (select 1 from portal_cadastros where loja = p_loja and documento = v_doc) then
    raise exception 'Já recebemos um cadastro com este documento. A equipe da Souza Ribeiro vai entrar em contato.';
  end if;
  select count(*) into v_recentes from portal_cadastros where criado_em > now() - interval '1 hour';
  if v_recentes >= 30 then raise exception 'Muitos cadastros agora. Tente de novo em alguns minutos.'; end if;
  insert into portal_cadastros (loja, documento, razao_social, fantasia, inscricao_estadual, responsavel, whats, telefone, email,
    cep, logradouro, numero, complemento, bairro, cidade, uf, origem, segmento, executivo_codigo, aceita_whatsapp, aceita_whatsapp_em)
  values (p_loja, v_doc, left(trim(d->>'razao_social'),200), nullif(left(trim(d->>'fantasia'),200),''), nullif(left(trim(d->>'inscricao_estadual'),30),''),
    left(trim(d->>'responsavel'),120), nullif(regexp_replace(coalesce(d->>'whats',''),'\D','','g'),''), nullif(regexp_replace(coalesce(d->>'telefone',''),'\D','','g'),''),
    lower(left(trim(d->>'email'),160)), nullif(regexp_replace(coalesce(d->>'cep',''),'\D','','g'),''), nullif(left(trim(d->>'logradouro'),200),''),
    nullif(left(trim(d->>'numero'),20),''), nullif(left(trim(d->>'complemento'),120),''), nullif(left(trim(d->>'bairro'),120),''),
    nullif(left(trim(d->>'cidade'),120),''), nullif(upper(left(trim(d->>'uf'),2)),''), nullif(left(trim(d->>'origem'),120),''),
    nullif(left(trim(d->>'segmento'),60),''), nullif(v_exec,''),
    coalesce(d->'aceita_whatsapp' = 'true'::jsonb, false), case when coalesce(d->'aceita_whatsapp' = 'true'::jsonb, false) then now() end)
  returning id into v_id;
  if v_exec <> '' then
    select id into v_exec_id from executivos where loja = p_loja and codigo = v_exec and ativo;
    if v_exec_id is not null then
      insert into executivo_clientes (loja, executivo_id, cadastro_id, documento, razao_social, situacao)
      values (p_loja, v_exec_id, v_id, v_doc, left(coalesce(trim(d->>'razao_social'),''),200), 'aguardando')
      on conflict do nothing;
    end if;
  end if;
  return jsonb_build_object('status', 'pendente');
end $function$;
