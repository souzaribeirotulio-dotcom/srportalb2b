-- Ajustes da classificação: empate entre itens com o mesmo número de palavras fica com o que aparece primeiro no nome
-- ("Molho Pimenta Sachê (Caixa...)" é molho, não caixa; "Gelatina Zero Açúcar" é gelatina). Igual à ordem do portal.
update public.portal_secoes set termos = array_remove(termos, 'kit') where categoria = 'Utilidades e Cia' and nome = 'Cozinha e Utensílios';
do $t$
declare
  extra jsonb := $j$[
  ["Descartáveis e Embalagens", "Bobinas e Filmes", "papel manteiga"],
  ["Escritório e Papelaria", "Calculadoras e Acessórios", "massa modelar"],
  ["Escritório e Papelaria", "Clips, Grampos e Grampeadores", "extrator grampo", "extrator grampos"],
  ["Utilidades e Cia", "Casa e Manutenção", "oleo diesel", "oleo 20w50", "oleo lubrificante", "oleo motor", "carrinho carga"],
  ["Higiene e Cuidados Pessoais", "Dispensers e Secadores", "dispenser papel"]
  ]$j$; e jsonb;
begin
  for e in select * from jsonb_array_elements(extra) loop
    update public.portal_secoes s set termos = s.termos || array(select x from jsonb_array_elements_text(e) with ordinality y(x, n) where n > 2 and not x = any(s.termos))
     where s.categoria = e->>0 and s.nome = e->>1;
  end loop;
end $t$;

create or replace function public.portal_classificar(p_loja text, p_de int, p_qtd int) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
  antigos jsonb := '{"Limpeza":"Limpeza","Descartáveis":"Descartáveis e Embalagens","Embalagens":"Descartáveis e Embalagens","Copa & Alimentos":"Alimentícios","Higiene":"Higiene e Cuidados Pessoais","Utensílios & EPI":"EPIs e Segurança","Papelaria":"Escritório e Papelaria","Utilidades Domésticas":"Utilidades e Cia","Eletrônicos & Informática":"Informática e Tecnologia","Festas & Brinquedos":"Festas e Brinquedos","Outros":"Outros"}';
begin
  with regras as (
    select c.nome dep, c.ordem dord, s.ordem sord, public.portal_tokens(t) ws
      from public.portal_secoes s join public.portal_categorias c on c.loja = s.loja and c.nome = s.categoria, unnest(s.termos) t
     where s.loja = p_loja and s.pai is null),
  prods as (
    select e.codigo, public.portal_tokens(coalesce(e.nome, '') || ' ' || coalesce(e.nome_g360, '')) tok, e.categoria
      from public.portal_produtos_exibicao e where e.loja = p_loja order by e.codigo offset p_de limit p_qtd),
  melhor as (
    select p.codigo, p.categoria, (select r.dep from regras r
       where cardinality(r.ws) > 0 and not exists (select 1 from unnest(r.ws) w
         where not exists (select 1 from unnest(p.tok) t where (length(w) >= 5 and t like w || '%') or t in (w, w || 's', w || 'es')))
       order by cardinality(r.ws) desc,
         (select min(o) from unnest(p.tok) with ordinality u(t, o) where (length(r.ws[1]) >= 5 and t like r.ws[1] || '%') or t in (r.ws[1], r.ws[1] || 's', r.ws[1] || 'es')),
         r.dord, r.sord limit 1) dep
      from prods p)
  update public.portal_produtos_exibicao e set categoria = coalesce(m.dep,
      antigos->>(select b.categoria from public.portal_categoria_antes_20261124 b where b.loja = p_loja and b.codigo = e.codigo limit 1),
      (select c.nome from public.portal_categorias c where c.loja = p_loja and c.nome = m.categoria), 'Outros')
    from melhor m where e.loja = p_loja and e.codigo = m.codigo;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.portal_classificar(text, int, int) from public, anon, authenticated;
