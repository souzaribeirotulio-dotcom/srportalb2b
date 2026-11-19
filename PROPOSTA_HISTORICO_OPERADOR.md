# Proposta para a Movimento: histórico de compras do cliente no painel do operador

Souza Ribeiro · Portal B2B · 19/11/2026
Contrato de referência: `api-sistemas-externos-2026-11-19.yaml`

Todos os dados dos exemplos são fictícios.

## 1. O que queremos fazer

No painel do portal, a equipe abre a ficha de um cliente e clica em **"Montar lista dos últimos 3 meses"**. O painel faz quatro coisas:

1. Mostra os produtos que o cliente comprou no período. Para cada um aparecem a embalagem em que foi vendido e o **valor unitário que ele pagou da última vez**.
2. Ao lado, mostra o preço de tabela atual para esse cliente (`POST operadores/produtos/precos`). Quando o operador tem `ver_custo`, mostra também o custo e a margem.
3. O operador confere, desmarca o que não quer e escolhe o período de validade.
4. O painel coloca os produtos marcados na Minha Lista do cliente (Supabase do portal) e grava um preço congelado por produto e embalagem (`POST operadores/clientes/{cliente}/precos-congelados`), com o valor da última compra.

Hoje não existe no contrato como fazer o passo 1:

- `GET historico-compras` só funciona com a sessão do próprio comprador e não traz o valor pago.
- O painel do operador não tem nenhuma rota de histórico.

Tentamos usar o PDF de vendas do G360, mas ele não serve:

- os itens não têm data, então não dá para saber qual é a última compra;
- não diz a embalagem vendida;
- o valor unitário às vezes difere do total dividido pela quantidade, por causa de desconto;
- a leitura do PDF quebra com nomes longos.

## 2. Operação 1 (a principal): histórico do cliente para o operador

```
GET operadores/clientes/{cliente}/historico-compras
operationId: consultarHistoricoComprasCliente
Authorization: Bearer <token do operador>
```

**Permissões (sugestão).** Ver o histórico exige o acesso **00500** (`consultar_clientes`). O cliente tem de estar no recorte do operador, igual à ficha: com "Vendedor exclusivo", fora da carteira, a resposta é 404 `CLIENTE_NAO_LOCALIZADO`. O `valor_unitario` vem preenchido só para quem tem `consultar_precos_cliente` (01100 + 00500). Sem esse acesso, vem `null`, como o custo com `ver_custo`.

**Parâmetros (query)**, no mesmo padrão do `GET historico-compras`:

| Nome | Tipo | Descrição |
|---|---|---|
| `meses` | inteiro de 1 a 24 | Janela móvel até hoje. Padrão: 3. |
| `produto_ids` | texto | Até 500 ids de produto separados por vírgula. Omitido: todos. |
| `pagina` | inteiro ≥ 1 | Padrão: 1. |
| `limite` | inteiro de 1 a 50 | Padrão: 20. |

**Regras que pedimos**

1. **Mesmas vendas do histórico do comprador:** vendas concluídas do cliente no período, feitas pela API ou com o vendedor.
2. **Uma linha por produto e embalagem:** cada combinação de `produto_id` com `unidade_id` (`null` = unidade base) é uma linha. O preço congelado é gravado por produto e unidade, então precisamos do valor de cada embalagem separado.
3. **`ultima_compra.valor_unitario`:** é o valor efetivamente cobrado por unidade vendida nessa linha, já com o desconto do item. Não inclui frete nem taxa de pagamento. Vem como texto decimal com ponto, na precisão da venda (a mesma que `POST precos-congelados` aceita).
4. **Kits:** o kit vem pelos componentes gravados como itens, como no histórico do comprador, com `kit_id` preenchido. O portal não congela preço de componente de kit.
5. **Produto que não se vende mais:** quando o produto está inativo, não é apto para venda ou não pode ter preço congelado (kit, por exemplo), `pode_congelar` vem `false`. Assim o portal não tenta gravar e recebe erro item por item.
6. **Ordem:** da compra mais recente para a mais antiga. `paginacao.total` conta linhas, não pedidos.

**Resposta 200 (exemplo)**

```json
{
  "dados": {
    "cliente": 42,
    "inicio": "2026-08-19",
    "fim": "2026-11-19",
    "produtos": [
      {
        "produto_id": 101,
        "codigo": "P-101",
        "unidade_id": null,
        "unidade": "UN",
        "pedidos": 4,
        "quantidade_media": "12",
        "pode_congelar": true,
        "kit_id": null,
        "ultima_compra": {
          "data": "2026-11-10",
          "pedido": 9001,
          "quantidade": "10",
          "valor_unitario": "18.9900000"
        }
      },
      {
        "produto_id": 101,
        "codigo": "P-101",
        "unidade_id": 7,
        "unidade": "CX",
        "pedidos": 1,
        "quantidade_media": "2",
        "pode_congelar": true,
        "kit_id": null,
        "ultima_compra": {
          "data": "2026-09-02",
          "pedido": 8800,
          "quantidade": "2",
          "valor_unitario": "180.0000000"
        }
      }
    ]
  },
  "paginacao": { "pagina": 1, "limite": 50, "total": 2 },
  "request_id": "exemplo-0001"
}
```

