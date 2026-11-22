/* =====================================================================
   Negociação de preço (lado do comprador), como no portal antigo:
   - "🤝 Solicitar negociação" no carrinho ou "Negociar preço" no produto;
   - o pedido vai para portal_negociacoes (Supabase, só a sessão vinculada
     grava e lê as suas linhas); a equipe responde no painel;
   - aprovada = a equipe grava um preço congelado no G360, e o catálogo
     passa a mostrar o "Seu preço" que a API devolver. O portal não calcula
     nem envia preço para o pedido.
   ===================================================================== */
import { sessao, garantirVinculo } from '../estado/sessao.js';
import { supabaseComprador, LOJA } from '../api/supabase.js';
import { $, esc, toast, abrirModal, fecharModal } from './comum.js';
import { dinheiro, dataBr, quantidade as fmtQtd, normalizarQuantidade } from '../ui/formato.js';
import { opcoesUnidade } from './cartao.js';
import { avisarEvento } from '../api/push.js';

const MSG = 'As negociações estão indisponíveis no momento. Tente de novo em instantes.';
const SIT = { aberta: 'Aguardando resposta', aprovada: 'Aprovada', recusada: 'Recusada', cancelada: 'Cancelada' };

async function cliente() {
  if (!(await garantirVinculo())) throw new Error(MSG);
  return supabaseComprador();
}

/** Valor digitado pelo comprador ("12,50") → texto decimal com ponto, ou null. */
function valorDigitado(t) {
  const s = String(t || '').trim().replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  return /^\d{1,11}(\.\d{1,4})?$/.test(s) && Number(s) > 0 ? s : null;
}

/**
 * itens: [{ produto, op: { id, nome, preco }, quantidade }] — produto já apresentado (nome do portal, preço da API).
 * Abre o formulário: preço desejado por item + mensagem.
 */
export function abrirNegociacao(itens) {
  if (!sessao.ativa) return;
  if (!itens.length) { toast('Coloque produtos no carrinho para negociar.'); return; }
  const linhas = itens.slice(0, 30).map(({ produto: p, op, quantidade }) => ({ p, op: op || opcoesUnidade(p)[0], quantidade }));
  $('cadBox').innerHTML = `<h3>🤝 Solicitar negociação</h3>
    <div class="sub">Diga o preço que você gostaria de pagar. A equipe da Souza Ribeiro responde por aqui, em <b>Meus Pedidos</b>. Se aprovar, o preço já aparece no catálogo como <b>Seu preço</b>.</div>
    <div class="negitens">${linhas.map((l, i) => `<div class="negit" data-i="${i}">
      <div class="nm"><b>${esc(l.p.nome)}</b><small>Cód. ${esc(l.p.codigo)} · hoje ${l.op.preco ? esc(dinheiro(l.op.preco)) : '—'} / ${esc(String(l.op.nome).toLowerCase())}${l.quantidade ? ` · ${esc(fmtQtd(l.quantidade))} no carrinho` : ''}</small></div>
      <label class="negv"><span>Preço desejado (R$)</span><input class="inp" inputmode="decimal" maxlength="14" placeholder="Opcional" aria-label="Preço desejado para ${esc(l.p.nome)}"></label></div>`).join('')}</div>
    <label for="ngMsg">Mensagem para a equipe <span style="text-transform:none;font-weight:400">(opcional)</span></label>
    <textarea class="inp" id="ngMsg" rows="3" maxlength="400" placeholder="Ex.: compro 50 caixas por mês; a concorrência faz por R$ 22,00." style="width:100%;resize:vertical"></textarea>
    <div class="err" id="ngErr" aria-live="polite"></div>
    <div class="act"><button type="button" class="btn sec" id="ngCancelar">Cancelar</button><button type="button" class="btn pri" id="ngEnviar">Enviar pedido de negociação</button></div>`;
  abrirModal('mCad');
  $('ngCancelar').onclick = () => fecharModal('mCad');
  $('ngEnviar').onclick = async () => {
    const msg = $('ngMsg').value.trim();
    const pedidos = [];
    let ruim = false;
    $('cadBox').querySelectorAll('.negit').forEach((el) => {
      const inp = el.querySelector('input'); const t = inp.value.trim();
      inp.removeAttribute('aria-invalid');
      if (!t) return;
      const v = valorDigitado(t);
      if (!v) { ruim = true; inp.setAttribute('aria-invalid', 'true'); return; }
      const l = linhas[Number(el.dataset.i)];
      pedidos.push({
        loja: LOJA, comprador_codigo: sessao.comprador.codigo, comprador_nome: (sessao.comprador.fantasia || sessao.comprador.nome || '').slice(0, 200) || null,
        produto_id: Number(l.p.id), codigo: String(l.p.codigo), produto_nome: String(l.p.nome).slice(0, 200), unidade: l.op.id ? String(l.op.nome).slice(0, 40) : null, unidade_id: l.op.id ? String(l.op.id) : null,
        preco_atual: l.op.preco ?? null, preco_desejado: v, quantidade: normalizarQuantidade(l.quantidade || '') || null, mensagem: msg || null,
      });
    });
    if (ruim) { $('ngErr').textContent = 'Confira os preços: use números, como 12,50.'; return; }
    if (!pedidos.length) { $('ngErr').textContent = 'Digite o preço desejado em pelo menos um produto.'; return; }
    const b = $('ngEnviar'); b.disabled = true; b.textContent = 'Enviando…';
    try {
      const sb = await cliente();
      const { error } = await sb.from('portal_negociacoes').insert(pedidos);
      if (error) throw new Error(MSG);
      avisarEvento('negociacao'); // aviso para os gestores
    } catch (e) { b.disabled = false; b.textContent = 'Enviar pedido de negociação'; $('ngErr').textContent = e.message; return; }
    $('cadBox').innerHTML = `<div class="ok"><div class="ic2">✓</div><h3>Pedido de negociação enviado!</h3>
      <p>A equipe da Souza Ribeiro vai analisar ${pedidos.length === 1 ? 'o produto' : `os ${pedidos.length} produtos`}. Acompanhe a resposta em <b>Meus Pedidos</b>.</p></div>
      <div class="act" style="justify-content:center"><button type="button" class="btn pri" id="ngOk">Entendi</button></div>`;
    $('ngOk').onclick = () => fecharModal('mCad');
  };
}

