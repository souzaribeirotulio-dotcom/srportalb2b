/* =====================================================================
   Novo cliente no G360 a partir do "Quero ser cliente" (pacote 18/11 manhã).
   - Regras do formulário: GET operadores/cadastro/cliente (editáveis, padrões, obrigatórios).
   - Listas: GET operadores/referencias?tipo=...
   - CNPJ: POST operadores/cadastro/cnpj (só sugestão; se já existe, abre a ficha).
     CPF: usa os dados do próprio pedido.
   - Gravação: POST operadores/clientes com Idempotency-Key. Resposta incerta →
     reenvia a mesma chave com o mesmo corpo, sem deixar editar até resolver.
   - O cliente nasce bloqueado; depois de incluir, vincula o pedido ao código
     devolvido e abre a ficha para liberar e mandar o link.
   ===================================================================== */
import {
  formularioNovoClienteOperador, referenciasNovoClienteOperador, preencherNovoClienteCnpj, incluirClienteOperador,
  consultarCepOperador, buscarReferenciasOperador, interpretarErro, ErroApi,
} from '../api/g360.js';
import { mostrarMensagemErro } from '../ui/mensagem.js';
import { $, esc, toast, abrirModal, fecharModal, adiar } from './comum.js';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const LISTAS = { categoria_id: ['categoria', 'Categoria'], situacao_id: ['situacao', 'Situação'], regiao_id: ['regiao', 'Região'], vendedor_id: ['vendedor', 'Vendedor'], tabela_preco_id: ['tabela_preco', 'Tabela de preço'], banco_cobranca_id: ['banco_cobranca', 'Banco de cobrança'] };
const BASICOS = new Set(['documento', 'nome', 'ie_rg', 'endereco', 'cep', 'numero', 'logradouro', 'bairro', 'cidade', 'uf', 'fantasia', 'email', 'telefone', 'telefone1', 'telefone2', 'telefone3', 'contato', 'complemento', 'rg_se_nao_contribuinte']);
const CONHECIDOS = new Set([...BASICOS, ...Object.keys(LISTAS), 'limite_credito_mensal', 'nascimento', 'nome_mae', 'rg']);
const INCERTO = new Set(['rede', 'tempo']);

// Envio em aberto por pedido do portal: { chave, corpo } até ter resposta final (o mesmo corpo volta com a mesma chave).
const pendentes = new Map();

const norm = (t) => String(t || '').trim().toLowerCase();
/** "categoria" ou "categoria_id" → "categoria_id" quando for lista; o resto fica como veio. */
function campoDe(t) { const n = norm(t); return LISTAS[`${n}_id`] ? `${n}_id` : n; }
const soNum = (v) => String(v || '').replace(/\D/g, '');
const docLimpo = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * k: pedido do portal (portal_cadastros). opcoes: { token: () => string, aoSessaoEncerrada(e), vincular(codigo) → Promise, abrirFicha(codigo) }
 */
