# Pendências para integração — Movimento Sistemas

**Responsável pela resolução:** Movimento Sistemas em conjunto com a Souza Ribeiro.

Este arquivo é um registro de dependências; **não descreve contratos nem regras internas do G360**. A interface visual existente está aprovada e não deve ser redesenhada sem solicitação expressa do responsável.

## Autenticação e acesso

- [ ] Definir autenticação real e autorização por perfil: cliente, administrador e eventual vendedor.
- [ ] Definir confirmação de e-mail antes da aprovação administrativa e recuperação segura de senha.
- [ ] Definir expiração, renovação e revogação de sessão, proteção contra acesso a dados de outros clientes.
- [ ] Definir origem oficial dos cadastros e fluxo de aprovação, incluindo liberação de condições de pagamento.
- [ ] Garantir que nenhuma credencial privilegiada seja incorporada no frontend.

## Catálogo

- [ ] Definir origem dos dados dos produtos: código, nome, descrição, marca, imagens, NCM, EAN, categoria e unidade.
- [ ] Confirmar estrutura de unidades alternativas e fatores.
- [ ] Definir consulta de disponibilidade/estoque e regra de item indisponível.
- [ ] Definir preços por cliente, validade, preços congelados, descontos, tributos e respostas do backend para totais.
- [ ] Definir cadência de atualização (solicitação comercial prévia: até 10 min durante o horário comercial) e fallback quando a fonte estiver indisponível.
- [ ] Confirmar se imagens e vídeos serão armazenados pela Movimento ou por outro serviço.

## Carrinho, checkout e pedidos

- [ ] Definir e homologar o cálculo autoritativo de valores, condições comerciais e totais **exclusivamente no backend**.
- [ ] Definir consulta de formas de pagamento liberadas individualmente por cliente.
- [ ] Definir seleção e manutenção dos endereços permitidos.
- [ ] Definir frete/prazo por endereço, data e disponibilidade; informações demonstrativas não são promessas de entrega.
- [ ] Definir envio seguro, idempotência e tratamento para resposta incerta do serviço, evitando duplicação de pedidos.
- [ ] Definir número, situação, itens, históricos, devoluções e atualização de pedidos existentes no ERP.
- [ ] Definir mensagens de sucesso/erro, inclusive falhas temporárias.

## Integração, segurança e operação

- [ ] A Movimento disponibilizará **contratos e documentação próprios** do backend quando definidos; o frontend não deve inventar rotas.
- [ ] Definir ambiente de testes/homologação isolado e credenciais de teste gerenciadas pela Movimento.
- [ ] Definir políticas de autorização, segurança de dados, auditoria e observabilidade.
- [ ] Confirmar responsável por cadastro, alteração e manutenção de NCM e outros dados fiscais.
- [ ] Validar uso e armazenamento de dados pessoais, consentimento de marketing e opção de descadastro.
- [ ] Definir provedor de envio para os e-mails transacionais e campanhas; configurar DNS SPF/DKIM/DMARC no domínio.
- [ ] Planejar testes end-to-end, carga, segurança, desempenho e aprovação final da Souza Ribeiro antes de produção.

## Não incluso nesta entrega

Não foram implementados API, banco, Supabase, autenticação real, leitura do G360, preços reais, regras de crédito, faturamento ou disparo de e-mails. Essas partes não devem ser simuladas como operações efetivas no ambiente final.
