/* =====================================================================
   Clips: feed de vídeos verticais dos produtos (como no portal antigo).
   Os vídeos ficam no Storage do Supabase (bucket público portal-clips) e a
   lista na tabela portal_clips (leitura pública só dos ativos). Preço,
   compra e disponibilidade vêm da API na hora (regra única do cartao.js);
   visitante vê o produto com "Entre para ver os preços".
   ===================================================================== */
import { supabaseComprador, supabaseConfigurado, LOJA } from '../api/supabase.js';
import { listarProdutos, listarVitrine, urlVitrine } from '../api/g360.js';
import { sessao } from '../estado/sessao.js';
import { apresentar, carregarExibicao, oculto } from '../catalogo/exibicao.js';
import { $, esc, toast, passoQuantidade } from './comum.js';
import { podeComprar, htmlPreco, htmlEstoque, opcoesUnidade, linhaCarrinho } from './cartao.js';
import { adicionar } from '../estado/carrinho.js';
import { normalizarQuantidade } from '../ui/formato.js';
import { htmlFoto, ligarFotos } from '../ui/fotos.js';
import { htmlDisponivel, conferir, somar } from './estoque.js';

const URL_SUPABASE = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
export const urlClip = (caminho) => `${URL_SUPABASE}/storage/v1/object/public/portal-clips/${caminho.split('/').map(encodeURIComponent).join('/')}`;

