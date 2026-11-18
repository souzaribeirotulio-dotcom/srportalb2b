-- Catálogo do visitante: só os códigos que aparecem no portal (com estoque acima do mínimo, sem os tirados pela equipe).
-- Sem quantidade, preço ou dado de cliente.
create or replace function public.portal_vitrine_codigos(p_loja text)
returns table (codigos text[], atualizado_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select array(
           select c from unnest(v.visiveis) c
           where not exists (select 1 from public.portal_produtos_exibicao e where e.loja = v.loja and e.codigo = c and e.oculto)
         ),
         v.atualizado_em
  from public.portal_visiveis v
  where p_loja ~ '^[a-f0-9]{16}$' and v.loja = p_loja;
$$;
revoke all on function public.portal_vitrine_codigos(text) from public;
grant execute on function public.portal_vitrine_codigos(text) to anon, authenticated;
