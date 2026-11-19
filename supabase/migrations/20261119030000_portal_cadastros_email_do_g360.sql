-- Ficha do portal ligada ao G360 copia os dados do G360 (fonte do cadastro).
-- Se o cadastro do G360 estiver sem e-mail válido, a ficha fica sem e-mail em vez de guardar outro.
-- O pedido de "Quero ser cliente" continua exigindo e-mail (conferido em portal_cadastro_solicitar).
alter table public.portal_cadastros alter column email drop not null;
alter table public.portal_cadastros add constraint portal_cadastros_email_sem_g360
  check (email is not null or codigo_g360 is not null);
