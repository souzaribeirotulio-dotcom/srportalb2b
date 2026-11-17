# Pendências para a Movimento Sistemas

Arquivo mantido pelo projeto durante a integração com a **API dos sistemas externos 2026.11.16**.
Cada item diz o que falta e por quê. Nenhum segredo ou dado de cliente é registrado aqui.

## Integração G360 (em andamento)

| # | Data | Assunto | O que precisamos | Situação |
|---|---|---|---|---|
| 1 | 16/11/2026 | Origem fixa de homologação | Cadastrar a origem `https://sr-portal-b2b-homologacao.vercel.app` na loja de homologação `96da1e99a3f327f0` (CORS). `http://localhost:5173` já está cadastrada. | Resolvido em 16/11/2026 (GET loja respondeu no endereço de homologação) |
| 2 | 16/11/2026 | Catálogo antes do login | No contrato, `GET produtos`, `GET grupos` e `GET marcas` exigem a sessão do comprador. A Souza Ribeiro quer que o visitante veja os produtos (nome, foto, marca, categoria), com o preço trocado por "Entre para ver os preços". Pedimos uma operação pública de catálogo sem preço, estoque nem dados de cliente (por exemplo `GET catalogo-publico`, paginada como `GET produtos`, com `grupos`/`marcas`). O portal não usa conta de comprador nem servidor intermediário para contornar. | Pedido à Movimento em 17/11 |
| 3 | 16/11/2026 | Teste do kit (`ponte_test.ts`) | Com Deno 2.9.8, `deno test` acusa erro de tipo na linha 86 do `ponte_test.ts` (TS2322: `Timeout` não é atribuível a `number`). Os 9 testes passam com `--no-check`. O arquivo do kit não foi alterado; sugerimos ajustar o tipo na próxima versão do kit. | Informativo — sem bloqueio |
| 4 | 16/11/2026 | Cadastro de cliente novo pelo portal | O contrato não tem operação para criar cliente no G360. O portal antigo tinha o "Quero ser cliente" (pedido de cadastro aprovado pela equipe). Por ora o pedido ficará guardado no Supabase da Souza Ribeiro e a equipe cadastra o cliente no G360; depois o cliente faz o primeiro acesso. Se a Movimento puder oferecer uma operação de pré-cadastro, o portal passa a usá-la. | Informativo — sem bloqueio |
| 5 | 16/11/2026 | Dados de homologação das etapas 4 a 11 | Recebidos da Movimento em 16/11: e-mail de teste, compradores 1165 e 1919, pedidos liberados (usar retirada), operadores do próprio G360 e cenário de pendência do fornecedor. | Resolvido em 16/11/2026 |
| 6 | 16/11/2026 | Data prevista de entrega | A natureza 12 dos pedidos da API não exige data prevista; o portal não calcula previsão por enquanto. Se a Souza Ribeiro mudar isso no G360, o tema volta. | Resolvido em 16/11/2026 |
| 7 | 16/11/2026 | Tabela de frete na homologação | Em 17/11 a Movimento carregou uma tabela de teste: Uberlândia sem frete; Uberaba R$ 25,00 (grátis a partir de R$ 1.500,00); Araguari R$ 35,00 (grátis a partir de R$ 2.000,00); demais cidades com "frete a combinar" (cliente 1919, de Indianópolis, para testar). Valores de Uberaba e Araguari são de teste. A Movimento vai levar a tabela para dentro do G360, para a Souza Ribeiro manter os valores por cidade. Falta a Souza Ribeiro responder como cobra pelo valor do pedido. | Tabela de teste carregada · aguardando regra definitiva |
| 8 | 16/11/2026 | Login de operador | A Movimento ainda não entrou com operador real nessa base. Se aparecer `LICENCA_OPERADOR_INDISPONIVEL`, mandar o código para o suporte. Gravação de fotos só confere na implantação. | Aguardando teste da etapa 10 |
| 9 | 16/11/2026 | Fotos enviadas pelo painel | Teste de 16/11 às 19:12: `POST operadores/produtos/{id}/fotos` respondeu 422 `DADOS_INVALIDOS` (request_id `9f213dac01197ff1`) por causa da pasta de rede do G360. Em 17/11 a Movimento liberou o envio na homologação com o operador Tulio nos produtos sem foto (7632, 3528, 55, 7345, 9138, 9139, 10498, 10499). Fotos que já existiam no G360 continuam sem abrir na homologação, porque os arquivos ficam no servidor da Souza Ribeiro. Sugestão mantida: classificar o erro de pasta de rede como `fornecedor`. | Liberado para teste em 17/11 |
| 10 | 16/11/2026 | Conferência no ar das etapas 5 a 11 | Portal construído e testado com a API simulada (dados fictícios). Falta a conferência na homologação real com os clientes 1165 e 1919 e os operadores do G360. Diferenças entre a API real e o contrato serão anotadas aqui com operação, horário e request_id. | Em conferência |
| 11 | 17/11/2026 | Unidades alternativas para teste | A Movimento liberou caixa/pacote nos produtos 7632 (caixa com 12), 3528 (caixas de 40 e de 50), 55 (DP e CX de 27), 7345, 9138, 9139, 10498 e 10499. | Liberado para teste em 17/11 |
| 12 | 17/11/2026 | Pedido mínimo pela API | A Movimento está criando o pedido mínimo (R$ 150,00) como regra da própria API, com parâmetro no G360: a revisão vai trazer a pendência "O pedido mínimo é de R$ 150,00." e não vai deixar enviar, e `GET loja` vai trazer o valor do mínimo para o portal avisar no carrinho. O portal só vai mostrar esse aviso quando o campo estiver no contrato OpenAPI (nome e formato); até lá o bloqueio aparece pela pendência da revisão, que o portal já mostra. Pedimos o contrato atualizado quando sair. Também precisamos saber se o mínimo pode variar por cidade (a regra comercial é R$ 150,00 em Uberlândia e Araguari e R$ 200,00 em Uberaba). | Em desenvolvimento pela Movimento |

