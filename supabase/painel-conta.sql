-- Conta do painel (Etapa 11): lê as ocorrências da loja no Supabase.
-- 1) Crie a conta em Authentication > Users > Add user > Create new user
--    (e-mail da equipe, senha forte, "Auto Confirm User" marcado).
-- 2) Rode este comando no SQL Editor, trocando <preencha> pelo e-mail da conta.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('g360_painel_loja', '96da1e99a3f327f0')
where email = '<preencha>';
-- Confira: deve aparecer 1 linha com o slug da loja.
select email, raw_app_meta_data ->> 'g360_painel_loja' as loja_do_painel
from auth.users where email = '<preencha>';
