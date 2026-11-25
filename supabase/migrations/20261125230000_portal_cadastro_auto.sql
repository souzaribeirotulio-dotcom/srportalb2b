-- Cadastro automático do "Quero ser cliente": a função cadastro-g360 cria a ficha no G360 (usuário técnico),
-- libera o acesso e manda o link de senha. O cliente entra, mas vê o catálogo sem preço até a equipe aprovar
-- no painel (em_analise = false). auto_status/auto_obs: o que a função fez (sem documento, senha ou e-mail).
alter table public.portal_cadastros
  add column if not exists em_analise boolean not null default false,
  add column if not exists auto_status text check (auto_status is null or auto_status in ('processando', 'criado', 'ja_existe', 'revisar', 'erro')),
  add column if not exists auto_obs text check (auto_obs is null or char_length(auto_obs) <= 300),
  add column if not exists auto_em timestamptz;

-- O portal pergunta, com a sessão vinculada do comprador, se o cadastro dele ainda está em análise.
create or replace function public.portal_ocultos_comprador()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_loja text := (select auth.jwt() -> 'app_metadata' ->> 'g360_loja');
  v_cod text := (select auth.jwt() -> 'app_metadata' ->> 'g360_comprador');
  v_termos text[]; v_codigos text[]; v_analise boolean;
begin
  if v_cod is null or v_loja is null or not (select g360_ponte_privado.sessao_valida()) then
    return jsonb_build_object('termos', '[]'::jsonb, 'codigos', '[]'::jsonb, 'em_analise', false);
  end if;
  select e.ocultar_termos, e.ocultar_codigos into v_termos, v_codigos
    from public.executivo_clientes v join public.executivos e on e.id = v.executivo_id
   where v.loja = v_loja and v.cliente_codigo::text = v_cod and v.situacao = 'ativo' and e.ativo
     and (v.fim is null or v.fim >= (now() at time zone 'America/Sao_Paulo')::date)
   order by v.inicio desc nulls last limit 1;
  select exists (select 1 from public.portal_cadastros c where c.loja = v_loja and c.codigo_g360::text = v_cod and c.em_analise) into v_analise;
  return jsonb_build_object('termos', to_jsonb(coalesce(v_termos, '{}')), 'codigos', to_jsonb(coalesce(v_codigos, '{}')), 'em_analise', coalesce(v_analise, false));
end $$;
