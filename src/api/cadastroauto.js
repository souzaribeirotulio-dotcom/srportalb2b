/* Cadastro automático do "Quero ser cliente" (função cadastro-g360).
   O navegador manda o documento do pedido que acabou de enviar e, quando a pessoa já criou a senha
   no formulário, a senha (só por HTTPS para a função; nunca vai para log nem para o Supabase).
   A função confere, cria a ficha no G360 e grava a senha (ou manda o link por e-mail).
   Resposta: { resultado: 'criado' | 'analise', senha: 'gravada' | 'email' | 'nao_enviada' }. */
const URL_CAD = String(import.meta.env.VITE_PONTE_URL || '').trim().replace(/\/ponte-g360$/, '/cadastro-g360');

export async function cadastroAutomatico(documento, senha = null) {
  if (!/\/cadastro-g360$/.test(URL_CAD)) return { resultado: 'analise' };
  try {
    const r = await fetch(URL_CAD, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(senha ? { acao: 'cadastrar', documento, senha } : { acao: 'cadastrar', documento }), credentials: 'omit', signal: AbortSignal.timeout(45000) });
    const c = await r.json().catch(() => ({}));
    return r.ok && c.resultado === 'criado' ? { resultado: 'criado', senha: c.senha === 'gravada' ? 'gravada' : 'email' } : { resultado: 'analise' };
  } catch { return { resultado: 'analise' }; }
}
