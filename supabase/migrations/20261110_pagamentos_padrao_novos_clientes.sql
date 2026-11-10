-- SR Portal B2B: pagamentos padrao para novos clientes
-- Sem alterar as permissões já gravadas em portal_clientes.
create table if not exists public.portal_pagamentos_config (
  unico boolean primary key default true check (unico = true),
  formas jsonb not null check (jsonb_typeof(formas) = 'array'),
  pag_padrao jsonb not null check (jsonb_typeof(pag_padrao) = 'array'),
  atualizado_em timestamptz not null default now()
);
alter table public.portal_pagamentos_config enable row level security;
revoke all on table public.portal_pagamentos_config from public, anon, authenticated;
grant select on table public.portal_pagamentos_config to anon, authenticated;
create policy "Consulta publica das formas de pagamento" on public.portal_pagamentos_config
  for select to anon, authenticated using (true);

-- Informacao publica para que os clientes vejam a descricao dos metodos liberados.
create or replace function public.portal_config_pagamentos()
returns jsonb language sql stable security invoker
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('formas', formas, 'pagPadrao', pag_padrao, 'configurada', true)
       from public.portal_pagamentos_config where unico = true),
    jsonb_build_object(
      'formas', jsonb_build_array(
        jsonb_build_object('id','pix','nome','PIX','obs','Pagamento à vista'),
        jsonb_build_object('id','din','nome','Dinheiro na entrega','obs','Pagamento ao receber'),
        jsonb_build_object('id','b14','nome','Boleto 14 dias','obs','Vencimento 14 dias após faturamento'),
        jsonb_build_object('id','b28','nome','Boleto 28 dias','obs','Vencimento 28 dias após faturamento'),
        jsonb_build_object('id','b2856','nome','Boleto 28/56 dias','obs','2 parcelas')
      ),
      'pagPadrao', jsonb_build_array('pix'),
      'configurada', false
    )
  );
$$;
revoke all on function public.portal_config_pagamentos() from public;
grant execute on function public.portal_config_pagamentos() to anon, authenticated;

-- A função privilegiada de escrita fica fora do schema exposto pela API.
create schema if not exists portal_private;
revoke all on schema portal_private from public;
grant usage on schema portal_private to anon, authenticated;

create or replace function portal_private.salvar_config_pagamentos(
  p_token uuid, p_formas jsonb, p_padrao jsonb
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  f jsonb;
  v_ids jsonb := '{}'::jsonb;
  v_id text;
  v_pg text;
begin
  perform public.portal__sessao(p_token, 'admin');
  if jsonb_typeof(p_formas) is distinct from 'array'
     or jsonb_array_length(p_formas) < 1
     or jsonb_array_length(p_formas) > 50 then
    raise exception 'Informe entre 1 e 50 formas de pagamento.';
  end if;
  if jsonb_typeof(p_padrao) is distinct from 'array'
     or jsonb_array_length(p_padrao) > 50 then
    raise exception 'Lista de pagamentos padrão inválida.';
  end if;
  for f in select value from jsonb_array_elements(p_formas) as x(value) loop
    v_id := f->>'id';
    if jsonb_typeof(f) is distinct from 'object'
       or v_id is null or v_id !~ '^[a-z0-9][a-z0-9_-]{0,39}$'
       or nullif(trim(f->>'nome'), '') is null
       or length(f->>'nome') > 100
       or length(coalesce(f->>'obs','')) > 200
       or v_ids ? v_id then
      raise exception 'Forma de pagamento inválida ou repetida.';
    end if;
    v_ids := v_ids || jsonb_build_object(v_id, true);
  end loop;
  for v_pg in select value from jsonb_array_elements_text(p_padrao) as x(value) loop
    if not (v_ids ? v_pg) then
      raise exception 'Pagamento padrão não existe na lista de formas.';
    end if;
  end loop;
  insert into public.portal_pagamentos_config(unico,formas,pag_padrao,atualizado_em)
  values(true,p_formas,p_padrao,now())
  on conflict (unico) do update
    set formas = excluded.formas, pag_padrao = excluded.pag_padrao,
        atualizado_em = now();
  return jsonb_build_object('formas',p_formas,'pagPadrao',p_padrao,'configurada',true);
end;
$$;
revoke all on function portal_private.salvar_config_pagamentos(uuid,jsonb,jsonb) from public;
grant execute on function portal_private.salvar_config_pagamentos(uuid,jsonb,jsonb) to anon, authenticated;

create or replace function public.portal_admin_salvar_pagamentos(
  p_token uuid, p_formas jsonb, p_padrao jsonb
) returns jsonb language sql security invoker
set search_path = ''
as $$
  select portal_private.salvar_config_pagamentos(p_token,p_formas,p_padrao);
$$;
revoke all on function public.portal_admin_salvar_pagamentos(uuid,jsonb,jsonb) from public;
grant execute on function public.portal_admin_salvar_pagamentos(uuid,jsonb,jsonb) to anon, authenticated;

-- O cadastro público não pode escolher suas próprias condições de pagamento.
-- Essa regra vale também se o cliente enviar manualmente "pagamentos" na requisição.
create or replace function portal_private.pagamentos_novo_cliente()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  new.pagamentos := coalesce(
    (select pag_padrao from public.portal_pagamentos_config where unico = true),
    '["pix"]'::jsonb
  );
  return new;
end;
$$;
revoke all on function portal_private.pagamentos_novo_cliente() from public;
drop trigger if exists portal_pagamentos_novo_cliente on public.portal_clientes;
create trigger portal_pagamentos_novo_cliente
  before insert on public.portal_clientes
  for each row execute function portal_private.pagamentos_novo_cliente();
