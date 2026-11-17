/* Utilidades do layout original (portal da Souza Ribeiro). */
import Decimal from 'decimal.js';
export const $ = (id) => document.getElementById(id);
export { esc } from '../ui/util.js';

export function toast(m) {
  const t = $('toast');
  if (!t) return;
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2800);
}

export function abrirModal(id) { $(id)?.classList.add('open'); }
export function fecharModal(id) { $(id)?.classList.remove('open'); }

/** Saudação pela hora do dia. */
export function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia.' : h < 18 ? 'Boa tarde.' : 'Boa noite.';
}

/** Soma 1 (ou subtrai) numa quantidade em texto, sem ponto flutuante. Nunca abaixo de 1. */
export function passoQuantidade(texto, delta) {
  const s = String(texto || '').trim().replace(',', '.');
  let atual;
  try { atual = new Decimal(/^[0-9]+(\.[0-9]+)?$/.test(s) ? s : '1'); } catch { atual = new Decimal(1); }
  const novo = atual.plus(delta);
  return (novo.lessThan(1) ? atual.lessThan(1) ? atual : new Decimal(1) : novo).toFixed().replace('.', ',');
}

/** Debounce simples. */
export function adiar(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