/** Embaralha uma cópia da lista (Fisher-Yates). */
function embaralhar(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

let lista = null; // [{id, produto_id, codigo, titulo, caminho}]
let observador = null;
let mudo = true;
let opcoes = {};

/** Clips ativos (cache da sessão da página). */
let listaEm = 0;
export async function carregarClips(forcar = false) {
  if (lista && !forcar && Date.now() - listaEm < 120_000) return lista;
  if (!supabaseConfigurado()) { lista = []; return lista; }
  const { data, error } = await supabaseComprador().from('portal_clips').select('id, produto_id, codigo, titulo, caminho')
    .eq('loja', LOJA).order('criado_em', { ascending: false }).limit(200);
  if (error) throw new Error('Os clips estão indisponíveis no momento. Tente de novo em instantes.');
  lista = data || []; listaEm = Date.now();
  return lista;
}

/** Primeiro clip de um produto (para o botão "Ver clip" na janela de detalhes). */
export function clipDoProduto(p) {
  return lista?.find((c) => Number(c.produto_id) === Number(p?.id)) || null;
}

/* Altura do feed = o que sobra da tela visível entre o cabeçalho e a barra de abas.
   No celular usa a área visível de verdade (visualViewport), que muda quando a barra do navegador
   aparece ou some, e a página não rola: o clip fica sempre inteiro, sem cortar em cima nem sobrar embaixo. */
function tamanho() {
  const f = $('clipsFeed'); if (!f) return;
  const celular = window.innerWidth <= 640;
  const header = document.querySelector('header');
  const tab = document.querySelector('.tabbar');
  if (celular) {
    // No celular o feed fica preso na tela (CSS), entre o cabeçalho e as abas: só passamos onde eles estão.
    if (window.scrollY) window.scrollTo(0, 0);
    const alto = window.innerHeight;
    const topo = header ? Math.max(0, Math.round(header.getBoundingClientRect().bottom)) : 0;
    const baixo = tab && getComputedStyle(tab).display !== 'none' ? Math.max(0, Math.round(alto - tab.getBoundingClientRect().top)) : 0;
    document.body.style.setProperty('--clips-topo', `${topo}px`);
    document.body.style.setProperty('--clips-baixo', `${baixo}px`);
    if (!observaBordas && 'ResizeObserver' in window) {
      observaBordas = new ResizeObserver(() => { if (!$('vClips').hidden) tamanho(); });
      [header, tab].filter(Boolean).forEach((el) => observaBordas.observe(el));
    }
    return;
  }
  const h = window.innerHeight - (header?.offsetHeight || 0) - 24;
  f.style.setProperty('--ch', `${Math.max(420, h)}px`);
}
let observaBordas = null;

export function pausarClips() {
  document.querySelectorAll('#clipsFeed video').forEach((v) => v.pause());
}

function htmlCard(p) {
  const comprar = sessao.ativa && podeComprar(p);
  const capa = !sessao.ativa && p.imagem ? urlVitrine(p.imagem) : null;
  return `${sessao.ativa ? `<div class="cimgw" data-a="ver">${htmlFoto(p, 'g360-foto')}</div>` : (capa ? `<img src="${esc(capa)}" alt="" referrerpolicy="no-referrer" data-a="ver">` : '<div class="cimgw" data-a="ver"></div>')}
        <div><div class="cn" data-a="ver">${esc(p.nome)}</div>${comprar ? `<div class="cp">${htmlPreco(opcoesUnidade(p)[0])}</div>` : ''}${sessao.ativa ? htmlEstoque(p) + htmlDisponivel(p) : ''}</div>
        ${sessao.ativa
    ? `<div class="cb"><div class="qty"><button type="button" data-d="-1" ${comprar ? '' : 'disabled'} aria-label="Diminuir">−</button><input type="text" inputmode="decimal" value="1" maxlength="13" aria-label="Quantidade" ${comprar ? '' : 'disabled'}><button type="button" data-d="1" ${comprar ? '' : 'disabled'} aria-label="Aumentar">+</button></div>
            <button type="button" class="add" data-a="add" ${comprar ? '' : 'disabled'}><svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Adicionar</button></div>`
    : '<div class="cb"><button type="button" class="lockp" style="margin:0" data-a="entrar">Entre para ver os preços</button></div>'}`;
}

function htmlLado(p) {
  const naLista = sessao.ativa ? opcoes.naLista?.(p) : null;
  return `${naLista === null || naLista === undefined ? '' : `<div><button type="button" class="cbtn ${naLista ? 'on' : ''}" data-a="fav" aria-label="Minha Lista">★</button><small>Lista</small></div>`}
        <div><button type="button" class="cbtn" data-a="ver" aria-label="Ver detalhes">👁</button><small>Detalhes</small></div>`;
}

/** Começa a baixar o vídeo (o 1º já com dados para tocar; o seguinte só o começo). */
function preparar(v, como) {
  if (!v || v.src) return;
  v.preload = como; v.src = v.dataset.src;
}

let desenhoN = 0;
/** opcoes: { exigirLogin(fn), abrirDetalhe(p), alternarLista(p) → Promise<bool>, naLista(p) → bool|null }
 *  Os vídeos aparecem e começam a tocar logo; os cartões dos produtos (preço, estoque) chegam em seguida. */
export async function desenharClips(abrirId, op = {}) {
  opcoes = op;
  const meu = ++desenhoN;
  const f = $('clipsFeed');
  tamanho();
  if (observador) observador.disconnect();
  f.innerHTML = '<div class="cempty"><div>Carregando os clips…</div></div>';
  const erro = (e) => {
    f.innerHTML = `<div class="cempty"><div><b style="font-size:16px;color:var(--tx)">Não foi possível carregar os clips.</b><br>${esc(e?.message || 'Confira a conexão e tente de novo.')}<br><button type="button" class="tool" id="cTentar" style="margin-top:12px">Tentar de novo</button></div></div>`;
    $('cTentar').onclick = () => desenharClips(abrirId, opcoes);
  };
  let clips;
  try { clips = await carregarClips(); } catch (e) { if (meu === desenhoN) erro(e); return; }
  if (meu !== desenhoN) return;
  // Ordem aleatória a cada vez que o cliente abre o Clips; o clip pedido (botão "Ver clip" do produto) vem primeiro.
  const itens = embaralhar(clips);
  const pedido = abrirId ? itens.findIndex((c) => String(c.id) === String(abrirId)) : -1;
  if (pedido > 0) itens.unshift(...itens.splice(pedido, 1));
  if (!itens.length) {
    f.innerHTML = '<div class="cempty"><div><b style="font-size:18px;color:var(--tx)">Nenhum clip ainda</b><br>Os vídeos dos produtos aparecem aqui.</div></div>';
    return;
  }
  // Produtos (preço, estoque, se aparece no portal) em paralelo com o vídeo.
  const ids = [...new Set(itens.map((c) => Number(c.produto_id)))];
  const produtosP = (async () => {
    await carregarExibicao();
    const partes = [];
    for (let i = 0; i < ids.length; i += 50) partes.push(ids.slice(i, i + 50));
    const res = await Promise.all(partes.map((parte) => (sessao.ativa ? listarProdutos(sessao.token, { ids: parte, limite: 50 }) : listarVitrine({ ids: parte, limite: 50 }))));
    const m = new Map(); res.forEach(({ dados }) => dados.forEach((p) => m.set(Number(p.id), apresentar(p))));
    return m;
  })();
  f._produtos = new Map();
  f.innerHTML = itens.map((c, i) => `<section class="clip paused" data-id="${esc(c.id)}" data-p="${Number(c.produto_id)}">
      <video playsinline loop muted preload="none" data-src="${esc(urlClip(c.caminho))}"></video><div class="grad"></div><div class="cbar"><i></i></div>
      <div class="cpause"><span>▶</span></div>
      <div class="ctop"><b>Clips <em>SR</em> <small class="cnum" style="font-size:11px;font-weight:600;color:var(--tx2)">${i + 1}/${itens.length}</small></b><button type="button" class="cbtn" data-a="mute" aria-label="Som">${mudo ? '🔇' : '🔊'}</button></div>
      <div class="cside"></div>
      ${c.titulo ? `<div class="cttl">${esc(c.titulo)}</div>` : ''}
      <div class="ccard ccarga"><div class="cimgw"></div><div><div class="cn">Carregando o produto…</div></div></div></section>`).join('');
  observador = new IntersectionObserver((es) => es.forEach((en) => {
    const s = en.target; const v = s.querySelector('video');
    if (en.isIntersecting) {
      preparar(v, 'auto');
      v.muted = mudo;
      v.play().then(() => s.classList.remove('paused')).catch(() => s.classList.add('paused'));
      preparar(s.nextElementSibling?.querySelector('video'), 'metadata'); // o próximo já fica pronto para a troca
    } else if (v.src) {
      // Como nos apps de vídeo: saiu da tela, volta para o começo. Ao rolar de volta, recomeça do zero.
      v.pause();
      try { v.currentTime = 0; } catch { /* ainda sem dados: já começa do zero */ }
      const bar = s.querySelector('.cbar i'); if (bar) bar.style.width = '0%';
    }
  }), { root: f, threshold: 0.65 });
  f.querySelectorAll('.clip').forEach((s) => {
    observador.observe(s);
    const v = s.querySelector('video'); const bar = s.querySelector('.cbar i');
    v.ontimeupdate = () => { bar.style.width = `${(v.currentTime / (v.duration || 1)) * 100}%`; };
    v.onpause = () => s.classList.add('paused'); v.onplay = () => s.classList.remove('paused');
    v.onerror = () => { s.classList.add('paused'); };
  });
  preparar(f.querySelector('.clip video'), 'auto');
  f.scrollTop = 0;

  let produtos;
  try { produtos = await produtosP; } catch (e) { if (meu === desenhoN) erro(e); return; }
  if (meu !== desenhoN) return;
  f._produtos = produtos;
  // Só clips de produtos que o cliente pode ver (fora do catálogo ou ocultos saem do feed).
  f.querySelectorAll('.clip').forEach((s) => {
    const p = produtos.get(Number(s.dataset.p));
    if (!p || oculto(p)) { observador.unobserve(s); s.querySelector('video')?.pause(); s.remove(); return; }
    const card = s.querySelector('.ccard'); card.classList.remove('ccarga'); card.innerHTML = htmlCard(p);
    s.querySelector('.cside').innerHTML = htmlLado(p);
  });
  const ficaram = [...f.querySelectorAll('.clip')];
  if (!ficaram.length) { f.innerHTML = '<div class="cempty"><div><b style="font-size:18px;color:var(--tx)">Nenhum clip ainda</b><br>Os vídeos dos produtos aparecem aqui.</div></div>'; return; }
  ficaram.forEach((s, i) => { const n = s.querySelector('.cnum'); if (n) n.textContent = `${i + 1}/${ficaram.length}`; });
  preparar(ficaram[0].querySelector('video'), 'auto');
  if (sessao.ativa) ligarFotos(f);
}

let ligado = false;
export function ligarClips() {
  if (ligado) return; ligado = true;
  const f = $('clipsFeed');
  f.addEventListener('click', async (e) => {
    const s = e.target.closest('.clip'); if (!s) return;
    const p = f._produtos?.get(Number(s.dataset.p)); const v = s.querySelector('video');
    const a = e.target.closest('[data-a]')?.dataset.a;
    const d = e.target.closest('[data-d]');
    if (d) { const i = s.querySelector('.qty input'); const r = somar(p, '', normalizarQuantidade(i.value) || '1', normalizarQuantidade(passoQuantidade(i.value, Number(d.dataset.d))) || '1'); i.value = String(r.valor).replace('.', ','); if (r.msg) toast(r.msg); return; }
    if (e.target.closest('.qty')) return;
    if (a === 'mute') { mudo = !mudo; f.querySelectorAll('video').forEach((x) => { x.muted = mudo; }); f.querySelectorAll('[data-a=mute]').forEach((b) => { b.textContent = mudo ? '🔇' : '🔊'; }); return; }
    if (a === 'entrar') { opcoes.exigirLogin?.(() => desenharClips(s.dataset.id, opcoes)); return; }
    if (a === 'ver') { v.pause(); if (sessao.ativa) opcoes.abrirDetalhe?.(p); else opcoes.exigirLogin?.(() => desenharClips(s.dataset.id, opcoes)); return; }
    if (a === 'fav') {
      const b = e.target.closest('.cbtn'); b.disabled = true;
      try { const agora = await opcoes.alternarLista?.(p); b.classList.toggle('on', agora === true); } catch (err) { toast(err.message); } finally { b.disabled = false; }
      return;
    }
    if (a === 'add') {
      const q = normalizarQuantidade(s.querySelector('.qty input').value);
      if (!q) { toast('Quantidade inválida: use um número maior que zero, com até 4 casas depois da vírgula.'); return; }
      const semSaldo = conferir(p, '', q); if (semSaldo) { toast(semSaldo); return; }
      const r = adicionar(linhaCarrinho(p, '', q));
      if (r === 'limite') { toast('O carrinho aceita até 100 linhas. Envie este pedido ou remova itens.'); return; }
      toast(`${r === 'somado' ? 'Quantidade somada' : 'Adicionado'} · ${p.nome.slice(0, 40)}`);
      return;
    }
    if (e.target.closest('.ccard')) return;
    if (v.paused) { if (!v.src) v.src = v.dataset.src; v.play().catch(() => {}); } else v.pause();
  });
  const passo = (n) => f.scrollBy({ top: n * f.clientHeight, behavior: 'smooth' });
  $('cUp').onclick = () => passo(-1); $('cDn').onclick = () => passo(1);
  document.addEventListener('keydown', (e) => {
    if ($('vClips').hidden || document.querySelector('.mod.open')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); passo(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); passo(-1); }
  });
  const ajustar = () => { if (!$('vClips').hidden) tamanho(); };
  window.addEventListener('resize', ajustar);
  window.addEventListener('orientationchange', () => setTimeout(ajustar, 300));
  window.visualViewport?.addEventListener('resize', ajustar);
}
