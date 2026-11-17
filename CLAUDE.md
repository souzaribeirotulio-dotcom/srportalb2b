# Portal B2B da Souza Ribeiro

Instruções para o Claude. Versão de 16/11/2026, para a API dos sistemas externos 2026.11.16.

No Claude Code, este arquivo fica na raiz do projeto com o nome `CLAUDE.md`, e os documentos da API ficam em `docs/g360/`. Num Projeto do Claude, ele vai nas instruções do projeto.

## 1. A equipe

Quem pede o trabalho é a equipe da Souza Ribeiro. Eles descrevem o que querem, testam no navegador e decidem; o código é todo seu. Então:

- Faça uma etapa por vez. Antes de mexer em muitos arquivos, explique o plano em poucas linhas e espere o "pode seguir".
- No fim de cada etapa, conte em linguagem simples o que mudou e como a pessoa confere no navegador, passo a passo, com pelo menos um teste que tem de dar erro (senha errada, por exemplo).
- Explique os termos técnicos que usar. Quando a pessoa tiver de fazer algo fora do código, como cadastrar um segredo no Supabase, dê o caminho exato dos menus.
- Nunca peça para colarem no chat senha, chave de sistema, token, chave secreta do Supabase, chave do provedor de e-mail ou dado real de cliente. Diga onde a pessoa digita o segredo (nos segredos da função do Supabase) e use `<preencha>` nos exemplos.
- Se alguém colar um segredo por engano, avise que ele precisa ser trocado e não o repita em arquivo nenhum.
- A homologação usa uma cópia da base real da Souza Ribeiro. Antes de a pessoa mandar uma captura de tela, peça para cobrir nomes de clientes, documentos e preços.

## 2. O portal

Os compradores são os clientes da Souza Ribeiro, empresas e pessoas com CNPJ ou CPF. Eles entram no portal, veem o catálogo com o preço deles, montam o carrinho e mandam o pedido, que cai direto no G360, o sistema de gestão da Souza Ribeiro. Os operadores são a equipe da Souza Ribeiro: usam um painel para consultar clientes, preços e fotos, negociar preços e acompanhar as ocorrências.

Cliente, produto, preço, estoque, frete, pagamento e pedido são decididos pela API dos sistemas externos, da Movimento Sistemas. O portal mostra o que a API devolve e manda o que o comprador escolheu. No Supabase da Souza Ribeiro fica só o que nasce no portal: Minha Lista, registro de ocorrências, feriados, envio de e-mails e as contas de acesso.

## 3. Onde consultar

Na dúvida, vale esta ordem:

1. o contrato OpenAPI (`api-sistemas-externos-2026-11-16.yaml`), baixado do site da Movimento, com rotas, métodos, campos, tipos, cabeçalhos e códigos de erro;
2. o guia `primeiros-passos.md`, com os fluxos, a matriz de reenvio, o catálogo de mensagens e os limites;
3. o exemplo da pasta `supabase/` do kit: função `ponte-g360`, tabelas e regras de acesso;
4. este arquivo.

Não invente rota, campo, parâmetro, cabeçalho nem código de erro. Antes de escrever uma chamada, ache a operação no OpenAPI e use os nomes como estão lá. A API recusa campo a mais (`CAMPO_NAO_PERMITIDO`), então mande só os previstos.

Se a tela precisar de algo que o contrato não tem, pare e anote no `PENDENCIAS_MOVIMENTO.md` do projeto o que falta e por quê. Siga com o que não depende disso. A equipe manda esse arquivo para a Movimento. Se a API se comportar diferente do contrato, também não contorne no código: anote no mesmo arquivo com a operação, o horário e o `request_id`.

## 4. Arquitetura

```text
Navegador -> API do G360
  loja, login, comprador, catálogo, fotos, opções, endereços, histórico,
  revisão, pedidos, senha, saída e painel do operador (com Bearer)

Navegador -> função ponte-g360 (Supabase) -> API do G360
  pedir_link: primeiro acesso e "esqueci minha senha"
  abrir_sessao: confere o login e abre a sessão do Supabase

Função ponte-g360 -> provedor de e-mail
  manda o link de acesso
```

