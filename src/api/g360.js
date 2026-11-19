/* =====================================================================
   Módulo ÚNICO de chamadas à API dos sistemas externos (G360).
   Contrato: docs/g360/api-sistemas-externos-2026-11-19.yaml
   Nenhuma tela chama fetch direto: tudo passa por aqui, inclusive o
   tratamento de erro (seção 10 do CLAUDE.md).
   Endereço = VITE_G360_BASE_URL + /b2b/v1/lojas/ + VITE_G360_LOJA + /caminho
   ===================================================================== */

const BASE_URL = String(import.meta.env.VITE_G360_BASE_URL || '').trim();
const LOJA = String(import.meta.env.VITE_G360_LOJA || '').trim();
const TEMPO_LIMITE_MS = 30000;

export const MENSAGEM_REDE = 'Não foi possível falar com o servidor. Confira a conexão e tente de novo.';
export const MENSAGEM_INTEGRACAO = 'Ocorreu um erro no portal. Tente de novo mais tarde e, se continuar, informe o código abaixo ao suporte.';
const RESPONSAVEIS = ['usuario', 'fornecedor', 'tentar_de_novo', 'integracao'];

/** Erro de uma chamada à API, já interpretado para as telas. */
export class ErroApi extends Error {
  constructor({ mensagem, codigo = null, responsavel = null, campos = {}, requestId = null, status = 0, tipo = 'api', operacao = null, retryAfter = null }) {
    super(mensagem);
    this.name = 'ErroApi';
    this.codigo = codigo;           // erro.codigo do contrato (ex.: SESSAO_INVALIDA)
    // Responsável ausente ou desconhecido recebe o mesmo tratamento de "integracao".
    this.responsavel = RESPONSAVEIS.includes(responsavel) ? responsavel : 'integracao';
    this.campos = campos && typeof campos === 'object' ? campos : {};
    this.requestId = requestId;     // request_id para o suporte
    this.status = status;           // HTTP (0 em falha de rede)
    this.tipo = tipo;               // api | rede | tempo | configuracao
    this.operacao = operacao;       // "MÉTODO caminho-do-contrato", ex.: "GET pedidos/{id}"
    this.retryAfter = retryAfter;   // segundos de Retry-After, quando a API mandou
  }
}

/* ---------------- Ganchos ----------------
   aoSessaoEncerrada(escopo, erro): 401 numa chamada com token. escopo = comprador | operador.
   aoAtividade(escopo): a API aceitou uma chamada autenticada (conta a inatividade a partir daqui).
   aoErroFornecedor(erro): responsavel = fornecedor numa chamada do comprador (Etapa 11 registra). */
const ganchos = { aoSessaoEncerrada: null, aoErroFornecedor: null, aoAtividade: null };
export function definirGancho(nome, funcao) { if (nome in ganchos) ganchos[nome] = funcao; }

/** Confere se as variáveis públicas estão preenchidas no formato do contrato. */
export function configuracaoValida() {
  const faltando = [];
  if (!/^https:\/\/[^/\s]+(\/[^/\s]+)*$/.test(BASE_URL) || /\/b2b\/v1/.test(BASE_URL)) faltando.push('VITE_G360_BASE_URL');
  if (!/^[a-f0-9]{16}$/.test(LOJA)) faltando.push('VITE_G360_LOJA');
  return faltando;
}

/** Monta o caminho trocando {parametros} pelos valores, sempre codificados. */
function montarCaminho(modelo, parametros = {}) {
  return modelo.replace(/\{(\w+)\}/g, (_, nome) => {
    if (parametros[nome] === undefined || parametros[nome] === null) throw new Error(`Parâmetro ausente: ${nome}`);
    return encodeURIComponent(String(parametros[nome]));
  });
}

