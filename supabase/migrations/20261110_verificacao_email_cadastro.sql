-- Cadastro B2B: verificar e-mail antes de exibir na fila do administrador.
-- Mantem clientes ja aprovados intactos. Requer configurar o remetente antes de publicar o frontend.
alter table public.portal_clientes
  add column if not exists email_verificado_em timestamptz,
  add column if not exists marketing_opt_in boolean not null default false,
  add column if not exists marketing_opt_in_em timestamptz;

-- O banco original aceita apenas pendente/aprovado/reprovado/bloqueado.
-- Acrescenta etapa de confirmação sem alterar os demais registros.
alter table public.portal_clientes drop constraint if exists portal_clientes_status_check;
alter table public.portal_clientes add constraint portal_clientes_status_check
check (status in ('email_pendente','pendente','aprovado','reprovado','bloqueado'));

create table if not exists public.portal_email_verificacoes (
  cnpj text primary key references public.portal_clientes(cnpj) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expira_em timestamptz not null,
  enviado_em timestamptz not null default now()
);
alter table public.portal_email_verificacoes enable row level security;
revoke all on table public.portal_email_verificacoes from public, anon, authenticated;

-- Qualquer cadastro feito pela funcao publica entra primeiro como e-mail pendente.
-- Cadastro criado pelo administrador ja aprovado nao e alterado.
create or replace function public.portal__marcar_email_pendente()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.status = 'pendente' then
    new.status := 'email_pendente';
  end if;
  return new;
end;
$$;
drop trigger if exists portal_marcar_email_pendente on public.portal_clientes;
create trigger portal_marcar_email_pendente before insert on public.portal_clientes
for each row execute function public.portal__marcar_email_pendente();

-- Apenas o servidor com SERVICE_ROLE gera/substitui links.
create or replace function public.portal_email_verificacao_preparar(
  p_cnpj text, p_email text, p_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare c public.portal_clientes; v_ultimo timestamptz;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'Operacao restrita ao servidor.';
  end if;
  if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Token invalido.'; end if;
  select * into c from public.portal_clientes
  where cnpj = regexp_replace(p_cnpj,'\D','','g') for update;
  if c.cnpj is null or c.status <> 'email_pendente'
     or lower(c.email) <> lower(trim(p_email)) then
    raise exception 'Cadastro nao encontrado ou ja confirmado.';
  end if;
  select enviado_em into v_ultimo from public.portal_email_verificacoes where cnpj=c.cnpj;
  if v_ultimo is not null and v_ultimo > now() - interval '60 seconds' then
    raise exception 'Aguarde antes de reenviar o e-mail.';
  end if;
  insert into public.portal_email_verificacoes(cnpj,token_hash,expira_em,enviado_em)
    values(c.cnpj,p_hash,now()+interval '24 hours',now())
  on conflict (cnpj) do update set token_hash=excluded.token_hash,
    expira_em=excluded.expira_em,enviado_em=now();
  return jsonb_build_object('email',c.email,'fantasia',coalesce(c.fantasia,c.razao_social));
end;
$$;
revoke all on function public.portal_email_verificacao_preparar(text,text,text) from public,anon,authenticated;
grant execute on function public.portal_email_verificacao_preparar(text,text,text) to service_role;

-- Link de verificacao consumido uma unica vez. Nao concede aprovacao comercial.
create or replace function public.portal_confirmar_email(p_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_cnpj text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok',false,'erro','Link invalido.');
  end if;
  select v.cnpj into v_cnpj
    from public.portal_email_verificacoes v
    join public.portal_clientes c on c.cnpj=v.cnpj
   where v.token_hash = encode(extensions.digest(convert_to(p_token,'UTF8'),'sha256'),'hex')
     and v.expira_em > now() and c.status='email_pendente'
   for update of v;
  if v_cnpj is null then
    return jsonb_build_object('ok',false,'erro','Link expirado ou ja utilizado.');
  end if;
  update public.portal_clientes set status='pendente',
    email_verificado_em=now(),atualizado_em=now() where cnpj=v_cnpj;
  delete from public.portal_email_verificacoes where cnpj=v_cnpj;
  return jsonb_build_object('ok',true,'mensagem','E-mail confirmado. Seu cadastro sera analisado.');
end;
$$;
revoke all on function public.portal_confirmar_email(text) from public;
grant execute on function public.portal_confirmar_email(text) to anon, authenticated;

-- A fila do admin ignora cadastros sem verificacao. Preserva os demais status.
create or replace function public.portal_admin_clientes(p_token uuid)
returns jsonb language plpgsql security definer set search_path = 'public'
as $$
begin
  perform portal__sessao(p_token,'admin');
  return coalesce((select jsonb_agg(portal__json_cliente(c)
    order by (c.status='pendente') desc,c.criado_em desc)
    from portal_clientes c where c.status <> 'email_pendente'),'[]'::jsonb);
end;
$$;

-- Registro opt-in de marketing apenas mediante escolha afirmativa do usuario.
create or replace function public.portal__registrar_marketing()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.marketing_opt_in and new.marketing_opt_in_em is null then
    new.marketing_opt_in_em := now();
  end if;
  return new;
end;
$$;
drop trigger if exists portal_marketing_consent on public.portal_clientes;
create trigger portal_marketing_consent before insert or update of marketing_opt_in
on public.portal_clientes for each row execute function public.portal__registrar_marketing();
