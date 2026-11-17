-- "Mostrar só produtos com mais de N unidades" (usa quantidade_disponivel da API, contrato 2026.11.17 noite).
alter table public.portal_config add column if not exists estoque_minimo numeric(12,4) not null default 0 check (estoque_minimo >= 0 and estoque_minimo <= 100000);
create or replace function public.portal_config_publica(p_loja text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'so_estoque', coalesce((select c.so_estoque from public.portal_config c where c.loja = p_loja), false),
    'estoque_minimo', coalesce((select c.estoque_minimo from public.portal_config c where c.loja = p_loja), 0))
$$;
