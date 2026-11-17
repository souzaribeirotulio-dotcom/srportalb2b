/* Meus Pedidos no layout original: GET pedidos (paginado) e GET pedidos/{id}
   ao abrir "Ver itens". A situação vem do G360. Sem número = aguardando aprovação. */
import { listarPedidos, consultarPedido } from '../api/g360.js';
import { sessao } from '../estado/sessao.js';
import { dinheiro, quantidade, dataBr } from '../ui/formato.js';
import { mostrarMensagemErro } from '../ui/mensagem.js';
import { $, esc } from './comum.js';
import { comprarDeNovo } from './lista.js';

const LIMITE = 20;
let pagina = 1;
const detalhes = new Map();

export function limparPedidosTela() { pagina = 1; detalhes.clear(); }

const numero = (p) => (p.numero ? `Nº ${esc(p.numero)}` : 'Aguardando aprovação');

export async function desenharPedidos(ctx, abrirId = null) {
  const painel = $('pPanel');
  painel.innerHTML = '<div class="empty2">Carregando pedidos…</div>';
  try {
    const { dados, paginacao } = await listarPedidos(sessao.token, pagina, LIMITE);
    const paginas = Math.max(1, Math.ceil((paginacao?.total || 0) / LIMITE));
    if (!dados.length) {
      painel.innerHTML = '<div class="empty2">Você ainda não fez pedidos pelo portal.<br><button type="button" class="btn pri" id="pCat" style="margin-top:14px">Ir para o catálogo</button></div>';
      $('pCat').onclick = () => ctx.ir('/catalogo');
      return;
    }
    painel.innerHTML = dados.map((p) => `<div class="ped" data-id="${Number(p.id)}"><div><b>${numero(p)}</b> <span class="st sit-${esc(p.situacao)}">${esc(p.situacao_nome)}</span>${p.faturado ? ' <span class="st">Com nota fiscal</span>' : ''}
        <div class="m">${esc(dataBr(p.data))}${p.hora ? ` às ${esc(p.hora)}` : ''}</div></div>
      <div class="v">${esc(dinheiro(p.total))}</div>
      <details ${String(p.id) === String(abrirId) ? 'open' : ''}><summary>Ver itens</summary><div class="det" aria-live="polite"></div></details></div>`).join('')
      + (paginas > 1 ? `<div class="ped" style="grid-template-columns:1fr;justify-items:center"><div class="row" style="display:flex;gap:10px;align-items:center">
          <button type="button" class="tool" id="pAnt" ${pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button><span style="color:var(--tx2);font-size:13px">Página ${pagina} de ${paginas}</span>
          <button type="button" class="tool" id="pProx" ${pagina >= paginas ? 'disabled' : ''}>Próxima ›</button></div></div>` : '');
    $('pAnt')?.addEventListener('click', () => { pagina -= 1; desenharPedidos(ctx); });
    $('pProx')?.addEventListener('click', () => { pagina += 1; desenharPedidos(ctx); });
    painel.querySelectorAll('.ped[data-id] details').forEach((d) => {
      const carregar = () => detalhe(ctx, d);
      d.addEventListener('toggle', () => { if (d.open) carregar(); });
      if (d.open) { carregar(); d.scrollIntoView({ block: 'center' }); }
    });
  } catch (e) {
    painel.innerHTML = '<div style="padding:16px" id="pErr"></div>';
    mostrarMensagemErro($('pErr'), e, { aoTentarDeNovo: () => desenharPedidos(ctx) });
  }
}

async function detalhe(ctx, d) {
  const id = d.closest('.ped').dataset.id;
  const alvo = d.querySelector('.det');
  alvo.innerHTML = '<div class="m">Carregando…</div>';
  try {
    const p = await consultarPedido(sessao.token, id);
    detalhes.set(id, p);
    const end = p.entrega?.endereco;
    alvo.innerHTML = `<div class="rv">${p.itens.map((i) => `<div><span>${esc(quantidade(i.quantidade))} ${esc(String(i.unidade || '').toLowerCase())} · ${esc(i.nome)}<br><small style="color:var(--tx3)">${esc(dinheiro(i.preco_unitario))} cada${i.seu_preco ? ' <span class="tagcg">Seu preço</span>' : ''}</small></span><b>${esc(dinheiro(i.total))}</b></div>`).join('')}</div>
      <div class="rv-tot"><div><span>Subtotal</span><span>${esc(dinheiro(p.subtotal))}</span></div>
        <div><span>Frete</span><span>${p.frete?.situacao === 'a_combinar' ? 'A combinar' : p.frete?.situacao === 'nao_aplicavel' ? '—' : esc(dinheiro(p.frete?.valor || '0.00'))}</span></div>
        ${p.taxa_pagamento && p.taxa_pagamento !== '0.00' ? `<div><span>Taxa de pagamento</span><span>${esc(dinheiro(p.taxa_pagamento))}</span></div>` : ''}
        <div class="rv-final"><span>Total</span><span><b>${esc(dinheiro(p.total))}</b></span></div></div>
      <div class="m">${p.entrega?.modalidade === 'retirada' ? 'Retirada na Souza Ribeiro' : 'Entrega'}${end ? ` · ${esc(end.descricao)} — ${esc(end.endereco)}, ${esc(end.numero)} — ${esc(end.cidade)}` : ''}</div>
      ${p.pagamento?.descricao ? `<div class="m">Pagamento: ${esc(p.pagamento.descricao)}${p.pagamento.parcelas?.length ? ` · ${p.pagamento.parcelas.map((x) => `${x.numero}ª ${esc(dataBr(x.vencimento))} ${esc(dinheiro(x.valor))}`).join(' · ')}` : ''}</div>` : ''}
      ${p.data_prevista ? `<div class="m">Previsão: ${esc(dataBr(p.data_prevista))}</div>` : ''}
      ${p.observacao ? `<div class="m">Obs.: ${esc(p.observacao)}</div>` : ''}
      <button type="button" class="tool" data-rep style="margin-top:8px">↻ Comprar de novo</button> <button type="button" class="tool" data-atu style="margin-top:8px">Atualizar situação</button>`;
    alvo.querySelector('[data-rep]').onclick = () => comprarDeNovo(ctx, p.itens);
    alvo.querySelector('[data-atu]').onclick = () => desenharPedidos(ctx, id);
  } catch (e) {
    alvo.innerHTML = '';
    mostrarMensagemErro(alvo, e, { aoTentarDeNovo: () => detalhe(ctx, d) });
  }
}
