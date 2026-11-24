/* Painel: aba Executivos (programa Executivo de Contas).
   Só aparece para quem tem a permissão própria 'executivos' (conferida pela função executivos-g360
   com o operador do G360). Cadastro do executivo, link de indicação, conta de acesso e regras. */
import { chamarExecutivos } from '../api/executivos.js';
import { referenciasNovoClienteOperador } from '../api/g360.js';
import { montarSeletorOcultos } from './adminocultos.js';
import { esc, toast } from './comum.js';
import Decimal from 'decimal.js';
import { dataBr, dinheiro } from '../ui/formato.js';

export const SITC = { prevista: 'Prevista', faturada: 'Faturada', liberada: 'Liberada', paga: 'Paga', cancelada: 'Cancelada' };
export const SITV = { aguardando: 'Aguardando aprovação', ativo: 'Ativo', recusado: 'Recusado', removido: 'Removido', sem_comissao: 'Sem comissão' };
const LIBERAR = { pagamento: 'Depois que o cliente paga', faturamento: 'Quando o pedido é faturado' };
const soNum = (t) => String(t || '').replace(/\D/g, '');
const docLimpo = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const pct = (v) => (v === null || v === undefined || v === '' ? '' : String(Number(v)).replace('.', ','));
export const linkExecutivo = (codigo) => `${location.origin}/?ex=${encodeURIComponent(codigo)}`;

/** Pergunta à função se o operador pode ver a aba (falha de rede = não mostra). */
export async function podeVerExecutivos(token) {
  try { return (await chamarExecutivos(token, 'pode')).dados?.pode === true; } catch { return false; }
}

