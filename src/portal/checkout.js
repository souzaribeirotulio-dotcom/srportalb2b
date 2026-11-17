/* =====================================================================
   Revisão e envio do pedido no modal original (#mChk).
   - Os totais que valem são os da revisão (POST revisoes).
   - Envio sem duplicar: estado/envio.js (matriz da seção 9).
   - Pendências do fornecedor viram ocorrência (estado/ocorrencias.js).
   ===================================================================== */
import { nomeDoItem } from '../catalogo/exibicao.js';
import { consultarOpcoes, revisarPedido } from '../api/g360.js';
import { sessao } from '../estado/sessao.js';
import { itensParaApi, linhasCarrinho, esvaziar, versaoCarrinho } from '../estado/carrinho.js';
import { pendenteDoComprador, prepararEnvio, executarEnvio, atualizarAssinatura, apagarPendente } from '../estado/envio.js';
import { registrarPendenciasFornecedor } from '../estado/ocorrencias.js';
import { mostrarMensagemErro } from '../ui/mensagem.js';
import { dinheiro, quantidade, dataBr } from '../ui/formato.js';
import { $, esc, abrirModal, fecharModal, adiar } from './comum.js';
import { formularioEndereco } from './endereco.js';

const escolha = { modalidade: null, endereco_id: null, condicao_id: null, observacao: '' };
let opcoes = null;
let revisao = null;      // { versao, chave, dados, requestId, corpo }
let pendente = null;     // intenção de envio em curso
let ctx = null;
let ocupado = false;

const ROTULO = { usuario: 'Para você ajustar', fornecedor: 'Depende da Souza Ribeiro', tentar_de_novo: 'Tente de novo em instantes', integracao: 'Erro no portal' };
const FRETE = { definido: 'Frete', gratis: 'Frete grátis', a_combinar: 'Frete a combinar', nao_aplicavel: 'Retirada: sem frete' };
const CREDITO = { liberado: 'Crédito liberado', aviso: 'Atenção ao crédito', aguardando_aprovacao: 'O pedido vai aguardar aprovação de crédito' };

export function limparCheckout() {
  Object.assign(escolha, { modalidade: null, endereco_id: null, condicao_id: null, observacao: '' });
  opcoes = null; revisao = null; pendente = null;
}

const chaveEscolha = () => JSON.stringify(escolha);
const revisaoValida = () => revisao && revisao.versao === versaoCarrinho() && revisao.chave === chaveEscolha();

function corpoRevisao() {
  const corpo = { itens: itensParaApi(), modalidade: escolha.modalidade };
  if (escolha.modalidade === 'entrega' && escolha.endereco_id) corpo.endereco_id = Number(escolha.endereco_id);
  if (opcoes && opcoes.pagamento.exigido !== 'nenhum' && escolha.condicao_id) corpo.condicao_pagamento_id = Number(escolha.condicao_id);
  const obs = escolha.observacao.trim(); if (obs) corpo.observacao = obs;
  return corpo;
}

function cabecalho() {
  const c = sessao.comprador || {};
  return `<h3>Revisar pedido</h3><div class="sub">${esc(c.fantasia || c.nome || '')}${c.documento ? ` · ${esc(c.documento)}` : ''}</div>`;
}

