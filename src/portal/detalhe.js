/* Detalhe do produto (modal #mDet do portal antigo): galeria, preço, embalagem,
   quantidade, carrinho, Minha Lista, descrição (aplicação do G360) e características.
   Mesma regra única do cartão (cartao.js). */
import { esc, toast, abrirModal, fecharModal, passoQuantidade } from './comum.js';
import { podeComprar, htmlPreco, htmlEstoque, htmlUnidades, opcoesUnidade, unidadeEscolhida, linhaCarrinho } from './cartao.js';
import { adicionar } from '../estado/carrinho.js';
import { normalizarQuantidade } from '../ui/formato.js';
import { ligarFotos } from '../ui/fotos.js';

let atual = null;

const htmlFotoItem = (p, item, classe) => `<div class="foto ${classe}" data-produto="${Number(p.id)}" data-item="${Number(item)}" data-alt="${esc(p.nome)}"><span>Carregando…</span></div>`;

/** opcoes: { naLista: true|false|null, aoFavoritar: async (p, estava) => novoEstado, aoClip: fn|null } */
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
  const caract = [
    ['Código', p.codigo], ['Marca', typeof p.marca === 'object' ? p.marca?.nome : p.marca], ['Categoria', p.categoria],
    ['Unidade de venda', p.unidade], ...ops.slice(1).map((o) => ['Embalagem', `${o.nome}${o.descricao ? ` — ${o.descricao}` : ''}`]),
    p.kit ? ['Kit', 'Sim'] : null,
  ].filter((x) => x && x[1]);
  $id('detBox').innerHTML = `<div class="gal">
      <div class="gmain">${fotos.length ? htmlFotoItem(p, fotos[atual.foto] ?? fotos[0], 'g360-foto') : '<div class="foto vazia g360-foto"><span>Sem foto</span></div>'}
        ${fotos.length > 1 ? '<button class="gnav p" data-g="-1" aria-label="Foto anterior">‹</button><button class="gnav n" data-g="1" aria-label="Próxima foto">›</button>' : ''}</div>
      ${fotos.length > 1 ? `<div class="gthumbs">${fotos.map((f, k) => `<button type="button" class="gth ${k === atual.foto ? 'on' : ''}" data-k="${k}" aria-label="Foto ${k + 1}">${htmlFotoItem(p, f, '')}</button>`).join('')}</div>` : ''}
    </div>
    <div class="dinfo"><button class="x" id="dX" aria-label="Fechar">×</button>
      <div class="brand">${esc(typeof p.marca === 'object' ? p.marca?.nome || '' : p.marca || '')}</div>
      <h2>${esc(p.nome)}</h2>
      <div class="meta">Cód. ${esc(p.codigo)}${p.nome_g360 && p.nome_g360 !== p.nome ? ` · ${esc(p.nome_g360)}` : ''}</div>
      <div class="dprice">${comprar ? htmlPreco(unidadeEscolhida(p, atual.un)) : ''}</div>
      ${htmlEstoque(p)}
      ${htmlUnidades(p, atual.un, 'lg')}
      <div class="dbuy"><div class="qty"><button type="button" data-d="-1" aria-label="Diminuir" ${comprar ? '' : 'disabled'}>−</button><input id="dQ" type="text" inputmode="decimal" value="1" maxlength="13" aria-label="Quantidade" ${comprar ? '' : 'disabled'}><button type="button" data-d="1" aria-label="Aumentar" ${comprar ? '' : 'disabled'}>+</button></div>
        <button type="button" class="add" id="dAdd" ${comprar ? '' : 'disabled aria-disabled="true"'}><svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Adicionar ao carrinho</button>
        ${naLista === null || naLista === undefined ? '' : `<button type="button" class="dfav ${naLista ? 'on' : ''}" id="dFav" title="Minha Lista" aria-pressed="${naLista}">${naLista ? '★' : '☆'}</button>`}</div>
      ${atual.aoClip ? '<button type="button" class="dclip" id="dClip">▶ Ver clip deste produto</button>' : ''}
      ${p.aplicacao ? `<div class="dsec"><h4>Descrição</h4><p>${esc(p.aplicacao)}</p></div>` : ''}
      <div class="dsec"><h4>Características</h4><table class="ftab">${caract.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></div>
    </div>`;
  ligarFotos($id('detBox'));
}

const $id = (id) => document.getElementById(id);
let ligado = false;
export function ligarDetalhe() {
  if (ligado) return; ligado = true;
  $id('mDet').addEventListener('click', async (e) => {
    if (!atual) return;
    if (e.target === $id('mDet') || e.target.closest('#dX')) { fecharModal('mDet'); return; }
    const g = e.target.closest('[data-g]');
    const fotos = atual.p.fotos || [];
    if (g) { atual.foto = (atual.foto + Number(g.dataset.g) + fotos.length) % fotos.length; desenhar(); return; }
    const th = e.target.closest('[data-k]');
    if (th) { atual.foto = Number(th.dataset.k); desenhar(); return; }
    const un = e.target.closest('.unsel [data-un]');
    if (un) { const q = $id('dQ').value; atual.un = un.dataset.un; desenhar(); $id('dQ').value = q; return; }
    const d = e.target.closest('[data-d]');
    if (d) { $id('dQ').value = passoQuantidade($id('dQ').value, Number(d.dataset.d)); return; }
    if (e.target.closest('#dAdd')) {
      const q = normalizarQuantidade($id('dQ').value);
      if (!q) { toast('Quantidade inválida: use um número maior que zero, com até 4 casas depois da vírgula.'); return; }
      const r = adicionar(linhaCarrinho(atual.p, atual.un, q));
      if (r === 'limite') { toast('O carrinho aceita até 100 linhas. Envie este pedido ou remova itens.'); return; }
      toast(`${r === 'somado' ? 'Quantidade somada' : 'Adicionado ao carrinho'} · ${atual.p.nome.slice(0, 40)}`);
      fecharModal('mDet'); return;
    }
    if (e.target.closest('#dFav') && atual.aoFavoritar) {
      const b = $id('dFav'); b.disabled = true;
      try { atual.naLista = await atual.aoFavoritar(atual.p, atual.naLista); desenhar(); } catch (err) { toast(err.message); b.disabled = false; }
      return;
    }
    if (e.target.closest('#dClip')) { fecharModal('mDet'); atual.aoClip(); }
  });
}
