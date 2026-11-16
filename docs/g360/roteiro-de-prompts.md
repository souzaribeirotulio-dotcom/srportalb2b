# Roteiro de prompts

Versão de 16/11/2026.

Colem um prompt por vez no Claude, na ordem, e só passem ao seguinte depois de conferir o atual. Cada etapa diz o que olhar no navegador e traz pelo menos um teste que tem de dar erro: se ele passar, tem algo errado. Quando alguma coisa não funcionar, usem o modelo do fim do arquivo.

O Claude já precisa estar montado como explica o [LEIA-ME](LEIA-ME.md), com as instruções do projeto, o contrato OpenAPI, o `primeiros-passos.md` e a pasta `supabase/`.

## Etapa 0. Leitura do projeto

```text
Leia as instruções do projeto, o contrato OpenAPI, o guia Primeiros passos
e o exemplo da pasta supabase. Ainda não escreva código.

Me explique em até 15 linhas, em linguagem simples:
- o que vamos construir;
- quem decide preço, estoque e pedido;
- onde fica a chave de sistema e por quê;
- a ordem das chamadas para um comprador fazer um pedido.

Depois, liste o que você precisa de mim para começar, sem pedir senhas ou chaves.
```

A resposta tem de dizer que preço, estoque e pedido são decididos pela API, que a chave de sistema fica só nos segredos da função do Supabase e que o navegador chama a API direto. Se o Claude falar em guardar a chave no site ou em criar um servidor para todas as chamadas, peçam para ele reler a seção 4 das instruções.

## Etapa 1. Projeto e página da loja

```text
Crie o projeto do portal (ou use o que já existe) e configure as variáveis
públicas VITE_G360_BASE_URL e VITE_G360_LOJA, com um arquivo .env.exemplo
sem valores reais. Me diga onde eu preencho os valores da homologação.
Fixe a porta de desenvolvimento em 5173.

Crie o módulo único de chamadas à API e uma página inicial que chama GET loja
e mostra o nome da loja. Preveja carregando, erro e falha de comunicação.
```

A origem `http://localhost:5173` já está cadastrada na loja de homologação. Preencham a URL-base e o slug que mandamos.

Para conferir, rodem o projeto do jeito que o Claude explicar e abram `http://localhost:5173`, escrevendo `localhost` e não `127.0.0.1`. O nome da loja tem de aparecer.

O teste que tem de falhar: troquem o último caractere do slug por outro (de `0` a `9` ou de `a` a `f`) e recarreguem. A tela deve mostrar uma mensagem de falha de comunicação, e nunca ficar em branco. Depois desfaçam a troca.

## Etapa 2. Tratamento de erros

```text
No módulo da API, trate o envelope de erro do contrato num único lugar,
seguindo a seção 10 das instruções: mensagem como veio, decisão pelo
responsavel, código e request_id visíveis em letra pequena, falha de rede
sem envelope e esperas para tentar_de_novo. Crie um componente de mensagem
reutilizável para as telas.

Para eu testar, crie um botão provisório "Testar erro", só no ambiente de
desenvolvimento, que chama GET me sem token. Ainda não crie login.
```

Cliquem em "Testar erro". Tem de aparecer "Sua sessão terminou. Entre novamente." e, em letra pequena, o código para o suporte. Peçam também ao Claude para mostrar onde ficou o tratamento de erros: precisa estar num lugar só.

## Etapa 3. Função ponte-g360 no Supabase

```text
Monte a função ponte-g360 a partir do exemplo da pasta supabase, sem
reescrever a ponte: copie index.ts e ponte.ts, aplique minha-lista.sql como
migração e configure verify_jwt = false só para essa função.

Adapte apenas enviarEmail para o provedor de e-mail que vamos usar:
<nome do provedor>.

Me dê o passo a passo, com os menus do Supabase, para eu mesmo cadastrar os
segredos da função e publicá-la no projeto de homologação. Não peça os
valores no chat. Depois rode os testes do exemplo e me mostre o resultado.
```

Antes de colar este prompt, separem, fora do chat, a chave de sistema que mandamos por outro canal e a chave do provedor de e-mail. Os valores dos segredos vocês mesmos digitam:

| Segredo | Valor |
|---|---|
| `G360_BASE_URL` e `G360_LOJA` | A URL-base e o slug da homologação. |
| `G360_CHAVE_SISTEMA` | A chave de sistema que a Movimento mandou. |
| `G360_RECONFERENCIA_MINUTOS` | `5` |
| `G360_OCORRENCIAS_HMAC` | Um valor aleatório gerado no computador de vocês (veja abaixo). |
| `PORTAL_ORIGENS` | `http://localhost:5173` e, depois de uma vírgula, o endereço fixo de homologação, quando existir. O de produção vai no projeto do Supabase de produção, que tem a configuração dele. |
| `PORTAL_PAGINA_SENHA` | `http://localhost:5173/definir-senha`, enquanto estiverem desenvolvendo. |
| `EMAIL_ENDPOINT` e `EMAIL_CHAVE` | Vêm do provedor de e-mail. |

O `G360_OCORRENCIAS_HMAC` não precisa passar pelo chat. Rodem um destes comandos, que já deixam o valor copiado, e colem direto no segredo.

No Windows (PowerShell):

```powershell
$b = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b) | Set-Clipboard
```

No Mac (Terminal):

```bash
openssl rand -base64 48 | pbcopy
```

Para conferir:

1. Os testes do exemplo (`deno test`) passam.
2. A função está publicada no projeto do Supabase. Rodando só no computador, o login sempre falha, porque o endereço do comprador não chega até a função.
3. No painel do Supabase, o IP Address Forwarding está ligado (em Authentication > Rate Limits), a verificação de JWT está desligada só para a `ponte-g360` e o cadastro aberto de usuários está desligado.
4. No provedor de e-mail, o rastreamento de cliques está desligado para o e-mail do link.
5. A chave de sistema não aparece em nenhum arquivo do projeto. Isso vocês conferem sem o Claude e sem colar a chave no chat. No Windows, abram o PowerShell na pasta do projeto e rodem o comando abaixo, com os 8 primeiros caracteres da chave no lugar do texto entre aspas. Se não sair nenhuma linha, está certo.

```powershell
Get-ChildItem -Recurse -File -Force | Where-Object { $_.FullName -notlike '*node_modules*' } | Select-String -SimpleMatch -List 'COMECO-DA-CHAVE' | Select-Object Path
```

No Mac, no Terminal, dentro da pasta do projeto:

```bash
grep -rlF --exclude-dir=node_modules 'COMECO-DA-CHAVE' .
```

## Etapa 4. Primeiro acesso e "esqueci minha senha"

```text
Crie as telas de primeiro acesso e de "esqueci minha senha", que chamam a
função com a ação pedir_link, e a página definir-senha, que lê o token do
fragmento do link e chama POST acessos/senha. Siga a seção 7 das instruções:
mensagem da função mostrada como veio, fragmento apagado do endereço antes
de qualquer script de análise e regra da senha junto ao campo.
```

Um aviso antes de testar: cada documento pode pedir no máximo 3 links a cada 15 minutos, e um link novo invalida o anterior. Usem sempre o e-mail mais recente.

1. Peçam o link com o CPF ou CNPJ de um comprador de teste. Na homologação, ele chega no e-mail de teste da loja, o que vocês combinaram com a gente.
2. Abram o link, definam a senha e entrem com ela.
3. Agora o teste que tem de falhar: abram o mesmo link de novo, digitem outra senha e enviem. A tela mostra "O link é inválido ou expirou. Solicite um novo link."
4. Peçam o link com um documento que não é cliente. A mensagem tem de ser igual à do passo 1.

## Etapa 5. Login, sessão e saída

```text
Crie o login do comprador (POST sessoes e depois abrir_sessao na função),
o controle de inatividade pelo sessao_minutos da loja, a renovação do
vínculo do Supabase, a saída e a troca de senha logado. Siga a seção 7 das
instruções, com o token só em memória e o tratamento do 401.
```

1. Entrem com o comprador de teste. A tela mostra o nome dele.
2. Entrem uma vez com a senha errada. Tem de aparecer "CNPJ/CPF ou senha inválidos." Não insistam muito: 5 erros em 15 minutos bloqueiam novas tentativas por um tempo.
3. Fiquem parados mais que o tempo de inatividade da loja (8 minutos, se não avisarmos outro) e cliquem em qualquer coisa. O portal pede o login de novo.
4. Saiam e usem o botão Voltar do navegador. Nenhum dado do comprador pode aparecer.