/** Abre a revisão a partir do carrinho. */
export async function abrirCheckout(contexto) {
  ctx = contexto;
  abrirModal('mChk');
  const box = $('chkBox');
  const pend = pendenteDoComprador();
  if (pend && !pendente) {
    box.innerHTML = `${cabecalho()}<div class="rv-aviso"><b>Há um envio de pedido sem confirmação.</b><br>Antes de começar outro, vamos conferir se ele foi gravado.</div>
      <div class="act"><button type="button" class="btn sec" id="cX">Voltar</button><button type="button" class="btn pri" id="cConf">Conferir agora</button></div>`;
    $('cX').onclick = fechar;
    $('cConf').onclick = () => { pendente = pend; desenharBase(); rodarEnvio({ consultarPrimeiro: true }); };
    return;
  }
  if (!linhasCarrinho().length) { box.innerHTML = `${cabecalho()}<div class="empty2">Seu carrinho está vazio.</div><div class="act"><button type="button" class="btn sec" id="cX">Voltar</button></div>`; $('cX').onclick = fechar; return; }
  box.innerHTML = `${cabecalho()}<div class="empty2">Carregando as opções de entrega e pagamento…</div>`;
  try {
    const dados = await consultarOpcoes(sessao.token);
    opcoes = dados;
    if (!dados.modalidades.includes(escolha.modalidade)) escolha.modalidade = dados.modalidades[0] || null;
    if (!dados.enderecos.some((e) => e.id === Number(escolha.endereco_id))) escolha.endereco_id = (dados.enderecos.find((e) => e.principal) || dados.enderecos[0])?.id ?? null;
    const conds = dados.pagamento.condicoes;
    if (!conds.some((c) => c.id === Number(escolha.condicao_id))) escolha.condicao_id = (conds.find((c) => c.padrao) || conds[0])?.id ?? null;
    desenharBase();
    revisar();
  } catch (e) {
    box.innerHTML = `${cabecalho()}<div id="cErr"></div><div class="act"><button type="button" class="btn sec" id="cX">Voltar</button></div>`;
    $('cX').onclick = fechar;
    mostrarMensagemErro($('cErr'), e, { aoTentarDeNovo: () => abrirCheckout(ctx) });
  }
}

function fechar() { if (ocupado) return; fecharModal('mChk'); }

/** Estrutura do modal: escolhas do comprador + área do resumo + área do envio. */
function desenharBase() {
  const op = opcoes;
  const box = $('chkBox');
  if (!op) { box.innerHTML = `${cabecalho()}<div id="cResumo"></div><div id="cEnvio" aria-live="polite"></div><div class="act"><button type="button" class="btn sec" id="cX">Voltar</button><button type="button" class="btn pri" id="cOk" disabled>Confirmar pedido</button></div>`; $('cX').onclick = fechar; return; }
  box.innerHTML = `${cabecalho()}
    <div id="cResumo" aria-live="polite"></div>
    <div class="chk-sec"><label>Como receber</label>
      <div class="pay">${op.modalidades.length ? op.modalidades.map((m) => `<label><input type="radio" name="mod" value="${m}" ${escolha.modalidade === m ? 'checked' : ''}><span>${m === 'entrega' ? 'Entrega' : 'Retirada na Souza Ribeiro'}<small>${m === 'entrega' ? 'No endereço escolhido abaixo' : 'Sem frete'}</small></span></label>`).join('')
        : '<div class="rv-aviso bad">Nenhuma forma de recebimento disponível para o seu cadastro. Fale com o seu vendedor.</div>'}</div></div>
    ${escolha.modalidade === 'entrega' ? `<div class="chk-sec"><label>Endereço de entrega</label><div id="cEnd">
        ${op.enderecos.map((x) => `<label class="addr"><input type="radio" name="en" value="${x.id}" ${Number(escolha.endereco_id) === x.id ? 'checked' : ''}><span><b>${esc(x.descricao)}${x.principal ? ' · principal' : ''}</b><small>${esc(x.endereco)}, ${esc(x.numero)}${x.complemento ? ` · ${esc(x.complemento)}` : ''} — ${esc(x.cidade)} · CEP ${esc(x.cep)}</small></span></label>`).join('')}
        ${op.enderecos.length ? '' : '<div class="hint" style="margin-bottom:8px">Nenhum endereço cadastrado ainda.</div>'}
        <button type="button" class="addu" id="qAdd">+ Entregar em outro endereço</button><div id="cNovoEnd"></div></div></div>` : ''}
    ${op.pagamento.exigido !== 'nenhum' ? `<div class="chk-sec"><label>Condição de pagamento</label>
      <div class="pay">${op.pagamento.condicoes.length ? op.pagamento.condicoes.map((c) => `<label><input type="radio" name="pg" value="${c.id}" ${Number(escolha.condicao_id) === c.id ? 'checked' : ''}><span>${esc(c.descricao)}<small>${c.pedido_minimo ? `Pedido mínimo ${esc(dinheiro(c.pedido_minimo))}` : ''}${c.parcelas > 1 ? `${c.pedido_minimo ? ' · ' : ''}${c.parcelas} parcelas` : ''}</small></span></label>`).join('')
        : '<div class="rv-aviso">Nenhuma condição de pagamento liberada para o seu cadastro. A revisão vai indicar o que fazer.</div>'}</div></div>` : ''}
    <label for="cObs">Observação (opcional)</label><textarea id="cObs" rows="2" maxlength="400" placeholder="Ex.: entregar pela manhã, falar com João">${esc(escolha.observacao)}</textarea>
    <div class="cont-obs"><span id="cObsN">${escolha.observacao.length}</span>/400</div>
    <div id="cEnvio" aria-live="polite"></div>
    <div class="act"><button type="button" class="btn sec" id="cX">Voltar</button><button type="button" class="btn pri" id="cOk" disabled>Confirmar pedido</button></div>`;
  $('cX').onclick = fechar;
  $('cOk').onclick = enviar;
  box.querySelectorAll('input[name=mod]').forEach((r) => r.onchange = () => { escolha.modalidade = r.value; desenharBase(); revisar(); });
  box.querySelectorAll('input[name=en]').forEach((r) => r.onchange = () => { escolha.endereco_id = Number(r.value); revisar(); });
  box.querySelectorAll('input[name=pg]').forEach((r) => r.onchange = () => { escolha.condicao_id = Number(r.value); revisar(); });
  const obs = $('cObs');
  const revisarObs = adiar(revisar, 700);
  obs.addEventListener('input', () => { escolha.observacao = obs.value; $('cObsN').textContent = obs.value.length; marcarDesatualizada(); revisarObs(); });
  $('qAdd')?.addEventListener('click', () => {
    $('qAdd').hidden = true;
    formularioEndereco($('cNovoEnd'), {
      aoCancelar: () => { $('cNovoEnd').innerHTML = ''; $('qAdd').hidden = false; },
      aoSalvar: async (novo) => {
        escolha.endereco_id = novo.id;
        try { opcoes = await consultarOpcoes(sessao.token); } catch { /* segue com a lista atual */ }
        if (!opcoes.enderecos.some((e) => e.id === novo.id)) opcoes.enderecos.push(novo);
        desenharBase(); revisar();
      },
    });
  });
  if (revisaoValida()) desenharResumo();
}

