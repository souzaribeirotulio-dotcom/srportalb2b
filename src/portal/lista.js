/* =====================================================================
   Minha Lista no layout original: os produtos salvos (Supabase, com o
   vínculo da ponte) e os já comprados (GET historico-compras), com preço
   e disponibilidade de agora (filtro ids, todas as páginas). Preço guardado
   nunca vai para a tela. Quantidades → carrinho ou pedido direto.
   ===================================================================== */
import { produtosPorIds, consultarHistoricoCompras, listarPedidos, consultarPedido } from '../api/g360.js';
import { sessao } from '../estado/sessao.js';
import { carregarIds, removerDaLista, ErroLista } from '../estado/minha-lista.js';
import { adicionar } from '../estado/carrinho.js';
import { normalizarQuantidade, dinheiro, quantidade as qtdBr, dataBr, estimar } from '../ui/formato.js';
import { ligarFotos, htmlFoto } from '../ui/fotos.js';
import { mostrarMensagemErro } from '../ui/mensagem.js';
import { $, esc, toast, passoQuantidade } from './comum.js';
import { podeComprar, htmlEstoque, htmlUnidades, unidadeEscolhida, linhaCarrinho } from './cartao.js';
import { abrirCheckout } from './checkout.js';
import { abrirCarrinho } from './loja.js';

let LQ = new Map();   // produto_id → quantidade (texto com vírgula)
let LU = new Map();   // produto_id → unidade escolhida ('' = base)
let preencherDepois = null; // itens de um pedido para "Comprar de novo"
let linhas = [];

export function limparListaTela() { LQ = new Map(); LU = new Map(); preencherDepois = null; linhas = []; }

/** "Comprar de novo" de um pedido: preenche as quantidades e abre a Minha Lista. */
export function comprarDeNovo(ctx, itens) { preencherDepois = itens; ctx.ir('/minha-lista'); }

function unidadeDoItem(p, nomeUnidade) {
  const u = (p.unidades || []).find((x) => x.nome === nomeUnidade);
  return u ? u.id : '';
}

export async function desenharMinhaLista(ctx) {
  const painel = $('lPanel');
  $('lSub').textContent = 'Os produtos que você salvou e os que sua empresa já compra, com o preço de agora. Informe as quantidades e faça o pedido em segundos.';
  $('lRep').onclick = () => repetirUltimo(ctx);
  painel.innerHTML = '<div class="empty2">Carregando a sua lista…</div>';
  let salvos = new Set(); let avisoLista = '';
  try { salvos = new Set(await carregarIds()); } catch (e) { avisoLista = e instanceof ErroLista ? e.message : 'A Minha Lista está indisponível no momento.'; }
  let hist = { produtos: [] };
  try { hist = await consultarHistoricoCompras(sessao.token, 6); } catch (e) { if (e.status === 401) return; }
  const compras = new Map((hist.produtos || []).map((h) => [Number(h.produto_id), h]));
  const extras = (preencherDepois || []).map((i) => Number(i.produto_id));
  const ids = [...new Set([...salvos, ...compras.keys(), ...extras])];
  if (!ids.length) {
    painel.innerHTML = `${avisoLista ? `<div class="rv-aviso bad" style="margin:12px">${esc(avisoLista)}</div>` : ''}<div class="empty2">Sua lista está vazia. No catálogo, toque em ☆ Lista nos produtos que você compra sempre.<br><button type="button" class="btn pri" id="lCat" style="margin-top:14px">Ir para o catálogo</button></div>`;
    $('lCat').onclick = () => ctx.ir('/catalogo');
    return;
  }
  let achados;
  try { achados = await produtosPorIds(sessao.token, ids); } catch (e) {
    painel.innerHTML = '<div style="padding:16px" id="lErr"></div>';
    mostrarMensagemErro($('lErr'), e, { aoTentarDeNovo: () => desenharMinhaLista(ctx) });
    return;
  }
  if (preencherDepois) {
    LQ = new Map();
    for (const i of preencherDepois) {
      const p = achados.get(Number(i.produto_id));
      if (p && podeComprar(p)) { LQ.set(p.id, qtdBr(i.quantidade)); LU.set(p.id, unidadeDoItem(p, i.unidade)); }
    }
    preencherDepois = null;
    toast('Quantidades do pedido preenchidas. Confira e feche o pedido.');
  }
  linhas = ids.map((id) => ({ id, p: achados.get(id), salvo: salvos.has(id), compra: compras.get(id) }))
    .sort((a, b) => String(a.p?.nome || 'zz').localeCompare(String(b.p?.nome || 'zz'), 'pt'));
  painel.innerHTML = `${avisoLista ? `<div class="rv-aviso bad" style="margin:12px">${esc(avisoLista)}</div>` : ''}
    <div class="lrow h"><div></div><div>Produto</div><div>Histórico</div><div>Preço</div><div>Quantidade</div><div style="text-align:right">Subtotal</div></div>
    ${linhas.map(htmlLinha).join('')}
    <div class="sticky"><div class="tt"><span id="lN"></span> Total estimado:<b id="lT"></b></div>
      <button type="button" class="btn out" id="lClr">Limpar</button><button type="button" class="btn out" id="lAdd">Adicionar ao carrinho</button><button type="button" class="btn pri" id="lBuy">Fechar pedido agora</button></div>`;
  ligarFotos(painel);
  atualizarTotais();
  $('lClr').onclick = () => { LQ = new Map(); desenharMinhaLista(ctx); };
  $('lAdd').onclick = () => { if (mandarParaCarrinho()) abrirCarrinho(); };
  $('lBuy').onclick = () => { if (mandarParaCarrinho()) abrirCheckout(ctx); };
  painel.onclick = (e) => cliqueLinha(e, ctx);
  painel.oninput = (e) => { const r = e.target.closest('.lrow[data-id]'); if (r && e.target.matches('.qty input')) definir(r, e.target.value, false); };
}

