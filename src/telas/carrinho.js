/* Carrinho, revisão (Etapa 7) e envio do pedido (Etapa 8).
   Os totais que valem são os da revisão. Antes dela, só a estimativa
   preço × quantidade, calculada com decimal.js e marcada como estimada. */
import { consultarOpcoes, revisarPedido, buscarReferenciasEndereco, incluirEndereco, ErroApi } from '../api/g360.js';
import { sessao } from '../estado/sessao.js';
import { linhasCarrinho, alterarQuantidade, remover, esvaziar, itensParaApi, versaoCarrinho, MAX_LINHAS } from '../estado/carrinho.js';
import { pendenteDoComprador, prepararEnvio, executarEnvio, atualizarAssinatura, apagarPendente } from '../estado/envio.js';
import { registrarPendenciasFornecedor } from '../estado/ocorrencias.js';
import { mostrarMensagemErro } from '../ui/mensagem.js';
import { dinheiro, quantidade, normalizarQuantidade, estimar, dataBr } from '../ui/formato.js';
import { carregando, vazia, erroTela, titulo } from '../ui/telas-comum.js';
import { esc } from '../ui/util.js';
import { htmlPedidoResumo } from './pedidos.js';

const escolha = { modalidade: null, endereco_id: null, condicao_id: null, observacao: '' };
let revisao = null; // { versao, chaveEscolha, dados, requestId, corpo }
let opcoes = null;  // { token, dados }
let pendenteAtual = null;
let ultimoPedido = null;

export function limparCarrinhoTela() {
  Object.assign(escolha, { modalidade: null, endereco_id: null, condicao_id: null, observacao: '' });
  revisao = null; opcoes = null; pendenteAtual = null; ultimoPedido = null;
}

const ROTULO_RESP = { usuario: 'Para você ajustar', fornecedor: 'Depende da Souza Ribeiro', tentar_de_novo: 'Tente de novo em instantes', integracao: 'Erro no portal' };
const FRETE = { definido: 'Frete', gratis: 'Frete grátis', a_combinar: 'Frete a combinar', nao_aplicavel: 'Retirada: sem frete' };
const CREDITO = { liberado: 'Crédito liberado', aviso: 'Atenção ao crédito', aguardando_aprovacao: 'Pedido vai aguardar aprovação de crédito' };

function chaveEscolha() { return JSON.stringify(escolha); }
function revisaoValida() { return revisao && revisao.versao === versaoCarrinho() && revisao.chaveEscolha === chaveEscolha(); }

function corpoRevisao(op) {
  const corpo = { itens: itensParaApi(), modalidade: escolha.modalidade };
  if (escolha.modalidade === 'entrega' && escolha.endereco_id) corpo.endereco_id = Number(escolha.endereco_id);
  if (op && op.pagamento.exigido !== 'nenhum' && escolha.condicao_id) corpo.condicao_pagamento_id = Number(escolha.condicao_id);
  const obs = escolha.observacao.trim();
  if (obs) corpo.observacao = obs;
  return corpo;
}

function htmlPendencias(lista) {
  if (!lista?.length) return '';
  return `<ul class="pendencias">${lista.map((p) => `<li class="pend-${esc(p.responsavel)}"><strong>${esc(ROTULO_RESP[p.responsavel] || 'Pendência')}</strong><span>${esc(p.mensagem)}</span></li>`).join('')}</ul>`;
}

