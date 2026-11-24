/* Programa Executivo de Contas: o link portal.../?ex=CODIGO guarda o código do executivo neste
   navegador por 90 dias (vale o último link usado). O "Quero ser cliente" já vem com ele
   preenchido. O código some do endereço na hora, sem recarregar a página. */
import { LOJA } from '../api/supabase.js';

const CHAVE = `g360:${LOJA}:executivo`;
const DIAS = 90;
const valido = (c) => /^[A-Z0-9]{3,20}$/.test(c);

export function capturarCodigoExecutivo() {
  try {
    const u = new URL(location.href);
    if (!u.searchParams.has('ex')) return;
    const c = String(u.searchParams.get('ex') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (valido(c)) localStorage.setItem(CHAVE, JSON.stringify({ c, ate: Date.now() + DIAS * 86400000 }));
    u.searchParams.delete('ex');
    history.replaceState(history.state, '', u.pathname + u.search + u.hash);
  } catch { /* navegador sem armazenamento: segue sem o código */ }
}

/** Código guardado (ou '' se não houver ou se passou dos 90 dias). */
export function codigoExecutivoGuardado() {
  try {
    const g = JSON.parse(localStorage.getItem(CHAVE) || 'null');
    if (g && valido(g.c) && g.ate > Date.now()) return g.c;
    if (g) localStorage.removeItem(CHAVE);
  } catch { /* sem armazenamento */ }
  return '';
}
