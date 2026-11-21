/* Detalhe do produto (modal #mDet do portal antigo): galeria, preço, embalagem,
   quantidade, carrinho, Minha Lista, descrição (aplicação do G360) e características.
   Mesma regra única do cartão (cartao.js). */
import { esc, toast, abrirModal, fecharModal, passoQuantidade } from './comum.js';
import { podeComprar, htmlPreco, htmlEstoque, htmlUnidades, opcoesUnidade, unidadeEscolhida, linhaCarrinho } from './cartao.js';
import { adicionar } from '../estado/carrinho.js';
import { normalizarQuantidade } from '../ui/formato.js';
import { ligarFotos } from '../ui/fotos.js';
import { registro } from '../catalogo/exibicao.js';
import { htmlDisponivel, conferir, somar } from './estoque.js';
import { fichaDoProduto } from '../catalogo/descricoes.js';

let atual = null;

const htmlFotoItem = (p, item, classe) => `<div class="foto ${classe}" data-produto="${Number(p.id)}" data-item="${Number(item)}" data-alt="${esc(p.nome)}"><span>Carregando…</span></div>`;

/** Quantos slides tem a galeria: as fotos e, no fim, o vídeo do produto (quando houver clip). */
const totalSlides = () => (atual.p.fotos || []).length + (atual.videoUrl ? 1 : 0);
const htmlVideo = () => `<div class="foto g360-foto dvideo"><video src="${esc(atual.videoUrl)}" controls playsinline muted autoplay loop preload="metadata" aria-label="Vídeo do produto"></video></div>`;

/** opcoes: { videoUrl: url do clip|null, naLista: true|false|null, aoFavoritar: async (p, estava) => novoEstado, aoClip: fn|null, aoNegociar: fn(p, op, qtd)|null } */
export function abrirDetalhe(p, opcoes = {}) {
  atual = { p, un: '', foto: 0, ...opcoes };
  desenhar();
  abrirModal('mDet');
}

function desenhar() {
  const { p, naLista } = atual;
  const fotos = Array.isArray(p.fotos) ? p.fotos : [];
  const comprar = podeComprar(p);
  const ops = opcoesUnidade(p);
  const ficha = fichaDoProduto(p, registro(p));
  const caract = [...ficha.caracteristicas, ...ops.slice(1).map((o) => ['Embalagem disponível', `${o.nome}${o.descricao ? ` — ${o.descricao}` : ''}`])];
  $id('detBox').innerHTML = `<div class="gal">
      <div class="gmain">${atual.videoUrl && atual.foto === fotos.length ? htmlVideo() : fotos.length ? htmlFotoItem(p, fotos[atual.foto] ?? fotos[0], 'g360-foto') : '<div class="foto vazia g360-foto"><span>Sem foto</span></div>'}
        ${totalSlides() > 1 ? '<button class="gnav p" data-g="-1" aria-label="Anterior">‹</button><button class="gnav n" data-g="1" aria-label="Próxima">›</button>' : ''}</div>
      ${totalSlides() > 1 ? `<div class="gthumbs">${fotos.map((f, k) => `<button type="button" class="gth ${k === atual.foto ? 'on' : ''}" data-k="${k}" aria-label="Foto ${k + 1}">${htmlFotoItem(p, f, '')}</button>`).join('')}${atual.videoUrl ? `<button type="button" class="gth gvid ${atual.foto === fotos.length ? 'on' : ''}" data-k="${fotos.length}" aria-label="Vídeo do produto">▶</button>` : ''}</div>` : ''}
    </div>
    <div class="dinfo"><button class="x" id="dX" aria-label="Fechar">×</button>
      <div class="brand">${esc(typeof p.marca === 'object' ? p.marca?.nome || '' : p.marca || '')}</div>
      <h2>${esc(p.nome)}</h2>
      <div class="meta">Cód. ${esc(p.codigo)}${ficha.ean ? ` · EAN ${esc(ficha.ean)}` : ''}</div>
      <div class="dprice">${comprar ? htmlPreco(unidadeEscolhida(p, atual.un), opcoesUnidade(p).length > 1) : ''}</div>
      ${htmlEstoque(p)}
      ${htmlDisponivel(p)}
      ${htmlUnidades(p, atual.un, 'lg')}
      <div class="dbuy"><div class="qty"><button type="button" data-d="-1" aria-label="Diminuir" ${comprar ? '' : 'disabled'}>−</button><input id="dQ" type="text" inputmode="decimal" value="1" maxlength="13" aria-label="Quantidade" ${comprar ? '' : 'disabled'}><button type="button" data-d="1" aria-label="Aumentar" ${comprar ? '' : 'disabled'}>+</button></div>
        <button type="button" class="add" id="dAdd" ${comprar ? '' : 'disabled aria-disabled="true"'}><svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Adicionar ao carrinho</button>
        ${naLista === null || naLista === undefined ? '' : `<button type="button" class="dfav ${naLista ? 'on' : ''}" id="dFav" title="Minha Lista" aria-pressed="${naLista}">${naLista ? '★' : '☆'}</button>`}</div>
      ${atual.aoClip ? '<button type="button" class="dclip" id="dClip">▶ Ver clip deste produto</button>' : ''}
      ${atual.aoNegociar && comprar ? '<button type="button" class="dclip" id="dNegociar">🤝 Negociar preço</button>' : ''}
      <div class="dsec"><h4>Descrição</h4><p>${esc(ficha.texto)}</p></div>
      <div class="dsec"><h4>Características</h4><table class="ftab">${caract.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></div>
    </div>`;
  ligarFotos($id('detBox'));
}