export function telaCarrinho({ conteudo, ir, eAtual }) {
  conteudo.innerHTML = `${titulo('Carrinho')}<div id="g360Pendente"></div><div id="g360Carrinho"></div>`;
  const area = conteudo.querySelector('#g360Carrinho');
  const areaPendente = conteudo.querySelector('#g360Pendente');

  if (ultimoPedido) { mostrarPedidoEnviado(); return; }

  // Envio anterior ainda sem resposta final (por exemplo, a página recarregou no meio).
  const pend = pendenteDoComprador();
  if (pend) {
    areaPendente.innerHTML = `<div class="app-aviso" role="status"><strong>Há um envio de pedido sem confirmação.</strong>
      <p>Antes de começar outro, vamos conferir se ele foi gravado.</p>
      <button type="button" class="g360-btn pri" id="g360ConferirPendente">Conferir agora</button></div>`;
    areaPendente.querySelector('#g360ConferirPendente').addEventListener('click', () => {
      pendenteAtual = pend;
      areaPendente.innerHTML = '';
      desenharCarrinho();
      rodarEnvio({ consultarPrimeiro: true });
    });
  }

  if (!linhasCarrinho().length && !pend) {
    vazia(area, 'Seu carrinho está vazio.', 'Escolha os produtos no catálogo, na Minha Lista ou em Comprar de novo.',
      '<button type="button" class="g360-btn pri" id="g360IrCatalogo">Ir para o catálogo</button>');
    area.querySelector('#g360IrCatalogo').addEventListener('click', () => ir('/catalogo'));
    return;
  }

  carregando(area, 'Carregando as opções de entrega e pagamento…');
  // Opções do momento (endereços e condições podem mudar no G360): uma consulta por abertura da tela.
  carregarOpcoes(true).then(() => { if (eAtual()) desenharCarrinho(); })
    .catch((e) => { if (eAtual()) erroTela(area, e, () => telaCarrinho({ conteudo, ir, eAtual })); });

  async function carregarOpcoes(forcar = false) {
    if (!forcar && opcoes && opcoes.token === sessao.token) return opcoes.dados;
    const dados = await consultarOpcoes(sessao.token);
    opcoes = { token: sessao.token, dados };
    if (!dados.modalidades.includes(escolha.modalidade)) escolha.modalidade = dados.modalidades.includes('retirada') && dados.modalidades.length === 1 ? 'retirada' : dados.modalidades[0] || null;
    if (!dados.enderecos.some((e) => e.id === Number(escolha.endereco_id))) escolha.endereco_id = dados.enderecos[0]?.id ?? null;
    const conds = dados.pagamento.condicoes;
    if (!conds.some((c) => c.id === Number(escolha.condicao_id))) escolha.condicao_id = (conds.find((c) => c.padrao) || conds[0])?.id ?? null;
    return dados;
  }

  function desenharCarrinho() {
    const op = opcoes.dados;
    const linhas = linhasCarrinho();
    const est = estimar(linhas);
    const rev = revisaoValida() ? revisao.dados : null;
    const itensRev = new Map((rev?.itens || []).map((i) => [`${i.produto_id}|${i.unidade_id ?? ''}`, i]));
    const bloqueado = sessao.comprador?.compra_bloqueada === true;

    area.innerHTML = `
      ${linhas.length ? `<ul class="linhas-carrinho">${linhas.map((l) => {
        const k = `${l.produto_id}|${l.unidade ?? ''}`;
        const ri = itensRev.get(k);
        return `<li class="linha" data-k="${esc(k)}">
          <div class="linha-info"><span class="cp-codigo">${esc(l.codigo)}</span><strong>${esc(l.nome)}</strong>
            <span class="linha-unid">${esc(l.unidadeNome || '')}</span>
            ${ri ? `<span class="linha-preco">${esc(dinheiro(ri.preco_unitario))} × ${esc(quantidade(ri.quantidade))} = <strong>${esc(dinheiro(ri.total))}</strong>${ri.seu_preco ? ' <span class="selo-seu-preco">Seu preço</span>' : ''}</span>`
              : `<span class="linha-preco estimado">${l.precoTexto ? `${esc(dinheiro(l.precoTexto))} cada (estimado)` : 'Preço na revisão'}</span>`}
            ${ri?.aviso ? `<span class="cp-aviso">${esc(ri.aviso)}</span>` : ''}
            ${ri?.pendencia ? `<span class="linha-pendencia">${esc(ri.pendencia)}</span>` : ''}
          </div>
          <div class="linha-acoes">
            <label class="sr" for="lq${esc(k)}">Quantidade de ${esc(l.nome)}</label>
            <input id="lq${esc(k)}" class="cp-qtd linha-qtd" type="text" inputmode="decimal" value="${esc(quantidade(l.quantidade))}" maxlength="13">
            <button type="button" class="app-link linha-remover">Remover</button>
          </div>
          <small class="linha-erro" aria-live="polite"></small>
        </li>`;
      }).join('')}</ul>
      <p class="estimativa">${rev ? '' : `Estimativa: <strong>${esc(dinheiro(est.total))}</strong> <span>(estimado${est.completo ? '' : ', sem os itens sem preço'}; os valores que valem aparecem na revisão)</span>`}</p>
      <p class="g360-mini">${linhas.length} de ${MAX_LINHAS} linhas.</p>` : ''}

      <fieldset class="bloco"><legend>Entrega</legend>
        ${op.modalidades.length ? op.modalidades.map((m) => `<label class="opcao"><input type="radio" name="modalidade" value="${m}" ${escolha.modalidade === m ? 'checked' : ''}> ${m === 'entrega' ? 'Entrega' : 'Retirada na Souza Ribeiro'}</label>`).join('')
          : '<p class="g360-mini">Nenhuma modalidade disponível para o seu cadastro.</p>'}
        ${escolha.modalidade === 'entrega' ? `
          <div class="enderecos">${op.enderecos.length ? op.enderecos.map((e) => `<label class="opcao endereco"><input type="radio" name="endereco" value="${e.id}" ${Number(escolha.endereco_id) === e.id ? 'checked' : ''}>
            <span><strong>${esc(e.descricao)}</strong>${e.principal ? ' <em>(principal)</em>' : ''}<br>${esc(e.endereco)}, ${esc(e.numero)}${e.complemento ? ` · ${esc(e.complemento)}` : ''} — ${esc(e.cidade)} · CEP ${esc(e.cep)}</span></label>`).join('')
            : '<p class="g360-mini">Nenhum endereço cadastrado.</p>'}</div>
          <details class="novo-endereco" id="g360NovoEndereco"><summary>Cadastrar outro endereço</summary><div id="g360FormEndereco"></div></details>` : ''}
      </fieldset>

      ${op.pagamento.exigido !== 'nenhum' ? `<fieldset class="bloco"><legend>Pagamento</legend>
        ${op.pagamento.condicoes.length ? `<label for="g360Condicao">Condição de pagamento</label>
          <select id="g360Condicao">${op.pagamento.condicoes.map((c) => `<option value="${c.id}" ${Number(escolha.condicao_id) === c.id ? 'selected' : ''}>${esc(c.descricao)}${c.pedido_minimo ? ` · pedido mínimo ${esc(dinheiro(c.pedido_minimo))}` : ''}</option>`).join('')}</select>`
          : '<p class="g360-mini">Nenhuma condição de pagamento liberada para o seu cadastro. A revisão vai indicar o que fazer.</p>'}
      </fieldset>` : ''}

      <fieldset class="bloco"><legend>Observação</legend>
        <label for="g360Obs" class="sr">Observação do pedido</label>
        <textarea id="g360Obs" maxlength="400" rows="3" placeholder="Opcional">${esc(escolha.observacao)}</textarea>
        <small class="g360-ajuda"><span id="g360ObsConta">${escolha.observacao.length}</span>/400 caracteres</small>
      </fieldset>

      <div class="acoes-carrinho">
        <button type="button" class="g360-btn ${rev ? 'sec' : 'pri'}" id="g360Revisar" ${linhas.length ? '' : 'disabled'}>${rev ? 'Revisar de novo' : 'Revisar pedido'}</button>
        <button type="button" class="app-link" id="g360Esvaziar" ${linhas.length ? '' : 'disabled'}>Esvaziar carrinho</button>
      </div>
      <div id="g360Revisao" aria-live="polite">${rev ? htmlRevisao(rev, bloqueado) : ''}</div>
      <div id="g360Envio" aria-live="polite"></div>`;

    ligar(op, bloqueado);
  }

  function htmlRevisao(rev, bloqueado) {
    const parcelas = rev.pagamento?.parcelas || [];
    const credito = rev.credito?.situacao ? `<p class="credito cred-${esc(rev.credito.situacao)}"><strong>${esc(CREDITO[rev.credito.situacao] || '')}</strong>${rev.credito.mensagem ? ` — ${esc(rev.credito.mensagem)}` : ''}</p>` : '';
    const freteValor = rev.frete.situacao === 'definido' ? esc(dinheiro(rev.frete.valor)) : rev.frete.situacao === 'gratis' ? 'R$ 0,00' : rev.frete.situacao === 'a_combinar' ? 'a combinar' : '—';
    return `<section class="resumo" aria-labelledby="g360ResumoTit">
      <h3 id="g360ResumoTit">Resumo da revisão</h3>
      <dl>
        <div><dt>Subtotal dos produtos</dt><dd>${esc(dinheiro(rev.subtotal))}</dd></div>
        <div><dt>${esc(FRETE[rev.frete.situacao] || 'Frete')}</dt><dd>${freteValor}</dd></div>
        ${rev.taxa_pagamento && rev.taxa_pagamento !== '0.00' ? `<div><dt>Taxa de pagamento</dt><dd>${esc(dinheiro(rev.taxa_pagamento))}</dd></div>` : ''}
        <div class="total"><dt>Total${rev.total_fechado ? '' : ' (ainda pode mudar)'}</dt><dd>${esc(dinheiro(rev.total))}</dd></div>
      </dl>
      ${rev.pagamento?.descricao ? `<p class="g360-mini">Pagamento: ${esc(rev.pagamento.descricao)}</p>` : ''}
      ${parcelas.length ? `<ul class="parcelas">${parcelas.map((p) => `<li>${p.numero}ª parcela · ${esc(dataBr(p.vencimento))} · ${esc(dinheiro(p.valor))}</li>`).join('')}</ul>`
        : rev.pagamento?.parcelas_a_definir ? '<p class="g360-mini">Parcelas definidas depois pela Souza Ribeiro.</p>' : ''}
      ${credito}
      ${htmlPendencias(rev.pendencias)}
      ${bloqueado ? '<p class="cp-sem">Seu cadastro está com compras bloqueadas: não é possível enviar o pedido.</p>' : ''}
      ${!rev.pode_enviar && !bloqueado ? '<p class="cp-sem">Resolva as pendências acima e revise de novo para poder enviar.</p>' : ''}
      <button type="button" class="g360-btn pri" id="g360Enviar" ${rev.pode_enviar && !bloqueado ? '' : 'disabled'}>Enviar pedido</button>
    </section>`;
  }

  function invalidar() {
    revisao = null;
    const r = area.querySelector('#g360Revisao');
    if (r && r.innerHTML) r.innerHTML = '<p class="app-aviso suave">O carrinho mudou. Clique em <strong>Revisar pedido</strong> para ver os valores atualizados.</p>';
    const b = area.querySelector('#g360Revisar');
    if (b) { b.textContent = 'Revisar pedido'; b.className = 'g360-btn pri'; }
  }

  function ligar(op, bloqueado) {
    area.querySelectorAll('.linha').forEach((li) => {
      const [pid, uni] = li.dataset.k.split('|');
      const unidade = uni || null;
      const campo = li.querySelector('.linha-qtd');
      const erro = li.querySelector('.linha-erro');
      campo.addEventListener('change', () => {
        const q = normalizarQuantidade(campo.value);
        if (!q) { erro.textContent = 'Quantidade inválida: use um número maior que zero.'; campo.setAttribute('aria-invalid', 'true'); return; }
        erro.textContent = ''; campo.removeAttribute('aria-invalid');
        alterarQuantidade(Number(pid), unidade, q);
        desenharCarrinho();
      });
      li.querySelector('.linha-remover').addEventListener('click', () => { remover(Number(pid), unidade); if (linhasCarrinho().length) desenharCarrinho(); else telaCarrinho({ conteudo, ir, eAtual }); });
    });
    area.querySelectorAll('input[name="modalidade"]').forEach((r) => r.addEventListener('change', () => { escolha.modalidade = r.value; desenharCarrinho(); }));
    area.querySelectorAll('input[name="endereco"]').forEach((r) => r.addEventListener('change', () => { escolha.endereco_id = Number(r.value); invalidar(); }));
    area.querySelector('#g360Condicao')?.addEventListener('change', (ev) => { escolha.condicao_id = Number(ev.target.value); invalidar(); });
    const obs = area.querySelector('#g360Obs');
    obs.addEventListener('input', () => {
      escolha.observacao = obs.value;
      area.querySelector('#g360ObsConta').textContent = obs.value.length;
      if (revisao) invalidar();
    });
    area.querySelector('#g360Esvaziar').addEventListener('click', () => { esvaziar(); revisao = null; telaCarrinho({ conteudo, ir, eAtual }); });
    area.querySelector('#g360Revisar').addEventListener('click', revisar);
    area.querySelector('#g360Enviar')?.addEventListener('click', () => enviar());
    const det = area.querySelector('#g360NovoEndereco');
    if (det) det.addEventListener('toggle', () => { if (det.open) formEndereco(area.querySelector('#g360FormEndereco')); }, { once: true });
    void bloqueado; void op;
  }

  async function revisar() {
    const alvo = area.querySelector('#g360Revisao');
    const botao = area.querySelector('#g360Revisar');
    botao.disabled = true;
    carregando(alvo, 'Revisando o pedido…');
    const corpo = corpoRevisao(opcoes.dados);
    try {
      const { dados, requestId } = await revisarPedido(sessao.token, corpo);
      if (!eAtual()) return;
      revisao = { versao: versaoCarrinho(), chaveEscolha: chaveEscolha(), dados, requestId, corpo };
      // Pendências do fornecedor viram ocorrência (uma por código nesta sessão).
      registrarPendenciasFornecedor(dados.pendencias, requestId, 'POST revisoes', true);
      desenharCarrinho();
      area.querySelector('#g360Revisao').scrollIntoView({ block: 'nearest' });
    } catch (e) {
      if (!eAtual()) return;
      botao.disabled = false;
      mostrarMensagemErro(alvo, e, { aoTentarDeNovo: revisar });
    }
  }

  async function enviar() {
    if (!revisaoValida() || !revisao.dados.pode_enviar || sessao.comprador?.compra_bloqueada) return;
    const corpo = { ...revisao.corpo, assinatura: revisao.dados.assinatura };
    const semAssinatura = (c) => { const { assinatura, ...resto } = c; void assinatura; return JSON.stringify(resto); };
    // Mesma intenção (o mesmo carrinho depois de REVISAO_ALTERADA): mesma chave, assinatura nova.
    // Carrinho diferente: o envio anterior já foi resolvido sem pedido, então a chave é nova.
    pendenteAtual = pendenteAtual && pendenteAtual.comprador === sessao.comprador.codigo && semAssinatura(pendenteAtual.corpo) === semAssinatura(corpo)
      ? atualizarAssinatura(pendenteAtual, corpo.assinatura)
      : prepararEnvio(corpo);
    rodarEnvio();
  }

  async function rodarEnvio(opcoesEnvio = {}) {
    const alvo = area.querySelector('#g360Envio');
    const botao = area.querySelector('#g360Enviar');
    if (botao) botao.disabled = true;
    area.querySelectorAll('#g360Revisar, .linha-qtd, .linha-remover, #g360Esvaziar').forEach((b) => { b.disabled = true; });
    let relogio = null;
    const progresso = (texto, segundos) => {
      if (relogio) clearInterval(relogio);
      let resta = segundos || 0;
      const pintar = () => { alvo.innerHTML = `<div class="estado-tela carregando" role="status"><span class="girando" aria-hidden="true"></span>${esc(texto)}${resta > 0 ? ` Nova tentativa em ${resta} s.` : ''}</div>`; };
      pintar();
      if (resta > 0) relogio = setInterval(() => { resta -= 1; if (resta <= 0) clearInterval(relogio); if (alvo.isConnected) pintar(); }, 1000);
    };
    const r = await executarEnvio(pendenteAtual, progresso, opcoesEnvio);
    if (relogio) clearInterval(relogio);
    if (r.tipo === 'sessao' || !alvo.isConnected) return;

    if (r.tipo === 'pedido') {
      ultimoPedido = r.pedido;
      pendenteAtual = null;
      esvaziar();
      revisao = null;
      if (eAtual()) mostrarPedidoEnviado();
      return;
    }
    const reabrir = () => area.querySelectorAll('#g360Revisar, .linha-qtd, .linha-remover, #g360Esvaziar').forEach((b) => { b.disabled = false; });

    if (r.tipo === 'revisao_alterada') {
      alvo.innerHTML = '';
      // Revisa de novo, mostra o que mudou e pede confirmação; a chave continua a mesma.
      const corpo = corpoRevisao(opcoes.dados);
      try {
        const { dados, requestId } = await revisarPedido(sessao.token, corpo);
        revisao = { versao: versaoCarrinho(), chaveEscolha: chaveEscolha(), dados, requestId, corpo };
        desenharCarrinho();
        area.querySelector('#g360Envio').innerHTML = `<div class="g360-msg g360-msg-corrigir" role="alert"><strong class="g360-msg-rotulo">Os valores mudaram</strong>
          <p>${esc(r.erro.message)}</p><p>Confira o resumo atualizado e clique em <strong>Enviar pedido</strong> para confirmar.</p></div>`;
        area.querySelector('#g360Revisao').scrollIntoView({ block: 'nearest' });
      } catch (e) {
        mostrarMensagemErro(alvo, e, { aoTentarDeNovo: () => rodarEnvio() });
      }
      return;
    }
    if (r.tipo === 'bloqueada') {
      registrarPendenciasFornecedor(r.pendencias, r.erro.requestId, 'POST pedidos');
      pendenteAtual = null;
      reabrir();
      alvo.innerHTML = `<div class="g360-msg g360-msg-corrigir" role="alert"><strong class="g360-msg-rotulo">O pedido não foi enviado</strong>
        <p>${esc(r.erro.message)}</p>${htmlPendencias(r.pendencias)}
        <small class="g360-msg-suporte">Código para o suporte: ${esc([r.erro.codigo, r.erro.requestId].filter(Boolean).join(' · '))}</small></div>`;
      revisao = null;
      return;
    }
    if (r.tipo === 'sem_conexao') {
      alvo.innerHTML = `<div class="g360-msg g360-msg-rede" role="alert"><strong class="g360-msg-rotulo">Sem conexão com o servidor</strong>
        <p>Não sabemos ainda se o pedido foi gravado. Confira a internet e clique em Tentar de novo: primeiro conferimos o pedido e só depois reenviamos.</p>
        <button type="button" class="g360-btn sec g360-msg-botao" id="g360TentarEnvio">Tentar de novo</button></div>`;
      alvo.querySelector('#g360TentarEnvio').addEventListener('click', () => rodarEnvio({ consultarPrimeiro: true }));
      return;
    }
    if (r.tipo === 'chave_reutilizada') {
      alvo.innerHTML = '';
      mostrarMensagemErro(alvo, r.erro);
      alvo.insertAdjacentHTML('beforeend', `<div class="g360-acoes"><p class="g360-mini">Conferimos: nenhum pedido foi gravado com esse envio. Para mandar o carrinho atual, comece um envio novo.</p>
        <button type="button" class="g360-btn pri" id="g360EnvioNovo">Começar envio novo</button></div>`);
      alvo.querySelector('#g360EnvioNovo').addEventListener('click', () => { apagarPendente(); pendenteAtual = null; reabrir(); revisar(); alvo.innerHTML = ''; });
      return;
    }
    // erro
    if (r.podeTentar) {
      mostrarMensagemErro(alvo, r.erro, { aoTentarDeNovo: () => rodarEnvio({ consultarPrimeiro: true }) });
    } else {
      pendenteAtual = null;
      reabrir();
      mostrarMensagemErro(alvo, r.erro);
    }
  }

  function mostrarPedidoEnviado() {
    const p = ultimoPedido;
    ultimoPedido = null; // aparece uma vez; na próxima visita o carrinho volta ao normal
    area.innerHTML = `<div class="g360-ok enviado" role="status"><strong>Pedido enviado!</strong>
      ${htmlPedidoResumo(p)}
      <div class="g360-acoes linha-botoes">
        <button type="button" class="g360-btn pri" id="g360VerPedido">Ver o pedido</button>
        <button type="button" class="g360-btn sec" id="g360Continuar">Continuar comprando</button>
      </div></div>`;
    area.querySelector('#g360VerPedido').addEventListener('click', () => ir(`/pedidos/${p.id}`));
    area.querySelector('#g360Continuar').addEventListener('click', () => ir('/catalogo'));
  }

  function formEndereco(alvo) {
    alvo.innerHTML = `<form class="g360-form form-endereco" novalidate>
      <label for="eDesc">Nome do endereço</label><input id="eDesc" maxlength="50" placeholder="Ex.: Depósito">
      <label for="eRua">Endereço</label><input id="eRua" maxlength="90" autocomplete="address-line1">
      <div class="duas"><div><label for="eNum">Número</label><input id="eNum" maxlength="10"></div>
        <div><label for="eCep">CEP</label><input id="eCep" maxlength="9" inputmode="numeric" autocomplete="postal-code"></div></div>
      <label for="eComp">Complemento</label><input id="eComp" maxlength="60">
      <div class="duas"><div><label for="eUf">UF</label><input id="eUf" maxlength="2" autocapitalize="characters" value="MG"></div>
        <div><label for="eCidadeBusca">Cidade</label><input id="eCidadeBusca" maxlength="70" placeholder="Digite e busque"></div></div>
      <button type="button" class="g360-btn sec" id="eBuscarCidade">Buscar cidade</button>
      <select id="eCidade" aria-label="Cidade encontrada"><option value="">Escolha a cidade</option></select>
      <label for="eBairroBusca">Bairro</label><input id="eBairroBusca" maxlength="70" placeholder="Digite e busque">
      <button type="button" class="g360-btn sec" id="eBuscarBairro">Buscar bairro</button>
      <select id="eBairro" aria-label="Bairro encontrado"><option value="">Escolha o bairro</option></select>
      <small class="g360-erro-campo" id="eErro" aria-live="polite"></small>
      <button type="submit" class="g360-btn pri">Salvar endereço</button>
      <div id="eResultado" aria-live="polite"></div>
    </form>`;
    const f = alvo.querySelector('form');
    const v = (id) => f.querySelector(`#${id}`).value.trim();
    const erro = f.querySelector('#eErro');
    const buscar = async (tipo, entrada, select) => {
      erro.textContent = '';
      const q = v(entrada);
      if (q.length < 2) { erro.textContent = 'Digite pelo menos 2 letras para buscar.'; return; }
      if (tipo === 'cidade' && !/^[A-Za-z]{2}$/.test(v('eUf'))) { erro.textContent = 'Informe a UF com 2 letras.'; return; }
      try {
        const lista = await buscarReferenciasEndereco(sessao.token, tipo, q, tipo === 'cidade' ? v('eUf').toUpperCase() : undefined);
        const sel = f.querySelector(`#${select}`);
        sel.innerHTML = `<option value="">${lista.length ? `Escolha (${lista.length} encontrados)` : 'Nada encontrado'}</option>` + lista.map((r) => `<option value="${r.id}">${esc(r.nome)}</option>`).join('');
      } catch (e) { mostrarMensagemErro(f.querySelector('#eResultado'), e); }
    };
    f.querySelector('#eBuscarCidade').addEventListener('click', () => buscar('cidade', 'eCidadeBusca', 'eCidade'));
    f.querySelector('#eBuscarBairro').addEventListener('click', () => buscar('bairro', 'eBairroBusca', 'eBairro'));
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      erro.textContent = '';
      const corpo = {
        descricao: v('eDesc'), endereco: v('eRua'), numero: v('eNum'), cep: v('eCep'),
        cidade_id: Number(v('eCidade')), bairro_id: Number(v('eBairro')), uf: v('eUf').toUpperCase(),
      };
      if (v('eComp')) corpo.complemento = v('eComp');
      if (!corpo.descricao || !corpo.endereco || !corpo.numero) { erro.textContent = 'Preencha nome, endereço e número.'; return; }
      if (!/^[0-9]{5}-?[0-9]{3}$/.test(corpo.cep)) { erro.textContent = 'CEP no formato 00000-000.'; return; }
      if (!corpo.cidade_id || !corpo.bairro_id) { erro.textContent = 'Busque e escolha a cidade e o bairro.'; return; }
      const b = f.querySelector('button[type="submit"]');
      b.disabled = true;
      try {
        const novo = await incluirEndereco(sessao.token, corpo);
        escolha.endereco_id = novo.id;
        await carregarOpcoes(true);
        revisao = null;
        desenharCarrinho();
      } catch (e) {
        b.disabled = false;
        mostrarMensagemErro(f.querySelector('#eResultado'), e);
      }
    });
  }
  void ErroApi;
}
