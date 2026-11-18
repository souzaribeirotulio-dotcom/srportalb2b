-- Caça-capa: produtos que o funcionário não achou foto ("fotografar no estoque").
alter table public.portal_lotes_fotos add column if not exists pulados text[] not null default '{}';