const $id = (id) => document.getElementById(id);
/** Fecha a janela e para o vídeo, se estiver tocando. */
function fechar() { $id('detBox')?.querySelector('video')?.pause(); fecharModal('mDet'); }
let ligado = false;
export function ligarDetalhe() {
  if (ligado) return; ligado = true;
  // Fechou a janela por qualquer caminho (Esc, fundo, botão): o vídeo para.
  new MutationObserver(() => { if (!$id('mDet').classList.contains('open')) $id('detBox')?.querySelector('video')?.pause(); })
    .observe($id('mDet'), { attributes: true, attributeFilter: ['class'] });
  // Deslizar a foto para o lado troca de foto (celular e mouse); arrastar na vertical continua rolando a tela.
  let toque = null;
  $id('mDet').addEventListener('pointerdown', (e) => {
    if (!atual || totalSlides() < 2 || !e.target.closest('.gmain') || e.target.closest('[data-g]') || e.target.closest('video')) return;
    toque = { x: e.clientX, y: e.clientY };
  });
  const soltar = (e) => {
    if (!toque || !atual) { toque = null; return; }
    const dx = e.clientX - toque.x; const dy = e.clientY - toque.y; toque = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const n = totalSlides();
    atual.foto = (atual.foto + (dx < 0 ? 1 : -1) + n) % n; desenhar();
  };
  $id('mDet').addEventListener('pointerup', soltar);
  $id('mDet').addEventListener('pointercancel', () => { toque = null; });
  $id('mDet').addEventListener('click', async (e) => {
    if (!atual) return;
    if (e.target === $id('mDet') || e.target.closest('#dX')) { fechar(); return; }
    const g = e.target.closest('[data-g]');
    if (g) { const n = totalSlides(); atual.foto = (atual.foto + Number(g.dataset.g) + n) % n; desenhar(); return; }
    const th = e.target.closest('[data-k]');
    if (th) { atual.foto = Number(th.dataset.k); desenhar(); return; }
    const un = e.target.closest('.unsel [data-un]');
    if (un) { const q = $id('dQ').value; atual.un = un.dataset.un; desenhar(); $id('dQ').value = q; return; }
    const d = e.target.closest('[data-d]');
    if (d) {
      const r = somar(atual.p, atual.un, normalizarQuantidade($id('dQ').value) || '1', normalizarQuantidade(passoQuantidade($id('dQ').value, Number(d.dataset.d))) || '1');
      $id('dQ').value = String(r.valor).replace('.', ','); if (r.msg) toast(r.msg);
      return;
    }
    if (e.target.closest('#dAdd')) {
      const q = normalizarQuantidade($id('dQ').value);
      if (!q) { toast('Quantidade inválida: use um número maior que zero, com até 4 casas depois da vírgula.'); return; }
      const semSaldo = conferir(atual.p, atual.un, q); if (semSaldo) { toast(semSaldo); return; }
      const r = adicionar(linhaCarrinho(atual.p, atual.un, q));
      if (r === 'limite') { toast('O carrinho aceita até 100 linhas. Envie este pedido ou remova itens.'); return; }
      toast(`${r === 'somado' ? 'Quantidade somada' : 'Adicionado ao carrinho'} · ${atual.p.nome.slice(0, 40)}`);
      fechar(); return;
    }
    if (e.target.closest('#dFav') && atual.aoFavoritar) {
      const b = $id('dFav'); b.disabled = true;
      try { atual.naLista = await atual.aoFavoritar(atual.p, atual.naLista); desenhar(); } catch (err) { toast(err.message); b.disabled = false; }
      return;
    }
    if (e.target.closest('#dClip')) { fechar(); atual.aoClip(); }
    if (e.target.closest('#dNegociar')) { const q = normalizarQuantidade($id('dQ').value) || '1'; fechar(); atual.aoNegociar(atual.p, unidadeEscolhida(atual.p, atual.un), q); }
  });
}
