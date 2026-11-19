/* Carrinho (seções 6 e 8): o mesmo produto na mesma unidade ocupa uma linha só,
   com as quantidades somadas. De 1 a 100 linhas. Preço guardado aqui serve só
   para a estimativa marcada como "estimada"; os valores que valem vêm da revisão
   (POST revisoes).
   Para não perder o carrinho no F5 ou ao sair e entrar de novo, as linhas ficam
   guardadas no navegador, numa chave por loja e comprador, só com produto,
   unidade, quantidade e nome (sem preço, estoque nem token). Ao voltar, o
   portal busca o preço e o estoque do momento na API. */
import { somarQuantidades } from '../ui/formato.js';

export const MAX_LINHAS = 100;
const linhas = new Map(); // "produto|unidade" → linha
const ouvintes = new Set();
let versao = 0;
let dono = null; // chave do navegador do comprador logado (null = só em memória)

function chave(produtoId, unidade) { return `${produtoId}|${unidade ?? ''}`; }
function guardar() {
  if (!dono) return;
  try {
    const mini = [...linhas.values()].map((l) => ({ produto_id: Number(l.produto_id), unidade: l.unidade ?? null, quantidade: l.quantidade, nome: l.nome, codigo: l.codigo, unidadeNome: l.unidadeNome }));
    if (mini.length) localStorage.setItem(dono, JSON.stringify(mini)); else localStorage.removeItem(dono);
  } catch { /* sem armazenamento: fica só em memória */ }
}
function avisar() { versao += 1; guardar(); ouvintes.forEach((fn) => { try { fn(); } catch { /* nada */ } }); }

/** Login ou F5 de um comprador: carrega o carrinho guardado dele (sem preço; o preço vem da API depois). */
export function vincularCarrinho(chaveDono) {
  dono = null; linhas.clear();
  try {
    const salvo = JSON.parse(localStorage.getItem(chaveDono) || '[]');
    for (const l of Array.isArray(salvo) ? salvo.slice(0, MAX_LINHAS) : []) {
      if (!(Number(l?.produto_id) > 0) || !/^[0-9]{1,7}(\.[0-9]{1,4})?$/.test(String(l.quantidade))) continue;
      linhas.set(chave(l.produto_id, l.unidade), { produto_id: Number(l.produto_id), unidade: l.unidade ?? null, quantidade: String(l.quantidade),
        nome: String(l.nome || ''), codigo: String(l.codigo || ''), unidadeNome: String(l.unidadeNome || 'UN'), precoTexto: null, semPrecoAtual: true });
    }
  } catch { /* guardado inválido: começa vazio */ }
  dono = chaveDono;
  avisar();
}
/** Saída ou troca de comprador: tira o carrinho da tela, mas mantém o guardado para quando ele voltar. */
export function desvincularCarrinho() { dono = null; }
/** Linhas restauradas que ainda esperam o preço e o estoque do momento. */
export function linhasSemPrecoAtual() { return [...linhas.values()].filter((l) => l.semPrecoAtual); }
/** Atualiza preço, selo e estoque de uma linha restaurada (dados vindos da API agora). */
export function atualizarLinha(produtoId, unidade, dados) {
  const l = linhas.get(chave(produtoId, unidade));
  if (l) { Object.assign(l, dados, { semPrecoAtual: false }); avisar(); }
}

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
