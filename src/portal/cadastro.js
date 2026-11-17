/* =====================================================================
   "Criar cadastro" para quem ainda não é cliente (modal original #mCad).
   O pedido fica no Supabase da Souza Ribeiro (portal_cadastro_solicitar) e a
   equipe aprova no painel. Depois de cadastrar e liberar no G360, o cliente
   usa o "Primeiro acesso" para criar a senha. O portal não cria cliente no G360.
   CNPJ e CEP preenchem os campos por consultas públicas (BrasilAPI e ViaCEP).
   ===================================================================== */
import { supabaseComprador, LOJA } from '../api/supabase.js';
import { $, esc, abrirModal, fecharModal } from './comum.js';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const so = (t) => String(t || '').replace(/\D/g, '');

function campo(id, rotulo, extra = '', obrig = false) {
  return `<label for="${id}">${rotulo}${obrig ? '' : ' <span style="text-transform:none;font-weight:400">(opcional)</span>'}</label><input class="inp" id="${id}" ${extra}><div class="err" id="${id}Err"></div>`;
}

/** Consulta pública do CNPJ: CNPJ.ws (usada pelo portal antigo) e, se falhar, BrasilAPI. */
async function consultarCnpj(d) {
  const tentar = async (url) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    try { const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal }); return r.ok ? await r.json() : null; }
    catch { return null; } finally { clearTimeout(t); }
  };
  const w = await tentar(`https://publica.cnpj.ws/cnpj/${d}`);
  if (w && w.razao_social) {
    const e = w.estabelecimento || {};
    const ie = (e.inscricoes_estaduais || []).find((x) => x.ativo && x.estado?.sigla === e.estado?.sigla) || (e.inscricoes_estaduais || []).find((x) => x.ativo);
    return {
      razao: w.razao_social, fantasia: e.nome_fantasia, ie: ie?.inscricao_estadual, email: (e.email || '').toLowerCase(),
      cep: so(e.cep), rua: [e.tipo_logradouro, e.logradouro].filter(Boolean).join(' '), numero: e.numero, complemento: e.complemento,
      bairro: e.bairro, cidade: e.cidade?.nome, uf: e.estado?.sigla, telefone: e.ddd1 && e.telefone1 ? `${e.ddd1}${e.telefone1}` : '',
      situacao: e.situacao_cadastral,
    };
  }
  const b = await tentar(`https://brasilapi.com.br/api/cnpj/v1/${d}`);
  if (b && b.razao_social) {
    return {
      razao: b.razao_social, fantasia: b.nome_fantasia, ie: '', email: (b.email || '').toLowerCase(), cep: so(b.cep),
      rua: [b.descricao_tipo_de_logradouro, b.logradouro].filter(Boolean).join(' '), numero: b.numero, complemento: b.complemento,
      bairro: b.bairro, cidade: b.municipio, uf: b.uf, telefone: so(b.ddd_telefone_1), situacao: b.descricao_situacao_cadastral,
    };
  }
  return null;
}

