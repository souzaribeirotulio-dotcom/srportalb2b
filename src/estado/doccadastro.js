/* CNPJ do "Quero ser cliente" que acabou de criar o acesso: fica guardado neste aparelho só enquanto
   o link de senha vale (30 minutos), para a página de senha já vir com o CNPJ preenchido.
   Sai ao criar a senha ou ao vencer. O documento não é segredo, mas não fica além disso. */
const CHAVE = `g360:${String(import.meta.env.VITE_G360_LOJA || '').trim()}:doc-cadastro`;
const VALIDADE_MS = 30 * 60_000;

export function guardarDocCadastro(documento) {
  try { localStorage.setItem(CHAVE, JSON.stringify({ d: String(documento || '').slice(0, 32), ate: Date.now() + VALIDADE_MS })); } catch { /* sem armazenamento */ }
}
export function docCadastroGuardado() {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) || 'null');
    if (v && typeof v.d === 'string' && v.d && Number(v.ate) > Date.now()) return v.d;
    localStorage.removeItem(CHAVE);
  } catch { /* sem armazenamento */ }
  return '';
}
export function esquecerDocCadastro() { try { localStorage.removeItem(CHAVE); } catch { /* sem armazenamento */ } }
