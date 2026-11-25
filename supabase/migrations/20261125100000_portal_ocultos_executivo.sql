-- Visitante que chegou pelo link do executivo (?ex=CODIGO), antes do cadastro: os produtos que os clientes desse
-- executivo não veem. Só devolve palavras e códigos de produto; nada sobre o executivo. Código desconhecido ou
-- executivo inativo = listas vazias (não revela se o código existe).
create or replace function public.portal_ocultos_executivo(p_codigo text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_termos text[]; v_codigos text[];
begin
  if p_codigo is null or p_codigo !~ '^[A-Z0-9]{3,20}$' then
    return jsonb_build_object('termos', '[]'::jsonb, 'codigos', '[]'::jsonb);
  end if;
  select e.ocultar_termos, e.ocultar_codigos into v_termos, v_codigos
    from public.executivos e where e.codigo = p_codigo and e.ativo limit 1;
  return jsonb_build_object('termos', to_jsonb(coalesce(v_termos, '{}')), 'codigos', to_jsonb(coalesce(v_codigos, '{}')));
end $$;
revoke all on function public.portal_ocultos_executivo(text) from public;
grant execute on function public.portal_ocultos_executivo(text) to anon, authenticated;