function marcarDesatualizada() {
  const ok = $('cOk'); if (ok) ok.disabled = true;
}

const htmlPendencias = (lista) => (lista || []).map((p) =>
  `<div class="rv-aviso ${p.responsavel === 'fornecedor' ? 'forn' : p.responsavel === 'usuario' ? 'bad' : ''}"><strong class="resp">${esc(ROTULO[p.responsavel] || 'Pendência')}</strong>${esc(p.mensagem)}</div>`).join('');

async function revisar() {
  if (!opcoes || ocupado) return;
  const alvo = $('cResumo'); if (!alvo) return;
  const corpo = corpoRevisao();
  const chave = chaveEscolha(); const versao = versaoCarrinho();
  marcarDesatualizada();
  alvo.innerHTML = '<div class="rv-aviso">Calculando os valores com a Souza Ribeiro…</div>';
  try {
    const { dados, requestId } = await revisarPedido(sessao.token, corpo);
    if (chave !== chaveEscolha() || versao !== versaoCarrinho()) return; // mudou no meio: vale a próxima revisão
    revisao = { versao, chave, dados, requestId, corpo };
    registrarPendenciasFornecedor(dados.pendencias, requestId, 'POST revisoes', true);
    desenharResumo();
  } catch (e) {
    alvo.innerHTML = '';
    mostrarMensagemErro(alvo, e, { aoTentarDeNovo: revisar });
  }
}