export function abrirCadastro(ctx) {
  $('cadBox').innerHTML = `<h3>Quero ser cliente</h3>
    <div class="sub">Preencha os dados da sua empresa. A equipe da Souza Ribeiro analisa e, depois de aprovado, você cria a sua senha em "Primeiro acesso".</div>
    ${campo('kDoc', 'CNPJ ou CPF', 'maxlength="18" autocomplete="off" placeholder="Digite e os dados da empresa vêm preenchidos"', true)}
    <div class="hint" id="kDocSt" aria-live="polite"></div>
    ${campo('kRazao', 'Razão social', 'maxlength="200"', true)}
    ${campo('kFantasia', 'Nome fantasia', 'maxlength="200"')}
    ${campo('kIe', 'Inscrição estadual', 'maxlength="30"')}
    ${campo('kResp', 'Nome do responsável pelas compras', 'maxlength="120" autocomplete="name"', true)}
    <div class="end-form" style="background:none;border:none;padding:0;margin:0"><div class="grade2">
      <div>${campo('kWhats', 'WhatsApp', 'inputmode="tel" maxlength="16" autocomplete="tel"', true)}</div>
      <div>${campo('kTel', 'Telefone', 'inputmode="tel" maxlength="16"')}</div></div></div>
    ${campo('kEmail', 'E-mail', 'type="email" maxlength="160" autocomplete="email"', true)}
    ${campo('kCep', 'CEP', 'inputmode="numeric" maxlength="9" autocomplete="postal-code"', true)}
    <div class="hint" id="kCepSt" aria-live="polite"></div>
    ${campo('kRua', 'Rua / avenida', 'maxlength="200"', true)}
    <div class="end-form" style="background:none;border:none;padding:0;margin:0"><div class="grade3">
      <div>${campo('kNum', 'Número', 'maxlength="20"', true)}</div>
      <div>${campo('kComp', 'Complemento', 'maxlength="120"')}</div></div>
      <div class="grade3"><div>${campo('kCidade', 'Cidade', 'maxlength="120"', true)}</div>
      <div><label for="kUf">UF</label><select class="inp" id="kUf">${UFS.map((u) => `<option ${u === 'MG' ? 'selected' : ''}>${u}</option>`).join('')}</select></div></div></div>
    ${campo('kBairro', 'Bairro', 'maxlength="120"', true)}
    ${campo('kOrigem', 'Como conheceu a Souza Ribeiro', 'maxlength="120" placeholder="Indicação, vendedor, Instagram…"')}
    <div id="kRes" aria-live="polite"></div>
    <div class="act"><button type="button" class="btn sec" id="kCancelar">Cancelar</button><button type="button" class="btn pri" id="kEnviar">Enviar cadastro</button></div>`;
  abrirModal('mCad');
  setTimeout(() => $('kDoc').focus(), 50);
  $('kCancelar').onclick = () => fecharModal('mCad');

  const doc = $('kDoc');
  doc.addEventListener('input', async () => {
    const d = so(doc.value);
    if (d.length !== 14 || /[A-Za-z]/.test(doc.value)) { $('kDocSt').textContent = ''; return; }
    $('kDocSt').textContent = 'Procurando o CNPJ…';
    const dados = await consultarCnpj(d);
    if (!dados) { $('kDocSt').textContent = 'Não achamos o CNPJ na consulta pública agora. Preencha os dados abaixo.'; return; }
    const pre = (id, v) => { if (v && !$(id).value) $(id).value = String(v).trim(); };
    pre('kRazao', dados.razao); pre('kFantasia', dados.fantasia); pre('kIe', dados.ie); pre('kEmail', dados.email);
    pre('kCep', dados.cep ? `${dados.cep.slice(0, 5)}-${dados.cep.slice(5)}` : ''); pre('kRua', dados.rua);
    pre('kNum', dados.numero); pre('kComp', dados.complemento); pre('kBairro', dados.bairro); pre('kCidade', dados.cidade); pre('kTel', dados.telefone);
    if (dados.uf) $('kUf').value = dados.uf;
    $('kDocSt').textContent = `${dados.situacao ? `Situação na Receita: ${dados.situacao}. ` : ''}Confira os dados preenchidos.`;
  });
  const cep = $('kCep');
  cep.addEventListener('input', async () => {
    const d = so(cep.value).slice(0, 8);
    cep.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
    if (d.length !== 8) { $('kCepSt').textContent = ''; return; }
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      const j = await r.json();
      if (j.erro) { $('kCepSt').textContent = 'CEP não encontrado.'; return; }
      if (j.logradouro) $('kRua').value = j.logradouro;
      if (j.bairro) $('kBairro').value = j.bairro;
      if (j.localidade) $('kCidade').value = j.localidade;
      if (j.uf) $('kUf').value = j.uf;
      $('kCepSt').textContent = ''; $('kNum').focus();
    } catch { $('kCepSt').textContent = ''; }
  });

  $('kEnviar').onclick = async () => {
    const v = (id) => $(id).value.trim();
    const erros = {};
    if (!/^[A-Za-z0-9]{11,14}$/.test(v('kDoc').replace(/[^A-Za-z0-9]/g, ''))) erros.kDoc = 'Digite o CNPJ (ou CPF) completo.';
    if (v('kRazao').length < 2) erros.kRazao = 'Digite a razão social.';
    if (v('kResp').length < 2) erros.kResp = 'Digite o nome do responsável.';
    if (!/^[0-9]{10,11}$/.test(so(v('kWhats')))) erros.kWhats = 'WhatsApp com DDD (10 ou 11 números).';
    if (v('kTel') && !/^[0-9]{10,11}$/.test(so(v('kTel')))) erros.kTel = 'Telefone com DDD (10 ou 11 números).';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v('kEmail'))) erros.kEmail = 'Digite um e-mail válido.';
    if (so(v('kCep')).length !== 8) erros.kCep = 'CEP com 8 números.';
    if (!v('kRua')) erros.kRua = 'Digite a rua ou avenida.';
    if (!v('kNum')) erros.kNum = 'Digite o número (ou S/N).';
    if (!v('kCidade')) erros.kCidade = 'Digite a cidade.';
    if (!v('kBairro')) erros.kBairro = 'Digite o bairro.';
    ['kDoc', 'kRazao', 'kResp', 'kWhats', 'kTel', 'kEmail', 'kCep', 'kRua', 'kNum', 'kCidade', 'kBairro'].forEach((id) => {
      $(`${id}Err`).textContent = erros[id] || '';
      if (erros[id]) $(id).setAttribute('aria-invalid', 'true'); else $(id).removeAttribute('aria-invalid');
    });
    const primeiro = Object.keys(erros)[0];
    if (primeiro) { $(primeiro).focus(); return; }
    const b = $('kEnviar'); b.disabled = true; b.textContent = 'Enviando…';
    const d = {
      documento: v('kDoc'), razao_social: v('kRazao'), fantasia: v('kFantasia'), inscricao_estadual: v('kIe'), responsavel: v('kResp'),
      whats: v('kWhats'), telefone: v('kTel'), email: v('kEmail'), cep: v('kCep'), logradouro: v('kRua'), numero: v('kNum'),
      complemento: v('kComp'), bairro: v('kBairro'), cidade: v('kCidade'), uf: $('kUf').value, origem: v('kOrigem'),
    };
    const sb = supabaseComprador();
    const { error } = sb ? await sb.rpc('portal_cadastro_solicitar', { p_loja: LOJA, d }) : { error: { message: 'Cadastro indisponível no momento.' } };
    if (error) {
      b.disabled = false; b.textContent = 'Enviar cadastro';
      $('kRes').innerHTML = `<div class="rv-aviso bad">${esc(error.message && !/^(new row|permission|JWT|fetch)/i.test(error.message) ? error.message : 'Não foi possível enviar agora. Tente de novo em instantes.')}</div>`;
      return;
    }
    $('cadBox').innerHTML = `<div class="ok"><div class="ic2">✓</div><h3>Cadastro enviado!</h3>
      <p>Recebemos os dados da <b>${esc(d.razao_social)}</b>. A equipe da Souza Ribeiro vai analisar e entrar em contato.<br>Depois da aprovação, use <b>Primeiro acesso</b> para criar a sua senha.</p></div>
      <div class="act" style="justify-content:center"><button type="button" class="btn pri" id="kOk">Entendi</button></div>`;
    $('kOk').onclick = () => fecharModal('mCad');
    void ctx;
  };
}
