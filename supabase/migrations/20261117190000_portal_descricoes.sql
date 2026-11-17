-- Descrição, características e código de barras próprios do portal (editáveis pela equipe).
-- Os 158 produtos do portal antigo usam src/catalogo/descricoes-legado.json; os demais recebem
-- descrição básica gerada pelo nome (src/catalogo/descricoes.js) enquanto a equipe não escrever uma.
alter table public.portal_produtos_exibicao
  add column if not exists descricao text check (descricao is null or char_length(descricao) <= 1500),
  add column if not exists ean text check (ean is null or ean ~ '^[0-9]{8,14}$');
