-- Palavras-chave de busca por produto (configuradas pela equipe no painel). Não aparecem para o cliente:
-- só entram no índice da busca do portal, como se fizessem parte do nome. Leitura pública igual à da descrição.
alter table public.portal_produtos_exibicao add column if not exists palavras_chave text;
alter table public.portal_produtos_exibicao drop constraint if exists portal_produtos_exibicao_palavras_chave_check;
alter table public.portal_produtos_exibicao add constraint portal_produtos_exibicao_palavras_chave_check check (palavras_chave is null or char_length(palavras_chave) <= 500);
