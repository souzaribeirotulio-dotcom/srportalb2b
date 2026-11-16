/* Cartão de produto compartilhado por catálogo, Minha Lista e recompra.
   Preço: o "preco" já é o que vale para o comprador; com "seu_preco",
   mostra o selo "Seu preço" (sem preço riscado nem desconto). */
import { esc } from './util.js';
import { dinheiro } from './formato.js';
import { htmlFoto } from './fotos.js';

const DISP = {
  disponivel: ['disp-ok', 'Disponível'],
  sob_consulta: ['disp-consulta', 'Sob consulta'],
  indisponivel: ['disp-fora', 'Indisponível'],
};

/** Opções de unidade: base (null) + unidades[] liberadas. */
export function opcoesUnidade(p) {
  const base = { id: '', nome: p.unidade || 'Unidade', descricao: '', preco: p.preco, seu_preco: p.seu_preco ?? null };
  return [base, ...(p.unidades || []).map((u) => ({ id: u.id, nome: u.nome, descricao: u.descricao, preco: u.preco, seu_preco: u.seu_preco ?? null }))];
}

export function podeComprar(p) {
  return p.compravel === true && p.disponibilidade === 'disponivel' && p.preco !== null && p.preco !== undefined;
}

function motivoSemCompra(p) {
  if (p.disponibilidade === 'sob_consulta') return 'Sob consulta: fale com o seu vendedor.';
  if (p.disponibilidade === 'indisponivel') return 'Indisponível no momento.';
  if (p.preco === null || p.preco === undefined) return 'Sem preço para compra.';
  return 'Não disponível para compra pelo portal.';
}

export function htmlPreco(op) {
  return `<span class="preco">${esc(dinheiro(op.preco))}</span>${op.seu_preco ? '<span class="selo-seu-preco" title="Preço negociado para você">Seu preço</span>' : ''}`;
}

/**
 * HTML do cartão. extras: { naLista (bool|null), quantidadeSugerida, rodape (html) }.
 */
export function htmlCartao(p, extras = {}) {
  const ops = opcoesUnidade(p);
  const [cls, nomeDisp] = DISP[p.disponibilidade] || ['disp-fora', 'Indisponível'];
  const comprar = podeComprar(p);
  const faixa = p.faixa_disponibilidade === 'ultimas_unidades' && p.disponibilidade === 'disponivel' ? ' · Últimas unidades' : '';
  const idU = `u${p.id}`;
  return `
  <article class="cartao-produto" data-id="${Number(p.id)}">
    ${htmlFoto(p)}
    <div class="cp-corpo">
      <div class="cp-topo"><span class="cp-codigo">${esc(p.codigo)}</span>${p.marca ? `<span class="cp-marca">${esc(p.marca)}</span>` : ''}</div>
      <h3 class="cp-nome">${esc(p.nome)}</h3>
      ${p.aplicacao ? `<p class="cp-aplicacao">${esc(p.aplicacao)}</p>` : ''}
      ${ops.length > 1 ? `<label class="cp-rotulo" for="${idU}">Embalagem</label>
        <select id="${idU}" class="cp-unidade">${ops.map((o, i) => `<option value="${esc(o.id)}" data-i="${i}">${esc(o.nome)}${o.descricao ? ` — ${esc(o.descricao)}` : ''}</option>`).join('')}</select>`
        : `<p class="cp-unidade-fixa">Vendido por ${esc(ops[0].nome)}</p>`}
      <div class="cp-preco" aria-live="polite">${htmlPreco(ops[0])}</div>
      <p class="cp-disp ${cls}">${nomeDisp}${faixa}</p>
      ${p.aviso ? `<p class="cp-aviso">${esc(p.aviso)}</p>` : ''}
      ${comprar ? `
        <div class="cp-comprar">
          <label class="sr" for="q${p.id}">Quantidade</label>
          <input id="q${p.id}" class="cp-qtd" type="text" inputmode="decimal" value="${esc(extras.quantidadeSugerida || '1')}" maxlength="13" aria-label="Quantidade">
          <button type="button" class="g360-btn pri cp-add">Adicionar</button>
        </div>` : `<p class="cp-sem">${esc(motivoSemCompra(p))}</p>`}
      <p class="cp-retorno" aria-live="polite"></p>
      ${extras.naLista === null || extras.naLista === undefined ? '' : `<button type="button" class="app-link cp-lista" aria-pressed="${extras.naLista ? 'true' : 'false'}">${extras.naLista ? '♥ Na Minha Lista' : '♡ Salvar na Minha Lista'}</button>`}
      ${extras.rodape || ''}
    </div>
  </article>`;
}

/** Atualiza o preço exibido quando a embalagem muda. */
export function ligarUnidade(cartao, p) {
  const sel = cartao.querySelector('.cp-unidade');
  if (!sel) return;
  const ops = opcoesUnidade(p);
  sel.addEventListener('change', () => {
    const op = ops[Number(sel.selectedOptions[0].dataset.i)];
    cartao.querySelector('.cp-preco').innerHTML = htmlPreco(op);
  });
}

/** Linha para o carrinho a partir do cartão. */
export function linhaDoCartao(cartao, p, quantidade) {
  const ops = opcoesUnidade(p);
  const sel = cartao.querySelector('.cp-unidade');
  const op = sel ? ops[Number(sel.selectedOptions[0].dataset.i)] : ops[0];
  return {
    produto_id: Number(p.id),
    unidade: op.id ? op.id : null,
    quantidade,
    nome: p.nome,
    codigo: p.codigo,
    unidadeNome: op.nome,
    precoTexto: op.preco || null,
  };
}
