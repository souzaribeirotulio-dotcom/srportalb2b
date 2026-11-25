-- "Quero ser cliente": se o pedido anterior do mesmo documento travou no cadastro automático
-- (auto_status revisar/erro, ainda sem ficha no G360 e pendente), um novo envio atualiza os dados
-- e volta a fila (auto_status nulo, criado_em agora): o portal tenta o cadastro automático de novo.
-- Qualquer outro pedido do mesmo documento continua recusado como antes.
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
