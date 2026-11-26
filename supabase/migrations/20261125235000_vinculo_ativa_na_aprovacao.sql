-- Executivo de contas: o vínculo "aguardando" passa a valer assim que o pedido fica aprovado e ligado
-- a um código do G360, por qualquer caminho (Cadastrar no G360, ligar a ficha existente, Editar,
-- cadastro automático). Antes dependia de uma segunda chamada do navegador, que às vezes não acontecia.
-- Regra igual à da função executivos-g360: com "só clientes novos", cliente que já usava o portal fica
-- "sem comissão"; senão fica ativo por prazo_meses a partir de hoje (horário de Brasília).
create or replace function public.portal_cadastro_ativa_vinculo()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg record; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_existia boolean;
begin
  if new.status <> 'aprovado' or new.codigo_g360 is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = new.status and old.codigo_g360 is not distinct from new.codigo_g360 then return new; end if;
  select so_novos, prazo_meses into v_cfg from public.comissao_config where loja = new.loja;
  select exists (select 1 from public.portal_acessos a where a.loja = new.loja and a.comprador_codigo = new.codigo_g360) into v_existia;
  if coalesce(v_cfg.so_novos, true) and v_existia then
    update public.executivo_clientes set situacao = 'sem_comissao', motivo = 'Cliente já existente — não gera comissão',
      cliente_codigo = new.codigo_g360, inicio = null, fim = null, atualizado_em = now()
     where loja = new.loja and cadastro_id = new.id and situacao = 'aguardando';
  else
    update public.executivo_clientes set situacao = 'ativo', motivo = null, cliente_codigo = new.codigo_g360, inicio = v_hoje,
      fim = case when coalesce(v_cfg.prazo_meses, 12) > 0 then (v_hoje + make_interval(months => coalesce(v_cfg.prazo_meses, 12)))::date end,
      atualizado_em = now()
     where loja = new.loja and cadastro_id = new.id and situacao = 'aguardando';
  end if;
  return new;
end $$;
revoke all on function public.portal_cadastro_ativa_vinculo() from public, anon, authenticated;
drop trigger if exists portal_cadastro_ativa_vinculo on public.portal_cadastros;
create trigger portal_cadastro_ativa_vinculo after insert or update of status, codigo_g360 on public.portal_cadastros
  for each row execute function public.portal_cadastro_ativa_vinculo();