**Erros**

Seguem o catálogo atual:

- `OPERADOR_SEM_ACESSO` (403);
- `CLIENTE_NAO_LOCALIZADO` (404, cliente fora do recorte);
- `DADOS_INVALIDOS` (422);
- `MUITAS_TENTATIVAS` (429), com `Retry-After`;
- `INDISPONIVEL` (503), com `Retry-After`;
- `LICENCA_OPERADOR_INDISPONIVEL` (423);
- os de sessão.

**Em `GET operadores/me`:** se o acesso ao histórico for diferente de `consultar_clientes`, incluir a permissão em `permissoes` (por exemplo, `historico_clientes`). Assim o painel esconde o botão de quem não pode usar.

## 3. Operação 2 (opcional): vários preços congelados numa chamada

Sem ela, um cliente com 120 produtos exige 120 chamadas de `POST precos-congelados`. Com pausas para respeitar o limite por IP e loja, isso leva alguns minutos. Se for possível:

```
POST operadores/clientes/{cliente}/precos-congelados/lote
operationId: incluirPrecosCongeladosEmLote
Authorization: Bearer <token do operador>
Idempotency-Key: <chave nova por lote>
```

- **Permissão:** a mesma do `POST precos-congelados` (500110).
- **Limite:** até 100 itens por chamada.
- **Cada item vale sozinho:** o que for recusado volta com o seu erro, e os demais são gravados.
- **Sem duplicar:** a `Idempotency-Key` segue a mesma regra do envio do pedido, para o painel poder repetir a chamada depois de um tempo esgotado.

```json
{
  "inicio": "2026-11-20",
  "fim": "2027-02-20",
  "itens": [
    { "produto": 101, "unidade_id": null, "valor": "18.99" },
    { "produto": 101, "unidade_id": 7, "valor": "180.00" }
  ]
}
```

Resposta 200:

```json
{
  "dados": {
    "gravados": 1,
    "recusados": 1,
    "itens": [
      { "produto": 101, "unidade_id": null, "situacao": "gravado", "preco": { "id": 501, "valor": "18.9900000", "inicio": "2026-11-20", "fim": "2027-02-20", "situacao": "ativo" } },
      { "produto": 101, "unidade_id": 7, "situacao": "recusado", "erro": { "codigo": "DADOS_INVALIDOS", "mensagem": "Use um produto que não seja kit e uma unidade disponível para venda.", "responsavel": "usuario" } }
    ]
  },
  "request_id": "exemplo-0002"
}
```

Se já existir preço congelado ativo para o mesmo produto, unidade e período, pedimos que a resposta diga isso no item. Pode ser `situacao: "ja_existia"` com o preço atual, ou um código de erro próprio. Assim o painel pergunta se a equipe quer alterar o existente (`PUT precos-congelados/{preco}`).

## 4. Como o portal vai usar

1. **Abrir a ficha:** só aparece o botão "Montar lista dos últimos 3 meses", sem nenhuma chamada.
2. **Clicar no botão:** o painel chama `GET operadores/clientes/{cliente}/historico-compras?meses=3&limite=50` e percorre as páginas. Um cliente com 120 linhas são 3 chamadas.
3. **Preços atuais:** o painel chama `POST operadores/produtos/precos` com os produtos do histórico, para ter o preço de tabela, o preço congelado vigente e, com `ver_custo`, a margem.
4. **Conferência:** o painel mostra uma tabela com: produto, embalagem, data e valor da última compra, preço de tabela atual, preço congelado vigente e margem.
   - Vêm desmarcadas as linhas com `pode_congelar: false` e as que ficariam abaixo da margem mínima da Souza Ribeiro.
   - O operador pode editar o valor antes de gravar.
5. **Confirmação:** o painel inclui os produtos na Minha Lista do cliente (Supabase do portal) e grava os preços pela operação 2 (ou um por um, se ela não existir). Depois mostra o resultado de cada linha.

O portal não calcula preço: o valor congelado é o que a API devolveu como último valor pago, ou o que o operador digitou. Quem confere o valor e a precisão continua sendo o `POST precos-congelados`.

## 5. Perguntas

1. O `valor_unitario` pode ser o valor por unidade vendida, já com o desconto do item? Ou o G360 guarda isso de outro jeito, por exemplo com desconto só no total da venda?
2. Pedido aguardando aprovação do fornecedor deve entrar no histórico, ou só as vendas concluídas?
3. A operação 2 (lote) é viável? Se não for, existe um limite por minuto próprio para `POST precos-congelados` que devemos respeitar?
4. Para o acesso ao valor pago, usamos `consultar_precos_cliente` ou vocês preferem uma permissão própria?
