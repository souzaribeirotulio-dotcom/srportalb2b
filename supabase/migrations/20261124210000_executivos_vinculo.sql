-- Executivos de contas, etapa 2: código no "Quero ser cliente", vínculo aguardando aprovação
-- e produtos que os clientes de um executivo não veem no portal.

-- Produtos escondidos para os clientes do executivo: palavras do nome (todas precisam aparecer,
-- ex.: 'saco lixo') e códigos de produto do G360.
alter table public.executivos add column if not exists ocultar_termos text[] not null default '{}';
alter table public.executivos add column if not exists ocultar_codigos text[] not null default '{}';

-- "Quero ser cliente": guarda o código do executivo (opcional) e, se ele existir e estiver ativo,
-- já cria o vínculo "aguardando" (a equipe confirma, troca ou remove na aprovação).
create or replace function public.portal_cadastro_solicitar(p_loja text, d jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_doc text := upper(regexp_replace(coalesce(d->>'documento',''), '[^A-Za-z0-9]', '', 'g'));
  v_exec text := upper(regexp_replace(coalesce(d->>'executivo',''), '[^A-Za-z0-9]', '', 'g'));
  v_recentes int;
  v_id uuid;
  v_exec_id uuid;
begin
  if p_loja !~ '^[a-f0-9]{16}$' then raise exception 'Loja inválida.'; end if;
  if v_doc !~ '^[A-Z0-9]{11,14}$' then raise exception 'Informe um CPF ou CNPJ válido.'; end if;
  if v_exec <> '' and v_exec !~ '^[A-Z0-9]{3,20}$' then v_exec := ''; end if;
  if exists (select 1 from portal_cadastros where loja = p_loja and documento = v_doc) then
    raise exception 'Já recebemos um cadastro com este documento. A equipe da Souza Ribeiro vai entrar em contato.';
  end if;
  select count(*) into v_recentes from portal_cadastros where criado_em > now() - interval '1 hour';
  if v_recentes >= 30 then raise exception 'Muitos cadastros agora. Tente de novo em alguns minutos.'; end if;
  insert into portal_cadastros (loja, documento, razao_social, fantasia, inscricao_estadual, responsavel, whats, telefone, email,
    cep, logradouro, numero, complemento, bairro, cidade, uf, origem, segmento, executivo_codigo)
  values (p_loja, v_doc, left(trim(d->>'razao_social'),200), nullif(left(trim(d->>'fantasia'),200),''), nullif(left(trim(d->>'inscricao_estadual'),30),''),
    left(trim(d->>'responsavel'),120), nullif(regexp_replace(coalesce(d->>'whats',''),'\D','','g'),''), nullif(regexp_replace(coalesce(d->>'telefone',''),'\D','','g'),''),
    lower(left(trim(d->>'email'),160)), nullif(regexp_replace(coalesce(d->>'cep',''),'\D','','g'),''), nullif(left(trim(d->>'logradouro'),200),''),
    nullif(left(trim(d->>'numero'),20),''), nullif(left(trim(d->>'complemento'),120),''), nullif(left(trim(d->>'bairro'),120),''),
    nullif(left(trim(d->>'cidade'),120),''), nullif(upper(left(trim(d->>'uf'),2)),''), nullif(left(trim(d->>'origem'),120),''),
    nullif(left(trim(d->>'segmento'),60),''), nullif(v_exec,''))
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

-- Comprador logado (sessão vinculada pela ponte): produtos que ele não vê por ser cliente de um executivo.
-- Só devolve palavras e códigos; nada sobre o executivo.
create or replace function public.portal_ocultos_comprador() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_loja text := (select auth.jwt() -> 'app_metadata' ->> 'g360_loja');
  v_cod text := (select auth.jwt() -> 'app_metadata' ->> 'g360_comprador');
  v_termos text[]; v_codigos text[];
begin
  if v_cod is null or v_loja is null or not (select g360_ponte_privado.sessao_valida()) then
    return jsonb_build_object('termos', '[]'::jsonb, 'codigos', '[]'::jsonb);
  end if;
  select e.ocultar_termos, e.ocultar_codigos into v_termos, v_codigos
    from public.executivo_clientes v join public.executivos e on e.id = v.executivo_id
   where v.loja = v_loja and v.cliente_codigo::text = v_cod and v.situacao = 'ativo' and e.ativo
     and (v.fim is null or v.fim >= (now() at time zone 'America/Sao_Paulo')::date)
   order by v.inicio desc nulls last limit 1;
  return jsonb_build_object('termos', to_jsonb(coalesce(v_termos, '{}')), 'codigos', to_jsonb(coalesce(v_codigos, '{}')));
end $$;
revoke all on function public.portal_ocultos_comprador() from public, anon;
grant execute on function public.portal_ocultos_comprador() to authenticated;