export async function abrirNovoClienteG360(k, opcoes) {
  abrirModal('mAdm');
  const box = $('admBox');
  box.innerHTML = '<div class="empty2">Carregando o formulário do G360…</div>';
  const doc = docLimpo(k.documento);
  const fisica = /^[0-9]{11}$/.test(doc);
  let form;
  try { form = await formularioNovoClienteOperador(opcoes.token()); }
  catch (e) { return falha(e, opcoes, () => abrirNovoClienteG360(k, opcoes)); }

  const editaveis = new Set((form.editaveis || []).map(campoDe));
  const obrig = new Set([...(form.obrigatorios || []), ...(fisica ? form.obrigatorios_pessoa_fisica || [] : [])].map(campoDe));
  const listas = Object.keys(LISTAS).filter((c) => editaveis.has(c) || obrig.has(c));
  const ref = {};
  try {
    await Promise.all(listas.map(async (c) => {
      try { ref[c] = await referenciasNovoClienteOperador(opcoes.token(), LISTAS[c][0]); } catch (e) { if (e.status === 401) throw e; ref[c] = e; }
    }));
  } catch (e) { return falha(e, opcoes); }

  // Sugestão pela Receita (só CNPJ). Para CPF, vale o pedido.
  let sug = null; let avisoCnpj = '';
  if (!fisica) {
    box.innerHTML = '<div class="empty2">Consultando o CNPJ…</div>';
    try {
      const r = await preencherNovoClienteCnpj(opcoes.token(), doc);
      if (r.ja_existe) return opcoes.jaExiste ? opcoes.jaExiste(r.cliente_id) : jaExiste(k, r.cliente_id, opcoes);
      sug = r;
    } catch (e) {
      if (e.status === 401) { fecharModal('mAdm'); opcoes.aoSessaoEncerrada?.(e); return; }
      const i = interpretarErro(e);
      avisoCnpj = `<div class="rv-aviso">${esc(i.mensagem)} Continue preenchendo à mão com os dados do pedido.${i.suporte ? `<small style="display:block;margin-top:4px">Código para o suporte: ${esc(i.suporte)}</small>` : ''}</div>`;
    }
  }
  desenhar({ k, doc, fisica, form, editaveis, obrig, listas, ref, sug, avisoCnpj, opcoes });
}

function falha(e, opcoes, deNovo) {
  if (e.status === 401) { fecharModal('mAdm'); opcoes.aoSessaoEncerrada?.(e); return; }
  $('admBox').innerHTML = `<div class="fxh"><div><h3>Novo cliente no G360</h3></div><button class="fxx" id="nX" title="Fechar">×</button></div><div id="nErr"></div>`;
  mostrarMensagemErro($('nErr'), e, deNovo ? { aoTentarDeNovo: deNovo } : {});
  $('nX').onclick = () => fecharModal('mAdm');
}

function jaExiste(k, codigo, opcoes) {
  const box = $('admBox');
  box.innerHTML = `<div class="fxh"><div><h3>Este cliente já está no G360</h3></div><button class="fxx" id="nX" title="Fechar">×</button></div>
    ${codigo ? `<p class="hint" style="margin:10px 0">O documento já tem cadastro no G360 (cód. <b>${esc(codigo)}</b>). Não vamos duplicar: abra a ficha para conferir, liberar o acesso e mandar o link.</p>`
    : '<div class="rv-aviso">O documento já existe no G360, mas fora do que o seu usuário enxerga (ou em mais de um cadastro). Confira no G360 antes de seguir.</div>'}
    <div id="nErr"></div>
    <div class="act"><button class="btn sec" id="nFechar" type="button">Fechar</button>${codigo ? '<button class="btn pri" id="nAbrir" type="button">Vincular e abrir a ficha</button>' : ''}</div>`;
  $('nX').onclick = $('nFechar').onclick = () => fecharModal('mAdm');
  if ($('nAbrir')) $('nAbrir').onclick = async () => {
    $('nAbrir').disabled = true;
    try { await opcoes.vincular(codigo); opcoes.abrirFicha(codigo); }
    catch (e) { $('nAbrir').disabled = false; $('nErr').innerHTML = `<div class="g360-erro">${esc(e.message)}</div>`; }
  };
}