## Etapa 6. Catálogo

```text
Crie o catálogo: busca, filtros por grupo e marca, paginação, foto da capa,
preço do comprador (com "Seu preço" quando houver preço negociado), unidades
alternativas e disponibilidade. Siga a seção 6 das instruções para fotos,
valores, unidades e disponibilidade. Preveja busca sem resultado com
orientação.
```

1. Busquem um produto que vocês vendem. O preço tem de ser o do comprador no G360. A homologação usa uma cópia da base de vocês, atualizada no começo de cada etapa, então um preço mudado depois da cópia pode aparecer diferente.
2. No lugar da foto aparece um espaço reservado, sem imagem quebrada. Na homologação os arquivos das fotos não estão disponíveis, porque ficam no servidor de vocês. A foto de verdade a gente confere na implantação.
3. Busquem um texto sem sentido, como "zzzz". A tela tem de dizer o que fazer, em vez de mostrar uma tabela vazia.
4. Abram no celular, ou estreitem a janela, e vejam se não aparece rolagem para o lado.

## Etapa 7. Carrinho e revisão

```text
Crie o carrinho e a revisão: escolha de entrega ou retirada, endereço,
inclusão de endereço, condição de pagamento e observação. Chame
POST revisoes, mostre o resumo da API e as pendências junto dos itens, e
deixe o envio desligado enquanto pode_enviar for falso. Siga as seções 6 e 8
das instruções. Ainda não envie o pedido.
```

1. Montem um carrinho com dois produtos e revisem. Subtotal, frete e total vêm da revisão.
2. Escolham retirada. O endereço some e o frete fica como "não se aplica".
3. Para ver o bloqueio, usem o cenário que preparamos, como a condição de pagamento com pedido mínimo e um carrinho pequeno. A revisão mostra a pendência e o botão de enviar fica desligado.
4. Digitem "1,5" na quantidade de um produto vendido em fração. O portal manda "1.5" e a revisão aceita.

## Etapa 8. Envio do pedido

```text
Crie o envio do pedido com a chave de envio (Idempotency-Key), a matriz de
reenvio e a tela de confirmação. Siga a seção 9 das instruções sem pular
nada: botão desligado durante o envio, chave e corpo guardados até a resposta
final, consulta por chave depois de tempo esgotado ou falta de conexão.
```

1. Enviem um pedido de teste. Aparecem a situação e o número. Se o pedido ficar aguardando aprovação de vocês, aparece "aguardando aprovação" no lugar do número.
2. Num pedido novo, cliquem em "Enviar" várias vezes seguidas. Em "Meus pedidos" tem de aparecer um pedido só.
3. Num outro pedido, desliguem a internet logo depois de clicar em "Enviar". O portal mostra "Sem conexão com o servidor" e o botão "Tentar de novo". Religuem a internet e cliquem no botão. O pedido aparece, sem duplicar.

Os pedidos de teste ficam na cópia de homologação e não chegam ao G360 de vocês.

## Etapa 9. Meus pedidos, histórico e Minha Lista

```text
Crie "Meus pedidos" (lista e detalhe), o histórico de compras com recompra e
a Minha Lista, guardada no Supabase pela tabela do exemplo. Preço e
disponibilidade sempre consultados na hora pelo filtro ids, percorrendo
todas as páginas.
```

1. O pedido da etapa 8 aparece na lista e no detalhe.
2. Ponham produtos na Minha Lista, saiam e entrem de novo. A lista continua lá, com o preço de agora. Ao pôr de novo um produto que já está nela, o portal avisa que ele já está na lista.
3. Fiquem mais de 5 minutos usando o portal e abram a Minha Lista outra vez. Ela tem de continuar aparecendo, e não vazia.
4. Entrem com o outro comprador de teste. Ele não pode ver a Minha Lista do primeiro.

## Etapa 10. Painel do operador

```text
Crie o painel do operador, com login próprio (POST operadores/sessoes) e
token separado do comprador: consulta de cliente por CNPJ, produtos com
preço, custo e margem, galeria de fotos (incluir, remover, capa e ordem) e
preço congelado. Siga a seção 11 das instruções. Ainda não crie a lista de
ocorrências.
```

