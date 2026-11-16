# Portal B2B com o Claude

Guia da Movimento para a equipe da Souza Ribeiro. Versão de 16/11/2026.

Vocês vão montar o portal com o Claude, sem programar, e o Claude precisa seguir a API do G360 sem inventar nada pelo caminho. Para isso preparamos três arquivos. Este aqui é para vocês: como montar o Claude, os cuidados de segurança e o que precisamos que nos mandem. O [instrucoes-para-o-claude.md](instrucoes-para-o-claude.md) é para o Claude ler, com as regras do projeto. E o [roteiro-de-prompts.md](roteiro-de-prompts.md) traz os prompts na ordem, cada um com o que conferir no navegador depois.

A referência técnica da API continua no site da Movimento, e o Claude vai trabalhar em cima dos arquivos de lá.

## Antes de começar

Vocês vão precisar de:

- Claude Code ou um Projeto no Claude, no navegador ou no aplicativo. Recomendamos o Claude Code, porque ele cria os arquivos e roda o projeto no computador de vocês;
- um projeto no Supabase para a homologação (o de produção fica para depois);
- um provedor de e-mail, para mandar os links de primeiro acesso e de recuperação de senha;
- a documentação da API, em <https://movimentosistemas.com.br/api-g360-documentacao/>. Baixem de lá o contrato OpenAPI (`api-sistemas-externos-2026-11-16.yaml`, na parte de downloads) e o `primeiros-passos.md`;
- a pasta `supabase/` deste kit, com a função `ponte-g360`, as tabelas e as regras de acesso;
- os dados da homologação, que nós mandamos: URL-base, slug da loja e compradores de teste. A chave de sistema e as senhas vão por outro canal.

## Como montar o Claude

### Claude Code

Criem uma pasta para o portal e abram o Claude Code nela. Copiem para lá o `instrucoes-para-o-claude.md` com o nome `CLAUDE.md`, que o Claude Code lê sozinho em toda conversa. No Windows, liguem a opção "Extensões de nomes de arquivos", no menu Exibir do Explorador, antes de renomear. Sem isso o arquivo acaba virando `CLAUDE.md.md`.

Dentro da pasta, criem `docs/g360/` e ponham ali o contrato OpenAPI, o `primeiros-passos.md` e a pasta `supabase/` do kit. Depois é começar pela etapa 0 do [roteiro](roteiro-de-prompts.md).

### Projeto no Claude

Criem um Projeto (pode ser "Portal Souza Ribeiro"), colem o texto inteiro do `instrucoes-para-o-claude.md` nas instruções e adicionem aos arquivos do Projeto o contrato OpenAPI, o `primeiros-passos.md` e o que está na pasta `supabase/`. Façam todo o trabalho dentro desse Projeto, começando pela etapa 0 do roteiro.

O Projeto tem uma limitação: o Claude escreve o código, mas não cria os arquivos no computador nem roda os testes. Vocês vão ter de copiar arquivo por arquivo e rodar os comandos que ele passar. É por isso que preferimos o Claude Code.

### Outras ferramentas de IA que criam sites

Também dá, colando as instruções no campo de instruções (ou de conhecimento) e anexando os mesmos arquivos. O porém é que muitas dessas ferramentas mostram o site num endereço de pré-visualização que muda a cada versão, e a API não aceita esses endereços. Para testar, publiquem num endereço fixo e nos digam qual é, ou rodem o projeto no computador, em `http://localhost:5173`.

## Cuidados

Senha, token, chave de sistema, chave secreta do Supabase e chave do provedor de e-mail não entram no chat do Claude. Dado de cliente real também não. Os segredos vocês mesmos digitam no painel do Supabase, nos segredos da função. A homologação roda numa cópia da base de vocês, então, antes de mandar uma captura de tela ao Claude, cubram nomes de clientes, documentos e preços.

A chave de sistema fica só na função `ponte-g360`, nunca no site. Se ela aparecer em algum arquivo do projeto, nos avisem para trocarmos a chave.

Preço, estoque, frete e total são calculados pela API. Se o Claude propuser fazer essa conta no site, digam que não.

Quando algo emperra, o Claude às vezes sugere atalhos: desligar o CORS, usar um proxy público, trocar o endereço da API ou afrouxar uma regra de acesso do Supabase. Não aceitem. Erro de CORS na API quase sempre é um endereço que ainda não cadastramos. Na função do Supabase, costuma ser configuração.

Vão uma etapa por vez e só passem para a próxima depois de conferir a atual, inclusive o teste que tem de dar erro. E testem só na homologação, com os compradores de teste. A produção a gente liga junto, na implantação.

## O que precisamos de vocês

Mandem por e-mail ou pelo canal de sempre:

- os endereços do portal (as origens), exatamente como aparecem na barra do navegador. O de desenvolvimento, `http://localhost:5173`, já está cadastrado. Faltam o endereço fixo de homologação e o de produção;
- um e-mail de teste de vocês. Na homologação, todo link de acesso vai para esse endereço, e nunca para um comprador de verdade;
- o nome de quem vai testar junto com a gente;
- a regra da previsão de entrega, se a loja exigir data prevista no pedido. A regra é de vocês, e o portal faz a conta com os feriados guardados no Supabase;
- o arquivo `PENDENCIAS_MOVIMENTO.md`, que o Claude vai mantendo no projeto, sempre que aparecer coisa nova nele.

O roteiro usa alguns cadastros de teste, e nós vamos deixá-los prontos na cópia de homologação: dois compradores liberados, para conferir que um não vê os dados do outro; um comprador com pendência que só vocês resolvem no G360, como cadastro sem condição de pagamento; uma condição de pagamento com pedido mínimo; um produto vendido em fração; um comprador com preço negociado; e dois operadores, um com acesso ao custo e outro sem. Se quiserem outros cenários, como comprador bloqueado, entrega e retirada, pagamento parcelado ou frete a combinar, é só pedir.

## Quando precisarem de ajuda

Contem o que aconteceu, em qual tela e a que horas, e mandem o "Código para o suporte" que o portal mostra junto da mensagem de erro. Não mandem senha, token nem dado de cliente. No fim do roteiro tem um prompt pronto para o Claude investigar o erro e uma tabela com os problemas mais comuns.
