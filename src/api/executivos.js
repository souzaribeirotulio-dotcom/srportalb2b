/* Chamadas à função executivos-g360 (programa Executivo de Contas, painel do administrador).
   Mesmo formato da função do painel: só POST + Content-Type; o token do operador vai no corpo. */
import { MENSAGEM_REDE } from './g360.js';
import { ErroPainel } from './painel.js';

const URL_EXEC = String(import.meta.env.VITE_PONTE_URL || '').trim().replace(/\/ponte-g360$/, '/executivos-g360');

export async function chamarExecutivos(token, acao, dados = {}) {
  if (!/\/executivos-g360$/.test(URL_EXEC)) throw new ErroPainel('O programa de executivos não está configurado neste site.');
  let resp;
  try {
    resp = await fetch(URL_EXEC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao, token, dados }), credentials: 'omit', signal: AbortSignal.timeout(20000) });
  } catch { throw new ErroPainel(MENSAGEM_REDE); }
  let corpo = {};
  try { corpo = await resp.json(); } catch { /* sem corpo */ }
  if (!resp.ok) throw new ErroPainel(corpo.mensagem || 'Não foi possível concluir agora. Tente de novo em instantes.', resp.status, corpo);
  return corpo;
}

/* Área do executivo: pede o link de acesso (definir senha) para um cliente aprovado dele.
   Função executivo-link; o token é a sessão do Supabase do executivo. O documento nunca passa pelo navegador. */
const URL_LINK = String(import.meta.env.VITE_PONTE_URL || '').trim().replace(/\/ponte-g360$/, '/executivo-link');

export async function pedirLinkDoCliente(token, vinculoId) {
  if (!/\/executivo-link$/.test(URL_LINK)) throw new ErroPainel('O envio de link não está configurado neste site.');
  let resp;
  try {
    resp = await fetch(URL_LINK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, vinculo_id: vinculoId }), credentials: 'omit', signal: AbortSignal.timeout(25000) });
  } catch { throw new ErroPainel(MENSAGEM_REDE); }
  let corpo = {};
  try { corpo = await resp.json(); } catch { /* sem corpo */ }
  if (!resp.ok) throw new ErroPainel(corpo.mensagem || 'Não foi possível concluir agora. Tente de novo em instantes.', resp.status, corpo);
  return corpo;
}
