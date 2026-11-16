/* Meus pedidos (Etapa 9): GET pedidos (paginado) e GET pedidos/{id}.
   A situação vem do G360 (situacao_nome). Pedido aguardando aprovação pode
   vir sem número: no lugar dele, "aguardando aprovação". */
import { listarPedidos, consultarPedido } from '../api/g360.js';
import { sessao } from '../estado/sessao.js';
import { dinheiro, quantidade, dataBr } from '../ui/formato.js';
import { carregando, vazia, erroTela, titulo } from '../ui/telas-comum.js';
import { esc } from '../ui/util.js';

const LIMITE = 20;
let paginaAtual = 1;

function numero(p) { return p.numero ? `Pedido nº ${esc(p.numero)}` : 'Pedido aguardando aprovação'; }
function quando(p) { return p.data ? `${esc(dataBr(p.data))}${p.hora ? ` às ${esc(p.hora)}` : ''}` : ''; }
function situacao(p) { return `<span class="situacao sit-${esc(p.situacao)}">${esc(p.situacao_nome)}</span>${p.faturado ? ' <span class="situacao sit-faturado">Com nota fiscal</span>' : ''}`; }

/** Resumo curto usado também depois do envio. */
export function htmlPedidoResumo(p) {
  return `<div class="pedido-resumo">
    <p class="pedido-num">${numero(p)}</p>
    <p>${situacao(p)}</p>
    ${quando(p) ? `<p class="g360-mini">${quando(p)}</p>` : ''}
    <p>Total: <strong>${esc(dinheiro(p.total))}</strong></p>
  </div>`;
}

export function telaPedidos({ conteudo, ir, eAtual }) {
  conteudo.innerHTML = `${titulo('Meus pedidos', 'Pedidos feitos pelo portal. A situação acompanha a separação, o faturamento e a entrega no G360.')}
    <div class="g360-acoes linha-botoes"><button type="button" class="g360-btn sec" id="g360Atualizar">Atualizar</button></div>
    <div id="g360ListaPedidos"></div><nav class="paginacao" id="g360PagPedidos" aria-label="Páginas de pedidos"></nav>`;
  const lista = conteudo.querySelector('#g360ListaPedidos');
  const pag = conteudo.querySelector('#g360PagPedidos');
  conteudo.querySelector('#g360Atualizar').addEventListener('click', () => carregar());

  async function carregar() {
    carregando(lista, 'Carregando seus pedidos…');
    pag.innerHTML = '';
    try {
      const { dados, paginacao } = await listarPedidos(sessao.token, paginaAtual, LIMITE);
      if (!eAtual()) return;
      const paginas = Math.max(1, Math.ceil((paginacao?.total || 0) / LIMITE));
      if (!dados.length) {
        vazia(lista, 'Você ainda não tem pedidos pelo portal.', 'Monte o carrinho no catálogo e envie o seu primeiro pedido.',
          '<button type="button" class="g360-btn pri" id="g360IrCatalogo">Ir para o catálogo</button>');
        lista.querySelector('#g360IrCatalogo').addEventListener('click', () => ir('/catalogo'));
        return;
      }
      lista.innerHTML = `<ul class="lista-pedidos">${dados.map((p) => `<li>
        <button type="button" class="pedido-item" data-id="${Number(p.id)}">
          <span class="pedido-num">${numero(p)}</span>
          <span>${situacao(p)}</span>
          <span class="g360-mini">${quando(p)}</span>
          <strong>${esc(dinheiro(p.total))}</strong>
        </button></li>`).join('')}</ul>`;
      lista.querySelectorAll('.pedido-item').forEach((b) => b.addEventListener('click', () => ir(`/pedidos/${b.dataset.id}`)));
      if (paginas > 1) {
        pag.innerHTML = `<button type="button" class="g360-btn sec" id="pAnt" ${paginaAtual <= 1 ? 'disabled' : ''}>Anterior</button>
          <span>Página ${paginaAtual} de ${paginas}</span>
          <button type="button" class="g360-btn sec" id="pProx" ${paginaAtual >= paginas ? 'disabled' : ''}>Próxima</button>`;
        pag.querySelector('#pAnt').addEventListener('click', () => { paginaAtual -= 1; carregar(); });
        pag.querySelector('#pProx').addEventListener('click', () => { paginaAtual += 1; carregar(); });
      }
    } catch (e) {
      if (eAtual()) erroTela(lista, e, carregar);
    }
  }
  carregar();
}