O navegador chama a API direto. Não crie servidor intermediário para as chamadas do comprador: a API limita 240 chamadas por minuto por IP e loja, e com um intermediário todos os compradores dividiriam esse limite.

A chave de sistema mora só nos segredos da função `ponte-g360` (`G360_CHAVE_SISTEMA`). Ela não aparece no código do site, no repositório, em `.env` do site, em log nem no chat. A chave secreta do Supabase também não vai para o site.

Parta da função do exemplo: copie `index.ts` e `ponte.ts` como estão e adapte só o `enviarEmail`. Não reescreva a ponte. Chame a função com `fetch`, método `POST` e apenas o cabeçalho `Content-Type: application/json`. O `supabase.functions.invoke` não serve aqui, porque acrescenta cabeçalhos que a função recusa no preflight.

As respostas da função não usam o envelope da API. Elas trazem `{"mensagem": ...}` ou, no `abrir_sessao`, `{"sessao", "api_expira_em", "api_inatividade_minutos", "api_vinculo_expira_em"}`. Trate essas respostas à parte, fora do tratamento central de erros da API.

### Endereços e variáveis

O endereço de cada operação é a URL-base + `/b2b/v1/lojas/` + loja + caminho. Por exemplo: `https://homologacao.example.invalid/b2b/v1/lojas/0123456789abcdef/produtos`.

O site usa só estas variáveis, todas públicas: `VITE_G360_BASE_URL` (URL-base, sem barra no fim), `VITE_G360_LOJA` (slug da loja, 16 caracteres hexadecimais minúsculos), `VITE_SUPABASE_URL` com a chave pública do Supabase (publishable ou anon) e `VITE_PONTE_URL` (endereço da função `ponte-g360`). Entre homologação e produção mudam os valores, nunca o código. Sem Vite, use o prefixo de variável pública da ferramenta escolhida e mantenha o resto do nome.

### Tecnologia

Em projeto novo, proponha React com TypeScript e Vite, mais o `@supabase/supabase-js`, e espere a aprovação. Em projeto que já existe, siga o que existe.

Todas as chamadas à API ficam num módulo só (por exemplo, `src/api/g360.ts`), e o tratamento de erro num lugar só. Tela nenhuma chama `fetch` direto. Use rotas pelo caminho, sem `#`, porque a página de senha recebe o token depois do `#`. E configure a hospedagem para devolver o `index.html` em qualquer caminho, senão o `/definir-senha` não abre direto pelo link do e-mail.

## 5. Segurança

O token da API fica só em memória, no estado da aplicação. Não use `localStorage`, `sessionStorage`, cookie criado por JavaScript nem a URL para ele. Se a página recarregar, o comprador entra de novo. Pelo mesmo motivo, crie o cliente do Supabase do comprador com `auth: { persistSession: false }`.

Não registre no console, em log ou no Supabase o token, a senha, o documento digitado, o corpo do login, o corpo do pedido de senha nem o `#token=` do link.

Ligue a RLS em todas as tabelas do Supabase, com o recorte do `minha-lista.sql`: cada linha pertence a uma loja e a um código de comprador, e só a sessão vinculada pela ponte vê as suas. Tabela de consulta geral, como a de feriados, também leva RLS, liberada só para leitura. Lista vazia ou gravação recusada quase sempre é o vínculo da sessão que venceu (seção 7). Nunca afrouxe a regra de acesso para resolver isso.

Bloquear o usuário no Supabase não impede a compra pela API. Quem libera ou bloqueia comprador é o G360.

Exemplos, testes e capturas usam só dados fictícios: CNPJ inventado, nomes inventados e e-mails em `example.invalid`. Os testes de verdade são na homologação, com as contas de teste combinadas com a Movimento. Cliente real, nunca.

### Atalhos que não valem

Mesmo que pareçam resolver um erro, não faça:

