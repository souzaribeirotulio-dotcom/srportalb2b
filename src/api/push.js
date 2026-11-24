/* Chamadas à função push-g360 do Supabase (avisos no celular).
   Mesmo jeito da ponte: só fetch + POST + Content-Type, sem envelope da API.
   O token vai só no corpo do "teste" (a função confere com GET me) e não é registrado. */
const PONTE_URL = String(import.meta.env.VITE_PONTE_URL || '').trim();
const PUSH_URL = PONTE_URL.replace(/\/ponte-g360$/, '/push-g360');

async function chamar(corpo) {
  if (!/\/push-g360$/.test(PUSH_URL)) throw new Error('Avisos não configurados neste portal.');
  let resp;
  try {
    resp = await fetch(PUSH_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      credentials: 'omit', signal: AbortSignal.timeout(20000),
    });
  } catch { throw new Error('Não foi possível falar com o servidor. Confira a conexão e tente de novo.'); }
  let dados = {};
  try { dados = await resp.json(); } catch { /* sem corpo */ }
  if (!resp.ok) { const e = new Error(dados.mensagem || 'Não foi possível concluir agora. Tente de novo.'); e.status = resp.status; throw e; }
  return dados;
}

export const chavePublicaPush = async () => (await chamar({ acao: 'chave' })).chave;
export const enviarAvisoTeste = (token) => chamar({ acao: 'teste', token });

/* Painel (gestores): token do operador do G360. */
export const situacaoPainelPush = (token) => chamar({ acao: 'painel_situacao', token });
export const inscreverPainelPush = (token, j, aparelho) => chamar({ acao: 'painel_inscrever', token, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, aparelho });
export const desinscreverPainelPush = (token, endpoint) => chamar({ acao: 'painel_desinscrever', token, endpoint });
export const testarPainelPush = (token) => chamar({ acao: 'painel_teste', token });

/* Executivo de contas: "sessao" é o token da sessão do executivo no Supabase (conferido no servidor). */
export const inscreverExecutivoPush = (sessao, j, aparelho) => chamar({ acao: 'exec_inscrever', sessao, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, aparelho });
export const desinscreverExecutivoPush = (sessao, endpoint) => chamar({ acao: 'exec_desinscrever', sessao, endpoint });
export const testarExecutivoPush = (sessao) => chamar({ acao: 'exec_teste', sessao });

/* Eventos para os gestores: só avisa o servidor que algo novo aconteceu; ele confere no banco/G360
   o que existe de verdade e manda o aviso. Nunca trava a tela do cliente. */
export function avisarEvento(tipo, extra = {}) {
  chamar({ acao: 'evento', tipo, ...extra }).catch(() => { /* aviso é extra: falha não atrapalha o cliente */ });
}