---

## Histórico: pendências da fase de protótipo (antes do escopo revisão 2)


Pontos em que o frontend precisa de uma definição da Movimento.

Enquanto a definição não chega, o adaptador mock (`servicos/adaptador-mock.js`) devolve uma resposta simulada e a tela segue funcionando.
Nada aqui é contrato oficial. Os nomes de operação são os da interface do frontend (`servicos/contrato.js`).

## Autenticação e sessão
1. Como o cliente B2B se autentica (CNPJ + senha? usuário por comprador?). Qual o formato do token e como a sessão é renovada ou expirada? *(mock: sessão no navegador)*
2. Como funciona o login do administrador do portal, e se ele usa usuários do G360 ou um cadastro próprio. *(mock: usuário `demo`)*
3. Como é feita a recuperação de senha e quem envia o e-mail. *(mock: mensagem "nenhum e-mail foi enviado")*
4. Situações de cadastro (pendente, aprovado, reprovado, bloqueado): quais existem no G360, e se o cadastro feito no portal entra como pré-cadastro para aprovação.

## Cadastro
5. Consulta de CNPJ, dados da Receita e inscrição estadual: se é feita pelo G360 ou por outro serviço. Formato do retorno e tratamento de empresa isenta. *(mock: só o CNPJ 11.222.333/0001-81)*
6. Consulta de CEP: se fica a cargo do serviço da Movimento. *(mock: 3 CEPs fictícios)*
7. Endereços de entrega adicionais: se o G360 guarda vários endereços por cliente, e qual é o identificador usado no pedido (`endereco_id`).

## Catálogo, preço e estoque
8. O serviço deve devolver o preço **já calculado para o cliente logado** (tabela, preço especial ou negociado). A tela não recalcula preços.
9. O catálogo deve vir sem preço para visitantes não logados? *(mock: devolve preço; a tela esconde até o login)*
10. Unidades alternativas (caixa, fardo): fator e preço próprio por unidade. Qual é o identificador da unidade (`unidade`) a enviar no pedido?
11. Estoque: qual saldo mostrar (disponível, reservado), com que frequência é atualizado e se o envio deve ser bloqueado acima do estoque. *(mock: bloqueia e explica em `aviso`)*
12. Fotos, descrição e palavras de busca dos produtos: se vêm do G360 ou de outro repositório.
13. Visibilidade (produto ativo/inativo no portal) e "mostrar só com estoque": quem controla.

## Revisão e envio do pedido
14. O G360 oferece uma etapa de **revisão/cotação** antes do pedido (preços, impostos, frete, totais, condições)? Por quanto tempo a revisão vale? *(mock: `revisarPedido` → `revisao_id` válido por 15 min)*
15. Quais totais devem aparecer (subtotal, impostos/ST, frete, descontos) e com quais rótulos? *(mock: subtotal e frete simulado R$ 0,00)*
16. Condições de pagamento por cliente: lista, descrição, parcelas e regras de disponibilidade.
17. **Previsão de entrega.** O frontend não calcula mais o prazo. Regra informada pela Souza Ribeiro para **Uberlândia**:
    - pedido em dia útil até 10h: entrega no mesmo dia até 18h;
    - após 10h: entrega no próximo dia útil até 18h;
    - fim de semana ou feriado: entrega no próximo dia útil até 18h.

    Feriados considerados: nacionais + 04/06 (Corpus Christi), 15/08 (N. Sra. da Abadia) e 31/08 (aniversário de Uberlândia). As regras das demais cidades ainda serão definidas pela Souza Ribeiro.

    Pergunta: o serviço devolve o texto da previsão pronto? *(mock: "Previsão fictícia: amanhã até 18h")*
