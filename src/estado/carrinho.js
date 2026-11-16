/* Carrinho em memória (seções 6 e 8): o mesmo produto na mesma unidade ocupa
   uma linha só, com as quantidades somadas. De 1 a 100 linhas. Preço guardado
   aqui serve só para a estimativa marcada como "estimada"; os valores que
   valem vêm da revisão (POST revisoes). */
import { somarQuantidades } from '../ui/formato.js';

export const MAX_LINHAS = 100;
const linhas = new Map(); // "produto|unidade" → linha
const ouvintes = new Set();
let versao = 0;

function chave(produtoId, unidade) { return `${produtoId}|${unidade ?? ''}`; }
function avisar() { versao += 1; ouvintes.forEach((fn) => { try { fn(); } catch { /* nada */ } }); }

export function aoMudarCarrinho(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
export function versaoCarrinho() { return versao; }
export function linhasCarrinho() { return [...linhas.values()]; }
export function quantidadeLinhas() { return linhas.size; }

/**
 * Inclui ou soma. linha: { produto_id, unidade (id|null), quantidade (texto), nome, codigo, unidadeNome, precoTexto }.
 * Devolve 'incluido' | 'somado' | 'limite'.
 */
export function adicionar(linha) {
  const k = chave(linha.produto_id, linha.unidade);
  const existente = linhas.get(k);
  if (existente) {
    existente.quantidade = somarQuantidades(existente.quantidade, linha.quantidade);
    if (linha.precoTexto) existente.precoTexto = linha.precoTexto;
    avisar();
    return 'somado';
  }
  if (linhas.size >= MAX_LINHAS) return 'limite';
  linhas.set(k, { ...linha, unidade: linha.unidade ?? null });
  avisar();
  return 'incluido';
}

export function alterarQuantidade(produtoId, unidade, quantidade) {
  const l = linhas.get(chave(produtoId, unidade));
  if (l) { l.quantidade = quantidade; avisar(); }
}

export function remover(produtoId, unidade) {
  if (linhas.delete(chave(produtoId, unidade))) avisar();
}

export function esvaziar() { if (linhas.size) { linhas.clear(); avisar(); } }

/** Itens no formato do contrato (ItemEntrada): só produto_id, quantidade e unidade. */
export function itensParaApi() {
  return linhasCarrinho().map((l) => ({ produto_id: Number(l.produto_id), quantidade: l.quantidade, unidade: l.unidade ?? null }));
}
