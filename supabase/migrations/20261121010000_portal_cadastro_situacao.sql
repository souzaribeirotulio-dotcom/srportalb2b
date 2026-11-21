-- Quero ser cliente: ao digitar o CNPJ/CPF, o portal pergunta se o documento já tem cadastro na loja.
-- Devolve só a situação (nada de nome, e-mail ou telefone): 'pendente', 'aprovado', 'recusado' ou null.
create or replace function public.portal_cadastro_situacao(p_loja text, p_documento text)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare v_doc text := upper(regexp_replace(coalesce(p_documento, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if p_loja !~ '^[a-f0-9]{16}$' or v_doc !~ '^[A-Z0-9]{11,14}$' then return null; end if;
  return (select case when codigo_g360 is not null then 'aprovado' else status end
            from portal_cadastros where loja = p_loja and documento = v_doc
           order by (codigo_g360 is not null) desc, atualizado_em desc nulls last limit 1);
end $$;
revoke all on function public.portal_cadastro_situacao(text, text) from public;
grant execute on function public.portal_cadastro_situacao(text, text) to anon, authenticated;
