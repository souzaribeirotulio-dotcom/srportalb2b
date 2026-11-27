/* =====================================================================
   Chamadas à função painel-g360 do Supabase: dados do painel (cadastros,
   ocorrências) com o mesmo login do G360. A função confere o token do
   operador na própria API. Mesmo formato da ponte: {"dados"} ou {"mensagem"},
   só POST + Content-Type: application/json. O token não vai para log.
   ===================================================================== */
import { MENSAGEM_REDE } from './g360.js';

const PAINEL_URL = String(import.meta.env.VITE_PONTE_URL || '').trim().replace(/\/ponte-g360$/, '/painel-g360');
const TEMPO_LIMITE_MS = 20000;

export class ErroPainel extends Error {
  constructor(mensagem, status = 0, corpo = {}) { super(mensagem); this.name = 'ErroPainel'; this.status = status; this.corpo = corpo; }
}

const PRE_URL = PAINEL_URL.replace(/\/painel-g360$/, '/precadastro-g360');

/** Função precadastro-g360 (Clientes → Carteira do portal): mesmo formato e mesmo login da painel-g360. */
export function chamarPreCadastro(token, acao, dados = {}) { return chamarPainel(token, acao, dados, PRE_URL); }

export async function chamarPainel(token, acao, dados = {}, url = PAINEL_URL) {
  if (!/\/(painel|precadastro)-g360$/.test(url)) throw new ErroPainel('O painel não está configurado neste site.');
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao, token, dados }), credentials: 'omit', signal: controle.signal,
    });
  } catch { throw new ErroPainel(MENSAGEM_REDE); } finally { clearTimeout(relogio); }
  let corpo = {};
  try { corpo = await resp.json(); } catch { /* sem corpo */ }
  if (!resp.ok) throw new ErroPainel(corpo.mensagem || 'Não foi possível concluir agora. Tente de novo em instantes.', resp.status, corpo);
  return corpo;
}
