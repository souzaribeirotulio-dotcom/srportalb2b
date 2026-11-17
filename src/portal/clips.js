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
const urlClip = (caminho) => `${URL_SUPABASE}/storage/v1/object/public/portal-clips/${caminho.split('/').map(encodeURIComponent).join('/')}`;

let lista = null; // [{id, produto_id, codigo, titulo, caminho}]
let observador = null;
let mudo = true;
let opcoes = {};

/** Clips ativos (cache da sessão da página). */
export async function carregarClips(forcar = false) {
  if (lista && !forcar) return lista;
  if (!supabaseConfigurado()) { lista = []; return lista; }
  const { data, error } = await supabaseComprador().from('portal_clips').select('id, produto_id, codigo, titulo, caminho')
    .eq('loja', LOJA).order('criado_em', { ascending: false }).limit(200);
  if (error) throw new Error('Os clips estão indisponíveis no momento. Tente de novo em instantes.');
  lista = data || [];
  return lista;
}

/** Primeiro clip de um produto (para o botão "Ver clip" na janela de detalhes). */
export function clipDoProduto(p) {
  return lista?.find((c) => Number(c.produto_id) === Number(p?.id)) || null;
}

function tamanho() {
  const h = window.innerHeight - (document.querySelector('header')?.offsetHeight || 0)
    - (getComputedStyle(document.querySelector('.tabbar')).display !== 'none' ? document.querySelector('.tabbar').offsetHeight : 0)
    - (window.innerWidth > 640 ? 24 : 0);
  $('clipsFeed').style.setProperty('--ch', `${Math.max(420, h)}px`);
}

export function pausarClips() {
  document.querySelectorAll('#clipsFeed video').forEach((v) => v.pause());
}

/** opcoes: { exigirLogin(fn), abrirDetalhe(p), alternarLista(p) → Promise<bool>, naLista(p) → bool|null } */
export async function desenharClips(abrirId, op = {}) {
  opcoes = op;
  const f = $('clipsFeed');
  tamanho();
  if (observador) observador.disconnect();
  f.innerHTML = '<div class="cempty"><div>Carregando os clips…</div></div>';
  let clips; let produtos = new Map();
  try {
    await carregarExibicao();
    clips = await carregarClips(true);
    const ids = [...new Set(clips.map((c) => Number(c.produto_id)))];
    for (let i = 0; i < ids.length; i += 50) {
      const parte = ids.slice(i, i + 50);
      const { dados } = sessao.ativa ? await listarProdutos(sessao.token, { ids: parte, limite: 50 }) : await listarVitrine({ ids: parte, limite: 50 });
      dados.forEach((p) => produtos.set(Number(p.id), apresentar(p)));
    }
  } catch (e) {
    f.innerHTML = `<div class="cempty"><div><b style="font-size:16px;color:var(--tx)">Não foi possível carregar os clips.</b><br>${esc(e.message || 'Confira a conexão e tente de novo.')}<br><button type="button" class="tool" id="cTentar" style="margin-top:12px">Tentar de novo</button></div></div>`;
    $('cTentar').onclick = () => desenharClips(abrirId, opcoes);
    return;
  }
  // Só clips de produtos que o cliente pode ver (fora do catálogo ou ocultos não aparecem).
  const itens = clips.filter((c) => produtos.has(Number(c.produto_id)) && !oculto(produtos.get(Number(c.produto_id))));
  if (!itens.length) {
    f.innerHTML = '<div class="cempty"><div><b style="font-size:18px;color:var(--tx)">Nenhum clip ainda</b><br>Os vídeos dos produtos aparecem aqui.</div></div>';
    return;
  }
  f._produtos = produtos;
  f.innerHTML = itens.map((c, i) => {
    const p = produtos.get(Number(c.produto_id));
    const comprar = sessao.ativa && podeComprar(p);
    const naLista = sessao.ativa ? opcoes.naLista?.(p) : null;
    const capa = !sessao.ativa && p.imagem ? urlVitrine(p.imagem) : null;
    return `<section class="clip paused" data-id="${esc(c.id)}" data-p="${Number(p.id)}">
      <video playsinline loop muted preload="none" data-src="${esc(urlClip(c.caminho))}"></video><div class="grad"></div><div class="cbar"><i></i></div>
      <div class="cpause"><span>▶</span></div>
      <div class="ctop"><b>Clips <em>SR</em> <small style="font-size:11px;font-weight:600;color:var(--tx2)">${i + 1}/${itens.length}</small></b><button type="button" class="cbtn" data-a="mute" aria-label="Som">${mudo ? '🔇' : '🔊'}</button></div>
      <div class="cside">${naLista === null || naLista === undefined ? '' : `<div><button type="button" class="cbtn ${naLista ? 'on' : ''}" data-a="fav" aria-label="Minha Lista">★</button><small>Lista</small></div>`}
        <div><button type="button" class="cbtn" data-a="ver" aria-label="Ver detalhes">👁</button><small>Detalhes</small></div></div>
      ${c.titulo ? `<div class="cttl">${esc(c.titulo)}</div>` : ''}
      <div class="ccard">${sessao.ativa ? `<div class="cimgw" data-a="ver">${htmlFoto(p, 'g360-foto')}</div>` : (capa ? `<img src="${esc(capa)}" alt="" referrerpolicy="no-referrer" data-a="ver">` : '<div class="cimgw" data-a="ver"></div>')}
        <div><div class="cn" data-a="ver">${esc(p.nome)}</div>${comprar ? `<div class="cp">${htmlPreco(opcoesUnidade(p)[0])}</div>` : ''}${sessao.ativa ? htmlEstoque(p) + htmlDisponivel(p, '') : ''}</div>
        ${sessao.ativa
    ? `<div class="cb"><div class="qty"><button type="button" data-d="-1" ${comprar ? '' : 'disabled'} aria-label="Diminuir">−</button><input type="text" inputmode="decimal" value="1" maxlength="13" aria-label="Quantidade" ${comprar ? '' : 'disabled'}><button type="button" data-d="1" ${comprar ? '' : 'disabled'} aria-label="Aumentar">+</button></div>
            <button type="button" class="add" data-a="add" ${comprar ? '' : 'disabled'}><svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Adicionar</button></div>`
    : '<div class="cb"><button type="button" class="lockp" style="margin:0" data-a="entrar">Entre para ver os preços</button></div>'}
      </div></section>`;
  }).join('');
  if (sessao.ativa) ligarFotos(f);
  observador = new IntersectionObserver((es) => es.forEach((en) => {
    const s = en.target; const v = s.querySelector('video');
    if (en.isIntersecting) {
      if (!v.src) v.src = v.dataset.src;
      v.muted = mudo;
      v.play().then(() => s.classList.remove('paused')).catch(() => s.classList.add('paused'));
    } else v.pause();
  }), { root: f, threshold: 0.65 });
  f.querySelectorAll('.clip').forEach((s) => {
    observador.observe(s);
    const v = s.querySelector('video'); const bar = s.querySelector('.cbar i');
    v.ontimeupdate = () => { bar.style.width = `${(v.currentTime / (v.duration || 1)) * 100}%`; };
    v.onpause = () => s.classList.add('paused'); v.onplay = () => s.classList.remove('paused');
    v.onerror = () => { s.classList.add('paused'); };
  });
  const alvo = abrirId && f.querySelector(`.clip[data-id="${CSS.escape(abrirId)}"]`);
  f.scrollTop = alvo ? alvo.offsetTop : 0;
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
  window.addEventListener('resize', () => { if (!$('vClips').hidden) tamanho(); });
}
