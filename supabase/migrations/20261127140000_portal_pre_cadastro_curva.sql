-- Curva ABC do cliente no período do lote (A = 80% do faturamento, B = próximos 15%, C = o resto),
-- para filtrar a Carteira do portal.
begin;
alter table public.portal_pre_cadastro add column if not exists curva text check (curva in ('A','B','C'));
alter table public.portal_pre_cadastro add column if not exists faturamento numeric(14,2);
drop view public.portal_pre_resumo;
create view public.portal_pre_resumo with (security_invoker = true) as
select c.loja, c.comprador_codigo, c.documento, c.nome, c.cidade, c.bairro, c.vendedores, c.ultima_compra,
       c.itens_lista, c.itens_congelados, c.acesso_liberado_em, c.senha_criada_em, c.acesso_obs, c.curva, c.faturamento,
       count(k.produto_id) filter (where k.situacao = 'gravado') as cong_gravados,
       count(k.produto_id) filter (where k.situacao = 'pendente') as cong_pendentes,
       count(k.produto_id) filter (where k.situacao in ('recusado', 'ignorado')) as cong_fora,
       a.primeiro_em as entrou_em, a.ultimo_em as ultimo_acesso
from public.portal_pre_cadastro c
left join public.portal_pre_congelados k on k.loja = c.loja and k.comprador_codigo = c.comprador_codigo
left join public.portal_acessos a on a.loja = c.loja and a.comprador_codigo = c.comprador_codigo
group by c.loja, c.comprador_codigo, a.primeiro_em, a.ultimo_em;
revoke all on public.portal_pre_resumo from public, anon, authenticated;
commit;
