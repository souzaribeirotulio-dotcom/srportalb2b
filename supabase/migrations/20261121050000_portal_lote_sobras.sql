-- Caça-capa: "Sobras de lotes antigos". Tira os produtos escolhidos dos lotes criados ANTES de hoje
-- (horário de Brasília) e grava um lote novo com eles, tudo numa transação só.
-- Lotes de hoje não são mexidos: quem está trabalhando neles agora não perde nada.
-- Usa a mesma trava do gatilho portal_lotes_sem_repetir, então dois pedidos no mesmo instante vão um de cada vez,
-- e o gatilho ainda tira do lote novo qualquer produto que continue em outro lote.
create or replace function public.portal_lote_sobras(p_loja text, p_codigos text[], p_responsavel text)
returns setof public.portal_lotes_fotos
language plpgsql security definer set search_path to 'public' as $$
declare
  hoje timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  num int;
begin
  perform pg_advisory_xact_lock(hashtext('portal_lotes_fotos:' || p_loja));
  update portal_lotes_fotos l
     set codigos = array(select c from unnest(l.codigos) with ordinality u(c, o) where not (c = any(p_codigos)) order by o),
         pulados = array(select c from unnest(coalesce(l.pulados, '{}')) c where not (c = any(p_codigos)))
   where l.loja = p_loja and l.criado_em < hoje and l.codigos && p_codigos;
  select coalesce(max(numero), 0) + 1 into num from portal_lotes_fotos where loja = p_loja;
  return query insert into portal_lotes_fotos (loja, numero, responsavel, codigos)
    values (p_loja, num, nullif(p_responsavel, ''), p_codigos) returning *;
end $$;
revoke all on function public.portal_lote_sobras(text, text[], text) from public, anon, authenticated;
grant execute on function public.portal_lote_sobras(text, text[], text) to service_role;
