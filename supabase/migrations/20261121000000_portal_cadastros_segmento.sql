-- Quero ser cliente: ramo do negócio (para mostrar primeiro o que o cliente mais usa).
alter table public.portal_cadastros add column if not exists segmento text check (segmento is null or char_length(segmento) <= 60);

CREATE OR REPLACE FUNCTION public.portal_cadastro_solicitar(p_loja text, d jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_doc text := upper(regexp_replace(coalesce(d->>'documento',''), '[^A-Za-z0-9]', '', 'g'));
  v_recentes int;
begin
  if p_loja !~ '^[a-f0-9]{16}$' then raise exception 'Loja inválida.'; end if;
  if v_doc !~ '^[A-Z0-9]{11,14}$' then raise exception 'Informe um CPF ou CNPJ válido.'; end if;
  if exists (select 1 from portal_cadastros where loja = p_loja and documento = v_doc) then
    raise exception 'Já recebemos um cadastro com este documento. A equipe da Souza Ribeiro vai entrar em contato.';
  end if;
  select count(*) into v_recentes from portal_cadastros where criado_em > now() - interval '1 hour';
  if v_recentes >= 30 then raise exception 'Muitos cadastros agora. Tente de novo em alguns minutos.'; end if;
  insert into portal_cadastros (loja, documento, razao_social, fantasia, inscricao_estadual, responsavel, whats, telefone, email,
    cep, logradouro, numero, complemento, bairro, cidade, uf, origem, segmento)
  values (p_loja, v_doc, left(trim(d->>'razao_social'),200), nullif(left(trim(d->>'fantasia'),200),''), nullif(left(trim(d->>'inscricao_estadual'),30),''),
    left(trim(d->>'responsavel'),120), nullif(regexp_replace(coalesce(d->>'whats',''),'\D','','g'),''), nullif(regexp_replace(coalesce(d->>'telefone',''),'\D','','g'),''),
    lower(left(trim(d->>'email'),160)), nullif(regexp_replace(coalesce(d->>'cep',''),'\D','','g'),''), nullif(left(trim(d->>'logradouro'),200),''),
    nullif(left(trim(d->>'numero'),20),''), nullif(left(trim(d->>'complemento'),120),''), nullif(left(trim(d->>'bairro'),120),''),
    nullif(left(trim(d->>'cidade'),120),''), nullif(upper(left(trim(d->>'uf'),2)),''), nullif(left(trim(d->>'origem'),120),''),
    nullif(left(trim(d->>'segmento'),60),''));
  return jsonb_build_object('status', 'pendente');
end $function$;
