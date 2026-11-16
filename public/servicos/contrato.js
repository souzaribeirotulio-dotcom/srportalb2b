/* =====================================================================
   INTERFACE DE SERVIÇOS DO PORTAL (contrato do frontend)
   ---------------------------------------------------------------------
   É a lista de operações que as telas chamam. Não é contrato oficial da
   Movimento: nomes de endpoints, autenticação e formatos reais serão
   definidos pela Movimento (dúvidas em PENDENCIAS_MOVIMENTO.md).
   Todas as operações são assíncronas (retornam Promise) e, em caso de
   erro, rejeitam com Error cuja .message é exibida ao usuário.

   Formatos usados pelas telas: veja os comentários de cada grupo e o
   adaptador mock, que devolve exemplos completos.
   ===================================================================== */
window.SR_CONTRATO = {
 /* Sessão */
 login:'(cnpj, senha) → {cnpj, razao_social, fantasia, vendedor}',
 sessaoCliente:'() → mesmo formato de login, ou null se não houver sessão',
 sairCliente:'() → true',
 loginAdmin:'(usuario, senha) → {usuario, nome}',
 sessaoAdmin:'() → {usuario} ou null',
 sairAdmin:'() → true',
 recuperarSenha:'(cnpj, email) → {mensagem}',
 /* Cadastro */
 consultarCNPJ:'(cnpj) → {razao_social, fantasia, telefone, email, cep, logradouro, numero, complemento, bairro, cidade, uf, inscricao_estadual, situacao}',
 consultarCEP:'(cep) → {logradouro, bairro, cidade, uf}',
 cadastrar:'(dadosDoFormulario) → {status}',
 cliente:'() → cadastro do cliente logado {cnpj, razao_social, fantasia, codigo, vendedor, cep, logradouro, ..., enderecos:[{id, apelido, cep, ...}]}',
 salvarEnderecos:'(cnpj, enderecos[]) → true',
 /* Catálogo */
 catalogo:'() → {produtos:[{cod, t (título), c (categoria), m (marca), u (unidade), p (preço p/ o cliente), s (estoque), d, f:[[rótulo,valor]], etiqueta_preco?, k? (custo, só admin)}], unidades_alternativas:{cod:[{id, nome, fator, preco, etiqueta_preco?}]}}',
 configuracao:'() → configurações do portal salvas pelo administrador (objeto, pode ser vazio)',
 lista:'() → Minha Lista [{cod, ultima_qtd, ultima_data, media_qtd, qtd_sugerida}]',
 salvarMinhaLista:'(itens[]) → true',
 /* Pagamento */
 pagamentos:'() → [{id, descricao, observacao}] condições liberadas para o cliente logado',
 /* Pedido */
 revisarPedido:'({origem, itens:[{cod, unidade, quantidade}], endereco_id}) → {revisao_id, itens:[{cod, descricao, quantidade_texto, conversao, preco_unitario, total, etiqueta_preco, aviso}], totais:[{rotulo, valor}], total, entrega:{endereco_id, endereco, previsao, observacao}, condicoes_pagamento:[{id, descricao, observacao}], avisos:[{tipo, texto}], pode_enviar}',
 criarPedido:'({revisao_id, origem, itens, endereco_id, pagamento_id, observacao}) → {numero, status, mensagem, total, pagamento, previsao, endereco}',
 pedidos:'() → histórico [{numero, status, criado_em, total, pagamento:{descricao}, endereco, previsao, observacao, itens:[{cod, descricao, unidade, un_id, q, total}]}]',
 /* Administração */
 listarClientes:'() → {cnpj: cliente}',
 salvarClienteAdmin:'(cnpj, dados) → true',
 salvarProduto:'(cod, dados) → true',
 buscarCongeladosAdmin:'(cnpj) → {cod: preco}',
 salvarPrecoCongelado:'(cnpj, cod, preco|null) → {cod: preco}',
 listaClienteAdmin:'(cnpj) → {configurada, lista, congelados}',
 salvarListaClienteAdmin:'(cnpj, itens) → {salvo}',
 salvarConfig:'(config) → true',
 salvarClips:'(cod, clips[]) → resultado',
 enviarVideo:'(arquivo, cod) → url',
 publicarFotos:'(cod, fotos[]) → urls[]',
 fotosCatalogo:'() → {cod: [urls]}',
 inteligencia:'(dias) → painel de indicadores',
 registrarEvento:'(evento, cod, termo, resultados) → true',
 atualizarCarrinhoMonitorado:'(itens, origem, checkout) → true',
 adminUsuarios:'() → [{usuario, nome}]',
 salvarAdminUsuario:'(usuario, nome, senha) → true',
 removerAdminUsuario:'(usuario) → true',
 /* Assistente e Escola do Souzinha */
 assistentePerguntar:'({message, history, candidates}) → {reply, product_codes?, search_query?, contact_support?}',
 escolaListar:'() → ensinamentos[]', escolaSalvar:'(ensinamento) → true', escolaApagar:'(id) → true',
 /* Negociações */
 negociacaoCriar:'({origem, itens, motivo, observacao}) → negociação',
 minhasNegociacoes:'() → negociações do cliente', negociacaoAceitar:'(id) → negociação', negociacaoCancelar:'(id) → negociação',
 adminNegociacoes:'() → negociações com dados do cliente',
 adminResponderNegociacao:'({id, acao: analise|proposta|recusada, ofertas[], resposta, validade_dias, congelar}) → negociação'
};