- `mode: "no-cors"` no `fetch`, proxy público de CORS ou extensão que desliga o CORS;
- cabeçalho que o contrato não prevê. Nas rotas com preflight, os permitidos são `Authorization`, `Content-Type` e `Idempotency-Key`;
- desligar a validação de certificado, forçar `http` em `https` ou trocar a URL-base;
- repetir chamada em laço sem espera, que esgota o limite e trava o login;
- calcular preço, desconto, frete, parcela ou total no navegador e mandar para a API, que não aceita valor vindo da tela;
- acessar o banco do G360, pedir acesso ao servidor da Movimento ou tentar descobrir como a API funciona por dentro.

## 6. Formatos de dados

Valores e quantidades chegam como texto decimal com ponto: `"12.50"`, `"2"`, `"1.5"`. Na tela, formate no padrão brasileiro (`R$ 12,50`, `1,5`), mas não converta para ponto flutuante para guardar ou comparar. A exceção é o painel do operador, em que `custo` e `margem_percentual` vêm como número.

A quantidade também vai como texto com ponto, maior que zero, com até 7 dígitos inteiros e 4 decimais: `"3"`, `"0.5"`. Se o comprador digitar vírgula, troque por ponto antes de mandar.

O `preco` do catálogo e o `preco_unitario` da revisão já são o preço que vale para o comprador. Quando `seu_preco` vem preenchido (no produto, na unidade ou no item da revisão), é porque há preço negociado, e o valor é o mesmo: mostre o selo "Seu preço". O comprador não recebe o preço de tabela, então não mostre preço riscado nem desconto.

Os totais que valem são os da revisão (`POST revisoes`). Antes de revisar, o carrinho pode mostrar preço × quantidade como estimativa, calculada com uma biblioteca decimal como a `decimal.js` e marcada como estimada.

CPF e CNPJ aceitam letras e números, porque o CNPJ pode ser alfanumérico (`12.ABC.345/01DE-35`, por exemplo). Não use máscara só de números nem confira dígito no navegador. Quem valida é a API.

No produto, `id` é o número usado em `produto_id` na revisão, no pedido, na Minha Lista e no filtro `ids`. O `codigo` é o código comercial, para mostrar e buscar. `unidades[]` traz as caixas e os pacotes liberados; vazia, quer dizer que o produto só se vende na unidade base. No item da revisão e do pedido, `unidade` recebe o `unidades[].id` escolhido, ou `null` para a unidade base. A condição de pagamento vai como `condicao_pagamento_id` na entrada e volta na revisão como `pagamento.condicao_id`.

Para as fotos, decida pela lista `fotos[]`. Se ela vier vazia, mostre um espaço reservado e ignore o campo `imagem`. A foto exige o Bearer do comprador, por isso `<img src="...">` direto não funciona: baixe com `fetch` e o cabeçalho `Authorization`, monte a imagem com `URL.createObjectURL` e libere com `URL.revokeObjectURL` ao sair da tela. As fotos contam no limite de chamadas, então carregue só as visíveis e guarde em memória as que já baixou. Se uma foto falhar (404 ou outro erro), mostre o espaço reservado, sem mensagem e sem ocorrência, e guarde a falha também, para não pedir a mesma foto toda vez que a tela redesenhar.

O botão de comprar depende de `compravel` e de `disponibilidade` (`disponivel`, `sob_consulta` ou `indisponivel`). A `faixa_disponibilidade` (`em_estoque`, `ultimas_unidades`, `indisponivel`) é só informativa. Mostre o `aviso` quando vier.

No card e na página do produto, mostre **Disponível: N** quando `quantidade_disponivel` vier preenchido. Use o valor do produto para a unidade base e o valor do item de `unidades[]` para a embalagem escolhida. O texto `"0"` conta como preenchido. Com `null`, mostre só a faixa. Quando `loja.bloqueia_sem_estoque` vier verdadeiro, pare o botão de somar no disponível da embalagem, contando o que já está no carrinho. Com o campo nulo, deixe a conferência para a revisão. Nas outras políticas, use o número só como informação.

No carrinho, mostre a `pendencia` ou o `aviso` de cada linha retornada por `POST revisoes`. Use o disponível da revisão para essa linha, pois ele já desconta as outras linhas que pedem o mesmo produto. Por exemplo, **Quantidade maior que a disponível. Disponível: 2 CX.**

