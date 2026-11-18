/* Fotos do catálogo (seção 6): a foto exige o Bearer, então é baixada com fetch
   pelo módulo da API e mostrada com URL.createObjectURL. Só as visíveis são
   carregadas; as baixadas (e as falhas) ficam guardadas em memória, e os
   endereços de objeto são liberados ao sair da tela. */
import { obterFotoProduto, urlFotoVitrine } from '../api/g360.js';
import { sessao } from '../estado/sessao.js';

const cache = new Map();      // "id/item" → Blob | 'falha' | Promise
let urlsDaTela = [];
let observador = null;
const fila = [];
let emAndamento = 0;
const MAX_SIMULTANEAS = 4;

export function limparCacheFotos() { cache.clear(); }

/** Chame ao sair de uma tela que mostrou fotos. */
export function liberarFotosDaTela() {
  urlsDaTela.forEach((u) => URL.revokeObjectURL(u));
  urlsDaTela = [];
  if (observador) { observador.disconnect(); observador = null; }
  fila.length = 0;
}

function mostrar(el, blob) {
  const url = URL.createObjectURL(blob);
  urlsDaTela.push(url);
  const img = document.createElement('img');
  img.alt = el.dataset.alt || '';
  img.decoding = 'async';
  img.src = url;
  el.replaceChildren(img);
  el.classList.add('com-foto');
}

function semFoto(el) {
  el.classList.add('vazia');
  el.innerHTML = '<span>Sem foto</span>';
}

function proxima() {
  while (emAndamento < MAX_SIMULTANEAS && fila.length) {
    const el = fila.shift();
    if (!el.isConnected) continue;
    const chave = `${el.dataset.produto}/${el.dataset.item}`;
    const guardado = cache.get(chave);
    if (guardado instanceof Blob) { mostrar(el, guardado); continue; }
    if (guardado === 'falha') { semFoto(el); continue; }
    emAndamento += 1;
    const token = sessao.token;
    obterFotoProduto(token, el.dataset.produto, el.dataset.item)
      .then((blob) => { cache.set(chave, blob); if (el.isConnected) mostrar(el, blob); })
      .catch(() => { cache.set(chave, 'falha'); if (el.isConnected) semFoto(el); }) // espaço reservado, sem mensagem nem ocorrência
      .finally(() => { emAndamento -= 1; proxima(); });
  }
}

/** Liga as fotos dos elementos [data-produto][data-item] dentro de `raiz`. */
export function ligarFotos(raiz) {
  ligarTrocaFotos(raiz);
  const els = [...raiz.querySelectorAll('.foto[data-produto][data-item]')];
  if (!els.length) return;
  const carregar = (el) => {
    const chave = `${el.dataset.produto}/${el.dataset.item}`;
    const guardado = cache.get(chave);
    if (guardado instanceof Blob) { mostrar(el, guardado); return; }
    if (guardado === 'falha') { semFoto(el); return; }
    fila.push(el); proxima();
  };
  if (!('IntersectionObserver' in window)) { els.forEach(carregar); return; }
  if (!observador) {
    observador = new IntersectionObserver((entradas) => {
      entradas.forEach((en) => { if (en.isIntersecting) { observador.unobserve(en.target); carregar(en.target); } });
    }, { rootMargin: '200px' });
  }
  els.forEach((el) => observador.observe(el));
}

/** HTML do espaço da foto: usa fotos[] (vazia → espaço reservado, ignorando "imagem"). */
export function htmlFoto(produto, classe = '') {
  const item = Array.isArray(produto.fotos) && produto.fotos.length ? produto.fotos[0] : null;
  const alt = String(produto.nome || '').replace(/"/g, '&quot;');
  if (!item) return `<div class="foto vazia ${classe}" aria-hidden="true"><span>Sem foto</span></div>`;
  const outras = produto.fotos.slice(0, 3).map(Number);
  return `<div class="foto ${classe}" data-produto="${Number(produto.id)}" data-item="${Number(item)}"${outras.length > 1 ? ` data-fotos="${outras.join(',')}"` : ''} data-alt="${alt}"><span>Carregando…</span></div>`;
}

/* ---------- troca de foto ao passar o mouse no card: 2ª, 3ª e volta à capa ---------- */
const PASSO_MS = 1100;
function blobDaFoto(id, item) {
  const chave = `${id}/${item}`;
  const g = cache.get(chave);
  if (g instanceof Blob) return Promise.resolve(g);
  if (g === 'falha') return Promise.reject(new Error('falha'));
  if (g instanceof Promise) return g;
  const p = obterFotoProduto(sessao.token, id, item).then((b) => { cache.set(chave, b); return b; }, (e) => { cache.set(chave, 'falha'); throw e; });
  cache.set(chave, p);
  return p;
}

/** Liga a troca de foto no hover dos cards que têm mais de uma foto (só em aparelhos com mouse). */
export function ligarTrocaFotos(raiz) {
  if (!window.matchMedia?.('(hover: hover)').matches) return;
  raiz.querySelectorAll('.foto[data-fotos]').forEach((el) => {
    const card = el.closest('.card, .ccard') || el;
    if (card.dataset.troca) return;
    card.dataset.troca = '1';
    const itens = el.dataset.fotos.split(',').map(Number);
    const publico = el.hasAttribute('data-publico');
    let timer = null; let pos = 0; let vez = 0;
    const img = () => el.querySelector('img');
    const mostrarItem = async (j, eu) => {
      const alvo = img(); if (!alvo) return;
      if (!alvo.dataset.capa) alvo.dataset.capa = alvo.src;
      if (j === 0) { alvo.src = alvo.dataset.capa; return; }
      if (publico) { alvo.src = urlFotoVitrine(el.dataset.produto, itens[j]); return; }
      try {
        const b = await blobDaFoto(el.dataset.produto, itens[j]);
        if (eu !== vez || !el.isConnected) return;
        const u = URL.createObjectURL(b); urlsDaTela.push(u); alvo.src = u;
      } catch { /* sem a foto extra: fica a atual */ }
    };
    card.addEventListener('mouseenter', () => {
      const eu = ++vez; pos = 0;
      if (!publico) itens.slice(1).forEach((it) => blobDaFoto(el.dataset.produto, it).catch(() => {})); // já busca as próximas
      const passo = () => { if (eu !== vez) return; pos = (pos + 1) % itens.length; mostrarItem(pos, eu); timer = setTimeout(passo, PASSO_MS); };
      timer = setTimeout(passo, 350);
    });
    card.addEventListener('mouseleave', () => { vez++; clearTimeout(timer); pos = 0; mostrarItem(0, vez); });
  });
}
