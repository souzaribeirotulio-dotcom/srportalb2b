/* Formatos da tela (seção 6 do CLAUDE.md). Valores chegam como texto decimal
   com ponto e só são convertidos para exibição, sem ponto flutuante. */
import Decimal from 'decimal.js';

function agrupar(inteiro) {
  return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** "1234.5" → "1.234,50" (mínimo de casas, sem perder as que vierem a mais). */
export function decimalBr(texto, minCasas = 2) {
  if (texto === null || texto === undefined || texto === '') return '';
  const s = String(texto);
  const neg = s.startsWith('-');
  const [int, frac = ''] = (neg ? s.slice(1) : s).split('.');
  let f = frac.replace(/0+$/, '');
  if (f.length < minCasas) f = f.padEnd(minCasas, '0');
  return `${neg ? '-' : ''}${agrupar(int || '0')}${f ? ',' + f : ''}`;
}

/** Dinheiro: "12.5" → "R$ 12,50"; "118.999025" → "R$ 119,00" (2 casas, arredondando).
    Abaixo de R$ 1 mantém até 4 casas ("0.0345" → "R$ 0,0345"), para não virar R$ 0,03.
    É só exibição: o valor guardado e enviado continua o texto da API, e os totais que valem são os da revisão. */
export function dinheiro(texto) {
  if (texto === null || texto === undefined || texto === '') return '—';
  let d;
  try { d = new Decimal(String(texto)); } catch { return `R$ ${decimalBr(texto, 2)}`; }
  const casas = d.abs().lt(1) ? 4 : 2;
  return `R$ ${decimalBr(d.toDecimalPlaces(casas, Decimal.ROUND_HALF_UP).toFixed(), 2)}`;
}

/** Quantidade: "1.5" → "1,5"; "2" → "2". */
export function quantidade(texto) {
  return decimalBr(texto, 0);
}

/** Número do painel do operador (custo e margem vêm como number no contrato). */
export function numeroPainel(n, casas = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: 4 });
}

/** Data AAAA-MM-DD → DD/MM/AAAA. */
export function dataBr(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (texto || '');
}

/**
 * Normaliza a quantidade digitada: vírgula vira ponto e confere o formato do contrato
 * (maior que zero, até 7 dígitos inteiros e 4 decimais). Devolve o texto ou null.
 */
export function normalizarQuantidade(digitado) {
  const s = String(digitado ?? '').trim().replace(',', '.');
  if (!/^[0-9]{1,7}(?:\.[0-9]{1,4})?$/.test(s)) return null;
  if (/^0+(?:\.0+)?$/.test(s)) return null;
  return new Decimal(s).toFixed(); // tira zeros à esquerda e à direita
}

/** Soma de quantidades em texto decimal (mesmo produto e unidade numa linha só). */
export function somarQuantidades(a, b) {
  return new Decimal(a).plus(new Decimal(b)).toFixed();
}

/** Estimativa do carrinho antes da revisão: preço × quantidade, com Decimal. */
export function estimar(linhas) {
  let total = new Decimal(0);
  let completo = true;
  for (const l of linhas) {
    if (!l.precoTexto) { completo = false; continue; }
    total = total.plus(new Decimal(l.precoTexto).times(new Decimal(l.quantidade)));
  }
  return { total: total.toFixed(2), completo };
}

export function cabeQuantidade(texto) {
  return /^[0-9]{1,7}(?:\.[0-9]{1,4})?$/.test(texto);
}