function desenhar(c) {
  const { k, doc, fisica, form, editaveis, obrig, listas, ref, sug, avisoCnpj, opcoes } = c;
  const box = $('admBox');
  const req = (campo) => (obrig.has(campo) ? ' <span class="req">*</span>' : '');
  const R = ' <span class="req">*</span>';
  const pode = (campo) => editaveis.has(campo) || obrig.has(campo);
  const se = sug?.endereco || {};
  // Pedido primeiro para contato; Receita primeiro para nome e endereço.
  const v = {
    nome: sug?.nome || k.razao_social || '', fantasia: sug?.fantasia || k.fantasia || '',
    ie_rg: (k.inscricao_estadual || sug?.ie_rg || '').toUpperCase(), email: k.email || sug?.email || '',
    telefone1: k.whats || sug?.telefone1 || '', telefone2: k.telefone || '', contato: k.responsavel || '',
    cep: soNum(se.cep || k.cep), numero: k.numero || se.numero || '', logradouro: se.logradouro || k.logradouro || '', complemento: k.complemento || se.complemento || '',
  };
  const naoMostrados = [...obrig].filter((x) => !CONHECIDOS.has(x));
  const inp = (id, val, extra = '') => `<input class="inp" id="${id}" value="${esc(val ?? '')}" ${extra}>`;
  const lista = (campo) => {
    const [, rot] = LISTAS[campo]; const r = ref[campo]; const pad = form.padroes?.[campo] ?? null;
    if (r instanceof Error) return `<div><label>${rot}${req(campo)}</label><div class="okmsg" style="color:#ffb5ac">${esc(interpretarErro(r).mensagem)}</div></div>`;
    return `<div><label for="n_${campo}">${rot}${req(campo)}</label><select class="inp" id="n_${campo}"><option value="">${pad ? 'Padrão do G360' : 'Escolha'}</option>${(r || []).filter((o) => o.id).map((o) => `<option value="${Number(o.id)}" ${Number(o.id) === pad ? 'selected' : ''}>${esc(o.nome)}</option>`).join('')}</select></div>`;
  };

  box.innerHTML = `<div class="fxh"><div><h3>Novo cliente no G360</h3><div class="sub">${fisica ? 'Pessoa física · dados do pedido' : 'Pessoa jurídica · dados da Receita e do pedido'}. Confira tudo: grava direto no G360, com o acesso ao portal bloqueado.</div></div><button class="fxx" id="nX" title="Fechar">×</button></div>
    ${avisoCnpj}
    ${sug?.situacao_irregular ? `<div class="rv-aviso"><b>Situação na Receita: ${esc(sug.situacao_receita || 'irregular')}.</b> Confira antes de cadastrar.</div>` : ''}
    ${naoMostrados.length ? `<div class="rv-aviso">O G360 exige também: ${esc(naoMostrados.join(', '))}. Esse campo ainda não está neste formulário; cadastre pelo G360 ou peça o ajuste.</div>` : ''}
    <div class="csec">Cadastro</div>
    <div class="fgrid">
      <div class="full"><label for="nDoc">${fisica ? 'CPF' : 'CNPJ'}${R}</label>${inp('nDoc', doc, 'maxlength="32" readonly')}</div>
      <div class="full"><label for="nNome">${fisica ? 'Nome' : 'Razão social'}${R}</label>${inp('nNome', v.nome, 'maxlength="90"')}</div>
      ${pode('fantasia') || !fisica ? `<div class="full"><label for="nFan">Nome fantasia${req('fantasia')}</label>${inp('nFan', v.fantasia, 'maxlength="90"')}</div>` : ''}
      <div class="full"><label for="nIe">${fisica ? 'RG ou IE' : 'Inscrição estadual'}${R}</label>${inp('nIe', v.ie_rg, 'maxlength="26" autocapitalize="characters"')}
        <div class="row" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><button type="button" class="tool" data-ie="NAO CONTRIBUINTE">Não contribuinte</button>${fisica ? '' : '<button type="button" class="tool" data-ie="ISENTO">Isento (governo/ONG)</button>'}</div>
        <label class="hint" id="nIsentoW" style="display:none;margin:6px 0 0;text-transform:none;letter-spacing:0;font-weight:500"><input type="checkbox" id="nIsento"> Confirmo que é governo ou ONG (só eles podem ser ISENTO)</label></div>
      <div class="full"><label for="nEm">E-mail (recebe o link de acesso)${req('email')}</label>${inp('nEm', v.email, 'type="email" maxlength="200"')}</div>
      <div><label for="nT1">Telefone 1${obrig.has('telefone') || obrig.has('telefone1') ? R : ''}</label>${inp('nT1', v.telefone1, 'maxlength="60" inputmode="tel"')}</div>
      <div><label for="nT2">Telefone 2</label>${inp('nT2', v.telefone2, 'maxlength="60" inputmode="tel"')}</div>
      <div><label for="nT3">Telefone 3</label>${inp('nT3', '', 'maxlength="60" inputmode="tel"')}</div>
      <div><label for="nCont">Contato${req('contato')}</label>${inp('nCont', v.contato, 'maxlength="50"')}</div>
      ${fisica && pode('nascimento') ? `<div><label for="nNasc">Nascimento${req('nascimento')}</label>${inp('nNasc', '', 'type="date"')}</div>` : ''}
      ${fisica && pode('nome_mae') ? `<div><label for="nMae">Nome da mãe${req('nome_mae')}</label>${inp('nMae', '', 'maxlength="50"')}</div>` : ''}
      ${fisica && (pode('rg') || obrig.has('rg_se_nao_contribuinte')) ? `<div><label for="nRg">RG${obrig.has('rg') ? R : ''}${obrig.has('rg_se_nao_contribuinte') ? ' <small>(obrigatório se não contribuinte)</small>' : ''}</label>${inp('nRg', '', 'maxlength="26"')}</div>` : ''}
    </div>
    ${listas.length || pode('limite_credito_mensal') ? `<div class="csec">Comercial e crédito (listas do G360)</div><div class="fgrid">${listas.map(lista).join('')}
      ${pode('limite_credito_mensal') ? `<div><label for="nLim">Limite de crédito mensal (R$)${req('limite_credito_mensal')}</label>${inp('nLim', '', 'inputmode="decimal" maxlength="13" placeholder="0,00"')}</div>` : ''}</div>` : ''}
    <div class="csec">Endereço principal</div>
    <div class="fgrid">
      <div><label for="nCep">CEP${R}</label>${inp('nCep', v.cep, 'inputmode="numeric" maxlength="9"')}<div class="okmsg" id="nCepM" aria-live="polite"></div></div>
      <div><label for="nNum">Número${R}</label>${inp('nNum', v.numero, 'maxlength="10"')}</div>
      <div class="full"><label for="nLog">Rua / avenida${R}</label>${inp('nLog', v.logradouro, 'maxlength="90"')}</div>
      <div class="full"><label for="nCom">Complemento</label>${inp('nCom', v.complemento, 'maxlength="60"')}</div>
      <div class="full" id="nCidBairro"></div></div>
    <div id="nErr" aria-live="polite"></div>
    <div class="act"><button class="btn sec" id="nFechar" type="button">Cancelar</button><button class="btn pri" id="nSalvar" type="button">Cadastrar no G360</button></div>`;

  $('nX').onclick = $('nFechar').onclick = () => fecharModal('mAdm');
  box.querySelectorAll('[data-ie]').forEach((b) => { b.onclick = () => { $('nIe').value = b.dataset.ie; mostrarIsento(); }; });
  $('nIe').addEventListener('input', mostrarIsento);
  function mostrarIsento() { $('nIsentoW').style.display = !fisica && $('nIe').value.trim().toUpperCase() === 'ISENTO' ? 'block' : 'none'; }
  mostrarIsento();

  /* ---- endereço: CEP pela API; CEP geral → bairro na lista; falha → cidade e bairro manuais ---- */
  const escolha = { cidade: null, bairro: null };
  let cepInfo = null; let manual = false;
  const cb = $('nCidBairro');
  function pintar() {
    const geral = cepInfo && !cepInfo.bairro?.nome;
    if (!manual && cepInfo && !geral) {
      cb.innerHTML = `<div class="ci2" style="display:block;margin:0"><small>Bairro <b>${esc(cepInfo.bairro?.nome || '—')}</b> · ${esc(cepInfo.cidade?.nome || '—')} / ${esc(cepInfo.uf || '')} <span style="color:var(--lima)">(pelo CEP)</span></small>
        <button type="button" class="tool" id="nManual" style="margin-top:6px">Escolher cidade e bairro na lista</button></div>`;
      $('nManual').onclick = () => { manual = true; pintar(); }; return;
    }
    if (!manual && !cepInfo) { cb.innerHTML = '<div class="hint" style="margin:0">Digite o CEP: rua, bairro e cidade vêm do G360. <button type="button" class="tool" id="nManual">Preencher à mão</button></div>'; $('nManual').onclick = () => { manual = true; pintar(); }; return; }
    cb.innerHTML = `${manual ? `<div class="fgrid"><div><label for="nUf">UF${R}</label><select class="inp" id="nUf">${UFS.map((u) => `<option ${u === (cepInfo?.uf || k.uf || 'MG') ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
        <div><label>Cidade${R}</label><div id="nCidBox"></div></div></div>` : '<div class="okmsg">Este CEP atende à cidade inteira: escolha o bairro e digite a rua.</div>'}
      <label>Bairro${R}</label><div id="nBaiBox"></div>`;
    if (manual) campo('cidade', $('nCidBox'));
    campo('bairro', $('nBaiBox'));
    if ($('nUf')) $('nUf').onchange = () => { escolha.cidade = null; campo('cidade', $('nCidBox')); };
  }
  function campo(tipo, alvo) {
    const sel = escolha[tipo];
    if (sel) { alvo.innerHTML = `<div class="escolhido"><span>✓ ${esc(sel.nome)}</span><button type="button">trocar</button></div>`; alvo.querySelector('button').onclick = () => { escolha[tipo] = null; campo(tipo, alvo); }; return; }
    alvo.innerHTML = '<input class="inp" autocomplete="off" maxlength="70" placeholder="Digite para buscar"><ul class="sugestoes" role="listbox"></ul>';
    const ent = alvo.querySelector('input'); const ul = alvo.querySelector('ul');
    ent.addEventListener('input', adiar(async () => {
      const q = ent.value.trim(); if (q.length < 2) { ul.innerHTML = ''; return; }
      ul.innerHTML = '<li style="padding:8px 10px;color:var(--tx3);font-size:13px">Buscando…</li>';
      try {
        const r = await buscarReferenciasOperador(opcoes.token(), tipo, q.slice(0, 70), tipo === 'cidade' ? $('nUf').value : undefined);
        if (ent.value.trim() !== q) return;
        ul.innerHTML = r.length ? r.map((x) => `<li><button type="button" data-id="${Number(x.id)}" data-nome="${esc(x.nome)}">${esc(x.nome)}</button></li>`).join('') : '<li style="padding:8px 10px;color:var(--tx3);font-size:13px">Nada encontrado.</li>';
        ul.querySelectorAll('button').forEach((b) => { b.onclick = () => { escolha[tipo] = { id: Number(b.dataset.id), nome: b.dataset.nome }; campo(tipo, alvo); }; });
      } catch (err) { ul.innerHTML = `<li style="padding:8px 10px;color:#ffb5ac;font-size:13px">${esc(err.message)}</li>`; }
    }, 400));
  }
  let n = 0;
  async function consultarCep() {
    const d = soNum($('nCep').value); const eu = ++n;
    if (d.length !== 8) { cepInfo = null; $('nCepM').textContent = ''; pintar(); return; }
    $('nCepM').textContent = 'Consultando o CEP…';
    try {
      const r = await consultarCepOperador(opcoes.token(), d);
      if (eu !== n) return;
      cepInfo = r; manual = false; escolha.bairro = null; escolha.cidade = r.cidade?.id ? { id: r.cidade.id, nome: r.cidade.nome } : null;
      if (r.logradouro) $('nLog').value = r.logradouro;
      $('nCepM').textContent = r.bairro?.nome ? '✓ Endereço encontrado' : '';
    } catch (e) {
      if (eu !== n) return;
      if (e.status === 401) { fecharModal('mAdm'); opcoes.aoSessaoEncerrada?.(e); return; }
      cepInfo = null; manual = true; $('nCepM').textContent = interpretarErro(e).mensagem;
    }
    pintar();
  }
  $('nCep').addEventListener('input', adiar(consultarCep, 350));
  if (v.cep.length === 8) consultarCep(); else pintar();

  /* ---- gravar ---- */
  const pend = pendentes.get(k.id);
  if (pend) travar(true, 'Há um envio anterior sem resposta. Clique em "Tentar de novo" para conferir com o G360 (mesmos dados).');
  $('nSalvar').onclick = () => salvar();

  function montar(extras = {}) {
    const val = (id) => ($(id)?.value ?? '').trim();
    const corpo = { documento: doc, nome: val('nNome'), ie_rg: val('nIe').toUpperCase() };
    const opc = { fantasia: val('nFan'), email: val('nEm'), telefone1: val('nT1'), telefone2: val('nT2'), telefone3: val('nT3'), contato: val('nCont') };
    for (const [ch, x] of Object.entries(opc)) if (x) corpo[ch] = x;
    if (fisica) { if (val('nNasc')) corpo.nascimento = val('nNasc'); if (val('nMae')) corpo.nome_mae = val('nMae'); if (val('nRg')) corpo.rg = val('nRg'); }
    for (const ch of listas) { const s = $(`n_${ch}`); if (s?.value && Number(s.value) !== (form.padroes?.[ch] ?? null)) corpo[ch] = Number(s.value); } // padrão: o G360 aplica sozinho
    if (val('nLim')) corpo.limite_credito_mensal = val('nLim').replace(/\./g, '').replace(',', '.');
    const end = { cep: soNum(val('nCep')), numero: val('nNum') };
    if (val('nCom')) end.complemento = val('nCom');
    if (manual) { end.logradouro = val('nLog'); if (escolha.cidade) end.cidade_id = escolha.cidade.id; if (escolha.bairro) end.bairro_id = escolha.bairro.id; end.uf = $('nUf')?.value || null; }
    else if (cepInfo && !cepInfo.bairro?.nome) { end.logradouro = val('nLog'); if (escolha.bairro) end.bairro_id = escolha.bairro.id; }
    else if (val('nLog') && val('nLog') !== (cepInfo?.logradouro || '')) end.logradouro = val('nLog');
    corpo.endereco = end;
    if (!fisica && corpo.ie_rg === 'ISENTO' && $('nIsento')?.checked) corpo.confirmar_isento = true;
    return { ...corpo, ...extras };
  }
  function faltando(corpo) {
    const f = [];
    if (corpo.nome.length < 2) f.push(fisica ? 'nome' : 'razão social');
    if (!corpo.ie_rg) f.push(fisica ? 'RG ou IE' : 'inscrição estadual (ou Não contribuinte)');
    if (corpo.endereco.cep.length !== 8) f.push('CEP');
    if (!corpo.endereco.numero) f.push('número');
    if (manual && (!corpo.endereco.cidade_id || !corpo.endereco.bairro_id || !corpo.endereco.logradouro)) f.push('cidade, bairro e rua');
    if (!manual && cepInfo && !cepInfo.bairro?.nome && (!corpo.endereco.bairro_id || !corpo.endereco.logradouro)) f.push('bairro e rua');
    if (!manual && !cepInfo) f.push('endereço pelo CEP (ou preencha à mão)');
    if ((obrig.has('telefone') || obrig.has('telefone1')) && !corpo.telefone1 && !corpo.telefone2 && !corpo.telefone3) f.push('um telefone');
    for (const ch of ['email', 'contato', 'fantasia', 'nascimento', 'nome_mae', 'limite_credito_mensal', ...listas]) if (obrig.has(ch) && corpo[ch] === undefined && !(LISTAS[ch] && form.padroes?.[ch])) f.push((LISTAS[ch]?.[1] || ch.replace('_', ' ')).toLowerCase());
    if (fisica && (obrig.has('rg') || (obrig.has('rg_se_nao_contribuinte') && corpo.ie_rg === 'NAO CONTRIBUINTE')) && !corpo.rg) f.push('RG');
    if (!fisica && corpo.ie_rg === 'ISENTO' && !corpo.confirmar_isento) f.push('confirmação de que é governo ou ONG (ou use Não contribuinte)');
    return f;
  }
  function travar(sim, msg = '') {
    box.querySelectorAll('input, select, [data-ie], #nManual').forEach((x) => { if (x.id !== 'nDoc') x.disabled = sim; });
    if (msg) $('nErr').innerHTML = `<div class="rv-aviso">${esc(msg)}</div>`;
    $('nSalvar').textContent = sim ? 'Tentar de novo' : 'Cadastrar no G360';
  }

  async function salvar(extras = {}) {
    let p = pendentes.get(k.id);
    if (!p) {
      const corpo = montar(extras);
      const f = faltando(corpo);
      if (f.length) { $('nErr').innerHTML = `<div class="g360-erro">Falta preencher: ${esc(f.join(', '))}.</div>`; return; }
      p = { chave: crypto.randomUUID(), corpo };
      pendentes.set(k.id, p);
    }
    $('nErr').innerHTML = ''; $('nSalvar').disabled = true; $('nSalvar').textContent = 'Gravando no G360…';
    let ficha;
    try { ficha = (await incluirClienteOperador(opcoes.token(), p.corpo, p.chave)).dados; }
    catch (e) {
      $('nSalvar').disabled = false;
      if (e.status === 401) { fecharModal('mAdm'); opcoes.aoSessaoEncerrada?.(e); return; }
      const incerto = e instanceof ErroApi && (INCERTO.has(e.tipo) || e.status === 503 || e.codigo === 'OPERACAO_EM_ANDAMENTO');
      if (incerto) { travar(true); mostrarMensagemErro($('nErr'), e); $('nErr').insertAdjacentHTML('beforeend', '<div class="hint">Não sabemos se o G360 gravou. "Tentar de novo" manda os mesmos dados com a mesma identificação: não duplica.</div>'); return; }
      pendentes.delete(k.id); travar(false);
      if (e.codigo === 'CHAVE_REUTILIZADA') { mostrarMensagemErro($('nErr'), e); return; }
      mostrarMensagemErro($('nErr'), e);
      if (e.codigo === 'DOCUMENTO_REPETIDO') confirmar('Sim, é outro cadastro com IE ou RG diferente', { confirmar_documento_repetido: true });
      if (e.codigo === 'IE_ISENTO_SEM_CONFIRMACAO') { $('nIsentoW').style.display = 'block'; $('nIsento').focus(); }
      return;
    }
    pendentes.delete(k.id);
    $('nSalvar').textContent = 'Cadastrado ✓';
    try { await opcoes.vincular(ficha.id); }
    catch (e) { toast(`Cliente cadastrado no G360 (cód. ${ficha.id}), mas o pedido do portal não foi vinculado: ${e.message}`); }
    toast(`Cliente cadastrado no G360 · cód. ${ficha.id} · acesso bloqueado até você liberar`);
    opcoes.abrirFicha(ficha.id);
  }
  function confirmar(texto, extras) {
    $('nErr').insertAdjacentHTML('beforeend', `<button class="btn pri" id="nConf" type="button" style="margin-top:8px">${esc(texto)}</button>`);
    $('nConf').onclick = () => { $('nConf').remove(); salvar(extras); };
  }
}
