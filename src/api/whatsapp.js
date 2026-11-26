/* Chamadas à função whatsapp-g360 (remarketing pelo WhatsApp) com o token do operador do G360.
   Mesmo formato do painel: {"dados"} ou {"mensagem"}, só POST + Content-Type. A chave da API
   do parceiro fica só no servidor; o navegador nunca a vê. */
import { MENSAGEM_REDE } from './g360.js';
import { ErroPainel } from './painel.js';

const URL_WPP = String(import.meta.env.VITE_PONTE_URL || '').trim().replace(/\/ponte-g360$/, '/whatsapp-g360');

export async function chamarWhatsapp(token, acao, dados = {}) {
  if (!/\/whatsapp-g360$/.test(URL_WPP)) throw new ErroPainel('O WhatsApp não está configurado neste site.');
  let resp;
  try {
    resp = await fetch(URL_WPP, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao, token, dados }), credentials: 'omit', signal: AbortSignal.timeout(60000) });
  } catch { throw new ErroPainel(MENSAGEM_REDE); }
  let corpo = {};
  try { corpo = await resp.json(); } catch { /* sem corpo */ }
  if (!resp.ok) throw new ErroPainel(corpo.mensagem || 'Não foi possível concluir agora. Tente de novo em instantes.', resp.status, corpo);
  return corpo;
}