export function telaPedido({ conteudo, ir, params, eAtual }) {
  const id = params[0];
  conteudo.innerHTML = `${titulo('Detalhe do pedido')}
    <div class="g360-acoes linha-botoes"><button type="button" class="app-link" id="g360Voltar">← Meus pedidos</button>
      <button type="button" class="g360-btn sec" id="g360Atualizar">Atualizar situação</button></div>
    <div id="g360Pedido"></div>`;
  const alvo = conteudo.querySelector('#g360Pedido');
  conteudo.querySelector('#g360Voltar').addEventListener('click', () => ir('/pedidos'));
  conteudo.querySelector('#g360Atualizar').addEventListener('click', () => carregar());

  async function carregar() {
    carregando(alvo, 'Carregando o pedido…');
    try {
      const p = await consultarPedido(sessao.token, id);
      if (!eAtual()) return;
      const end = p.entrega?.endereco;
      alvo.innerHTML = `<section class="resumo">
        ${htmlPedidoResumo(p)}
        <ul class="itens-pedido">${p.itens.map((i) => `<li><span class="cp-codigo">${esc(i.codigo)}</span> <strong>${esc(i.nome)}</strong>
          <span>${esc(quantidade(i.quantidade))} ${esc(i.unidade || '')} × ${esc(dinheiro(i.preco_unitario))}${i.seu_preco ? ' <span class="selo-seu-preco">Seu preço</span>' : ''} = <strong>${esc(dinheiro(i.total))}</strong></span></li>`).join('')}</ul>
        <dl>
          <div><dt>Subtotal</dt><dd>${esc(dinheiro(p.subtotal))}</dd></div>
          <div><dt>Frete</dt><dd>${p.frete?.situacao === 'a_combinar' ? 'a combinar' : p.frete?.situacao === 'nao_aplicavel' ? '—' : esc(dinheiro(p.frete?.valor || '0.00'))}</dd></div>
          ${p.taxa_pagamento && p.taxa_pagamento !== '0.00' ? `<div><dt>Taxa de pagamento</dt><dd>${esc(dinheiro(p.taxa_pagamento))}</dd></div>` : ''}
          <div class="total"><dt>Total</dt><dd>${esc(dinheiro(p.total))}</dd></div>
        </dl>
        <p><strong>Entrega:</strong> ${p.entrega?.modalidade === 'retirada' ? 'Retirada na Souza Ribeiro' : p.entrega?.modalidade === 'entrega' ? 'Entrega' : '—'}
          ${end ? `<br><span class="g360-mini">${esc(end.descricao)} — ${esc(end.endereco)}, ${esc(end.numero)}${end.complemento ? ` · ${esc(end.complemento)}` : ''} — ${esc(end.cidade)}</span>` : ''}</p>
        ${p.pagamento?.descricao ? `<p><strong>Pagamento:</strong> ${esc(p.pagamento.descricao)}</p>` : ''}
        ${p.pagamento?.parcelas?.length ? `<ul class="parcelas">${p.pagamento.parcelas.map((x) => `<li>${x.numero}ª · ${esc(dataBr(x.vencimento))} · ${esc(dinheiro(x.valor))}</li>`).join('')}</ul>` : ''}
        ${p.data_prevista ? `<p><strong>Previsão:</strong> ${esc(dataBr(p.data_prevista))}</p>` : ''}
        ${p.observacao ? `<p><strong>Observação:</strong> ${esc(p.observacao)}</p>` : ''}
      </section>`;
    } catch (e) {
      if (eAtual()) erroTela(alvo, e, carregar);
    }
  }
  carregar();
}