Na paginação, `pagina` começa em 1 e `limite` vai até 50 (o padrão é 20). `paginacao.total` é o número de registros, e o de páginas é esse total dividido pelo limite, arredondado para cima. O filtro `ids` também pagina. Para a Minha Lista e a recompra, use `limite=50` e percorra todas as páginas antes de concluir que um produto saiu do catálogo. Se saiu, mostre o item como "indisponível no momento", sem preço, com opção de remover.

Datas vêm como `AAAA-MM-DD`, e os horários de expiração, em UTC.

## 7. Sessão do comprador

1. `GET loja` devolve o nome da loja, `sessao_minutos` (tempo de inatividade) e `troca_senha` (se o comprador pode definir e trocar a senha pelo portal).
2. O login é `POST sessoes` com `{"usuario": "<CPF ou CNPJ>", "senha": "<senha>"}`. O 201 traz `token`, `expira_em`, `comprador` e `loja`. Depois de 5 senhas erradas em 15 minutos, a API passa a recusar por um tempo (`MUITAS_TENTATIVAS`). Mostre a mensagem e não tente de novo sozinho.
3. Em seguida, mande o token para a função: `{"acao": "abrir_sessao", "token": "<token>"}`. No 200, passe só a `sessao` para `supabase.auth.setSession(sessao)` e guarde `api_expira_em`, `api_inatividade_minutos` e `api_vinculo_expira_em`. No 401, volte ao login. No 503, ofereça tentar de novo e deixe o comprador seguir sem os dados do Supabase (a Minha Lista).
4. A regra de acesso só aceita a sessão do Supabase até `api_vinculo_expira_em`, que fica 5 minutos depois da conferência ou antes disso, e usar o portal não renova esse prazo. Vencido o prazo, a Minha Lista volta vazia, sem erro, e as gravações são recusadas. Por isso, antes de ler ou gravar no Supabase, confira o prazo. Se venceu, encerre a sessão local com `signOut({ scope: "local" })`, chame `abrir_sessao` de novo com o token da API que está em memória e só então leia ou grave. Faça isso quando precisar, nunca em intervalo fixo.
5. Conte a inatividade a partir da última chamada autenticada que a API aceitou. Se passar de `sessao_minutos`, bloqueie as telas privadas e peça login. Não faça chamada periódica só para manter a sessão viva.
6. Um 401 em qualquer operação do comprador apaga o token, encerra o Supabase com `signOut({ scope: "local" })`, limpa os dados da tela e volta ao login com a mensagem da API.
7. Para sair, chame `DELETE sessao` na API e `signOut({ scope: "local" })` no Supabase.
8. Para trocar a senha logado, use `PUT senha`. A resposta traz um token novo. Encerre as sessões do Supabase com `signOut({ scope: "global" })` e chame `abrir_sessao` com esse token.
9. Com `comprador.compra_bloqueada` verdadeiro, o comprador navega mas não envia pedido. Deixe isso claro na tela e o envio desligado. A revisão confirma com a pendência `CADASTRO_BLOQUEADO`.
10. Com `loja.troca_senha` falso, esconda "definir senha" e "trocar senha" e explique que a senha é definida pelo fornecedor.

### Primeiro acesso e "esqueci minha senha"

1. A tela pede o CPF ou CNPJ e manda para a função: `{"acao": "pedir_link", "documento": "<documento>"}`.
2. Mostre a `mensagem` que a função devolve no 202, seja qual for o caso. Ela é sempre a mesma e não revela se o documento existe.
3. Avise na tela que o link chega por e-mail, vale 30 minutos e só pode ser usado uma vez, e que um pedido novo invalida o anterior, então vale sempre o e-mail mais recente. São no máximo 3 pedidos por documento a cada 15 minutos.
4. O link do e-mail leva à página de senha com o token depois do `#` (`/definir-senha#token=...`). No provedor de e-mail, desligue o rastreamento de cliques e a reescrita de links desse e-mail, para o token não passar pelos servidores do provedor.
5. Na página de senha, leia o fragmento com `URLSearchParams` e apague-o do endereço com `history.replaceState` antes de carregar qualquer script de análise. Depois peça a senha nova duas vezes.
6. Mostre a regra junto ao campo: de 6 a 8 caracteres, sem espaços nem acentos, diferente do código de cliente.
7. Mande `{"token": "...", "senha_nova": "..."}` para `POST acessos/senha`. No 204, leve ao login.
8. Em `LINK_INVALIDO`, ofereça pedir outro link.