export async function desenharExecutivosPainel(alvo, { token, aoEncerrar }) {
  let lista = null; let config = null; let editando = null; let vendedores = null; let verConfig = false; let erro = '';
  let verRel = false; let rel = null; let relMes = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 7); let relErro = ''; let pagando = null;
  const chamar = async (acao, dados) => {
    try { return await chamarExecutivos(token, acao, dados); } catch (e) { if (e.status === 401) aoEncerrar?.(e.message); throw e; }
  };
  const carregar = async () => {
    try { const d = (await chamar('listar')).dados; lista = d.executivos; config = d.config; erro = ''; } catch (e) { erro = e.message; lista = lista || []; }
    pintar();
  };
  const carregarVendedores = async () => {
    if (vendedores) return;
    try { vendedores = await referenciasNovoClienteOperador(token, 'vendedor'); } catch { vendedores = []; }
    if (editando) pintar();
  };

  const linhaHtml = (x) => `<div class="ex-linha${x.ativo ? '' : ' off'}" data-id="${esc(x.id)}">
      <div class="ex-dados"><b>${esc(x.nome)}</b> <span class="ex-cod">${esc(x.codigo)}</span>${x.ativo ? '' : ' <span class="ex-sit">Desativado</span>'}
        <small class="hint">${x.clientes.ativos} cliente${x.clientes.ativos === 1 ? '' : 's'} ativo${x.clientes.ativos === 1 ? '' : 's'}${x.clientes.aguardando ? ` · ${x.clientes.aguardando} aguardando aprovação` : ''} · ${x.percentual !== null ? `${pct(x.percentual)}% (próprio)` : `${pct(config?.percentual ?? 3)}% (padrão)`}${x.vendedor_nome ? ` · vendedor no G360: ${esc(x.vendedor_nome)}` : ''}${x.tem_acesso ? '' : ' · sem acesso à área'}</small>
        ${(x.ocultar_termos || []).length || (x.ocultar_codigos || []).length ? `<small class="hint">Os clientes dele não veem: ${esc([...(x.ocultar_termos || []), ...(x.ocultar_codigos || []).map((c) => `cód. ${c}`)].join(', '))}</small>` : ''}
        <small class="ex-link">${esc(linkExecutivo(x.codigo))}</small>
        <div class="ex-cli" hidden></div></div>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <button class="tool" data-clientes type="button">Clientes</button><button class="tool" data-copia type="button">Copiar link</button><button class="tool" data-edita type="button">Editar</button>
        <button class="tool" data-liga type="button">${x.ativo ? 'Desativar' : 'Reativar'}</button></div></div>`;

  const formHtml = (x) => `<form id="exForm" class="panel" style="margin-top:14px;padding:14px" novalidate autocomplete="off">
      <b>${x.id ? `Editar ${esc(x.nome)}` : 'Novo executivo'}</b>
      <div class="fgrid" style="margin-top:10px">
        <div><label for="exNome">Nome</label><input class="inp" id="exNome" maxlength="120" value="${esc(x.nome || '')}"></div>
        <div><label for="exCod">Código (vai no link)</label><input class="inp" id="exCod" maxlength="20" value="${esc(x.codigo || '')}" placeholder="Ex.: JOAO" autocapitalize="characters" spellcheck="false">
          <small class="hint" id="exLinkPrev" style="display:block;margin-top:4px"></small></div>
        <div><label for="exDoc">CPF ou CNPJ</label><input class="inp" id="exDoc" maxlength="20" value="${esc(x.documento || '')}" autocapitalize="characters" spellcheck="false"></div>
        <div><label for="exWa">WhatsApp</label><input class="inp" id="exWa" inputmode="tel" maxlength="16" value="${esc(x.whatsapp || '')}" placeholder="(34) 99999-0000"></div>
        <div><label for="exMail">E-mail (é o login da área do executivo)</label><input class="inp" id="exMail" type="email" maxlength="160" value="${esc(x.email || '')}" autocomplete="off"></div>
        <div><label for="exSenha">${x.id ? 'Nova senha (deixe em branco para manter)' : 'Senha de acesso'}</label><input class="inp" id="exSenha" type="password" maxlength="72" autocomplete="new-password" placeholder="8 caracteres ou mais">
          <small class="hint" style="display:block;margin-top:4px">Combine a senha direto com o executivo. O portal não manda e-mail.</small></div>
        <div><label for="exPct">Comissão própria (%)</label><input class="inp" id="exPct" inputmode="decimal" maxlength="6" value="${esc(pct(x.percentual))}" placeholder="Em branco = padrão (${esc(pct(config?.percentual ?? 3))}%)"></div>
        <div><label for="exVend">Vendedor no G360 (opcional)</label><select class="inp" id="exVend">
          <option value="">${vendedores ? 'Nenhum' : 'Carregando…'}</option>
          ${(vendedores || []).map((v) => `<option value="${v.id}" ${Number(x.vendedor_g360) === v.id ? 'selected' : ''}>${esc(v.nome)}</option>`).join('')}
          ${x.vendedor_g360 && vendedores && !vendedores.some((v) => v.id === Number(x.vendedor_g360)) ? `<option value="${x.vendedor_g360}" selected>${esc(x.vendedor_nome || `Vendedor ${x.vendedor_g360}`)}</option>` : ''}
        </select><small class="hint" style="display:block;margin-top:4px">O cliente novo indicado por ele nasce no G360 com este vendedor.</small></div>
        <div class="full"><span class="lbl-like">Produtos que os clientes dele não veem (opcional)</span><div id="exOcultos"></div>
          <details class="oc-palavras"${(x.ocultar_termos || []).length ? ' open' : ''}><summary>Também esconder por palavra do nome (pega produtos novos)</summary>
            <input class="inp" id="exOcT" maxlength="600" value="${esc((x.ocultar_termos || []).join(', '))}" placeholder="Ex.: saco lixo, saco p lixo" aria-label="Palavras do nome a esconder">
            <small class="hint" style="display:block;margin-top:4px">Separe por vírgula. Some todo produto que tiver todas as palavras de um item no nome (sem acento), inclusive os que forem cadastrados depois.</small></details></div>
      </div>
      <div class="okmsg" id="exMsg" aria-live="polite" style="margin-top:8px"></div>
      <div class="act" style="margin-top:10px"><button class="btn sec" type="button" id="exCancela">Cancelar</button><button class="btn pri" type="submit" id="exSalva">Salvar executivo</button></div>
    </form>`;

  const configHtml = () => `<form id="exCfg" class="panel" style="margin-top:14px;padding:14px" novalidate>
      <b>Regras do programa</b>
      <div class="fgrid" style="margin-top:10px">
        <div><label for="cfPct">Comissão padrão (%)</label><input class="inp" id="cfPct" inputmode="decimal" maxlength="6" value="${esc(pct(config.percentual))}"></div>
        <div><label for="cfLib">Quando a comissão é liberada</label><select class="inp" id="cfLib">${Object.entries(LIBERAR).map(([k, t]) => `<option value="${k}" ${config.liberar_em === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div><label for="cfPrazo">Prazo do vínculo</label><select class="inp" id="cfPrazo">
          ${[3, 6, 12, 18, 24, 36].map((m) => `<option value="${m}" ${Number(config.prazo_meses) === m ? 'selected' : ''}>${m} meses após a aprovação do cliente</option>`).join('')}
          <option value="" ${config.prazo_meses === null ? 'selected' : ''}>Sem prazo</option></select></div>
        <div><label class="ex-check"><input type="checkbox" id="cfNovos" ${config.so_novos ? 'checked' : ''}> Só clientes novos geram comissão</label>
          <small class="hint" style="display:block;margin-top:4px">Cliente que já existe no G360 ou já usava o portal fica sem comissão.</small></div>
      </div>
      <small class="hint" style="display:block;margin-top:8px">Base de cálculo: valor dos produtos dos pedidos feitos pelo portal, sem frete e sem taxa de pagamento. Pedidos cancelados ou devolvidos saem da conta.</small>
      <div class="okmsg" id="cfMsg" aria-live="polite" style="margin-top:8px"></div>
      <div class="act" style="margin-top:10px"><button class="btn sec" type="button" id="cfFecha">Fechar</button><button class="btn pri" type="submit" id="cfSalva">Salvar regras</button></div>
    </form>`;

  function pintar() {
    if (lista === null) { alvo.innerHTML = '<div class="hint" style="padding:18px">Carregando os executivos…</div>'; return; }
    alvo.innerHTML = `<div style="padding:16px 18px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><b>Executivos de contas</b><small class="hint" style="display:block;margin:2px 0 0">Parceiros que indicam clientes novos. Cada um tem um código e um link próprio; quem se cadastra pelo link já chega indicado por ele.</small></div>
        ${editando ? '' : `<div class="row" style="gap:6px;flex-wrap:wrap"><button class="tool${verRel ? ' on' : ''}" id="exVerRel" type="button">📊 Comissões</button><button class="tool" id="exVerCfg" type="button">⚙ Regras${config ? ` · ${pct(config.percentual)}%` : ''}</button><button class="btn pri" id="exNovo" type="button">＋ Novo executivo</button></div>`}
      </div>
      ${erro ? `<div class="g360-aviso-busca" role="alert" style="margin-top:12px">${esc(erro)}</div>` : ''}
      ${verConfig && config && !editando ? configHtml() : ''}
      ${editando ? formHtml(editando) : ''}
      ${verRel && !editando ? relatorioHtml() : ''}
      <div style="margin-top:14px"${verRel ? ' hidden' : ''}>${lista.length ? lista.map(linhaHtml).join('') : (editando ? '' : '<div class="hint" style="padding:18px 0">Nenhum executivo ainda. Clique em "Novo executivo" para cadastrar o primeiro.</div>')}</div></div>`;
    ligar();
  }

  function ligar() {
    alvo.querySelector('#exNovo')?.addEventListener('click', () => { editando = {}; verConfig = false; pintar(); carregarVendedores(); alvo.querySelector('#exNome')?.focus(); });
    alvo.querySelector('#exVerCfg')?.addEventListener('click', () => { verConfig = !verConfig; verRel = false; pintar(); });
    alvo.querySelector('#exVerRel')?.addEventListener('click', () => { verRel = !verRel; verConfig = false; pintar(); if (verRel && !rel) carregarRel(); });
    ligarRel();
    alvo.querySelectorAll('.ex-linha').forEach((l) => {
      const x = lista.find((e) => e.id === l.dataset.id);
      l.querySelector('[data-copia]').onclick = async () => {
        try { await navigator.clipboard.writeText(linkExecutivo(x.codigo)); toast('Link copiado'); } catch { toast(linkExecutivo(x.codigo)); }
      };
      l.querySelector('[data-edita]').onclick = () => { editando = { ...x }; verConfig = false; pintar(); carregarVendedores(); };
      l.querySelector('[data-clientes]').onclick = async (ev) => {
        const box = l.querySelector('.ex-cli'); const bt = ev.currentTarget;
        if (!box.hidden) { box.hidden = true; bt.textContent = 'Clientes'; return; }
        box.hidden = false; bt.textContent = 'Fechar clientes'; box.innerHTML = '<small class="hint">Carregando os clientes…</small>';
        try { box.innerHTML = clientesHtml((await chamar('clientes', { executivo_id: x.id })).dados || []); }
        catch (e) { box.innerHTML = `<small class="hint">${esc(e.message)}</small>`; }
      };
      l.querySelector('[data-liga]').onclick = async (ev) => {
        if (x.ativo && !confirmar(ev.currentTarget, `Desativar ${x.nome}? Ele deixa de entrar na área dele e os novos cadastros com o código dele não geram vínculo.`)) return;
        try { await chamar('situacao', { id: x.id, ativo: !x.ativo }); toast(x.ativo ? 'Executivo desativado' : 'Executivo reativado'); carregar(); } catch (e) { toast(e.message); }
      };
    });
    const f = alvo.querySelector('#exForm');
    if (f) {
      const prev = () => { const c = f.querySelector('#exCod').value.trim().toUpperCase(); f.querySelector('#exLinkPrev').textContent = c ? `Link: ${linkExecutivo(c)}` : ''; };
      f.querySelector('#exCod').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); prev(); });
      prev();
      const seletor = montarSeletorOcultos(f.querySelector('#exOcultos'), { token: () => token, codigos: editando.ocultar_codigos || [], aoEncerrar, aoMudar: (l) => { editando.ocultar_codigos = l; } });
      f.querySelector('#exCancela').onclick = () => { editando = null; pintar(); };
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        const msg = f.querySelector('#exMsg'); const bt = f.querySelector('#exSalva');
        const vend = f.querySelector('#exVend');
        const dados = {
          id: editando.id || undefined,
          nome: f.querySelector('#exNome').value, codigo: f.querySelector('#exCod').value,
          documento: docLimpo(f.querySelector('#exDoc').value), whatsapp: soNum(f.querySelector('#exWa').value),
          email: f.querySelector('#exMail').value, senha: f.querySelector('#exSenha').value,
          percentual: f.querySelector('#exPct').value.trim(),
          vendedor_g360: vend.value ? Number(vend.value) : null, vendedor_nome: vend.value ? vend.selectedOptions[0]?.textContent || '' : '',
          ocultar_termos: f.querySelector('#exOcT').value, ocultar_codigos: seletor.codigos(),
        };
        bt.disabled = true; msg.className = 'okmsg'; msg.textContent = 'Salvando…';
        try {
          await chamar('salvar', { executivo: dados });
          f.querySelector('#exSenha').value = '';
          toast('Executivo salvo ✓'); editando = null; await carregar();
        } catch (e) { msg.className = 'okmsg err'; msg.textContent = e.message; bt.disabled = false; f.querySelector('#exSenha').value = dados.senha; }
      };
    }
    const c = alvo.querySelector('#exCfg');
    if (c) {
      c.querySelector('#cfFecha').onclick = () => { verConfig = false; pintar(); };
      c.onsubmit = async (ev) => {
        ev.preventDefault();
        const msg = c.querySelector('#cfMsg'); const bt = c.querySelector('#cfSalva');
        bt.disabled = true; msg.className = 'okmsg'; msg.textContent = 'Salvando…';
        try {
          config = (await chamar('config_salvar', {
            percentual: c.querySelector('#cfPct').value, liberar_em: c.querySelector('#cfLib').value,
            prazo_meses: c.querySelector('#cfPrazo').value === '' ? null : Number(c.querySelector('#cfPrazo').value),
            so_novos: c.querySelector('#cfNovos').checked,
          })).dados;
          toast('Regras salvas ✓'); verConfig = false; pintar();
        } catch (e) { msg.className = 'okmsg err'; msg.textContent = e.message; bt.disabled = false; }
      };
    }
  }

  /* ---------- Comissões do mês ---------- */
  async function carregarRel() {
    rel = null; relErro = ''; pintar();
    try { rel = (await chamar('relatorio', { mes: relMes })).dados; } catch (e) { relErro = e.message; rel = { comissoes: [], executivos: [], config }; }
    pintar();
  }
  const soma = (l, f = (c) => c.valor) => l.reduce((t, c) => t.plus(new Decimal(String(f(c) ?? 0))), new Decimal(0)).toFixed(2);
  function relatorioHtml() {
    const topo = `<div class="ex-rel-topo"><label for="exMes">Mês</label><input class="inp" type="month" id="exMes" value="${esc(relMes)}" style="max-width:180px">
      <button class="tool" id="exRecalc" type="button" title="Refaz as comissões que faltarem a partir dos pedidos feitos pelo portal no mês">↻ Recalcular o mês</button></div>
      <small class="hint" style="display:block;margin:6px 0 0">A comissão nasce <b>prevista</b> quando o cliente vinculado faz o pedido pelo portal (valor dos produtos, sem frete e sem taxa). Confira cada pedido no G360 antes de marcar. Regra atual: liberar ${config?.liberar_em === 'faturamento' ? 'quando o pedido é faturado' : 'depois que o cliente paga'}.</small>`;
    if (!rel) return `<div class="panel ex-rel">${topo}<div class="hint" style="padding:14px 0">Carregando as comissões…</div></div>`;
    const porExec = new Map();
    for (const c of rel.comissoes) { const l = porExec.get(c.executivo_id) || []; l.push(c); porExec.set(c.executivo_id, l); }
    const blocos = [...porExec.entries()].map(([id, l]) => {
      const e = rel.executivos.find((x) => x.id === id) || { nome: 'Executivo', codigo: '' };
      const validas = l.filter((c) => c.situacao !== 'cancelada');
      const tot = (s) => soma(l.filter((c) => s.includes(c.situacao)));
      const liberadas = l.filter((c) => c.situacao === 'liberada');
      return `<div class="ex-rel-bloco" data-exec="${esc(id)}">
        <div class="ex-rel-cab"><div><b>${esc(e.nome)}</b> <span class="ex-cod">${esc(e.codigo)}</span>
          <small class="hint">${new Set(validas.map((c) => c.cliente_codigo)).size} cliente(s) compraram · ${validas.length} pedido(s) · vendas ${esc(dinheiro(soma(validas, (c) => c.base)))}</small></div>
          <div class="ex-rel-tot"><span>Prevista <b>${esc(dinheiro(tot(['prevista', 'faturada'])))}</b></span><span>Liberada <b>${esc(dinheiro(tot(['liberada'])))}</b></span><span>Paga <b>${esc(dinheiro(tot(['paga'])))}</b></span></div></div>
        ${liberadas.length ? `<div class="ex-rel-pagar">${pagando === id ? `<input class="inp" type="date" id="exPgData" value="${esc(new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10))}" style="max-width:170px"><input class="inp" id="exPgObs" maxlength="300" placeholder="Observação (ex.: nº da nota do executivo)"><button class="btn pri" type="button" data-pgok>Confirmar pagamento de ${esc(dinheiro(soma(liberadas)))}</button><button class="tool" type="button" data-pgcancela>Cancelar</button>` : `<button class="btn sec" type="button" data-pagar>Marcar liberadas como pagas (${esc(dinheiro(soma(liberadas)))})</button>`}</div>` : ''}
        <div class="ex-rel-tab">${l.map((c) => `<div class="ex-rel-l ${esc(c.situacao)}" data-c="${esc(c.id)}">
          <div><b>${esc(c.cliente)}</b><small class="hint">${esc(dataBr(c.pedido_data))} · pedido ${esc(c.pedido_numero || 'aguardando número')} · vendas ${esc(dinheiro(c.base))} × ${esc(pct(c.percentual))}%${c.paga_em ? ` · paga em ${esc(dataBr(c.paga_em))}` : ''}${c.observacao ? ` · ${esc(c.observacao)}` : ''}</small></div>
          <div class="ex-rel-v"><b>${esc(dinheiro(c.valor))}</b><span class="ex-st ${c.situacao === 'paga' || c.situacao === 'liberada' ? 'ativo' : c.situacao === 'cancelada' ? 'recusado' : 'aguardando'}">${esc(SITC[c.situacao] || c.situacao)}</span></div>
          <div class="row" style="gap:6px;flex-wrap:wrap">
            ${c.situacao === 'prevista' ? '<button class="tool" type="button" data-m="faturada">Faturado</button>' : ''}
            ${['prevista', 'faturada'].includes(c.situacao) ? '<button class="tool" type="button" data-m="cliente_pagou">Cliente pagou</button>' : ''}
            ${['prevista', 'faturada', 'liberada'].includes(c.situacao) ? '<button class="tool" type="button" data-m="cancelar">Cancelado/devolvido</button>' : ''}
            ${c.situacao === 'cancelada' ? '<button class="tool" type="button" data-m="reabrir">Reabrir</button>' : ''}
          </div></div>`).join('')}</div></div>`;
    }).join('');
    return `<div class="panel ex-rel">${topo}${relErro ? `<div class="g360-aviso-busca" role="alert" style="margin-top:10px">${esc(relErro)}</div>` : ''}
      ${blocos || '<div class="hint" style="padding:14px 0">Nenhuma comissão neste mês. Ela aparece quando um cliente vinculado faz um pedido pelo portal.</div>'}</div>`;
  }
  function ligarRel() {
    const r = alvo.querySelector('.ex-rel'); if (!r) return;
    r.querySelector('#exMes')?.addEventListener('change', (e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { relMes = e.target.value; pagando = null; carregarRel(); } });
    r.querySelector('#exRecalc')?.addEventListener('click', async (ev) => {
      ev.currentTarget.disabled = true;
      try { const n = (await chamar('recalcular', { desde: `${relMes}-01` })).dados.novas; toast(n ? `${n} comissão(ões) nova(s)` : 'Nada faltando neste mês'); } catch (e) { toast(e.message); }
      carregarRel();
    });
    r.querySelectorAll('[data-m]').forEach((b) => b.onclick = async () => {
      const id = b.closest('[data-c]').dataset.c; const m = b.dataset.m;
      if (m === 'cancelar' && !confirmar(b, 'Cancelar a comissão deste pedido (cancelado ou devolvido)?')) return;
      b.disabled = true;
      try { await chamar('comissao_marcar', { ids: [id], acao: m }); carregarRel(); } catch (e) { b.disabled = false; toast(e.message); }
    });
    r.querySelectorAll('[data-pagar]').forEach((b) => b.onclick = () => { pagando = b.closest('[data-exec]').dataset.exec; pintar(); });
    r.querySelector('[data-pgcancela]')?.addEventListener('click', () => { pagando = null; pintar(); });
    r.querySelector('[data-pgok]')?.addEventListener('click', async (ev) => {
      const bloco = ev.currentTarget.closest('[data-exec]');
      const ids = rel.comissoes.filter((c) => c.executivo_id === bloco.dataset.exec && c.situacao === 'liberada').map((c) => c.id);
      ev.currentTarget.disabled = true;
      try {
        await chamar('comissao_marcar', { ids, acao: 'paga', data: bloco.querySelector('#exPgData').value, observacao: bloco.querySelector('#exPgObs').value });
        toast('Comissões marcadas como pagas ✓'); pagando = null; carregarRel();
      } catch (e) { ev.currentTarget.disabled = false; toast(e.message); }
    });
  }

  function clientesHtml(lista) {
    if (!lista.length) return '<small class="hint">Nenhum cliente indicado ainda.</small>';
    return `<div class="ex-cli-lista">${lista.map((c) => `<div class="ex-cli-l"><b>${esc(c.razao_social || c.documento)}</b>
      <span class="ex-st ${esc(c.situacao)}">${esc(SITV[c.situacao] || c.situacao)}</span>
      <small class="hint">${c.cliente_codigo ? `cód. G360 ${esc(c.cliente_codigo)} · ` : ''}${c.inicio ? `desde ${esc(dataBr(c.inicio))}` : `indicado em ${esc(dataBr(String(c.criado_em).slice(0, 10)))}`}${c.fim ? ` · até ${esc(dataBr(c.fim))}` : c.situacao === 'ativo' ? ' · sem prazo' : ''}${c.motivo ? ` · ${esc(c.motivo)}` : ''}</small></div>`).join('')}</div>`;
  }

  /** Confirmação no próprio botão (sem caixa de diálogo do navegador): primeiro toque arma, segundo confirma. */
  function confirmar(bt, texto) {
    if (bt.dataset.armado) return true;
    bt.dataset.armado = '1'; const antes = bt.textContent; bt.textContent = 'Toque de novo para confirmar'; bt.title = texto; toast(texto);
    setTimeout(() => { delete bt.dataset.armado; bt.textContent = antes; }, 4000);
    return false;
  }

  pintar();
  await carregar();
}