function htmlLinha(x) {
  const p = x.p;
  const h = x.compra?.ultima_compra;
  const hist = h ? `Última compra: <b>${esc(qtdBr(h.quantidade))} ${esc(h.unidade_vendida || h.unidade_base || '')}</b> em ${esc(dataBr(h.data))}<br>${Number(x.compra.pedidos)} pedido${x.compra.pedidos === 1 ? '' : 's'} em 6 meses` : 'Salvo por você';
  if (!p) {
    return `<div class="lrow" data-fora="${x.id}"><div class="g360-mini">Sem foto</div>
      <div class="nm">Produto ${esc(x.id)}<small>Indisponível no momento</small>${x.salvo ? '<button type="button" class="rm" data-rm>Remover da lista</button>' : ''}</div>
      <div class="hist">${hist}</div><div class="pr fora">—</div><div></div><div class="sub2">—</div></div>`;
  }
  const est = { q: LQ.get(p.id) || '', un: LU.get(p.id) || '' };
  const op = unidadeEscolhida(p, est.un);
  const comprar = podeComprar(p);
  const sub = est.q && op.preco ? dinheiro(estimar([{ precoTexto: op.preco, quantidade: normalizarQuantidade(est.q) || '0' }]).total) : '—';
  return `<div class="lrow ${est.q ? 'sel' : ''}" data-id="${p.id}">
    ${htmlFoto(p, 'g360-mini')}
    <div class="nm">${esc(p.nome)}<small>Cód. ${esc(p.codigo)} · ${esc(p.marca || '')}</small>${htmlEstoque(p)}${p.aviso ? `<div class="warn">${esc(p.aviso)}</div>` : ''}${htmlUnidades(p, est.un, 'sm')}
      ${x.salvo ? '<button type="button" class="rm" data-rm>Remover da lista</button>' : ''}</div>
    <div class="hist">${hist}</div>
    <div class="pr">${op.preco ? esc(dinheiro(op.preco)) : '—'}<small>/ ${esc(String(op.nome).toLowerCase())}</small>${op.seu_preco ? '<span class="tagcg">Seu preço</span>' : ''}</div>
    <div class="qty"><button type="button" data-d="-1" ${comprar ? '' : 'disabled'} aria-label="Diminuir">−</button><input type="text" inputmode="decimal" value="${esc(est.q)}" placeholder="0" maxlength="13" aria-label="Quantidade de ${esc(p.nome)}" ${comprar ? '' : 'disabled'}><button type="button" data-d="1" ${comprar ? '' : 'disabled'} aria-label="Aumentar">+</button></div>
    <div class="sub2">${sub}</div></div>`;
}