18. Retorno do envio:
    - número do pedido;
    - situação inicial;
    - quais erros podem ocorrer (estoque, crédito, bloqueio financeiro, preço alterado);
    - se o envio pode ser repetido com segurança (idempotência), para o botão "Tentar novamente" não duplicar o pedido.
19. Observação do pedido: limite de caracteres e campo de destino no G360. *(tela: até 500)*

## Histórico
20. Formato do histórico: situações possíveis (recebido, faturado, entregue, cancelado), número da nota fiscal, rastreio e paginação.
21. "Minha Lista" (itens que o cliente costuma comprar, com última quantidade e média): se é calculada pelo G360 a partir das vendas.

## Recursos administrativos e extras
22. Cadastro de clientes pelo admin do portal: se grava no G360 e qual é o campo do "código do cliente no G360".
23. Preços especiais (congelados) por cliente e negociações de preço: se o G360 tem tabela de preço por cliente ou se fica em cadastro próprio do portal.
24. Configurações do portal (sinônimos de busca, formas de pagamento, vendedores, feriados, margem mínima): onde ficam guardadas.
25. Custo do produto (para o alerta de margem do admin): se pode ser exposto ao painel administrativo e com que permissão.
26. Clips (vídeos) e fotos enviados pelo admin: armazenamento e URLs. *(mock: ficam só no navegador)*
27. Painel de inteligência comercial (buscas, carrinhos parados): se a Movimento recebe esses eventos. *(mock: "depende de integração")*
28. Assistente Souzinha (IA): serviço e chave ficam fora do escopo da Movimento? *(mock: resposta simulada sem IA)*
29. Edição de produto e de preço de tabela pelo painel (nome, descrição, preço, unidades alternativas, mostrar/ocultar no catálogo): o contrato 2026-11-16 só tem, para o operador, consulta de produtos/preços, preço congelado por cliente e fotos. A equipe informou em 17/11 que a API aceita editar produtos e preços: pedir à Movimento a versão do contrato OpenAPI com essas operações (rota, campos, permissões e erros) para o painel usar.
30. Lista de clientes com acesso ao portal: o painel só sabe quem já entrou pelo menos uma vez. Pedir uma operação do operador que liste os clientes com "Acesso à API dos sistemas externos" marcado (código, nome, CNPJ, situação), paginada.

31. Pedido mínimo: resolvido pelo contrato atual — `pedido_minimo` vem na condição de pagamento e a revisão devolve a pendência PEDIDO_MINIMO (o portal já mostra e bloqueia o envio). Não precisa de campo novo em GET loja.

## Atualização 17/11 (contrato 2026-11-17)
- Item 2 (catálogo para visitantes): RESOLVIDO pela vitrine (`GET vitrine/produtos`, `vitrine/grupos`, `vitrine/marcas`, fotos sem Bearer). Implantado no portal. Confirmar com a Movimento que o "Catálogo aberto para visitantes" está ligado na loja de homologação e que a origem https://sr-portal-b2b-homologacao.vercel.app está cadastrada também para a vitrine.
- Itens 12/31 (pedido mínimo): `GET loja` agora traz `pedido_minimo` e a revisão devolve `PEDIDO_MINIMO_LOJA`. O carrinho mostra o mínimo; o envio é decidido pela revisão.

## Pedidos novos (17/11, tarde)
32. Incluir e alterar cliente pelo painel do operador (item 22): o contrato 2026-11-17 só tem `POST operadores/clientes/consulta` (por CNPJ, devolve código, nome, acesso_portal e segmento). Pedir operações para incluir cliente e alterar cadastro (dados principais, contato, endereço, liberação de "Acesso à API"), com as permissões do G360 (00501/00502). Hoje o painel guarda uma ficha própria no Supabase e liga ao cliente pelo código do G360, sem alterar o G360.
33. Consulta do cadastro completo do cliente pelo operador (endereço, contato, e-mail, inscrição estadual), por CNPJ ou por código, para a ficha do painel vir preenchida do G360 em vez da Receita.
34. Esconder produtos com estoque baixo: a equipe quer mostrar no portal só produtos com saldo acima de 5 unidades. O catálogo não traz a quantidade em estoque, só `disponibilidade`/`compravel` e a `faixa_disponibilidade` (informativa, sem o limite documentado). Pedir: (a) um parâmetro da loja no G360 com o saldo mínimo para o produto aparecer/vender no portal, aplicado pela própria API; ou (b) o limite usado para "ultimas_unidades" e se ele pode ser configurado em 5.
35. Travar quantidade acima do saldo ao adicionar ao carrinho: o catálogo não informa a quantidade disponível. Pedir um campo com o saldo disponível para venda (ou um máximo por item) em `GET produtos`/`POST produtos/busca`, e confirmar se `POST revisoes` devolve pendência no item quando a quantidade pedida passa do saldo (qual código e mensagem), com a loja bloqueando venda sem estoque.