/** "Minhas negociações" abaixo de Meus Pedidos. */
export async function desenharMinhasNegociacoes() {
  const alvo = $('negClientView'); if (!alvo) return;
  if (!sessao.ativa || !sessao.supabaseOk) { alvo.innerHTML = ''; return; }
  alvo.innerHTML = '<div class="panel" style="margin-top:16px"><div class="empty2">Carregando negociações…</div></div>';
  let dados;
  try {
    const sb = await cliente();
    const { data, error } = await sb.from('portal_negociacoes').select('id, produto_nome, codigo, unidade, preco_atual, preco_desejado, status, preco_aprovado, valido_ate, resposta, criado_em')
      .order('criado_em', { ascending: false }).limit(100);
    if (error) throw new Error(MSG);
    dados = data || [];
  } catch (e) { alvo.innerHTML = `<div class="panel" style="margin-top:16px"><div class="empty2">${esc(e.message)}</div></div>`; return; }
  if (!dados.length) { alvo.innerHTML = ''; return; }
  alvo.innerHTML = `<div class="ph" style="margin-top:22px"><div><h2>Minhas <em>negociações</em></h2><p>Pedidos de preço enviados pelo carrinho ou pelo produto.</p></div></div>
    <div class="panel">${dados.map((n) => `<div class="ped" data-id="${esc(n.id)}"><div><b>${esc(n.produto_nome)}</b> <span class="st sit-${n.status === 'aprovada' ? 'faturado' : n.status === 'recusada' || n.status === 'cancelada' ? 'cancelado' : 'aberto'}">${SIT[n.status] || esc(n.status)}</span>
        <div class="m">Cód. ${esc(n.codigo)}${n.unidade ? ` · ${esc(n.unidade)}` : ''} · pedido em ${esc(new Date(n.criado_em).toLocaleDateString('pt-BR'))} · você pediu ${esc(dinheiro(n.preco_desejado))}${n.preco_atual ? ` (era ${esc(dinheiro(n.preco_atual))})` : ''}</div>
        ${n.status === 'aprovada' ? `<div class="m" style="color:var(--lima)">Preço aprovado: <b>${esc(dinheiro(n.preco_aprovado))}</b>${n.valido_ate ? ` até ${esc(dataBr(n.valido_ate))}` : ''}. Ele aparece no catálogo como “Seu preço”.</div>` : ''}
        ${n.resposta ? `<div class="m">Resposta da equipe: ${esc(n.resposta)}</div>` : ''}</div>
      <div class="v">${n.status === 'aberta' ? '<button type="button" class="tool" data-cancelar>Cancelar</button>' : ''}</div></div>`).join('')}</div>`;
  alvo.querySelectorAll('[data-cancelar]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const sb = await cliente();
      const { error } = await sb.from('portal_negociacoes').update({ status: 'cancelada', atualizado_em: new Date().toISOString() }).eq('id', b.closest('.ped').dataset.id);
      if (error) throw new Error(MSG);
      toast('Negociação cancelada'); desenharMinhasNegociacoes();
    } catch (e) { b.disabled = false; toast(e.message); }
  }));
}
