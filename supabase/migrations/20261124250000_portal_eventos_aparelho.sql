-- Computador × celular: tipo de aparelho em cada acesso e pedido do portal.
-- Só o tipo (computador, celular ou tablet) e se foi pelo app instalado. Nada pessoal.
alter table public.portal_eventos add column if not exists aparelho text
  check (aparelho is null or aparelho in ('computador', 'celular', 'tablet'));
alter table public.portal_eventos add column if not exists app boolean;
alter table public.portal_eventos drop constraint if exists portal_eventos_tipo_check;
alter table public.portal_eventos add constraint portal_eventos_tipo_check check (tipo in ('busca', 'pedido', 'acesso'));
grant insert (aparelho, app) on public.portal_eventos to authenticated;