function desenharResumo() {
  const r = revisao.dados;
  const bloqueado = sessao.comprador?.compra_bloqueada === true;
  const freteValor = r.frete.situacao === 'definido' ? dinheiro(r.frete.valor) : r.frete.situacao === 'gratis' ? 'Grátis' : r.frete.situacao === 'a_combinar' ? 'A combinar' : '—';
  const soFornecedor = (r.pendencias || []).length && r.pendencias.every((p) => p.responsavel === 'fornecedor');
  $('cResumo').innerHTML = `
    <div class="rv">${r.itens.map((i) => `<div class="rv-item"><div class="linha1"><span>${esc(quantidade(i.quantidade))} ${esc(String(i.unidade || '').toLowerCase())} · ${esc(nomeDoItem(i))}</span><b>${i.total ? esc(dinheiro(i.total)) : '—'}</b></div>
      <small>${i.preco_unitario ? `${esc(dinheiro(i.preco_unitario))} por ${esc(String(i.unidade || '').toLowerCase())}` : 'Sem preço'}${i.seu_preco ? ' <span class="tagcg">Seu preço</span>' : ''}</small>
      ${i.aviso ? `<small class="rv-pend">⚠ ${esc(i.aviso)}</small>` : ''}${i.pendencia ? `<small class="rv-pend">⚠ ${esc(i.pendencia)}</small>` : ''}</div>`).join('')}</div>
    <div class="rv-tot">
      <div><span>Subtotal dos produtos</span><span>${esc(dinheiro(r.subtotal))}</span></div>
      <div><span>${esc(FRETE[r.frete.situacao] || 'Frete')}</span><span>${esc(freteValor)}</span></div>
      ${r.taxa_pagamento && r.taxa_pagamento !== '0.00' ? `<div><span>Taxa de pagamento</span><span>${esc(dinheiro(r.taxa_pagamento))}</span></div>` : ''}
      <div class="rv-final"><span>${r.itens.length} ${r.itens.length === 1 ? 'item' : 'itens'}${r.total_fechado ? '' : ' · total ainda pode mudar'}</span><span>Total <b>${esc(dinheiro(r.total))}</b></span></div>
    </div>
    ${r.pagamento?.parcelas?.length ? `<div class="hint">${r.pagamento.parcelas.map((p) => `${p.numero}ª parcela ${esc(dataBr(p.vencimento))}: ${esc(dinheiro(p.valor))}`).join(' · ')}</div>`
      : r.pagamento?.parcelas_a_definir ? '<div class="hint">Parcelas definidas depois pela Souza Ribeiro.</div>' : ''}
    ${r.credito?.situacao ? `<div class="rv-aviso ${r.credito.situacao === 'liberado' ? '' : 'bad'}"><b>${esc(CREDITO[r.credito.situacao] || '')}</b>${r.credito.mensagem ? ` — ${esc(r.credito.mensagem)}` : ''}</div>` : ''}
    ${htmlPendencias(r.pendencias)}
    ${bloqueado ? '<div class="rv-aviso bad">Seu cadastro está com compras bloqueadas: não é possível enviar o pedido.</div>' : ''}
    ${!r.pode_enviar && !bloqueado ? `<div class="hint">${soFornecedor ? 'Essa pendência depende da Souza Ribeiro. Escolha outra opção (por exemplo, Retirada) ou fale com o seu vendedor.' : 'Ajuste o que está indicado acima: a revisão é refeita sozinha.'}</div>` : ''}`;
  const ok = $('cOk'); if (ok) ok.disabled = !(r.pode_enviar && !bloqueado && revisaoValida());
}

async function enviar() {
  if (!revisaoValida() || !revisao.dados.pode_enviar || sessao.comprador?.compra_bloqueada) return;
  const corpo = { ...revisao.corpo, assinatura: revisao.dados.assinatura };
  const semAss = (c) => { const { assinatura, ...resto } = c; void assinatura; return JSON.stringify(resto); };
  // Mesmo carrinho depois de REVISAO_ALTERADA: mesma chave, assinatura nova. Carrinho diferente: chave nova.
  pendente = pendente && pendente.comprador === sessao.comprador.codigo && semAss(pendente.corpo) === semAss(corpo)
    ? atualizarAssinatura(pendente, corpo.assinatura) : prepararEnvio(corpo);
  rodarEnvio();
}

function travar(sim) {
  ocupado = sim;
  $('chkBox').querySelectorAll('input, textarea, #qAdd, #cX').forEach((el) => { el.disabled = sim; });
  const ok = $('cOk'); if (ok) ok.disabled = true;
}

