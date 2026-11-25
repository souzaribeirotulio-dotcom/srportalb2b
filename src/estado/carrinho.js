/* Carrinho (seções 6 e 8): o mesmo produto na mesma unidade ocupa uma linha só,
   com as quantidades somadas. De 1 a 100 linhas. Preço guardado aqui serve só
   para a estimativa marcada como "estimada"; os valores que valem vêm da revisão
   (POST revisoes).
   Para não perder o carrinho no F5 ou ao sair e entrar de novo, as linhas ficam
   guardadas no navegador, numa chave por loja e comprador, só com produto,
   unidade, quantidade e nome (sem preço, estoque nem token). Ao voltar, o
   portal busca o preço e o estoque do momento na API.
   O mesmo conteúdo vai para o Supabase (carrinho-nuvem.js), para aparecer em
   outro navegador; vale a versão mais nova (carimbo da última mudança). */
import { somarQuantidades } from '../ui/formato.js';
import { clienteEmAnalise } from './analise.js';

export const MAX_LINHAS = 100;
const linhas = new Map(); // "produto|unidade" → linha
const ouvintes = new Set();
let versao = 0;
let dono = null; // chave do navegador do comprador logado (null = só em memória)
let carimbo = 0; // momento (ms) da última mudança feita pelo comprador

function chave(produtoId, unidade) { return `${produtoId}|${unidade ?? ''}`; }
/** Linhas no formato guardado (sem preço, estoque nem token). */
export function linhasParaGuardar() {
  return [...linhas.values()].map((l) => ({ produto_id: Number(l.produto_id), unidade: l.unidade ?? null, quantidade: l.quantidade, nome: l.nome, codigo: l.codigo, unidadeNome: l.unidadeNome }));
}
function guardar() {
  if (!dono) return;
  try { localStorage.setItem(dono, JSON.stringify({ em: carimbo, linhas: linhasParaGuardar() })); } catch { /* sem armazenamento: fica só em memória */ }
}
/** origem: 'local' (o comprador mexeu), 'nuvem' (veio de outro navegador), 'preco' (preço do momento). */
function avisar(origem = 'local') {
  versao += 1;
  if (origem === 'local') carimbo = Date.now();
  guardar();
  ouvintes.forEach((fn) => { try { fn(origem); } catch { /* nada */ } });
}
function preencher(lista) {
  linhas.clear();
  for (const l of Array.isArray(lista) ? lista.slice(0, MAX_LINHAS) : []) {
    if (!(Number(l?.produto_id) > 0) || !/^[0-9]{1,7}(\.[0-9]{1,4})?$/.test(String(l.quantidade))) continue;
    linhas.set(chave(l.produto_id, l.unidade), { produto_id: Number(l.produto_id), unidade: l.unidade ?? null, quantidade: String(l.quantidade),
      nome: String(l.nome || ''), codigo: String(l.codigo || ''), unidadeNome: String(l.unidadeNome || 'UN'), precoTexto: null, semPrecoAtual: true });
  }
}

/** Login ou F5 de um comprador: carrega o carrinho guardado dele (sem preço; o preço vem da API depois). */
export function vincularCarrinho(chaveDono) {
  dono = null; carimbo = 0; linhas.clear();
  try {
    const salvo = JSON.parse(localStorage.getItem(chaveDono) || 'null');
    if (Array.isArray(salvo)) { preencher(salvo); carimbo = salvo.length ? 1 : 0; } // formato antigo
    else if (salvo && typeof salvo === 'object') { preencher(salvo.linhas); carimbo = Number(salvo.em) || 0; }
  } catch { /* guardado inválido: começa vazio */ }
  dono = chaveDono;
  avisar('nuvem');
}
/** Carrinho mais novo vindo de outro navegador: substitui o desta tela. */
export function substituirCarrinho(lista, em) {
  if (!dono) return;
  preencher(lista);
  carimbo = Number(em) || carimbo;
  avisar('nuvem');
}
export function donoCarrinho() { return dono; }
export function carimboCarrinho() { return carimbo; }
/** Saída ou troca de comprador: tira o carrinho da tela, mas mantém o guardado para quando ele voltar. */
export function desvincularCarrinho() { dono = null; }
/** Linhas restauradas que ainda esperam o preço e o estoque do momento. */
export function linhasSemPrecoAtual() { return [...linhas.values()].filter((l) => l.semPrecoAtual); }
/** Atualiza preço, selo e estoque de uma linha restaurada (dados vindos da API agora). */
export function atualizarLinha(produtoId, unidade, dados) {
  const l = linhas.get(chave(produtoId, unidade));
  if (l) { Object.assign(l, dados, { semPrecoAtual: false }); avisar('preco'); }
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
  if (clienteEmAnalise()) return 'analise';
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
