-- Sobras: lote antigo que ficaria vazio é apagado (o check exige 1+ produtos), e se nada sobrar livre
-- (outra pessoa pegou tudo no mesmo instante) não grava lote nenhum e devolve vazio.
create or replace function public.portal_lote_sobras(p_loja text, p_codigos text[], p_responsavel text)
returns setof public.portal_lotes_fotos
language plpgsql security definer set search_path to 'public' as $$
declare
  hoje timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  num int;
  livres text[];
begin
  perform pg_advisory_xact_lock(hashtext('portal_lotes_fotos:' || p_loja));
  delete from portal_lotes_fotos l where l.loja = p_loja and l.criado_em < hoje and l.codigos <@ p_codigos;
  update portal_lotes_fotos l
     set codigos = array(select c from unnest(l.codigos) with ordinality u(c, o) where not (c = any(p_codigos)) order by o),
         pulados = array(select c from unnest(coalesce(l.pulados, '{}')) c where not (c = any(p_codigos)))
   where l.loja = p_loja and l.criado_em < hoje and l.codigos && p_codigos;
  livres := array(select c from unnest(p_codigos) with ordinality u(c, o)
                  where not exists (select 1 from portal_lotes_fotos x where x.loja = p_loja and c = any(x.codigos)) order by o);
  if cardinality(livres) = 0 then return; end if;
  select coalesce(max(numero), 0) + 1 into num from portal_lotes_fotos where loja = p_loja;
  return query insert into portal_lotes_fotos (loja, numero, responsavel, codigos)
    values (p_loja, num, nullif(p_responsavel, ''), livres) returning *;
end $$;
revoke all on function public.portal_lote_sobras(text, text[], text) from public, anon, authenticated;
grant execute on function public.portal_lote_sobras(text, text[], text) to service_role;
