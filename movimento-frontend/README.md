# Portal B2B Souza Ribeiro — entrega demonstrativa para a Movimento

## Limite de escopo

Esta pasta é uma **cópia isolada do frontend atual**, para a equipe da Movimento Sistemas. Os elementos visuais, layout, cores, identidade da Souza Ribeiro, navegação, busca com rolagem, Minha Lista, detalhes, carrinho, checkout e painel administrador foram preservados. **Não é um portal operacional**.

- Não há conexão com o G360, Supabase, banco de dados, serviços de e-mail nem endpoints de backend.
- Não realiza cobrança, emissão fiscal, reserva de estoque ou gravação de pedido real.
- Os preços, custos e estoques exibidos são **valores demonstrativos** gerados localmente. Nomes e imagens de produtos são referências visuais do layout já aprovado, não representam uma oferta validada.
- As alterações de demonstração ficam apenas na memória da aba; dados e senhas digitados não são persistidos no navegador.
- O sistema real publicado na raiz do repositório permanece independente desta pasta.

## Arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `index.html` | HTML e CSS do portal original, sem redesenho; carrega os dois arquivos abaixo |
| `portal-ui.js` | Interações e estado das telas existentes, incluindo catálogo, cadastro visual, carrinho e pedido simulado |
| `mock-adapter.js` | Fonte local de dados demonstrativos e simulações; local de substituição pela integração definitiva |
| `PENDENCIAS_MOVIMENTO.md` | Dependências e decisões do backend que não devem ser inventadas no frontend |
| `ROTEIRO_TESTES.md` | Checklist de homologação visual e funcional |

A interface e a fonte de dados estão em arquivos separados, mas alguns estados visuais legados ainda estão reunidos em `portal-ui.js`. Uma modularização futura deve preservar integralmente a aparência e as interações aprovadas.

## Como executar

Sem instalação, bibliotecas externas ou build. Na pasta `movimento-frontend`:

```bash
python -m http.server 8000
```

Abra `http://localhost:8000/`. Para outro servidor estático, sirva `index.html`, `mock-adapter.js` e `portal-ui.js` no mesmo diretório.

**Atenção:** não publicar esta versão como portal de compras operacional. Um preview privado ou ambiente local serve apenas para análise e testes da Movimento.

## Entrar na demonstração

A tela de login é **somente visual**. Dados de teste da versão mock:

- Cliente de exemplo: CNPJ `12345678000190`, senha fictícia `1234`.
- Outra conta demonstrativa: CNPJ `98765432000110`, senha fictícia `1234`.
- Administração visual: usuário `admin`, senha fictícia `1234`.

Nenhuma senha digitada é enviada à internet ou persistida; essas credenciais de exemplo não dão acesso ao ERP ou a qualquer serviço real.

## Cenários disponíveis

Abra a mesma página com os parâmetros abaixo:

- `?mock_catalogo=vazio` — catálogo vazio.
- `?mock_catalogo=falha` — falha de carregamento.
- `?mock_catalogo=carregando` — carregamento ilustrativo seguido da lista.
- `?mock_catalogo=indisponivel` — alguns produtos com estoque demonstrativo zerado.
- `?mock_envio=falha` — erro no envio simulado; nenhuma confirmação indevida.
- `?mock_envio=incerto` — retorno incerto, sinalizado como **Conferindo envio**.
- `?mock_sessao=expirada` — falha ilustrativa por sessão expirada ao tentar entrar.

Todos os cenários são locais e não chamam a infraestrutura da Movimento.

## Integração pela Movimento

Substituir os métodos de `MOVIMENTO_MOCK` em `mock-adapter.js` por um adaptador real, **conforme contratos que a própria Movimento definir**. Não assumir que nomes, formatos, fórmulas, endpoints ou regras da demonstração correspondam ao ERP. Em especial, login/autorização real, preços por cliente, condições de pagamento, disponibilidade, prazos, emissão e status precisam ser fornecidos e validados pelo backend.

Consulte `PENDENCIAS_MOVIMENTO.md` antes da integração. Os testes responsivos finais e a homologação comercial dependem de ambiente de navegação e da equipe responsável.