async function rodarEnvio(opcoesEnvio = {}) {
  const alvo = $('cEnvio'); if (!alvo) return;
  travar(true);
  let relogio = null;
  const progresso = (texto, segundos) => {
    if (relogio) clearInterval(relogio);
    let resta = segundos || 0;
    const pintar = () => { alvo.innerHTML = `<div class="rv-aviso">${esc(texto)}${resta > 0 ? ` Nova tentativa em ${resta} s.` : ''}</div>`; };
    pintar();
    if (resta > 0) relogio = setInterval(() => { resta -= 1; if (resta <= 0) clearInterval(relogio); if (alvo.isConnected) pintar(); }, 1000);
  };
  const r = await executarEnvio(pendente, progresso, opcoesEnvio);
  if (relogio) clearInterval(relogio);
  ocupado = false;
  if (r.tipo === 'sessao' || !alvo.isConnected) return;

  if (r.tipo === 'pedido') { pendente = null; revisao = null; esvaziar(); sucesso(r.pedido); return; }
  const destravar = () => travar(false);

  if (r.tipo === 'revisao_alterada') {
    destravar();
    alvo.innerHTML = '';
    await revisar();
    $('cEnvio').innerHTML = `<div class="rv-aviso bad"><b>Os valores mudaram.</b> ${esc(r.erro.message)} Confira o resumo atualizado e clique em Confirmar pedido.</div>`;
    $('cResumo').scrollIntoView({ block: 'nearest' });
    return;
  }
  if (r.tipo === 'bloqueada') {
    registrarPendenciasFornecedor(r.pendencias, r.erro.requestId, 'POST pedidos');
    pendente = null; revisao = null; destravar();
    alvo.innerHTML = `<div class="rv-aviso bad"><b>O pedido não foi enviado.</b> ${esc(r.erro.message)}</div>${htmlPendencias(r.pendencias)}
      <div class="hint">Código para o suporte: ${esc([r.erro.codigo, r.erro.requestId].filter(Boolean).join(' · '))}</div>`;
    return;
  }
  if (r.tipo === 'sem_conexao') {
    alvo.innerHTML = `<div class="rv-aviso bad"><b>Sem conexão com o servidor.</b> Ainda não sabemos se o pedido foi gravado. Confira a internet e clique em Tentar de novo: primeiro conferimos o pedido e só depois reenviamos.</div>
      <div class="act"><button type="button" class="btn pri" id="cTentar">Tentar de novo</button></div>`;
    $('cTentar').onclick = () => rodarEnvio({ consultarPrimeiro: true });
    return;
  }
  if (r.tipo === 'chave_reutilizada') {
    alvo.innerHTML = '';
    mostrarMensagemErro(alvo, r.erro);
    alvo.insertAdjacentHTML('beforeend', '<div class="hint">Conferimos: nenhum pedido foi gravado com esse envio. Para mandar o carrinho atual, comece um envio novo.</div><div class="act"><button type="button" class="btn pri" id="cNovo">Começar envio novo</button></div>');
    $('cNovo').onclick = () => { apagarPendente(); pendente = null; destravar(); alvo.innerHTML = ''; revisar(); };
    return;
  }
  if (r.podeTentar) {
    alvo.innerHTML = '';
    mostrarMensagemErro(alvo, r.erro, { aoTentarDeNovo: () => rodarEnvio({ consultarPrimeiro: true }) });
  } else {
    pendente = null; destravar(); alvo.innerHTML = '';
    mostrarMensagemErro(alvo, r.erro);
  }
}

function sucesso(p) {
  $('chkBox').innerHTML = `<div class="ok"><div class="ic2">✓</div><h3>Pedido enviado!</h3>
    <p>${p.numero ? `Pedido nº <b>${esc(p.numero)}</b>` : '<b>Aguardando aprovação</b>'} · ${esc(p.situacao_nome || '')}<br>Total de <b>${esc(dinheiro(p.total))}</b>${p.data ? `<br>${esc(dataBr(p.data))}${p.hora ? ` às ${esc(p.hora)}` : ''}` : ''}</p></div>
    <div class="act" style="justify-content:center"><button type="button" class="btn sec" id="okP">Ver meus pedidos</button><button type="button" class="btn pri" id="okC">Continuar comprando</button></div>`;
  $('okP').onclick = () => { fecharModal('mChk'); ctx.ir(`/pedidos/${p.id}`); };
  $('okC').onclick = () => { fecharModal('mChk'); ctx.ir('/catalogo'); };
}
