/* Chamada à função dashboard-g360 (números de vendas do portal, só gestores).
   Mesmo jeito da ponte: só fetch + POST + Content-Type. O token do operador vai no corpo e não é registrado. */
const URL_DASH = String(import.meta.env.VITE_PONTE_URL || '').trim().replace(/\/ponte-g360$/, '/dashboard-g360');

export async function lerDashboard(token, dias) {
  if (!/\/dashboard-g360$/.test(URL_DASH)) throw new Error('Painel de vendas não configurado neste site.');
  let r;
  try {
    r = await fetch(URL_DASH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, dias }), credentials: 'omit', signal: AbortSignal.timeout(30000) });
  } catch { throw new Error('Não foi possível falar com o servidor. Confira a conexão e tente de novo.'); }
  let d = {};
  try { d = await r.json(); } catch { /* sem corpo */ }
  if (!r.ok) { const e = new Error(d.mensagem || 'Não foi possível carregar as vendas agora.'); e.status = r.status; throw e; }
  return d.dados;
}
