# Souza Ribeiro | Portal B2B — frontend com camada de serviços simulada

Portal de compras B2B da Souza Ribeiro (somente frontend, HTML/CSS/JS puro, sem build).
Nesta versão o portal funciona inteiro com **dados fictícios** e um **adaptador mock**.
A Movimento Sistemas fará a conexão real com o G360 e a homologação.

## Como executar
Não precisa de chave, conta nem internet. Sirva a pasta por HTTP:

```bash
cd srportalb2b
python3 -m http.server 8080      # ou: npx serve .
# abra http://localhost:8080
```

> Abrir o `index.html` direto (file://) também funciona na maioria dos navegadores, mas o servidor local é o recomendado.
> A única requisição externa é a fonte Poppins (Google Fonts). Sem internet, o portal usa a fonte do sistema e tudo continua funcionando.

### Acessos da demonstração (fictícios)
| Perfil | Login | Senha |
|---|---|---|
| Cliente aprovado | CNPJ 12.345.678/0001-90 | demo123 |
| Cliente aprovado (sem endereço extra) | CNPJ 98.765.432/0001-10 | demo123 |
| Cliente pendente (login bloqueado) | CNPJ 11.444.777/0001-61 | demo123 |
| Administrador | usuário `demo` ("Acesso do administrador" na tela de login) | demo123 |

- Consulta de CNPJ simulada: 11.222.333/0001-81. CEPs simulados: 38400-000, 38400-001, 38440-000.
- **Cenário de falha:** na tela de revisão há o bloco "Cenário da demonstração". Escolha *Falha na 1ª tentativa* ou *Falha sempre*.
- Os dados ficam no navegador (`localStorage`, chave `sr_demo_estado_v1`). Para recomeçar, rode `Servicos.demo.restaurar()` no console e recarregue a página.

## Estrutura
```
index.html                     telas (HTML/CSS) + inicialização: carrega serviços, catálogo e sessões
app.js                         lógica das telas (catálogo, carrinho, Minha Lista, revisão, pedidos, conta, admin)
portal-*.js / souzinha*.js     módulos de tela (negociação, listas do admin, inteligência, assistente)
servicos/
  configuracao.js              ← PONTO ÚNICO DE TROCA DO ADAPTADOR
  contrato.js                  interface que as telas usam (operações e formatos)
  adaptador-mock.js            implementação simulada (dados fictícios, sem rede)
  dados-ficticios.js           produtos, preços, estoque, clientes, usuários e condições fictícios
  adaptador-movimento.js       esqueleto para a Movimento implementar
  servicos.js                  publica o adaptador escolhido como window.Servicos
testes/teste_ponta_a_ponta.py  teste automatizado com a rede externa bloqueada (computador e celular)
PENDENCIAS_MOVIMENTO.md        dúvidas que dependem de definição da Movimento
```

## Onde a Movimento troca o adaptador
1. **Arquivo `servicos/configuracao.js`, linha 10:** `window.SR_ADAPTADOR = 'mock';` → `'movimento'`.
2. Implemente as operações em **`servicos/adaptador-movimento.js`** (mesmos nomes e formatos de `servicos/contrato.js`; o mock traz exemplos completos de cada retorno).
3. Opcional: retire `dados-ficticios.js` e `adaptador-mock.js` da lista de scripts em `index.html` (bloco "CAMADA DE SERVIÇOS").

As telas não chamam rede diretamente: tudo passa por `API` (= `window.Servicos`).

## Regras da revisão e do envio
- A tela envia ao serviço **só as escolhas do comprador**:
  - `revisarPedido({origem, itens:[{cod, unidade, quantidade}], endereco_id})`;
  - `criarPedido({revisao_id, origem, itens, endereco_id, pagamento_id, observacao})`.
- Preços, conversões de unidade, totais, condições de pagamento, previsão de entrega, avisos de estoque e permissão de envio são **exibidos como o serviço devolve**.
- Os valores do mock são fictícios. Não implementam regras comerciais.
- Em caso de falha no envio, a tela mantém o carrinho e mostra "Tentar novamente".
- A confirmação ("Pedido simulado com sucesso") e o histórico aparecem marcados como **demonstração**.

## Teste automatizado
Com o servidor rodando em `http://127.0.0.1:8123/`:
```bash
pip install playwright && playwright install chromium
python3 testes/teste_ponta_a_ponta.py http://127.0.0.1:8123/
```
O teste bloqueia toda requisição fora do localhost. Percorre, no computador (1366×850) e no celular (390×844):
1. catálogo sem preço;
2. login;
3. carrinho com caixa e item acima do estoque;
4. revisão bloqueada pelo serviço e depois liberada;
5. troca de endereço;
6. falha simulada, com o carrinho mantido;
7. nova tentativa com sucesso;
8. histórico;
9. recarregar a página;
10. sair e entrar como administrador.

As capturas ficam em `testes/capturas/`.

## Pastas legadas
`supabase/` (SQL) e `api/souzinha.js` pertencem à versão anterior ligada ao Supabase/IA. **Não são usados por este frontend.**
Ficaram só como referência do comportamento já desenhado.