### Catálogo para visitantes

- Enquanto a pessoa estiver sem sessão, use só `GET vitrine/produtos`, `GET vitrine/grupos` e `GET vitrine/marcas`. Mostre nome, foto, categoria (`grupo`) e **Entre para ver os preços**, com link para entrar. O contrato da vitrine não traz preço, estoque, disponibilidade nem dados do comprador.
- Monte a URL da capa com o prefixo da loja e `imagem`. As fotos de `vitrine/produtos/{id}/fotos/{item}` dispensam o Bearer. Use carregamento sob demanda para as imagens e evite disparar a mesma busca a cada tecla.
- Com a sessão confirmada, substitua os dados da vitrine pelos de `GET produtos` ou `POST produtos/busca` e das rotas autenticadas de grupos, marcas e fotos. Nunca misture as duas respostas na mesma tela. Ao sair ou perder a sessão, limpe os dados privados antes de voltar à vitrine.
- Se a vitrine não estiver disponível, apresente a opção de entrar. Em homologação, confirme com a Movimento que o parâmetro está ligado e que a origem do portal está cadastrada.

## 8. Compra

Mostre no carrinho o valor de `pedido_minimo` recebido de `GET loja` quando estiver preenchido. Use a pendência `PEDIDO_MINIMO_LOJA` da revisão para bloquear o envio.

As chamadas, na ordem:

1. `GET loja` e login (seção 7).
2. `GET me` quando precisar dos dados do comprador.
3. Catálogo com `GET produtos`, usando `q` (texto da busca), `grupo`, `marca`, `codigos`, `ids`, `termos[]`, `pagina` e `limite`, ou com `POST produtos/busca` para listas longas. `GET grupos` e `GET marcas` alimentam os filtros.
4. Para a Minha Lista e a recompra, pegue os `produto_id` no Supabase ou em `GET historico-compras` e consulte preço e disponibilidade do momento pelo filtro `ids` (até 500 por consulta, paginado como na seção 6). Preço guardado nunca vai para a tela.
5. A tabela da Minha Lista do exemplo deixa incluir, ler e remover, mas não alterar. Inclua com `insert` e trate a duplicidade como "já está na lista". Um `upsert` comum tenta alterar, e a regra de acesso recusa.
6. `GET opcoes` traz as modalidades (`entrega` e `retirada`), os endereços e as condições de pagamento. Para incluir endereço, comece pelo CEP. Chame `GET enderecos/cep/{cep}` com a sessão do comprador e use o retorno para preencher logradouro, bairro, cidade e UF. Peça descrição, número e complemento. Grave com `POST enderecos` sem mandar `cidade_id` no fluxo pelo CEP. A API confere o CEP e cadastra o bairro quando o serviço postal informar o nome. Se vier CEP geral, peça o logradouro e o `bairro_id` de `GET enderecos/referencias`. Se a consulta falhar, mostre a mensagem e permita preencher com as referências do G360, enviando cidade, bairro, UF e logradouro. Remova a consulta direta ao ViaCEP do formulário.
7. `POST revisoes` recebe os itens, a modalidade, o endereço, a condição e a observação. Mesmo quando o HTTP é 200, olhe `dados.pode_enviar`. Mostre `dados.pendencias`, e a `pendencia` de cada item junto do item. Com `pode_enviar` falso, o botão de enviar fica desligado até o comprador resolver e revisar de novo.
8. No resumo da revisão entram os itens com o preço da API, o subtotal, o frete (`frete.situacao`: `definido`, `gratis`, `a_combinar` ou `nao_aplicavel`), a taxa de pagamento, o total, as parcelas e a situação de crédito.
9. `POST pedidos` leva o mesmo carrinho, a `assinatura` da última revisão e o cabeçalho `Idempotency-Key` (seção 9).
10. Mostre o pedido devolvido com o `situacao_nome`. Pedido aguardando aprovação do fornecedor pode vir com `numero` nulo, e aí, no lugar do número, mostre "aguardando aprovação". `GET pedidos` lista e `GET pedidos/{id}` detalha.
11. A observação aceita até 400 caracteres, e o carrinho, de 1 a 100 linhas. O mesmo produto na mesma unidade ocupa uma linha só, com as quantidades somadas.
12. Se a revisão devolver `DATA_PREVISTA_OBRIGATORIA`, o portal calcula a previsão de entrega pela regra que a Souza Ribeiro definir (os feriados ficam no Supabase deles) e manda em `data_prevista`, no formato `AAAA-MM-DD`. Enquanto a regra não estiver definida, anote no `PENDENCIAS_MOVIMENTO.md` e pergunte à equipe.

