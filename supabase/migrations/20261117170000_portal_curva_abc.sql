alter table public.portal_produtos_exibicao add column if not exists curva text check (curva in ('A','B','C'));
update public.portal_produtos_exibicao set curva = 'A' where origem = 'legado' and curva is null; -- provisório até importar a planilha do G360
