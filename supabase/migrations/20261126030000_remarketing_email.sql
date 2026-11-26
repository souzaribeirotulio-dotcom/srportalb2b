-- Remarketing por e-mail (Resend), junto com o WhatsApp: canal em cada envio e em cada saída,
-- e "e-mail ligado" separado do "envio ligado" do WhatsApp.
alter table public.whatsapp_config add column if not exists email_ligado boolean not null default false;
alter table public.whatsapp_envios add column if not exists canal text not null default 'whatsapp' check (canal in ('whatsapp', 'email'));
alter table public.whatsapp_saidas add column if not exists canal text not null default 'whatsapp' check (canal in ('whatsapp', 'email'));
-- Cada gatilho manda uma vez por pessoa/situação em cada canal; simulação não conta.
drop index if exists public.whatsapp_envios_real_unico;
create unique index if not exists whatsapp_envios_real_unico on public.whatsapp_envios (loja, canal, gatilho, ref) where modo <> 'simulado';
-- E-mail mascarado para o painel (ex.: co***@gmail.com); o endereço completo não fica nas tabelas de envio.
alter table public.whatsapp_envios add column if not exists email_mascara text check (email_mascara is null or char_length(email_mascara) <= 80);
alter table public.whatsapp_saidas add column if not exists email_mascara text check (email_mascara is null or char_length(email_mascara) <= 80);