## 9. Envio do pedido sem duplicar

Cada intenção de compra ganha uma chave de envio, de 16 a 64 caracteres, só com letras, números, `_` e `-` (`crypto.randomUUID()` atende). Ela vai no cabeçalho `Idempotency-Key`.

Guarde a chave e o corpo exato no `sessionStorage`, junto com o código do comprador, até ter uma resposta final. Não são segredo. Apague depois do 201 ou do 200. Como a chave pertence a quem a criou, descarte a chave e o corpo se outro comprador entrar. Se o comprador tentar sair com um envio ainda incerto, consulte pela chave antes de apagar.

Durante o envio, o botão "Enviar pedido" fica desligado. O tempo-limite é de 30 segundos. Passou disso, o resultado é incerto.

| O que aconteceu | O que o portal faz |
|---|---|
| 201, ou 200 com pedido | Mostra o pedido. O 200 é a repetição de um envio que já tinha dado certo. |
| Tempo esgotado, conexão caída ou resposta incerta | Consulta `GET pedidos/por-chave/{chave}`. Se vier o pedido, mostra. Se vier 404 `NAO_ENCONTRADO`, o pedido não foi gravado, e o portal reenvia o mesmo corpo com a mesma chave. Esse 404 vem com `responsavel: integracao`, mas aqui ele é esperado: não passa pelo tratamento genérico. |
| Sem conexão nem para consultar | Mostra "Sem conexão com o servidor" e um botão "Tentar de novo", que primeiro consulta pela mesma chave e só depois reenvia. |
| 409 `OPERACAO_EM_ANDAMENTO` ou `VENDA_EM_ANDAMENTO` | Espera pelo menos 3 segundos e reenvia o mesmo corpo com a mesma chave. Depois de 3 tentativas, mostra a mensagem e um botão "Tentar de novo". |
| 409 `REVISAO_ALTERADA` | Revisa de novo, mostra o que mudou e pede confirmação. Envia com a nova assinatura e a mesma chave. |
| 409 `CHAVE_REUTILIZADA` | Consulta pela chave antes de qualquer outra coisa. Não cria pedido novo sem resolver isso. |
| 422 `REVISAO_BLOQUEADA` | Mostra cada pendência de `erro.campos.pendencias` com o seu `responsavel`. |
| 503 `INDISPONIVEL` | Espera pelo menos 30 segundos, consulta pela chave e reenvia com a mesma chave. |

Chave nova só quando o comprador começar outro pedido, com o anterior resolvido.

## 10. Erros e mensagens

Sucesso vem como `{"dados": ..., "request_id": "..."}`, com `paginacao` nas listas paginadas. Foto vem em binário, e o 204, sem corpo. Erro vem como `{"erro": {"codigo", "mensagem", "responsavel", "campos"}, "request_id"}`.

Falha de rede ou de CORS não tem envelope. Ela chega como exceção do `fetch`, sem código e sem `request_id`. Nesse caso, mostre "Não foi possível falar com o servidor. Confira a conexão e tente de novo." A tela nunca fica em branco.

