/* Promoções (seção 6 do CLAUDE.md): o bloco "promocao" que a API manda no produto, na embalagem e no item da
   revisão. Ele só EXPLICA o preço: o valor da tela continua sendo o "preco" do catálogo ou o "preco_unitario" da
   revisão. Nunca aplicamos o preço da oferta por conta própria nem guardamos o bloco. */
import Decimal from 'decimal.js';
import { esc } from './comum.js';
import { dinheiro, quantidade, dataBr } from '../ui/formato.js';

/** A oferta já vale nesta quantidade? ("faltam" = "0"). */
export function ofertaValendo(pr) {
  if (!pr) return false;
  try { return new Decimal(String(pr.faltam)).isZero(); } catch { return false; }
}

const un = (nome) => (nome ? ` ${esc(String(nome).toLowerCase())}` : '');
/** "até 30/11 às 23:59" (hora nula = o dia todo). */
function termino(fim) {
  if (!fim?.data) return '';
  return `até ${esc(dataBr(fim.data).slice(0, 5))}${fim.hora ? ` às ${esc(fim.hora)}` : ''}`;
}
function extras(pr, unidade) {
  const partes = [];
  if (pr.restam !== null && pr.restam !== undefined) partes.push(`Restam ${esc(quantidade(pr.restam))}${un(unidade)}`);
  const t = termino(pr.fim); if (t) partes.push(t.charAt(0).toUpperCase() + t.slice(1));
  return partes.length ? `<span class="promo-fim">${partes.join(' · ')}</span>` : '';
}

/** Selo ao lado do preço (catálogo, página do produto, Minha Lista): só com a oferta valendo. */
export function seloOferta(pr) {
  if (!ofertaValendo(pr)) return '';
  const pct = typeof pr.desconto_percentual === 'number' ? ` −${String(pr.desconto_percentual).replace('.', ',')}%` : '';
  return `<span class="tagof">Oferta${pct}</span>${pr.preco_normal ? `<s class="promo-de">${esc(dinheiro(pr.preco_normal))}</s>` : ''}`;
}

/** Linha da promoção no catálogo: o término quando vale; "Leve N e pague X cada" quando ainda não vale. */
export function linhaPromoCatalogo(pr, unidade) {
  if (!pr) return '';
  if (ofertaValendo(pr)) return `<div class="promo">${extras(pr, unidade)}</div>`;
  const texto = pr.a_partir === false
    ? `A cada ${esc(quantidade(pr.meta))}${un(unidade)}, pague ${esc(dinheiro(pr.preco_oferta))} cada`
    : `Leve ${esc(quantidade(pr.meta))}${un(unidade)} e pague ${esc(dinheiro(pr.preco_oferta))} cada`;
  return `<div class="promo"><span class="tagof leve">Promoção</span> ${texto}${extras(pr, unidade)}</div>`;
}

/** Linha da promoção no item da revisão (carrinho): oferta aplicada ou "Leve mais N e pague X cada". */
export function linhaPromoRevisao(pr, unidade) {
  if (!pr) return '';
  if (ofertaValendo(pr)) {
    return `<small class="promo"><span class="tagof">Oferta</span>${pr.preco_normal ? ` de <s class="promo-de">${esc(dinheiro(pr.preco_normal))}</s>` : ''}${pr.economia ? ` · economia de ${esc(dinheiro(pr.economia))}` : ''}${extras(pr, unidade)}</small>`;
  }
  return `<small class="promo"><span class="tagof leve">Promoção</span> Leve mais ${esc(quantidade(pr.faltam))}${un(unidade)} e pague ${esc(dinheiro(pr.preco_oferta))} cada${pr.economia ? ` (economia de ${esc(dinheiro(pr.economia))})` : ''}${extras(pr, unidade)}</small>`;
}
