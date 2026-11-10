# Inteligência Comercial — portal B2B Souza Ribeiro

## Objetivo
Painel simples e acionável, sem alterações no catálogo, Minha Lista ou checkout. A aba **Admin → Inteligência** só é acessível por administradores com sessão válida. O período pode ser de 7 ou 30 dias.

## O que já é coletado
Somente durante sessões **autenticadas de clientes** (não contabiliza visitas anônimas nem atividade de admin):
- **Buscas:** texto de pesquisa (máximo 80 caracteres) e quantidade de resultados, após pausa na digitação; buscas contendo possíveis e-mails ou longas sequências numéricas são omitidas.
- **Produtos vistos:** abertura da página de detalhes.
- **Adições:** ação de adicionar ao carrinho, não quantidade comprada.
- **Checkout iniciado:** abertura da revisão do pedido, **não equivale a pedido confirmado**.
- **Carrinho em preparação:** itens e quantidades, sem preços, com CNPJ da sessão, origem (carrinho/Minha Lista) e data da última atualização.

As tabelas `portal_intel_eventos` e `portal_intel_carrinhos` estão no Supabase com RLS habilitado e sem acesso direto dos usuários; eventos e consultas passam por funções com tokens validados no servidor.

## Indicadores expostos
1. Clientes ativos com eventos registrados.
2. Total de buscas e buscas sem resultado (com proporção).
3. Visualizações e adições.
4. Checkouts iniciados.
5. Termos de pesquisa mais frequentes e sem resultado.
6. Produtos visualizados, mas pouco adicionados (sinal de interesse, não prova de venda perdida).
7. Carrinhos com itens e sem atualização há mais de 24 horas (somente no período selecionado).

Os dados **começam a ser coletados agora**, sem histórico retroativo. Como a entrega do pedido no portal ainda é demonstrativa, **não há KPI de faturamento nem de pedidos reais confirmados**. O painel exibe explicitamente essa pendência.

## Para a Movimento Sistemas
- Homologar a origem dos pedidos reais e fornecer o evento autoritativo de **pedido confirmado** com identificador único para não contabilizar duplicações.
- Revalidar preços, condições, estoque e valores no backend; jamais derivar o faturamento do evento de clique em confirmar.
- Manter a fonte de dados do dashboard sob autorização administrativa por servidor.
- Decidir retenção dos eventos (por exemplo, janela limitada), avisos de privacidade e bases legais conforme LGPD; avaliar consentimento quando necessário.
- Garantir que a conta do cliente não possa ler dados de outros CNPJs; proteger endpoints contra abuso.
- Considerar carrinhos por usuário/sessão caso um mesmo CNPJ use vários dispositivos; a primeira versão mantém somente o último estado por CNPJ.
- Confirmar se o catálogo e as palavras-chave continuarão no frontend ou passarão ao mecanismo de busca integrado.

## Limitações da versão inicial
- Eventos gerados pelo navegador são indicativos, podem ser bloqueados e não são registros de auditoria, vendas ou cobrança.
- A taxa de compra não pode ser estimada com segurança até a integração com o ERP.
- Não recupera interações de antes da implantação nem buscas realizadas sem login.
- Carrinho parado significa **sem atualização por 24 horas**, não necessariamente abandono definitivo.
- Sem campanhas automáticas de recuperação, mensagens a clientes ou contato automático com vendedores.
