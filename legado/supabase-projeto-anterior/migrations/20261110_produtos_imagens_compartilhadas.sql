-- Fotos centralizadas do Portal B2B Souza Ribeiro.
-- Leitura pública de URLs; gravação somente via sessão ativa de administrador.
create table if not exists public.portal_produtos_imagens (
  cod text primary key,
  fotos jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por text,
  constraint portal_produtos_imagens_cod check (cod ~ '^[A-Za-z0-9_-]{1,60}$'),
  constraint portal_produtos_imagens_fotos check (jsonb_typeof(fotos)='array' and jsonb_array_length(fotos)<=8)
);
alter table public.portal_produtos_imagens enable row level security;
revoke all on public.portal_produtos_imagens from public, anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('portal-produtos','portal-produtos',true,2097152,array['image/jpeg','image/png','image/webp']::text[])
on conflict(id) do nothing;

create or replace function public.portal_imagens_catalogo()
returns jsonb language sql stable security definer
set search_path=public,pg_temp as $fn$
  select coalesce(jsonb_object_agg(cod,fotos),'{}'::jsonb)
  from public.portal_produtos_imagens;
$fn$;

create or replace function public.portal_admin_salvar_imagens(p_token uuid,p_cod text,p_fotos jsonb)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $fn$
declare admin_ref text; url text;
begin
  admin_ref:=public.portal__sessao(p_token,'admin');
  if p_cod is null or p_cod !~ '^[A-Za-z0-9_-]{1,60}$' then
    raise exception 'Código de produto inválido';
  end if;
  if p_fotos is null or jsonb_typeof(p_fotos)<>'array' or jsonb_array_length(p_fotos)>8 then
    raise exception 'Informe até 8 fotos por produto';
  end if;
  for url in select value from jsonb_array_elements_text(p_fotos)
  loop
    if length(url)>2048 or url !~ '^https://[^[:space:]"''<>]+$'
       or position(chr(92) in url)>0 or position(chr(96) in url)>0 then
      raise exception 'Cada foto deve ter um link HTTPS válido';
    end if;
  end loop;
  if jsonb_array_length(p_fotos)=0 then
    delete from public.portal_produtos_imagens where cod=p_cod;
  else
    insert into public.portal_produtos_imagens(cod,fotos,atualizado_por)
    values(p_cod,p_fotos,admin_ref)
    on conflict(cod) do update set
      fotos=excluded.fotos,atualizado_em=now(),atualizado_por=excluded.atualizado_por;
  end if;
  return p_fotos;
end $fn$;

revoke all on function public.portal_imagens_catalogo() from public;
revoke all on function public.portal_admin_salvar_imagens(uuid,text,jsonb) from public;
grant execute on function public.portal_imagens_catalogo() to anon,authenticated;
grant execute on function public.portal_admin_salvar_imagens(uuid,text,jsonb) to anon,authenticated;
