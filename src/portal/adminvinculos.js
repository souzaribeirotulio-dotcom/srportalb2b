/* Painel: "Indicado por" nos pedidos de Quero ser cliente (programa Executivo de Contas).
   - Quem tem a permissão 'executivos' vê o executivo de cada pedido e pode confirmar, trocar ou remover.
   - Ao aprovar ou reprovar (qualquer operador), o vínculo acompanha: aprovado → ativo (ou "sem comissão"
     se o cliente já existia), reprovado → recusado. Falha aqui nunca impede a aprovação. */
import { chamarExecutivos } from '../api/executivos.js';
import { esc, toast, abrirModal, fecharModal, $ } from './comum.js';
import { SITV } from './adminexecutivos.js';

let dados = null; // { executivos, porCadastro: Map, pode }

export async function carregarVinculos(token) {
  try {
    const r = (await chamarExecutivos(token, 'vinculos_cadastros')).dados;
    dados = { pode: true, executivos: r.executivos || [], porCadastro: new Map((r.vinculos || []).map((v) => [v.cadastro_id, v])) };
  } catch (e) { if (e.status === 401) throw e; dados = { pode: false, executivos: [], porCadastro: new Map() }; }
  return dados;
}
export const podeVincular = () => !!dados?.pode;

/** Linha "Indicado por" do pedido (vazia se não houver indicação). */
export function htmlIndicado(k) {
  const v = dados?.porCadastro.get(k.id);
  const e = v && dados.executivos.find((x) => x.id === v.executivo_id);
  if (v && e && v.situacao !== 'removido') {
    const sem = v.situacao === 'sem_comissao';
    return `<small class="ex-ind${sem ? ' sem' : ''}">🤝 Indicado por: <b>${esc(e.nome)}</b> (${esc(e.codigo)}) · ${esc(SITV[v.situacao] || v.situacao)}${sem ? ' — Cliente já existente — não gera comissão' : ''}</small>`;
  }
  if (k.executivo_codigo) return `<small class="ex-ind sem">🤝 Código do executivo informado: <b>${esc(k.executivo_codigo)}</b>${dados?.pode ? ' — código não encontrado ou executivo desativado' : ''}</small>`;
  return '';
}

/** Confirmar, trocar ou remover o executivo de um pedido (antes de aprovar). */
export function abrirVinculoPedido(k, { token, depois }) {
  if (!dados?.pode) return;
  const v = dados.porCadastro.get(k.id);
  const atual = v && ['aguardando', 'ativo'].includes(v.situacao) ? v.executivo_id : '';
  abrirModal('mAdm');
  $('admBox').innerHTML = `<div class="fxh"><div><h3>Executivo do pedido</h3><div class="sub">${esc(k.fantasia || k.razao_social)}${k.executivo_codigo ? ` · código informado: ${esc(k.executivo_codigo)}` : ''}</div></div><button class="fxx" id="vxX" title="Fechar">×</button></div>
    <div class="fgrid"><div class="full"><label for="vxSel">Indicado por</label><select class="inp" id="vxSel">
      <option value="">Ninguém (sem executivo)</option>
      ${dados.executivos.filter((e) => e.ativo || e.id === atual).map((e) => `<option value="${esc(e.id)}" ${e.id === atual ? 'selected' : ''}>${esc(e.nome)} (${esc(e.codigo)})</option>`).join('')}
    </select><small class="hint" style="display:block;margin-top:4px">O vínculo vale a partir da aprovação. Cliente que já existia no G360 ou já usava o portal fica "sem comissão" (regra "só clientes novos").</small></div></div>
    <div class="okmsg" id="vxMsg" aria-live="polite"></div>
    <div class="act"><button class="btn sec" id="vxCancela" type="button">Cancelar</button><button class="btn pri" id="vxOk" type="button">Salvar</button></div>`;
  const fechar = () => fecharModal('mAdm');
  $('vxX').onclick = fechar; $('vxCancela').onclick = fechar;
  $('vxOk').onclick = async () => {
    const sel = $('vxSel').value || null;
    $('vxOk').disabled = true; $('vxMsg').className = 'okmsg'; $('vxMsg').textContent = 'Salvando…';
    try {
      await chamarExecutivos(token(), 'vinculo_definir', { cadastro_id: k.id, executivo_id: sel });
      await carregarVinculos(token()); fechar(); toast(sel ? 'Executivo do pedido salvo ✓' : 'Pedido sem executivo ✓'); depois?.();
    } catch (e) { $('vxOk').disabled = false; $('vxMsg').className = 'okmsg err'; $('vxMsg').textContent = e.message; }
  };
}

/** Executivo indicado no pedido (para sugerir o vendedor no Novo cliente). Nunca lança. */
export async function executivoDoPedido(token, k) {
  try { return (await chamarExecutivos(token, 'vinculo_do_cadastro', { cadastro_id: k.id })).dados; } catch { return null; }
}

/** Aprovado e ligado ao código do G360: ativa o vínculo. Nunca lança; avisa quando não gera comissão. */
export async function ativarVinculo(token, k, codigo, novo) {
  try {
    const r = (await chamarExecutivos(token, 'vinculo_ativar', { cadastro_id: k.id, cliente_codigo: Number(codigo), novo: novo === true })).dados;
    if (r?.situacao === 'sem_comissao') toast('Cliente já existente — o vínculo com o executivo não gera comissão.');
    if (r) await carregarVinculos(token).catch(() => {});
    return r;
  } catch { return null; }
}

export async function recusarVinculo(token, k) {
  try { await chamarExecutivos(token, 'vinculo_recusar', { cadastro_id: k.id }); await carregarVinculos(token).catch(() => {}); } catch { /* segue */ }
}
