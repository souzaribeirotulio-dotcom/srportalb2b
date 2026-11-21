/* Fotos do catálogo (seção 6): a foto exige o Bearer, então é baixada com fetch
   pelo módulo da API e mostrada com URL.createObjectURL. Só as visíveis são
   carregadas; as baixadas (e as falhas) ficam guardadas em memória, e os
   endereços de objeto são liberados ao sair da tela. */
import { obterFotoProduto, urlFotoVitrine } from '../api/g360.js';
import { sessao } from '../estado/sessao.js';

const cache = new Map();      // "id/item" → Blob | 'falha' | { ate } (falha passageira) | Promise
// Foto que não existe (404) fica como 'falha' de vez. Falha passageira (limite de chamadas, servidor
// ocupado, rede) tenta de novo algumas vezes e, se ainda falhar, só fica de lado por 1 minuto:
// a próxima vez que a tela desenhar o produto, a foto é pedida de novo.
const TENTATIVAS = [3, 8, 20]; // segundos de espera entre as tentativas
const ESPERA_FALHA_MS = 60_000;
const dorme = (s) => new Promise((ok) => setTimeout(ok, s * 1000));
const definitiva = (e) => e?.status === 404 || e?.status === 400 || e?.status === 403;
async function baixar(id, item) {
  for (let t = 0; ; t++) {
    try { return await obterFotoProduto(sessao.token, id, item); } catch (e) {
      if (definitiva(e) || e?.status === 401 || t >= TENTATIVAS.length) throw e;
      await dorme(Math.max(TENTATIVAS[t], Number(e?.retryAfter) || 0));
    }
  }
}
function lerCache(chave) {
  const g = cache.get(chave);
  if (g && typeof g === 'object' && 'ate' in g) { if (Date.now() < g.ate) return 'falha'; cache.delete(chave); return undefined; }
  return g;
}
const guardarFalha = (chave, e) => cache.set(chave, definitiva(e) ? 'falha' : { ate: Date.now() + ESPERA_FALHA_MS });
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
    const guardado = lerCache(chave);
    if (guardado instanceof Blob) { mostrar(el, guardado); continue; }
    if (guardado === 'falha') { semFoto(el); continue; }
    emAndamento += 1;
    baixar(el.dataset.produto, el.dataset.item)
      .then((blob) => { cache.set(chave, blob); if (el.isConnected) mostrar(el, blob); })
      .catch((e) => { guardarFalha(chave, e); if (el.isConnected) semFoto(el); }) // espaço reservado, sem mensagem nem ocorrência
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
    const guardado = lerCache(chave);
    if (guardado instanceof Blob) { mostrar(el, guardado); return; }
    if (guardado === 'falha') { semFoto(el); return; }
    fila.push(el); proxima();
  };
  if (!('IntersectionObserver' in window)) { els.forEach(carregar); return; }
  if (!observador) {
    observador = new IntersectionObserver((entradas) => {
      // Cartão de um resultado antigo (a busca nova está chegando) não baixa foto: vai ser trocado.
      entradas.forEach((en) => { if (en.isIntersecting) { observador.unobserve(en.target); if (en.target.isConnected && !en.target.closest('.buscando')) carregar(en.target); } });
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

/* ---------- ao passar o mouse no card (como no portal antigo): a capa esmaece e a 2ª foto aparece;
   com 3 fotos, a 3ª entra do mesmo jeito em seguida. Pontinhos mostram qual está na tela.
   Produto com uma foto só ganha um leve zoom (só CSS). As fotos extras só são buscadas no primeiro hover. ---------- */
const PASSO_MS = 1600;
function blobDaFoto(id, item) {
  const chave = `${id}/${item}`;
  const g = lerCache(chave);
  if (g instanceof Blob) return Promise.resolve(g);
  if (g === 'falha') return Promise.reject(new Error('falha'));
  if (g instanceof Promise) return g;
  const p = baixar(id, item).then((b) => { cache.set(chave, b); return b; }, (e) => { guardarFalha(chave, e); throw e; });
  cache.set(chave, p);
  return p;
}

export function ligarTrocaFotos(raiz) {
  if (!window.matchMedia?.('(hover: hover)').matches) return;
  raiz.querySelectorAll('.foto[data-fotos]').forEach((el) => {
    const card = el.closest('.card, .ccard') || el;
    if (card.dataset.troca) return;
    card.dataset.troca = '1';
    const itens = el.dataset.fotos.split(',').map(Number);
    const publico = el.hasAttribute('data-publico');
    const caixa = el.closest('.img') || el;
    if (!caixa.querySelector('.dots')) caixa.insertAdjacentHTML('beforeend', `<span class="dots" aria-hidden="true">${itens.map(() => '<i></i>').join('')}</span>`);
    const extras = new Map(); // posição → <img> já montada
    let vez = 0; let timer = null;
    const marcar = (j) => { caixa.querySelectorAll('.dots i').forEach((d, k) => d.classList.toggle('on', k === j)); };
    marcar(0);
    const imgExtra = async (j) => {
      if (extras.has(j)) return extras.get(j);
      let src;
      if (publico) src = urlFotoVitrine(el.dataset.produto, itens[j]);
      else { const b = await blobDaFoto(el.dataset.produto, itens[j]); src = URL.createObjectURL(b); urlsDaTela.push(src); }
      const im = document.createElement('img');
      im.className = 'iextra'; im.alt = ''; im.decoding = 'async';
      if (publico) im.referrerPolicy = 'no-referrer';
      im.src = src;
      await new Promise((ok) => { if (im.complete) ok(); else { im.onload = ok; im.onerror = ok; } });
      extras.set(j, im); el.appendChild(im);
      return im;
    };
    const mostrar = async (j, eu) => {
      try {
        const im = await imgExtra(j); if (eu !== vez) return;
        void im.offsetWidth; // a transição de opacidade começa do zero
        el.querySelectorAll('img.iextra').forEach((x) => x.classList.toggle('on', x === im));
        el.classList.add('troca'); marcar(j);
      } catch { /* sem a foto extra: fica a atual */ }
    };
    card.addEventListener('mouseenter', () => {
      const eu = ++vez;
      mostrar(1, eu).then(() => { if (itens.length > 2 && eu === vez) timer = setTimeout(() => mostrar(2, eu), PASSO_MS); });
    });
    card.addEventListener('mouseleave', () => {
      vez++; clearTimeout(timer);
      el.classList.remove('troca'); el.querySelectorAll('img.iextra').forEach((x) => x.classList.remove('on')); marcar(0);
    });
  });
}
