# Roteiro de verificação — frontend demonstrativo

## Inspeção estrutural realizada

- [x] `index.html` preserva o HTML e o CSS do projeto original.
- [x] O catálogo e os valores são servidos por `mock-adapter.js`.
- [x] Chamadas de dados pessoais e de envio de pedidos usam respostas simuladas, não HTTP.
- [x] Nenhum endereço/chave do Supabase de produção foi incluído no JS demonstrativo.
- [x] A interface continua usando as mesmas rotinas de busca, navegação, fotos, Minha Lista, checkout e telas administrativas.
- [x] Sintaxe de `portal-ui.js` e `mock-adapter.js` verificada.

## Homologação visual em navegador — ainda necessária

- [ ] Largura 360 px: cabeçalho, busca, duas colunas de cards, carrinho e checkout, sem scroll lateral.
- [ ] Largura 390 px: pesquisa e rolagem automática mantendo a busca visível com teclado aberto.
- [ ] Largura 768 px: grid, tabbar quando aplicável e modais.
- [ ] Largura 1280 px: catálogos, carrinho e detalhes.
- [ ] Largura 1920 px: centralização e uso correto de espaços.
- [ ] Uso por teclado: Tab, Enter, Escape, foco visível.
- [ ] Tela vazia, erro, carregamento, indisponibilidade, sessão encerrada.
- [ ] Carrinho vazio, adicionar/remover, quantidade, Minha Lista e revisão.
- [ ] Envio simulado com sucesso, falha e resposta incerta; nunca afirmar recebimento real.
- [ ] Preços de demonstração claramente distinguidos de preços reais no aceite da entrega.
- [ ] Validação final de compatibilidade pelos responsáveis pelo portal e pela Movimento.

**Não confundir verificação estática com teste visual em navegador.** A homologação visual acima permanece pendente.
