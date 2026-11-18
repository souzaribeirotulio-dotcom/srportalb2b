alter table public.portal_negociacoes add column if not exists unidade_id text check (unidade_id is null or char_length(unidade_id) between 1 and 100);