function montarConsulta(consulta) {
  if (!consulta) return '';
  const p = new URLSearchParams();
  for (const [chave, valor] of Object.entries(consulta)) {
    if (valor === undefined || valor === null || valor === '') continue;
    if (Array.isArray(valor)) valor.forEach((v) => p.append(chave, String(v)));
    else p.append(chave, String(valor));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * Faz uma chamada à API seguindo o envelope do contrato.
 * @param metodo  GET | POST | PUT | DELETE
 * @param modelo  caminho como está no contrato, sem o prefixo da loja (ex.: "pedidos/{id}")
 * Sucesso → { dados, request_id, paginacao? } (ou null no 204; Blob quando binario).
 * Falha → lança ErroApi (envelope de erro, falha de rede ou tempo esgotado).
 * Não registra token, senha nem corpo em log.
 */
export async function requisitar(metodo, modelo, { parametros, consulta, token = null, corpo, cabecalhos = {}, binario = false, semGanchos = false, cacheModo = 'no-store', semAtividade = false } = {}) {
  const operacao = `${metodo} ${modelo}`;
  const escopo = !token ? 'publico' : (modelo.startsWith('operadores/') ? 'operador' : 'comprador');
  const avisarAtividade = () => {
    // Leitura em segundo plano (sem o cliente mexer) não conta como atividade dele.
    if (escopo !== 'publico' && !semAtividade && ganchos.aoAtividade) { try { ganchos.aoAtividade(escopo); } catch { /* nada */ } }
  };
  const faltando = configuracaoValida();
  if (faltando.length) {
    throw new ErroApi({ mensagem: MENSAGEM_INTEGRACAO, codigo: 'CONFIGURACAO_AUSENTE', responsavel: 'integracao', tipo: 'configuracao', campos: { variaveis: faltando }, operacao });
  }
  const headers = { ...cabecalhos };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';

  const url = `${BASE_URL}/b2b/v1/lojas/${LOJA}/${montarCaminho(modelo, parametros)}${montarConsulta(consulta)}`;
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let resp;
  try {
    resp = await fetch(url, {
      method: metodo,
      headers,
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      signal: controle.signal,
      credentials: 'omit',
      cache: cacheModo,
    });
  } catch (e) {
    // Falha de rede ou de CORS não tem envelope nem request_id.
    const tempo = e && e.name === 'AbortError';
    throw new ErroApi({ mensagem: MENSAGEM_REDE, tipo: tempo ? 'tempo' : 'rede', responsavel: 'tentar_de_novo', operacao });
  } finally {
    clearTimeout(relogio);
  }

  if (resp.status === 204) { avisarAtividade(); return null; }
  if (resp.ok && binario) { avisarAtividade(); return resp.blob(); }

  let json = null;
  try { json = await resp.json(); } catch { json = null; }
  if (resp.ok && json && 'dados' in json) { avisarAtividade(); json.status = resp.status; return json; }

  const env = json && json.erro;
  // Retry-After (segundos) é legível pelo navegador nas origens cadastradas.
  const ra = Number(resp.headers.get('Retry-After'));
  const retryAfter = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 600) : null;
  const erro = env && typeof env.mensagem === 'string'
    ? new ErroApi({
        mensagem: env.mensagem,       // como veio, sem reescrever nem traduzir
        codigo: env.codigo || null,
        responsavel: env.responsavel || null,
        campos: env.campos || {},
        requestId: (json && json.request_id) || null,
        status: resp.status,
        operacao,
        retryAfter,
      })
    // Resposta fora do envelope: tratada como defeito de integração.
    : new ErroApi({ mensagem: MENSAGEM_INTEGRACAO, responsavel: 'integracao', status: resp.status, requestId: (json && json.request_id) || null, operacao, retryAfter });

  // Um 401 em operação autenticada encerra aquela sessão (comprador ou operador).
  if (resp.status === 401 && escopo !== 'publico' && ganchos.aoSessaoEncerrada) {
    try { ganchos.aoSessaoEncerrada(escopo, erro); } catch { /* a tela segue com a mensagem */ }
  }
  if (!semGanchos && escopo === 'comprador' && erro.responsavel === 'fornecedor' && ganchos.aoErroFornecedor) {
    try { ganchos.aoErroFornecedor(erro); } catch { /* registro de ocorrência não bloqueia a tela */ }
  }
  throw erro;
}

/* ---------------- Interpretação para as telas (um lugar só) ---------------- */

/**
 * Diz o que a tela deve mostrar e fazer para um erro, conforme o responsável.
 * @param erro       ErroApi (ou qualquer erro)
 * @param tentativa  quantas vezes a mesma ação já recebeu 429 seguidos (para a espera crescente)
 * @returns {{tipo, mensagem, suporte, campos, esperaSegundos, podeTentar}}
 *   tipo: corrigir | fornecedor | tentar | integracao | rede
 */
export function interpretarErro(erro, tentativa = 0) {
  const e = erro instanceof ErroApi ? erro : new ErroApi({ mensagem: MENSAGEM_INTEGRACAO, responsavel: 'integracao' });
  const suporte = [e.codigo, e.requestId].filter(Boolean).join(' · ') || null;

  if (e.tipo === 'rede' || e.tipo === 'tempo') {
    return { tipo: 'rede', mensagem: MENSAGEM_REDE, suporte: null, campos: {}, esperaSegundos: 0, podeTentar: true };
  }
  switch (e.responsavel) {
    case 'usuario':
      return { tipo: 'corrigir', mensagem: e.message, suporte, campos: e.campos, esperaSegundos: 0, podeTentar: false };
    case 'fornecedor':
      return { tipo: 'fornecedor', mensagem: e.message, suporte, campos: {}, esperaSegundos: 0, podeTentar: false };
    case 'tentar_de_novo':
      return { tipo: 'tentar', mensagem: e.message, suporte, campos: {}, esperaSegundos: esperaPara(e, tentativa), podeTentar: true };
    default: // integracao, ausente ou desconhecido
      return { tipo: 'integracao', mensagem: MENSAGEM_INTEGRACAO, suporte, campos: {}, esperaSegundos: 0, podeTentar: true };
  }
}

/** Espera antes de tentar de novo: 3 s nos 409, 30 s no 503 e 5, 10, 20, 40 s no 429. */
export function esperaPara(erro, tentativa = 0) {
  if (erro.retryAfter) return erro.retryAfter; // a API diz quanto esperar
  if (erro.status === 409) return 3;
  if (erro.status === 503) return 30;
  if (erro.status === 429) return [5, 10, 20, 40][Math.min(tentativa, 3)];
  return 3;
}

/* ---------------- Operações do contrato ---------------- */

/** GET loja — apresentarLoja: { nome, troca_senha, sessao_minutos } */
export async function apresentarLoja() {
  const r = await requisitar('GET', 'loja');
  return r.dados;
}

/** GET me — consultarComprador (exige o token do comprador). */
export async function consultarComprador(token) {
  const r = await requisitar('GET', 'me', { token });
  return r.dados;
}

/** POST acessos/senha — gravarSenhaPorLink (público). 204 sem corpo; depois, entrar por POST sessoes.
 *  Erros possíveis: LINK_INVALIDO, SENHA_NOVA_INVALIDA, TROCA_DE_SENHA_DESLIGADA, 429, 503. */
export async function gravarSenhaPorLink(token, senhaNova) {
  await requisitar('POST', 'acessos/senha', { corpo: { token, senha_nova: senhaNova } });
}

/* ---------------- Sessão do comprador (Etapa 5) ---------------- */

/** POST sessoes — criarSessao. 201: { token, tipo, expira_em, comprador, loja }. */
export async function entrar(usuario, senha) {
  const r = await requisitar('POST', 'sessoes', { corpo: { usuario, senha } });
  return r.dados;
}

/** DELETE sessao — encerrarSessao. */
export async function sair(token) {
  await requisitar('DELETE', 'sessao', { token });
}

/** PUT senha — trocarSenha. 200: { token, tipo, expira_em, comprador } (token substituto). */
export async function trocarSenha(token, senhaAtual, senhaNova) {
  const r = await requisitar('PUT', 'senha', { token, corpo: { senha_atual: senhaAtual, senha_nova: senhaNova } });
  return r.dados;
}

/* ---------------- Catálogo (Etapa 6) ---------------- */

/**
 * GET produtos — listarProdutos. filtros: { q, grupo, marca, codigos[], ids[], termos[], pagina, limite }.
 * codigos e ids vão separados por vírgula; termos[] repete o parâmetro (contrato).
 * Devolve { dados, paginacao }.
 */
export async function listarProdutos(token, filtros = {}) {
  const consulta = {
    q: filtros.q,
    grupo: filtros.grupo,
    marca: filtros.marca,
    codigos: filtros.codigos?.length ? filtros.codigos.join(',') : undefined,
    ids: filtros.ids?.length ? filtros.ids.join(',') : undefined,
    'termos[]': filtros.termos?.length ? filtros.termos : undefined,
    pagina: filtros.pagina,
    limite: filtros.limite,
  };
  const r = await requisitar('GET', 'produtos', { token, consulta, semAtividade: filtros.segundoPlano === true });
  return { dados: r.dados, paginacao: r.paginacao };
}

/** POST produtos/busca — buscarProdutos (listas longas de ids ou códigos). */
export async function buscarProdutos(token, filtros = {}) {
  const corpo = {};
  for (const k of ['q', 'grupo', 'marca', 'codigos', 'ids', 'termos', 'pagina', 'limite']) {
    if (filtros[k] !== undefined && filtros[k] !== null && filtros[k] !== '') corpo[k] = filtros[k];
  }
  const r = await requisitar('POST', 'produtos/busca', { token, corpo });
  return { dados: r.dados, paginacao: r.paginacao };
}

/**
 * Todos os produtos de uma lista de ids, percorrendo todas as páginas (limite 50)
 * e em blocos de até 500 ids. Usado pela Minha Lista e pela recompra.
 */
export async function produtosPorIds(token, ids) {
  const unicos = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const achados = new Map();
  for (let i = 0; i < unicos.length; i += 500) {
    const bloco = unicos.slice(i, i + 500);
    let pagina = 1;
    let paginas = 1;
    do {
      const { dados, paginacao } = await buscarProdutos(token, { ids: bloco, pagina, limite: 50 });
      for (const p of dados || []) achados.set(p.id, p);
      paginas = Math.max(1, Math.ceil((paginacao?.total || 0) / 50));
      pagina += 1;
    } while (pagina <= paginas);
  }
  return achados;
}

/** GET grupos / GET marcas — filtros do catálogo: [{ codigo, nome, quantidade }]. */
export async function listarGrupos(token) { return (await requisitar('GET', 'grupos', { token })).dados; }
export async function listarMarcas(token) { return (await requisitar('GET', 'marcas', { token })).dados; }

/** GET produtos/{id}/fotos/{item} — obterFotoProduto: Blob da imagem (exige o Bearer). */
export async function obterFotoProduto(token, id, item) {
  return requisitar('GET', 'produtos/{id}/fotos/{item}', { token, parametros: { id, item }, binario: true, semGanchos: true });
}

/* ---------------- Carrinho, revisão e pedido (Etapas 7 e 8) ---------------- */

/** GET opcoes — consultarOpcoes: { modalidades, enderecos, pagamento: { exigido, condicoes } }. */
export async function consultarOpcoes(token) { return (await requisitar('GET', 'opcoes', { token })).dados; }

/** GET enderecos/referencias — cidades (exige uf) ou bairros: [{ id, nome }]. */
export async function buscarReferenciasEndereco(token, tipo, q, uf) {
  return (await requisitar('GET', 'enderecos/referencias', { token, consulta: { tipo, q, uf } })).dados;
}

/** GET enderecos/cep/{cep} — consultarEnderecoCep (logradouro, bairro, cidade e UF com os códigos do G360). */
export async function consultarEnderecoCep(token, cep) {
  return (await requisitar('GET', 'enderecos/cep/{cep}', { token, parametros: { cep } })).dados;
}

/** POST enderecos — incluirEndereco. */
export async function incluirEndereco(token, endereco) {
  return (await requisitar('POST', 'enderecos', { token, corpo: endereco })).dados;
}

/** POST revisoes — revisarPedido. Devolve { dados, requestId }. */
export async function revisarPedido(token, corpo) {
  const r = await requisitar('POST', 'revisoes', { token, corpo });
  return { dados: r.dados, requestId: r.request_id };
}

/**
 * POST pedidos — enviarPedido, com Idempotency-Key. Devolve { dados, status } (201 novo, 200 repetição).
 * Sem o gancho de fornecedor: as pendências do envio são registradas pela tela, uma por linha.
 */
export async function enviarPedido(token, corpo, chave) {
  const r = await requisitar('POST', 'pedidos', { token, corpo, cabecalhos: { 'Idempotency-Key': chave }, semGanchos: true });
  return { dados: r.dados, status: r.status };
}

/** GET pedidos/por-chave/{chave} — consultarPedidoPorChave. O 404 aqui é esperado (pedido não gravado). */
export async function consultarPedidoPorChave(token, chave) {
  return (await requisitar('GET', 'pedidos/por-chave/{chave}', { token, parametros: { chave }, semGanchos: true })).dados;
}

/* ---------------- Pedidos, histórico (Etapa 9) ---------------- */

/** GET pedidos — listarPedidos: { dados, paginacao }. */
export async function listarPedidos(token, pagina = 1, limite = 20) {
  const r = await requisitar('GET', 'pedidos', { token, consulta: { pagina, limite } });
  return { dados: r.dados, paginacao: r.paginacao };
}

/** GET pedidos/{id} — consultarPedido. */
export async function consultarPedido(token, id) {
  return (await requisitar('GET', 'pedidos/{id}', { token, parametros: { id } })).dados;
}

/** GET historico-compras — consultarHistoricoCompras: { inicio, fim, produtos[] }. */
export async function consultarHistoricoCompras(token, meses = 6, produtoIds = null) {
  const consulta = { meses, produto_ids: produtoIds?.length ? produtoIds.join(',') : undefined };
  return (await requisitar('GET', 'historico-compras', { token, consulta })).dados;
}

/* ---------------- Painel do operador (Etapa 10) ---------------- */

/** POST operadores/sessoes — criarSessaoOperador: { token, tipo, expira_em }. */
export async function entrarOperador(usuario, senha) {
  return (await requisitar('POST', 'operadores/sessoes', { corpo: { usuario, senha } })).dados;
}
export async function sairOperador(token) { await requisitar('DELETE', 'operadores/sessao', { token }); }

/** GET operadores/me — consultarOperadorDaSessao: { operador: {codigo, usuario, nome}, empresa, permissoes, carteira, sessao }. */
export async function consultarOperadorMe(token) {
  return (await requisitar('GET', 'operadores/me', { token })).dados;
}

/** POST operadores/clientes/consulta — { codigo, nome, acesso_portal, segmento }. */
export async function consultarClienteOperador(token, cnpj) {
  return (await requisitar('POST', 'operadores/clientes/consulta', { token, corpo: { cnpj } })).dados;
}

/** Ficha do cliente no G360 (operador): consultar, alterar, liberar/bloquear acesso. */
export async function consultarFichaClienteOperador(token, cliente) {
  return (await requisitar('GET', 'operadores/clientes/{cliente}', { token, parametros: { cliente } })).dados;
}
export async function alterarFichaClienteOperador(token, cliente, corpo) {
  return (await requisitar('PUT', 'operadores/clientes/{cliente}', { token, parametros: { cliente }, corpo })).dados;
}
export async function alterarAcessoClienteOperador(token, cliente, liberado, revisao) {
  return (await requisitar('PUT', 'operadores/clientes/{cliente}/acesso', { token, parametros: { cliente }, corpo: { liberado, revisao } })).dados;
}
/** GET operadores/enderecos/cep/{cep} e GET operadores/enderecos/referencias (ficha do cliente). */
export async function consultarCepOperador(token, cep) {
  return (await requisitar('GET', 'operadores/enderecos/cep/{cep}', { token, parametros: { cep } })).dados;
}
export async function buscarReferenciasOperador(token, tipo, q, uf) {
  return (await requisitar('GET', 'operadores/enderecos/referencias', { token, consulta: { tipo, q, uf } })).dados;
}

/* ---- Novo cliente pelo painel (pacote 18/11 manhã) ---- */
/** GET operadores/cadastro/cliente — regras do formulário: { obrigatorios, obrigatorios_pessoa_fisica, editaveis, padroes }. */
export async function formularioNovoClienteOperador(token) {
  return (await requisitar('GET', 'operadores/cadastro/cliente', { token })).dados;
}
/** GET operadores/referencias?tipo=categoria|situacao|regiao|vendedor|tabela_preco|banco_cobranca — [{ id, nome }]. */
export async function referenciasNovoClienteOperador(token, tipo) {
  return (await requisitar('GET', 'operadores/referencias', { token, consulta: { tipo } })).dados;
}
/** POST operadores/cadastro/cnpj — { ja_existe: true, cliente_id } ou a sugestão da Receita. Não cria nada. */
export async function preencherNovoClienteCnpj(token, cnpj) {
  return (await requisitar('POST', 'operadores/cadastro/cnpj', { token, corpo: { cnpj } })).dados;
}
/** POST operadores/clientes com Idempotency-Key — { dados: ficha, status } (201 incluído, 200 reenvio da mesma chave). */
export async function incluirClienteOperador(token, corpo, chave) {
  const r = await requisitar('POST', 'operadores/clientes', { token, corpo, cabecalhos: { 'Idempotency-Key': chave } });
  return { dados: r.dados, status: r.status };
}

/** POST operadores/produtos/busca — { dados, paginacao } com preço, custo e margem. */
export async function buscarProdutosOperador(token, filtros = {}) {
  const corpo = {};
  for (const k of ['q', 'grupo', 'marca', 'codigos', 'ids', 'termos', 'pagina', 'limite']) {
    if (filtros[k] !== undefined && filtros[k] !== null && filtros[k] !== '') corpo[k] = filtros[k];
  }
  const r = await requisitar('POST', 'operadores/produtos/busca', { token, corpo });
  return { dados: r.dados, paginacao: r.paginacao };
}

/** POST operadores/produtos/precos — preços para um cliente (1 a 50 ids). */
export async function consultarPrecosOperador(token, cliente, ids) {
  return (await requisitar('POST', 'operadores/produtos/precos', { token, corpo: { cliente, ids } })).dados;
}

/** Preço congelado: listar (cursor apos), incluir, alterar, encerrar. */
export async function listarPrecosCongelados(token, cliente, apos) {
  return (await requisitar('GET', 'operadores/clientes/{cliente}/precos-congelados', { token, parametros: { cliente }, consulta: { apos } })).dados;
}
export async function incluirPrecoCongelado(token, cliente, entrada) {
  return (await requisitar('POST', 'operadores/clientes/{cliente}/precos-congelados', { token, parametros: { cliente }, corpo: entrada })).dados;
}
export async function alterarPrecoCongelado(token, cliente, preco, entrada) {
  return (await requisitar('PUT', 'operadores/clientes/{cliente}/precos-congelados/{preco}', { token, parametros: { cliente, preco }, corpo: entrada })).dados;
}
export async function encerrarPrecoCongelado(token, cliente, preco) {
  return (await requisitar('DELETE', 'operadores/clientes/{cliente}/precos-congelados/{preco}', { token, parametros: { cliente, preco } })).dados;
}

/** Galeria de fotos do operador. */
export async function listarFotosOperador(token, id) {
  return (await requisitar('GET', 'operadores/produtos/{id}/fotos', { token, parametros: { id } })).dados;
}
export async function obterFotoOperador(token, id, item) {
  return requisitar('GET', 'operadores/produtos/{id}/fotos/{item}', { token, parametros: { id, item }, binario: true });
}
export async function incluirFotoOperador(token, id, foto, descricao) {
  const corpo = { foto };
  if (descricao) corpo.descricao = descricao;
  return (await requisitar('POST', 'operadores/produtos/{id}/fotos', { token, parametros: { id }, corpo })).dados;
}
export async function definirCapaOperador(token, id, item) {
  return (await requisitar('PUT', 'operadores/produtos/{id}/fotos/capa', { token, parametros: { id }, corpo: { item } })).dados;
}
export async function ordenarFotosOperador(token, id, itens) {
  return (await requisitar('PUT', 'operadores/produtos/{id}/fotos/ordem', { token, parametros: { id }, corpo: { itens } })).dados;
}
export async function removerFotoOperador(token, id, item) {
  return (await requisitar('DELETE', 'operadores/produtos/{id}/fotos/{item}', { token, parametros: { id, item } })).dados;
}

/* ---------------- Catálogo aberto para visitantes (vitrine, sem sessão) ----------------
   GET simples, sem cabeçalhos de sessão nem de revalidação manual (o navegador cuida do cache).
   Sem preço, estoque, disponibilidade ou dados do comprador. Limite: 30 chamadas/min por IP
   para produtos, grupos e marcas somados — por isso a tela guarda as respostas e espera a digitação. */

/** GET vitrine/produtos — filtros iguais aos de GET produtos. */
export async function listarVitrine(filtros = {}) {
  const r = await requisitar('GET', 'vitrine/produtos', {
    cacheModo: 'default',
    consulta: {
      q: filtros.q, grupo: filtros.grupo, marca: filtros.marca,
      codigos: filtros.codigos?.length ? filtros.codigos.join(',') : undefined,
      ids: filtros.ids?.length ? filtros.ids.join(',') : undefined,
      'termos[]': filtros.termos?.length ? filtros.termos : undefined,
      pagina: filtros.pagina, limite: filtros.limite,
    },
  });
  return { dados: r.dados, paginacao: r.paginacao };
}
export async function listarGruposVitrine() { return (await requisitar('GET', 'vitrine/grupos', { cacheModo: 'default' })).dados; }
export async function listarMarcasVitrine() { return (await requisitar('GET', 'vitrine/marcas', { cacheModo: 'default' })).dados; }

/** Endereço público de uma foto da vitrine (sem Bearer): prefixo da loja + caminho. */
export function urlVitrine(caminho) {
  const c = String(caminho || '').replace(/^\/+/, '');
  return /^vitrine\/produtos\/\d+\/fotos\/\d+$/.test(c) ? `${BASE_URL}/b2b/v1/lojas/${LOJA}/${c}` : '';
}
export function urlFotoVitrine(id, item) { return urlVitrine(`vitrine/produtos/${Number(id)}/fotos/${Number(item)}`); }