Combinem com a gente qual operador usar e o que dá para conferir na homologação. A gravação de fotos só pode ser conferida no ambiente de vocês, na implantação.

1. Entrem com o operador de teste e consultem um cliente pelo CNPJ.
2. Consultem o preço de dois produtos para um cliente sem preço negociado. O valor tem de ser o mesmo que ele vê no catálogo. Com preço negociado não dá para comparar assim: o catálogo mostra o menor dos dois valores, e o painel mostra cada um separado.
3. Com o operador que não tem acesso ao custo, a busca de produtos não pode mostrar custo nem margem.

## Etapa 11. Ocorrências do fornecedor

```text
Ligue o registro de ocorrências, seguindo a seção 10 das instruções: todo
erro ou pendência com responsavel fornecedor, com a sessão do comprador
válida, grava uma linha em ocorrencias_g360 com insert sem .select().
Depois crie no painel do operador a lista dessas ocorrências, com a sessão
do Supabase do operador descrita na seção 11, para a equipe resolver no G360.
```

Antes, o administrador do Supabase de vocês cria a conta do operador para o painel e grava nela o slug da loja, com o comando que o Claude preparar.

1. Entrem com o comprador de teste que tem pendência do lado de vocês, como cadastro sem condição de pagamento, e façam a revisão. A pendência aparece para ele.
2. No painel, a ocorrência aparece na lista, com o código e a data.
3. Repitam o passo 1 depois de mais de 5 minutos logados. Uma linha nova tem de aparecer.

## Etapa 12. Revisão antes da homologação conjunta

```text
Revise o projeto inteiro contra as instruções, seção por seção, e me
entregue uma lista do que não cumpre, com o arquivo e o que falta. Procure em
especial: segredos no código, token fora da memória, console.log de dados
sensíveis, chamadas fora do módulo da API, tabelas sem RLS, telas sem estado
de erro ou de vazio e rolagem horizontal no celular. Corrija só depois que eu
aprovar a lista.
```

Peçam para o Claude corrigir o que a lista apontar e refaçam as conferências das etapas 4 a 11. Depois, é marcar com a gente a homologação conjunta.

## Quando der erro

Copiem da tela o código do erro, a mensagem e o "Código para o suporte" (o `request_id`). Token e senha não se copiam. Numa captura de tela, cubram nomes de clientes, documentos e preços.

```text
Ao fazer <o que eu fiz>, na tela <nome da tela>, apareceu:
código <código>, mensagem "<mensagem>", código para o suporte <request_id>.
Descubra a causa sem mudar o contrato da API e sem contornar a verificação.
Se o problema estiver na API ou na configuração da loja, escreva em
PENDENCIAS_MOVIMENTO.md o que devo enviar à Movimento.
```

Os problemas que mais aparecem:

| O que aparece | O que costuma ser |
|---|---|
| Erro de CORS, ou "Não foi possível falar com o servidor", ao chamar a API | Origem do portal ainda não cadastrada, ou URL-base ou slug errados. Confiram as variáveis e nos mandem o endereço exato do portal. |
| Erro de CORS ao chamar a função `ponte-g360` | Configuração do Supabase de vocês: origem fora de `PORTAL_ORIGENS`, algum segredo faltando ou verificação de JWT ligada na função. |
| "Esta loja não está disponível" | A API está desligada nessa loja. Falem com a gente. |
| "Muitas tentativas de acesso" | Senha errada vezes demais em 15 minutos. Esperem e tentem de novo. |
| "Muitas solicitações" | Alguma tela chamando a API sem parar. Peçam ao Claude para achar onde. |
| O link de acesso não chega | Na homologação, ele vai só para o e-mail de teste da loja. Mais de 3 pedidos do mesmo documento em 15 minutos também deixam de gerar link, sem aviso nenhum, e aí é esperar. Confiram ainda os segredos `G360_CHAVE_SISTEMA`, `G360_LOJA` e `G360_BASE_URL`, os registros da função no painel do Supabase e o provedor de e-mail. |
| A Minha Lista aparece vazia, sem erro | O vínculo da sessão do Supabase venceu e não foi renovado. Peçam ao Claude para conferir o passo 4 da seção 7 das instruções, e não aceitem que ele afrouxe a regra de acesso. |
| Mensagem genérica com código para o suporte | Defeito do portal (`integracao`). Usem o prompt acima. |
