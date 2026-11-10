-- Prepara colunas mesmo quando as migrações são ordenadas pelo nome.
alter table public.portal_clientes add column if not exists email_verificado_em timestamptz;
alter table public.portal_clientes add column if not exists marketing_opt_in boolean not null default false;
alter table public.portal_clientes add column if not exists marketing_opt_in_em timestamptz;

-- Bloqueia aprovação prematura e registra consentimento na criação.
-- Aplicar após 20261110_verificacao_email_cadastro.sql.
create or replace function public.portal_cadastrar(d jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','extensions'
as $function$
declare v_cnpj text := regexp_replace(coalesce(d->>'cnpj',''),'\D','','g');
begin
  if length(v_cnpj) <> 14 then raise exception 'CNPJ inválido.'; end if;
  if length(coalesce(d->>'senha','')) < 6 then raise exception 'A senha precisa ter pelo menos 6 caracteres.'; end if;
  if coalesce(d->>'email','') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Informe um e-mail válido.'; end if;
  if exists(select 1 from portal_clientes where cnpj = v_cnpj) then
    raise exception 'Este CNPJ já possui cadastro. Faça login ou use "Esqueci minha senha".';
  end if;
  insert into portal_clientes(
    cnpj,status,razao_social,fantasia,inscricao_estadual,responsavel,whats,telefone,email,
    cep,logradouro,numero,complemento,bairro,cidade,uf,origem,senha_hash,marketing_opt_in
  ) values (
    v_cnpj,'pendente',left(d->>'razao_social',200),left(d->>'fantasia',200),
    left(coalesce(d->>'inscricao_estadual',''),30),left(d->>'responsavel',120),
    left(regexp_replace(coalesce(d->>'whats',''),'\D','','g'),11),
    left(regexp_replace(coalesce(d->>'telefone',''),'\D','','g'),11),
    lower(left(d->>'email',160)),left(regexp_replace(coalesce(d->>'cep',''),'\D','','g'),8),
    left(d->>'logradouro',200),left(d->>'numero',20),left(d->>'complemento',120),
    left(d->>'bairro',120),left(d->>'cidade',120),upper(left(d->>'uf',2)),
    left(d->>'origem',120),crypt(d->>'senha',gen_salt('bf')),
    coalesce(d->>'marketing_opt_in','false') = 'true'
  );
  return jsonb_build_object('status','email_pendente');
end $function$;

-- Impede aprovação de cadastro público antes da verificação, inclusive via RPC de admin.
create or replace function public.portal__bloquear_aprovacao_sem_email()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.status = 'email_pendente'
      and new.status = 'aprovado'
      and old.email_verificado_em is null then
    raise exception 'Confirme o e-mail do cliente antes de aprovar.';
  end if;
  return new;
end;
$$;
drop trigger if exists portal_bloquear_aprovacao_sem_email on public.portal_clientes;
create trigger portal_bloquear_aprovacao_sem_email
  before update on public.portal_clientes for each row
  execute function public.portal__bloquear_aprovacao_sem_email();
