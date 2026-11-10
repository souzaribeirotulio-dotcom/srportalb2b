# Souza Ribeiro | Portal B2B

Portal de compras B2B da Souza Ribeiro (front end). O backend será feito pela Movimento Sistemas (ERP G360).

## Como funciona
- `index.html` é o portal inteiro (página única, sem build).
- Toda comunicação com o backend passa pelo bloco `API` dentro do `index.html` (procure por `CAMADA DE INTEGRAÇÃO`).
  - `CONFIG.modo = 'demo'` → usa dados de demonstração.
  - `CONFIG.modo = 'api'` + `CONFIG.baseUrl` → chama o backend real.
- O contrato de endpoints proposto está documentado no comentário do bloco `API`.

## Publicação
Hospedado na Vercel, com deploy automático a cada push na branch `main`.

## Acessos de demonstração (não aparecem mais no site)
- Clientes: CNPJ 12.345.678/0001-90 ou 98.765.432/0001-10 · senha 1234
- Administrador: link "Acesso do administrador" na tela de login · usuário admin · senha 1234
