-- Caça-capa: um produto não pode estar em dois lotes da mesma loja.
-- Ao gravar um lote, os produtos que já estão em outro lote saem do lote novo.
-- A trava (advisory lock por loja) faz dois lotes gravados no mesmo instante serem conferidos um de cada vez.
create or replace function public.portal_lotes_sem_repetir() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  perform pg_advisory_xact_lock(hashtext('portal_lotes_fotos:' || new.loja));
  new.codigos := coalesce((
    select array_agg(c order by ord) from unnest(new.codigos) with ordinality as u(c, ord)
    where not exists (select 1 from portal_lotes_fotos l where l.loja = new.loja and l.id is distinct from new.id and u.c = any(l.codigos))
  ), '{}');
  return new;
end $$;
revoke all on function public.portal_lotes_sem_repetir() from public, anon, authenticated;
drop trigger if exists portal_lotes_sem_repetir on public.portal_lotes_fotos;
create trigger portal_lotes_sem_repetir before insert on public.portal_lotes_fotos
  for each row execute function public.portal_lotes_sem_repetir();
