/* =====================================================================
   Módulo ÚNICO de chamadas à API dos sistemas externos (G360).
   Contrato: docs/g360/api-sistemas-externos-2026-11-16.yaml
   Nenhuma tela chama fetch direto: tudo passa por aqui.
   Endereço = VITE_G360_BASE_URL + /b2b/v1/lojas/ + VITE_G360_LOJA + /caminho
   ===================================================================== */

const BASE_URL = String(import.meta.env.VITE_G360_BASE_URL || '').trim();
const LOJA = String(import.meta.env.VITE_G360_LOJA || '').trim();
const TEMPO_LIMITE_MS = 30000;

/** Erro de uma chamada à API, já interpretado para as telas. */
export class ErroApi extends Error {
  constructor({ mensagem, codigo = null, responsavel = null, campos = {}, requestId = null, status = 0, tipo = 'api' }) {
    super(mensagem);
    this.name = 'ErroApi';
    this.codigo = codigo;           // erro.codigo do contrato (ex.: SESSAO_INVALIDA)
    this.responsavel = responsavel; // usuario | fornecedor | tentar_de_novo | integracao
    this.campos = campos || {};
    this.requestId = requestId;     // request_id para o suporte
    this.status = status;           // HTTP
    this.tipo = tipo;               // api | rede | tempo | configuracao
  }
}

export const MENSAGEM_REDE = 'Não foi possível falar com o servidor. Confira a conexão e tente de novo.';

/** Confere se as variáveis públicas estão preenchidas no formato do contrato. */
export function configuracaoValida() {
  const faltando = [];
  if (!/^https:\/\/[^/]+(\/[^/]+)*$/.test(BASE_URL) || /\/b2b\/v1/.test(BASE_URL)) faltando.push('VITE_G360_BASE_URL');
  if (!/^[a-f0-9]{16}$/.test(LOJA)) faltando.push('VITE_G360_LOJA');
  return faltando;
}

function endereco(caminho) {
  return `${BASE_URL}/b2b/v1/lojas/${LOJA}/${caminho}`;
}

/**
 * Faz uma chamada à API seguindo o envelope do contrato.
 * Sucesso → objeto { dados, request_id, paginacao? } (ou null no 204).
 * Falha → lança ErroApi (envelope de erro, falha de rede ou tempo esgotado).
 * Não registra token, senha nem corpo em log.
 */
export async function requisitar(metodo, caminho, { token = null, corpo, cabecalhos = {}, binario = false } = {}) {
  const faltando = configuracaoValida();
  if (faltando.length) {
    throw new ErroApi({ mensagem: 'O portal está sem a configuração da loja.', codigo: 'CONFIGURACAO_AUSENTE', responsavel: 'integracao', tipo: 'configuracao', campos: { variaveis: faltando } });
  }
  const headers = { ...cabecalhos };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';

  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let resp;
  try {
    resp = await fetch(endereco(caminho), {
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
    throw new ErroApi({ mensagem: tempo ? 'O servidor demorou para responder. Tente de novo.' : MENSAGEM_REDE, tipo: tempo ? 'tempo' : 'rede', responsavel: 'tentar_de_novo' });
  } finally {
    clearTimeout(relogio);
  }

  if (resp.status === 204) return null;
  if (resp.ok && binario) return resp.blob();

  let json = null;
  try { json = await resp.json(); } catch { json = null; }

  if (resp.ok && json && 'dados' in json) return json;

  const erro = json && json.erro;
  if (erro && typeof erro.mensagem === 'string') {
    throw new ErroApi({
      mensagem: erro.mensagem,          // mostrada como veio, sem reescrever
      codigo: erro.codigo || null,
      responsavel: erro.responsavel || null,
      campos: erro.campos || {},
      requestId: json.request_id || null,
      status: resp.status,
    });
  }
  // Resposta fora do envelope: tratada como defeito de integração.
  throw new ErroApi({ mensagem: 'Ocorreu um erro inesperado. Tente de novo.', responsavel: 'integracao', status: resp.status, requestId: json && json.request_id || null });
}

/* ---------------- Operações do contrato ---------------- */

/** GET loja — apresentarLoja: { nome, troca_senha, sessao_minutos } */
export async function apresentarLoja() {
  const r = await requisitar('GET', 'loja');
  return r.dados;
}
