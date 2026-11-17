/* Cartão de produto no layout original.
   REGRA ÚNICA de compra (vale para catálogo, Minha Lista e qualquer tela que use estas funções):
   - compravel: true  → mostra o preço e libera o botão. Se disponibilidade = "sob_consulta",
                        só o selo discreto "Disponibilidade a confirmar";
   - compravel: false → botão desligado e o "aviso" exatamente como veio da API;
   - nenhum texto próprio para esses casos e nada derivado de faixa_disponibilidade (só informativa).
   - "seu_preco" preenchido = selo "Seu preço", sem preço riscado;
   - fotos só pela lista fotos[] (vazia = espaço reservado). */
import { esc } from './comum.js';
import { dinheiro } from '../ui/formato.js';
import { htmlFoto } from '../ui/fotos.js';
import { htmlDisponivel } from './estoque.js';

export function opcoesUnidade(p) {
  const base = { id: '', nome: p.unidade || 'UN', descricao: '', preco: p.preco, seu_preco: p.seu_preco ?? null, quantidade_disponivel: p.quantidade_disponivel ?? null };
  return [base, ...(p.unidades || []).map((u) => ({ id: u.id, nome: u.nome, descricao: u.descricao, preco: u.preco, seu_preco: u.seu_preco ?? null, quantidade_disponivel: u.quantidade_disponivel ?? null }))];
}

export function podeComprar(p) {
  return p?.compravel === true;
}

export function htmlPreco(op) {
  if (op.preco === null || op.preco === undefined) return '';
  return `<b>${esc(dinheiro(op.preco))}</b><small>/ ${esc(String(op.nome).toLowerCase())}</small>${op.seu_preco ? '<span class="tagcg">Seu preço</span>' : ''}`;
}

/** Selo e aviso da regra única: selo só para comprável sob consulta; aviso só para não comprável, como veio. */
export function htmlEstoque(p) {
  if (podeComprar(p)) return p.disponibilidade === 'sob_consulta' ? '<div class="stk low">Disponibilidade a confirmar</div>' : '';
  return p?.aviso ? `<div class="warn">${esc(p.aviso)}</div>` : '';
}

export function htmlUnidades(p, sel = '', cls = '') {
  const ops = opcoesUnidade(p);
  if (ops.length < 2) return '';
  return `<div class="unsel ${cls}" role="group" aria-label="Embalagem">${ops.map((o) =>
    `<button type="button" data-un="${esc(o.id)}" class="${o.id === (sel || '') ? 'on' : ''}" title="${esc(o.descricao || o.nome)}">${esc(o.nome)}${o.descricao ? ` <small>${esc(o.descricao)}</small>` : ''}</button>`).join('')}</div>`;
}

/** Cartão completo. naLista: true/false/null (null = Minha Lista indisponível, sem botão). */
export function htmlCartao(p, { naLista = null } = {}) {
  const comprar = podeComprar(p);
  const ops = opcoesUnidade(p);
  return `
  <article class="card" data-id="${Number(p.id)}" data-un="">
    <div class="img">${p.categoria ? `<span class="cat">${esc(p.categoria)}</span>` : ''}
      ${htmlFoto(p, 'g360-foto')}
      <button type="button" class="eye" title="Ver detalhes" aria-label="Ver detalhes de ${esc(p.nome)}"><svg class="ic" viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button>
      ${naLista === null ? '' : `<button type="button" class="fav ${naLista ? 'on' : ''}" aria-pressed="${naLista}" title="Minha Lista">${naLista ? '⭐ Na lista' : '☆ Lista'}</button>`}
    </div>
    <div class="info">
      <div class="brand">${esc(p.marca || '')}${ops.length > 1 ? `<span class="tagcx">${esc(ops[1].nome)} disponível</span>` : ''}</div>
      <div class="name" title="${esc(p.nome_g360 || p.nome)}">${esc(p.nome)}</div>
      <div class="meta">Cód. ${esc(p.codigo)} · ${esc(p.unidade || '')}</div>
      <div class="price">${htmlPreco(ops[0])}</div>
      ${htmlEstoque(p)}
      <div class="dispw">${htmlDisponivel(p, '')}</div>
      ${htmlUnidades(p)}
      <div class="buy">
        <div class="qty"><button type="button" data-d="-1" aria-label="Diminuir" ${comprar ? '' : 'disabled'}>−</button><input type="text" inputmode="decimal" value="1" maxlength="13" aria-label="Quantidade" ${comprar ? '' : 'disabled'}><button type="button" data-d="1" aria-label="Aumentar" ${comprar ? '' : 'disabled'}>+</button></div>
        <button type="button" class="add" ${comprar ? '' : 'disabled aria-disabled="true"'}><svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Adicionar</button>
      </div>
    </div>
  </article>`;
}

/** Unidade escolhida no cartão (ou linha). */
export function unidadeEscolhida(p, id) {
  const ops = opcoesUnidade(p);
  return ops.find((o) => o.id === (id || '')) || ops[0];
}

/** Linha para o carrinho. */
export function linhaCarrinho(p, unidadeId, quantidade) {
  const op = unidadeEscolhida(p, unidadeId);
  return {
    produto_id: Number(p.id), unidade: op.id ? op.id : null, quantidade,
    nome: p.nome, codigo: p.codigo, unidadeNome: op.nome, precoTexto: op.preco || null,
    fotos: p.fotos || [], id: p.id, seu_preco: op.seu_preco, disponivel: op.quantidade_disponivel ?? null,
  };
}