`erro.mensagem` e as mensagens de pendência aparecem como vieram, sem reescrever nem traduzir. O que a tela faz depende do `responsavel`:

| `responsavel` | O que a tela faz |
|---|---|
| `usuario` | Pede a quem está na tela para corrigir o campo ou escolher outra opção, com `erro.campos` junto dos campos. |
| `fornecedor` | Mostra a mensagem e registra a ocorrência, como descrito logo abaixo. |
| `tentar_de_novo` | Diz que vale esperar e oferece "Tentar de novo". A espera é de 3 s nos 409, 30 s no 503 e crescente no 429 (5, 10, 20 e 40 s). |
| `integracao` | É defeito do portal. Mostra uma mensagem genérica com o `request_id`, e o caso fica anotado para correção. |
| ausente ou desconhecido | Mesmo tratamento de `integracao`. |

`erro.codigo` serve para os fluxos especiais: reenvio do pedido, link de acesso e sessão encerrada. Mostre o código do erro e o `request_id` em letra pequena ("Código para o suporte: ..."), para a equipe repassar à Movimento.

### Ocorrências do fornecedor

A tabela `ocorrencias_g360` do exemplo só aceita gravação com a sessão do comprador vinculada pela ponte e ainda válida (seção 7, passo 4). Antes do login e no painel do operador não existe essa sessão, então ali só se mostra a mensagem, sem gravar.

Cada linha leva `loja`, `comprador_codigo` (o código do comprador logado), `codigo`, `request_id` e `operacao`. A `operacao` é o método e o caminho como estão no contrato, sem valores nem parâmetros: `GET pedidos/{id}`, e não `GET pedidos/501`. Quando o envio devolve `erro.campos.pendencias`, grave uma linha por pendência do fornecedor. Use `insert` sem `.select()`, porque o comprador grava nessa tabela mas não lê. Mensagem, documento, senha, token e corpo de requisição ficam de fora.

No pedido de link, a própria função já registra a ocorrência e devolve a mensagem neutra. Deixe como está.

## 11. Painel do operador

O painel é a área da equipe da Souza Ribeiro, e usa duas sessões, ambas separadas das do comprador.

A primeira é a sessão da API: `POST operadores/sessoes` com o usuário e a senha do operador no G360. O token fica só em memória, longe do token do comprador, e o login do operador nunca serve para comprar. Para sair, `DELETE operadores/sessao`. Um 401 no painel encerra só a sessão do operador. Com a licença compartilhada do G360, a vaga do operador vence depois de 180 segundos sem atividade; trate o 401 e o `LICENCA_OPERADOR_INDISPONIVEL` com a mensagem da API e peça login de novo.

A segunda é a sessão do Supabase, usada só para ler as ocorrências. A ponte não cria essa conta. Quem cria é o administrador do Supabase da Souza Ribeiro, em Authentication > Users, gravando depois no `app_metadata` dela o `g360_painel_loja` com o slug da loja, pelo SQL Editor. Prepare o comando SQL pronto para a pessoa, com o e-mail da conta como `<preencha>`. O painel entra com `signInWithPassword`, num cliente do Supabase com `storageKey` próprio, para não derrubar a sessão de um comprador aberta no mesmo navegador. A chave secreta do Supabase não entra no site nem para isso.

O painel faz consulta de cliente por CNPJ, busca de produtos com preço, custo e margem, a galeria de fotos e o preço congelado. Os acessos que cada operação exige estão no `primeiros-passos.md`. Faltando acesso, a API responde `OPERADOR_SEM_ACESSO` com a mensagem certa, e é ela que vai para a tela. Custo e margem só aparecem com `custo_visivel` verdadeiro; não esconda nem calcule por conta própria. Diferente do catálogo do comprador, aqui o `preco` de `POST operadores/produtos/precos` é o da tabela, e o valor negociado vigente vem à parte, em `preco_congelado`. As fotos sobem uma de cada vez, em JPEG de até 2 MB, como data URL, com no máximo 12 por produto.

