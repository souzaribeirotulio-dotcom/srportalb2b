/* Chamadas à função margens-g360 (aba Margens do painel). Só fetch + POST + Content-Type. */
const URL_MRG = String(import.meta.env.VITE_PONTE_URL || '').trim().replace(/\/ponte-g360$/, '/margens-g360');

export async function chamarMargens(token, acao, extra = {}) {
  if (!/\/margens-g360$/.test(URL_MRG)) throw new Error('Conferência de margens não configurada neste site.');
  let r;
  try {
    r = await fetch(URL_MRG, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao, token, ...extra }), credentials: 'omit', signal: AbortSignal.timeout(140000) });
  } catch { const e = new Error('Não foi possível falar com o servidor. Confira a conexão e tente de novo.'); e.status = 0; throw e; }
  let d = {};
  try { d = await r.json(); } catch { /* sem corpo */ }
  if (!r.ok) { const e = new Error(d.mensagem || 'Não foi possível conferir as margens agora.'); e.status = r.status; throw e; }
  return d;
}
