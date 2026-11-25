/* Cadastro automático do "Quero ser cliente" (função cadastro-g360).
   O navegador manda só o documento do pedido que acabou de enviar; a função confere,
   cria a ficha no G360 e pede o link de senha. Resposta: { resultado: 'criado' | 'analise' }. */
const URL_CAD = String(import.meta.env.VITE_PONTE_URL || '').trim().replace(/\/ponte-g360$/, '/cadastro-g360');

export async function cadastroAutomatico(documento) {
  if (!/\/cadastro-g360$/.test(URL_CAD)) return { resultado: 'analise' };
  try {
    const r = await fetch(URL_CAD, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'cadastrar', documento }), credentials: 'omit', signal: AbortSignal.timeout(45000) });
    const c = await r.json().catch(() => ({}));
    return r.ok && c.resultado === 'criado' ? { resultado: 'criado' } : { resultado: 'analise' };
  } catch { return { resultado: 'analise' }; }
}
