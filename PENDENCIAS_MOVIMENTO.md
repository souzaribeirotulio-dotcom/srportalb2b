# Pendências para a Movimento Sistemas

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
