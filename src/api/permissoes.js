/* Chamadas à função permissoes-g360 (permissões do painel). Só fetch + POST + Content-Type. */
const URL_PERM = String(import.meta.env.VITE_PONTE_URL || '').trim().replace(/\/ponte-g360$/, '/permissoes-g360');

export async function chamarPermissoes(token, acao, extra = {}) {
  if (!/\/permissoes-g360$/.test(URL_PERM)) throw new Error('Permissões não configuradas neste site.');
  let r;
  try {
    r = await fetch(URL_PERM, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao, token, ...extra }), credentials: 'omit', signal: AbortSignal.timeout(30000) });
  } catch { const e = new Error('Não foi possível falar com o servidor. Confira a conexão e tente de novo.'); e.status = 0; throw e; }
  let d = {};
  try { d = await r.json(); } catch { /* sem corpo */ }
  if (!r.ok) { const e = new Error(d.mensagem || 'Não foi possível concluir agora.'); e.status = r.status; throw e; }
  return d;
}
