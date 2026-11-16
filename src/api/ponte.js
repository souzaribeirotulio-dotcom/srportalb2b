/* =====================================================================
   Chamadas à função ponte-g360 do Supabase (seção 4 do CLAUDE.md).
   A ponte NÃO usa o envelope da API: responde {"mensagem": ...} ou, no
   abrir_sessao, {"sessao", "api_expira_em", ...}. Por isso fica à parte
   do tratamento central de erros da API (src/api/g360.js).
   Só fetch + POST + Content-Type: application/json (o invoke do supabase-js
   acrescenta cabeçalhos que a função recusa no preflight).
   Nada do corpo (documento, token) é registrado em log.
   ===================================================================== */
import { MENSAGEM_REDE } from './g360.js';

const PONTE_URL = String(import.meta.env.VITE_PONTE_URL || '').trim();
const TEMPO_LIMITE_MS = 30000;
export const MENSAGEM_PONTE_FALHOU = 'Não foi possível concluir agora. Tente de novo em instantes.';

/** Falha numa chamada à ponte. `rede` = sem resposta do servidor. */
export class ErroPonte extends Error {
  constructor(mensagem, status = 0, rede = false) {
    super(mensagem);
    this.name = 'ErroPonte';
    this.status = status;
    this.rede = rede;
  }
}

export function ponteConfigurada() {
  return /^https:\/\/[^/\s]+\/functions\/v1\/ponte-g360$/.test(PONTE_URL) || /^http:\/\/localhost(:\d+)?\//.test(PONTE_URL);
}

async function chamar(corpo) {
  if (!ponteConfigurada()) throw new ErroPonte(MENSAGEM_PONTE_FALHOU);
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let resp;
  try {
    resp = await fetch(PONTE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      credentials: 'omit',
      cache: 'no-store',
      signal: controle.signal,
    });
  } catch {
    throw new ErroPonte(MENSAGEM_REDE, 0, true);
  } finally {
    clearTimeout(relogio);
  }
  let json = null;
  try { json = await resp.json(); } catch { json = null; }
  return { status: resp.status, json: json && typeof json === 'object' ? json : {} };
}

/**
 * Primeiro acesso / "esqueci minha senha": pede o link para o documento.
 * No 202 devolve a mensagem da função, que é sempre a mesma e não revela
 * se o documento existe. Mostre-a como veio.
 */
export async function pedirLink(documento) {
  const { status, json } = await chamar({ acao: 'pedir_link', documento });
  if (status === 202 && typeof json.mensagem === 'string') return json.mensagem;
  throw new ErroPonte(typeof json.mensagem === 'string' ? json.mensagem : MENSAGEM_PONTE_FALHOU, status);
}