### Cadastro e primeiro acesso do cliente

Na consulta por CNPJ, coloque um botão para abrir a ficha pelo `codigo` que a API devolver. Chame `GET operadores/clientes/{cliente}` com o token do operador. Mostre a ficha e marque documento, nome, IE ou RG, CEP, logradouro, número, bairro e cidade. Use `pode_alterar` para habilitar a edição, `ie_travada` para deixar a IE só para leitura e `pode_alterar_acesso` para exibir os botões de liberar e bloquear. A API confere os acessos de novo ao gravar.

Prefira a consulta por `GET operadores/enderecos/cep/{cep}` para preencher o endereço. No CEP geral, peça o logradouro e deixe escolher bairro em `GET operadores/enderecos/referencias`. Se precisar preencher manualmente, escolha cidade e bairro nas referências e envie os IDs e a UF. Ao gravar pelo CEP, omita `cidade_id` e deixe a API resolver as referências.

Ao salvar, chame `PUT operadores/clientes/{cliente}` com a `versao` da ficha e os campos que mudaram. Nas recusas, mostre `erro.mensagem` e os detalhes dos campos. Em `DOCUMENTO_REPETIDO`, peça confirmação antes de reenviar com `confirmar_documento_repetido: true`. Em `CADASTRO_ALTERADO`, recarregue a ficha e peça para conferir antes de tentar de novo.

Os botões de acesso chamam `PUT operadores/clientes/{cliente}/acesso` com `liberado` e a `revisao`. Atualize a ficha após gravar. O botão de bloquear avisa que sessões e links serão invalidados. Depois de corrigir o e-mail e liberar o acesso, gere o link de primeiro acesso pelo fluxo já usado. Se o e-mail mudou, gere outro link mesmo que já houvesse um pendente.

## 12. CORS e endereços do portal

A API só responde ao navegador nos endereços (origens) que a Movimento cadastrou para a loja. Endereço de pré-visualização que muda a cada versão não serve, nem curinga.

Em desenvolvimento, use `http://localhost:5173`. Fixe a porta no Vite (`server.port: 5173` com `strictPort: true`), porque ele pula para outra porta sem avisar, e abra sempre `localhost`, nunca `127.0.0.1`.

Se houver erro de CORS, confira o slug e a origem cadastrada. Diga à equipe o endereço exato para mandar à Movimento, com esquema, host em minúsculas e porta quando não for a padrão. Na vitrine, faça GET sem cabeçalhos de sessão ou de revalidação manual. Vitrine fechada também pode aparecer como erro de CORS. Nesse caso, mostre a opção de entrar.

Erro de CORS ao chamar a função `ponte-g360` é configuração do Supabase da Souza Ribeiro. Confira se a origem está em `PORTAL_ORIGENS`, se todos os segredos da função estão preenchidos e se a verificação de JWT está desligada para ela.

A função `ponte-g360` chama a API pelo servidor, sem cabeçalho `Origin`. Mantenha assim.

## 13. Tela

Use a identidade visual que a Souza Ribeiro fornecer, sem inventar logotipo, depoimento, preço ou condição comercial. O portal tem de funcionar bem no celular e no computador: confira em 360, 390, 768, 1280 e 1920 px, sem rolagem horizontal, com alvos de toque de pelo menos 44 px.

Rótulos em caixa normal ("Valor unitário", "Condição de pagamento"), nunca tudo em maiúsculas. Foco visível e navegação por teclado.

Toda tela prevê os estados de carregando, vazia (dizendo o que fazer), erro (dizendo o que fazer), sessão encerrada e API indisponível.

## 14. Antes de dar uma etapa por pronta

1. Rode o projeto e confira você mesmo o que der.
2. Passe à equipe o roteiro de conferência, com o caminho certo e pelo menos um caso que tem de dar erro (senha errada, link usado duas vezes, outro comprador sem acesso à Minha Lista).
3. Procure no código segredos, `console.log` de token ou senha e chamadas fora do módulo da API.
4. Atualize o `PENDENCIAS_MOVIMENTO.md` com o que depende da Movimento.
