-- Resumo do pré-cadastro para a aba Clientes do painel (só a função painel-g360 lê, com a chave secreta).
-- E a opção "conferir WhatsApp ou e-mail" do formulário para quem está no pré-cadastro.
begin;

create view public.portal_pre_resumo with (security_invoker = true) as
select c.loja, c.comprador_codigo, c.documento, c.nome, c.cidade, c.bairro, c.vendedores, c.ultima_compra,
       c.itens_lista, c.itens_congelados, c.acesso_liberado_em, c.senha_criada_em, c.acesso_obs,
       count(k.produto_id) filter (where k.situacao = 'gravado') as cong_gravados,
       count(k.produto_id) filter (where k.situacao = 'pendente') as cong_pendentes,
       count(k.produto_id) filter (where k.situacao in ('recusado', 'ignorado')) as cong_fora,
       a.primeiro_em as entrou_em, a.ultimo_em as ultimo_acesso
from public.portal_pre_cadastro c
left join public.portal_pre_congelados k on k.loja = c.loja and k.comprador_codigo = c.comprador_codigo
left join public.portal_acessos a on a.loja = c.loja and a.comprador_codigo = c.comprador_codigo
group by c.loja, c.comprador_codigo, a.primeiro_em, a.ultimo_em;

revoke all on public.portal_pre_resumo from public, anon, authenticated;

alter table public.portal_config add column if not exists pre_conferir_contato boolean not null default false;
comment on column public.portal_config.pre_conferir_contato is
  'Pré-cadastro: no Quero ser cliente, só cria a senha se o WhatsApp ou o e-mail digitado for o da ficha no G360.';

commit;