function definir(row, valor, redesenhar = true) {
  const id = Number(row.dataset.id);
  const x = linhas.find((l) => l.id === id); if (!x?.p) return;
  const est = { q: String(valor || '').trim(), un: LU.get(id) || '' };
  if (!est.q || est.q === '0') LQ.delete(id); else LQ.set(id, est.q);
  if (redesenhar) row.outerHTML = htmlLinha(x);
  else {
    const op = unidadeEscolhida(x.p, est.un); const q = normalizarQuantidade(est.q);
    row.querySelector('.sub2').textContent = q && op.preco ? dinheiro(estimar([{ precoTexto: op.preco, quantidade: q }]).total) : '—';
    row.classList.toggle('sel', !!est.q);
  }
  if (redesenhar) ligarFotos($('lPanel'));
  atualizarTotais();
}

async function cliqueLinha(e, ctx) {
  const r = e.target.closest('.lrow[data-id], .lrow[data-fora]'); if (!r) return;
  if (e.target.closest('[data-rm]')) {
    const id = Number(r.dataset.id || r.dataset.fora);
    try { await removerDaLista(id); toast('Removido da Minha Lista'); desenharMinhaLista(ctx); } catch (err) { toast(err.message); }
    return;
  }
  if (!r.dataset.id) return;
  const id = Number(r.dataset.id);
  const un = e.target.closest('.unsel [data-un]');
  if (un) { LU.set(id, un.dataset.un); r.outerHTML = htmlLinha(linhas.find((l) => l.id === id)); ligarFotos($('lPanel')); atualizarTotais(); return; }
  const d = e.target.closest('[data-d]');
  if (d) {
    const atual = r.querySelector('.qty input').value;
    if (Number(d.dataset.d) < 0 && (!atual || atual === '0' || atual === '1')) { definir(r, ''); return; }
    definir(r, atual ? passoQuantidade(atual, Number(d.dataset.d)) : '1');
  }
}

function itensEscolhidos() {
  const it = [];
  for (const [id, texto] of LQ) {
    const x = linhas.find((l) => l.id === id); if (!x?.p || !podeComprar(x.p)) continue;
    const q = normalizarQuantidade(texto); if (!q) return { erro: x.p.nome };
    it.push(linhaCarrinho(x.p, LU.get(id) || '', q));
  }
  return { it };
}

function atualizarTotais() {
  const { it = [] } = itensEscolhidos();
  $('lN').textContent = it.length ? `${it.length} ${it.length === 1 ? 'item' : 'itens'} ·` : 'Nenhum item ·';
  $('lT').textContent = dinheiro(estimar(it).total);
  $('lAdd').disabled = $('lBuy').disabled = !it.length;
}

function mandarParaCarrinho() {
  const { it, erro } = itensEscolhidos();
  if (erro) { toast(`Quantidade inválida em ${erro.slice(0, 40)}.`); return false; }
  let limite = false;
  it.forEach((l) => { if (adicionar(l) === 'limite') limite = true; });
  if (limite) toast('O carrinho aceita até 100 linhas. Alguns itens ficaram de fora.');
  else toast(`${it.length} ${it.length === 1 ? 'produto adicionado' : 'produtos adicionados'} ao carrinho`);
  LQ = new Map();
  document.querySelectorAll('#lPanel .lrow.sel').forEach((row) => { row.classList.remove('sel'); const i = row.querySelector('.qty input'); if (i) i.value = ''; const s = row.querySelector('.sub2'); if (s) s.textContent = '—'; });
  atualizarTotais();
  return true;
}

async function repetirUltimo(ctx) {
  try {
    const { dados } = await listarPedidos(sessao.token, 1, 1);
    if (!dados.length) { toast('Você ainda não tem pedidos pelo portal.'); return; }
    const p = await consultarPedido(sessao.token, dados[0].id);
    comprarDeNovo(ctx, p.itens);
    desenharMinhaLista(ctx);
  } catch (e) { toast(e.message); }
}
