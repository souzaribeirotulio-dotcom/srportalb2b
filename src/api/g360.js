/* =====================================================================
   Módulo ÚNICO de chamadas à API dos sistemas externos (G360).
   Contrato: docs/g360/api-sistemas-externos-2026-11-16.yaml
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
  constructor({ mensagem, codigo = null, responsavel = null, campos = {}, requestId = null, status = 0, tipo = 'api', operacao = null }) {
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
  }
}

/* ---------------- Ganchos para as próximas etapas ----------------
   aoSessaoEncerrada: chamado num 401 (SESSAO_INVALIDA) — a Etapa 5 encerra a sessão.
   aoErroFornecedor: chamado quando responsavel = fornecedor — a Etapa 11 registra a ocorrência. */
const ganchos = { aoSessaoEncerrada: null, aoErroFornecedor: null };
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
export async function requisitar(metodo, modelo, { parametros, consulta, token = null, corpo, cabecalhos = {}, binario = false } = {}) {
  const operacao = `${metodo} ${modelo}`;
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
      cache: 'no-store',
    });
  } catch (e) {
    // Falha de rede ou de CORS não tem envelope nem request_id.
    const tempo = e && e.name === 'AbortError';
    throw new ErroApi({ mensagem: MENSAGEM_REDE, tipo: tempo ? 'tempo' : 'rede', responsavel: 'tentar_de_novo', operacao });
  } finally {
    clearTimeout(relogio);
  }

  if (resp.status === 204) return null;
  if (resp.ok && binario) return resp.blob();

  let json = null;
  try { json = await resp.json(); } catch { json = null; }
  if (resp.ok && json && 'dados' in json) return json;

  const env = json && json.erro;
  const erro = env && typeof env.mensagem === 'string'
    ? new ErroApi({
        mensagem: env.mensagem,       // como veio, sem reescrever nem traduzir
        codigo: env.codigo || null,
        responsavel: env.responsavel || null,
        campos: env.campos || {},
        requestId: (json && json.request_id) || null,
        status: resp.status,
        operacao,
      })
    // Resposta fora do envelope: tratada como defeito de integração.
    : new ErroApi({ mensagem: MENSAGEM_INTEGRACAO, responsavel: 'integracao', status: resp.status, requestId: (json && json.request_id) || null, operacao });

  if (erro.codigo === 'SESSAO_INVALIDA' && ganchos.aoSessaoEncerrada) {
    try { ganchos.aoSessaoEncerrada(erro); } catch { /* a tela segue com a mensagem */ }
  }
  if (erro.responsavel === 'fornecedor' && ganchos.aoErroFornecedor) {
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
