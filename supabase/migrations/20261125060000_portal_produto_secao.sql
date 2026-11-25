-- Seção escolhida pela equipe na aba Produtos do painel (pelo nome da seção, dentro do departamento do produto).
-- Vazia = seção automática pelas palavras do nome. Quem grava é a função painel-g360 (exibicao_salvar), que confere
-- se a seção existe no departamento; renomear ou apagar a seção (secoes_salvar) atualiza ou limpa este campo.
alter table public.portal_produtos_exibicao add column if not exists secao text check (secao is null or char_length(secao) between 1 and 40);
