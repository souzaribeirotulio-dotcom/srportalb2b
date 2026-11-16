/* Utilidades de tela compartilhadas. */
export function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Leva o foco ao título da tela nova (leitor de tela e teclado). */
export function focarTitulo(raiz) {
  const t = raiz.querySelector('h2');
  if (t) { t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: false }); }
}
