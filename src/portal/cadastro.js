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
/** Telefone brasileiro só com DDD + número: tira +55 e o 0 de operadora/DDD que o preenchimento automático costuma pôr. */
function fone(t) {
  let d = so(t);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1);
  return d;
}
const foneOk = (t) => /^[1-9][0-9][0-9]{8,9}$/.test(fone(t));
function foneBonito(t) { const d = fone(t); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : t; }

function campo(id, rotulo, extra = '', obrig = false, dica = '') {
  return `<div class="kc" id="${id}Box"><label for="${id}">${rotulo}${obrig ? '' : ' <span class="kop">(opcional)</span>'}</label><input class="inp" id="${id}" ${extra}>${dica ? `<div class="hint kdica">${dica}</div>` : ''}<div class="err" id="${id}Err"></div></div>`;
}

export const SEGMENTOS = ['Salão de beleza ou estética', 'Restaurante, bar ou lanchonete', 'Padaria ou confeitaria', 'Mercado ou comércio', 'Clínica, consultório ou hospital',
  'Escritório', 'Condomínio', 'Escola', 'Hotel ou pousada', 'Indústria', 'Igreja ou associação', 'Revenda', 'Outro'];
const ORIGENS = ['Indicação de um cliente', 'Vendedor da Souza Ribeiro', 'Instagram', 'Google', 'Mercado Livre', 'WhatsApp', 'Outro'];

/** Ramo provável pela atividade principal (CNAE) da Receita. Só sugere: a pessoa confirma. */
function segmentoPelaAtividade(t) {
  const a = String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const regras = [
    [/cabeleireir|manicure|pedicure|estetic|beleza|barbear|depila/, 'Salão de beleza ou estética'],
    [/padaria|confeitaria|panificad/, 'Padaria ou confeitaria'],
    [/restaurante|lanchonete|bares|bar |alimentacao|refeic|pizzaria|sorvet|buffet/, 'Restaurante, bar ou lanchonete'],
    [/medic|odontolog|clinica|hospital|laboratori|fisioterap|veterinar|saude/, 'Clínica, consultório ou hospital'],
    [/condominio/, 'Condomínio'],
    [/ensino|escola|educacao|creche/, 'Escola'],
    [/hotel|pousada|hospedagem|motel/, 'Hotel ou pousada'],
    [/fabricacao|industria/, 'Indústria'],
    [/organizacoes religiosas|associac|sindicat/, 'Igreja ou associação'],
    [/atacadista/, 'Revenda'],
    [/varejista|supermercado|mercad|minimercado|comercio/, 'Mercado ou comércio'],
    [/contabil|advocac|consultoria|escritorio|administrativ|imobiliar|seguros/, 'Escritório'],
  ];
  return regras.find(([re]) => re.test(a))?.[1] || '';
}

/** Máscara do CNPJ (também alfanumérico) ou do CPF, enquanto a pessoa digita. Quem valida é a equipe/G360. */
function mascaraDoc(t) {
  const c = String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14);
  if (c.length <= 11 && /^\d*$/.test(c)) return c.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  return c.replace(/^(\w{2})(\w)/, '$1.$2').replace(/^(\w{2})\.(\w{3})(\w)/, '$1.$2.$3').replace(/\.(\w{3})(\w)/, '.$1/$2').replace(/(\w{4})(\w{1,2})$/, '$1-$2');
}

/** Consulta pública do CNPJ: CNPJ.ws, CNPJá (aberta) e BrasilAPI, ao mesmo tempo.
 *  A inscrição estadual vem do CNPJ.ws ou do CNPJá (que buscam no cadastro dos estados); a Receita não informa IE. */
export async function consultarCnpj(d) {
  const tentar = async (url) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    try { const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal }); return r.ok ? await r.json() : null; }
    catch { return null; } finally { clearTimeout(t); }
  };
  const [w, j, b] = await Promise.all([tentar(`https://publica.cnpj.ws/cnpj/${d}`), tentar(`https://open.cnpja.com/office/${d}`), tentar(`https://brasilapi.com.br/api/cnpj/v1/${d}`)]);
  let r = null;
  if (w && w.razao_social) {
    const e = w.estabelecimento || {};
    const ie = (e.inscricoes_estaduais || []).find((x) => x.ativo && x.estado?.sigla === e.estado?.sigla) || (e.inscricoes_estaduais || []).find((x) => x.ativo);
    r = {
      razao: w.razao_social, fantasia: e.nome_fantasia, ie: ie?.inscricao_estadual, email: (e.email || '').toLowerCase(),
      cep: so(e.cep), rua: [e.tipo_logradouro, e.logradouro].filter(Boolean).join(' '), numero: e.numero, complemento: e.complemento,
      bairro: e.bairro, cidade: e.cidade?.nome, uf: e.estado?.sigla, telefone: e.ddd1 && e.telefone1 ? `${e.ddd1}${e.telefone1}` : '',
      situacao: e.situacao_cadastral, atividade: e.atividade_principal?.descricao || '',
    };
  } else if (j && j.company?.name) {
    const a = j.address || {}; const tel = (j.phones || [])[0];
    r = {
      razao: j.company.name, fantasia: j.alias, ie: '', email: ((j.emails || [])[0]?.address || '').toLowerCase(), cep: so(a.zip),
      rua: a.street, numero: a.number, complemento: a.details, bairro: a.district, cidade: a.city, uf: a.state,
      telefone: tel ? `${tel.area}${tel.number}` : '', situacao: j.status?.text, atividade: j.mainActivity?.text || '',
    };
  } else if (b && b.razao_social) {
    r = {
      razao: b.razao_social, fantasia: b.nome_fantasia, ie: '', email: (b.email || '').toLowerCase(), cep: so(b.cep),
      rua: [b.descricao_tipo_de_logradouro, b.logradouro].filter(Boolean).join(' '), numero: b.numero, complemento: b.complemento,
      bairro: b.bairro, cidade: b.municipio, uf: b.uf, telefone: so(b.ddd_telefone_1), situacao: b.descricao_situacao_cadastral,
      atividade: b.cnae_fiscal_descricao || '',
    };
  }
  if (!r) return null;
  if (!r.ie && Array.isArray(j?.registrations)) {
    const regs = j.registrations.filter((x) => x?.number);
    const ie = regs.find((x) => x.enabled && x.state === r.uf) || regs.find((x) => x.enabled);
    if (ie) r.ie = ie.number;
  }
  r.ieConsultada = Boolean(w?.estabelecimento || Array.isArray(j?.registrations));
  return r;
}

/** Situação do documento no portal: 'pendente', 'aprovado', 'recusado' ou null (sem cadastro). Falha → null. */
async function situacaoNoPortal(doc) {
  try {
    const sb = supabaseComprador(); if (!sb) return null;
    const { data, error } = await sb.rpc('portal_cadastro_situacao', { p_loja: LOJA, p_documento: doc });
    return error ? null : (data || null);
  } catch { return null; }
}

/* "Cadastro em análise" neste aparelho: só a data do envio, sem documento nem dados da empresa.
   Some quando a pessoa entra no portal. */
const CHAVE_ANALISE = `g360:${LOJA}:cadastro-em-analise`;
function marcarEmAnalise() { try { localStorage.setItem(CHAVE_ANALISE, new Date().toISOString().slice(0, 10)); } catch { /* sem armazenamento */ } }
export function cadastroEmAnalise() { try { return localStorage.getItem(CHAVE_ANALISE); } catch { return null; } }
export function esquecerCadastroEmAnalise() { try { localStorage.removeItem(CHAVE_ANALISE); } catch { /* sem armazenamento */ } }

export function abrirCadastro(ctx) {
  const opcoes = (lista) => `<option value="">Selecione…</option>${lista.map((o) => `<option>${esc(o)}</option>`).join('')}`;
  $('cadBox').innerHTML = `<div class="kcad"><h3>Quero ser cliente</h3>
    <div class="sub">Leva uns 2 minutos. Digite o CNPJ que a gente preenche o resto pela Receita. A equipe da Souza Ribeiro confere e, depois de aprovado, você recebe por e-mail o link para criar a sua senha.</div>

    <div class="ksec"><div class="ktit"><span>1</span>Sua empresa</div>
      ${campo('kDoc', 'CNPJ ou CPF', 'maxlength="18" autocomplete="off" autocapitalize="characters" inputmode="text" enterkeyhint="next" placeholder="00.000.000/0000-00"', true)}
      <div class="hint" id="kDocSt" aria-live="polite"></div>
      <div id="kJa" class="kja" hidden></div>
      <div id="kResumo" class="kresumo" hidden></div>
      <div id="kEmpresa">
        ${campo('kRazao', 'Razão social', 'maxlength="200" autocomplete="organization"', true)}
        <div id="kSoPj">
          ${campo('kFantasia', 'Nome fantasia', 'maxlength="200"')}
          ${campo('kIe', 'Inscrição estadual', 'maxlength="30" inputmode="text" autocapitalize="characters"', false, 'Quem compra para revender ou tem IE ativa deve informar. Sem IE, marque “Isento”.')}
          <label class="kchk"><input type="checkbox" id="kIsento"> Isento / não tenho inscrição estadual</label>
        </div>
      </div>
      <div class="kc"><label for="kSeg">Ramo do negócio</label><select class="inp" id="kSeg">${opcoes(SEGMENTOS)}</select><div class="hint kdica">Ajuda a gente a mostrar primeiro o que o seu negócio mais usa.</div><div class="err" id="kSegErr"></div></div>
    </div>

    <div class="ksec"><div class="ktit"><span>2</span>Quem vai comprar</div>
      ${campo('kResp', 'Seu nome', 'maxlength="120" autocomplete="name" autocapitalize="words" enterkeyhint="next"', true)}
      <div class="grade2k">
        ${campo('kWhats', 'WhatsApp', 'type="tel" inputmode="tel" maxlength="20" autocomplete="tel-national" placeholder="(34) 99999-0000" enterkeyhint="next"', true)}
        ${campo('kEmail', 'E-mail', 'type="email" maxlength="160" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" enterkeyhint="next"', true, 'O link para criar a senha chega neste e-mail.')}
      </div>
      ${campo('kTel', 'Outro telefone', 'type="tel" inputmode="tel" maxlength="20" placeholder="(34) 3200-0000"')}
    </div>

    <div class="ksec"><div class="ktit"><span>3</span>Endereço de entrega</div>
      <div class="grade2k">
        ${campo('kCep', 'CEP', 'inputmode="numeric" maxlength="9" autocomplete="postal-code" placeholder="00000-000"', true)}
        ${campo('kNum', 'Número', 'maxlength="20" inputmode="text" placeholder="ou S/N"', true)}
      </div>
      <div class="hint" id="kCepSt" aria-live="polite"></div>
      ${campo('kRua', 'Rua ou avenida', 'maxlength="200" autocomplete="address-line1"', true)}
      ${campo('kComp', 'Complemento', 'maxlength="120" autocomplete="address-line2" placeholder="Sala, loja, bloco…"')}
      ${campo('kBairro', 'Bairro', 'maxlength="120"', true)}
      <div class="grade2k kcid">
        ${campo('kCidade', 'Cidade', 'maxlength="120" autocomplete="address-level2"', true)}
        <div class="kc"><label for="kUf">UF</label><select class="inp" id="kUf">${UFS.map((u) => `<option ${u === 'MG' ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
      </div>
    </div>

    <div class="ksec"><div class="kc"><label for="kOrigem">Como conheceu a Souza Ribeiro <span class="kop">(opcional)</span></label><select class="inp" id="kOrigem">${opcoes(ORIGENS)}</select></div></div>
    <div id="kRes" aria-live="polite"></div>
    <div class="act kact"><button type="button" class="btn sec" id="kCancelar">Cancelar</button><button type="button" class="btn pri" id="kEnviar">Enviar cadastro</button></div></div>`;
  abrirModal('mCad');
  setTimeout(() => $('kDoc').focus(), 50);
  $('kCancelar').onclick = () => fecharModal('mCad');

  const doc = $('kDoc');
  const ePf = () => { const c = doc.value.replace(/[^A-Za-z0-9]/g, ''); return c.length === 11 && /^\d+$/.test(c); };
  const ajustarTipo = () => {
    const pf = ePf();
    $('kSoPj').hidden = pf;
    document.querySelector('label[for="kRazao"]').innerHTML = pf ? 'Nome completo' : 'Razão social';
  };
  const mostrarCampos = () => { $('kEmpresa').hidden = false; $('kResumo').hidden = true; };
  // Documento que já tem cadastro no portal: avisa na hora e mostra o caminho certo (entrar ou aguardar).
  let jaConsultado = ''; let jaCadastrado = null;
  const conferirJaCadastrado = async () => {
    const c = doc.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const completo = c.length === 14 || (c.length === 11 && /^\d+$/.test(c));
    if (!completo) { jaConsultado = ''; jaCadastrado = null; $('kJa').hidden = true; $('kEnviar').disabled = false; return; }
    if (c === jaConsultado) return; jaConsultado = c;
    const st = await situacaoNoPortal(c);
    if (doc.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase() !== c) return;
    jaCadastrado = st;
    const caixa = $('kJa');
    if (!st) { caixa.hidden = true; $('kEnviar').disabled = false; return; }
    const tipo = c.length === 11 ? 'CPF' : 'CNPJ';
    const textos = {
      aprovado: [`Este ${tipo} já está cadastrado no portal.`, 'É só entrar com ele e a sua senha. Se esqueceu a senha, use <b>Esqueci minha senha</b>: o link chega no e-mail cadastrado. Se ainda não tem senha ou o e-mail mudou, fale com a equipe da Souza Ribeiro pelo WhatsApp.'],
      pendente: [`Já recebemos um cadastro com este ${tipo}.`, 'O cadastro está em análise: a equipe da Souza Ribeiro confere e fala com você pelo WhatsApp. Quando for aprovado, chega no e-mail cadastrado o link para criar a senha.'],
      recusado: [`Já existe um cadastro com este ${tipo}.`, 'Para mais informações, fale com a equipe da Souza Ribeiro.'],
    }[st] || [`Este ${tipo} já está cadastrado no portal.`, ''];
    caixa.innerHTML = `<div class="kja1">✓ ${textos[0]}</div>${textos[1] ? `<div class="kja2">${textos[1]}</div>` : ''}
      ${st === 'aprovado' || st === 'pendente' ? `<div class="kja3">${st === 'aprovado' ? '<button type="button" class="btn pri" id="kJaEntrar">Entrar</button>' : ''}${st === 'aprovado' && ctx.loja?.troca_senha !== false ? '<button type="button" class="btn sec" id="kJaPrimeiro">Esqueci minha senha</button>' : ''}</div>` : ''}`;
    caixa.hidden = false;
    $('kEnviar').disabled = true;
    $('kJaEntrar')?.addEventListener('click', () => { fecharModal('mCad'); ctx.abrirLogin?.(doc.value); });
    $('kJaPrimeiro')?.addEventListener('click', () => { fecharModal('mCad'); ctx.ir?.('/esqueci-senha'); });
  };
  let ultimaConsulta = '';
  doc.addEventListener('input', async () => {
    const pos = doc.selectionStart === doc.value.length; doc.value = mascaraDoc(doc.value); if (pos) doc.setSelectionRange(doc.value.length, doc.value.length);
    $('kDocErr').textContent = ''; doc.removeAttribute('aria-invalid');
    ajustarTipo();
    conferirJaCadastrado();
    const d = so(doc.value);
    if (d.length !== 14 || /[A-Za-z]/.test(doc.value)) { $('kDocSt').textContent = ''; if (!$('kResumo').hidden) mostrarCampos(); return; }
    if (d === ultimaConsulta) return; ultimaConsulta = d;
    $('kDocSt').innerHTML = '<span class="kbusca">Buscando os dados na Receita…</span>';
    const dados = await consultarCnpj(d);
    if (so(doc.value) !== d) return;
    if (!dados) { $('kDocSt').textContent = 'Não conseguimos consultar este CNPJ agora. Preencha os dados abaixo.'; mostrarCampos(); return; }
    const pre = (id, v) => { if (v && !$(id).value.trim()) $(id).value = String(v).trim(); };
    pre('kRazao', dados.razao); pre('kFantasia', dados.fantasia); pre('kIe', dados.ie); pre('kEmail', dados.email);
    pre('kCep', dados.cep ? `${dados.cep.slice(0, 5)}-${dados.cep.slice(5)}` : ''); pre('kRua', dados.rua);
    pre('kNum', dados.numero); pre('kComp', dados.complemento); pre('kBairro', dados.bairro); pre('kCidade', dados.cidade);
    if (dados.telefone && !$('kTel').value) $('kTel').value = foneBonito(dados.telefone);
    if (dados.uf) $('kUf').value = dados.uf;
    if (!$('kSeg').value) { const sg = segmentoPelaAtividade(dados.atividade); if (sg) $('kSeg').value = sg; }
    const ativa = /ativa/i.test(dados.situacao || '') && !/inativ/i.test(dados.situacao || '');
    const ieTxt = dados.ie ? `IE ${esc(dados.ie)}` : (dados.ieConsultada ? 'Nenhuma inscrição estadual ativa encontrada' : 'Inscrição estadual: confira abaixo');
    $('kResumo').innerHTML = `<div class="kr1"><b>${esc(dados.razao)}</b>${dados.situacao ? `<span class="kst ${ativa ? 'ok' : 'bad'}">${esc(dados.situacao)}</span>` : ''}</div>
      ${dados.fantasia ? `<div class="kr2">${esc(dados.fantasia)}</div>` : ''}
      <div class="kr2">${ieTxt}${dados.atividade ? ` · ${esc(dados.atividade)}` : ''}</div>
      ${dados.cidade ? `<div class="kr2">${esc([dados.rua, dados.numero].filter(Boolean).join(', '))} · ${esc(dados.cidade)}/${esc(dados.uf || '')}</div>` : ''}
      <button type="button" class="tool" id="kEditar">Corrigir dados da empresa</button>`;
    $('kResumo').hidden = false;
    // Com os dados encontrados, os campos da empresa ficam recolhidos (dá para abrir e corrigir).
    // Achou tudo (inclusive a IE): os campos da empresa ficam recolhidos. Sem IE, ficam abertos para informar ou marcar isento.
    $('kEmpresa').hidden = Boolean(dados.ie);
    $('kEditar').onclick = mostrarCampos;
    $('kDocSt').innerHTML = ativa || !dados.situacao ? '' : `<span class="ruim">Este CNPJ aparece como <b>${esc(dados.situacao)}</b> na Receita. Confira o número; se estiver certo, pode enviar que a equipe analisa.</span>`;
    if (!$('kResp').value) $('kResp').focus();
  });
  $('kIsento').addEventListener('change', () => { if ($('kIsento').checked) { $('kIe').value = ''; $('kIe').disabled = true; } else $('kIe').disabled = false; });

  const cep = $('kCep');
  cep.addEventListener('input', async () => {
    const d = so(cep.value).slice(0, 8);
    cep.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
    if (d.length !== 8) { $('kCepSt').textContent = ''; return; }
    $('kCepSt').textContent = 'Buscando o endereço…';
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      const j = await r.json();
      if (j.erro) { $('kCepSt').textContent = 'CEP não encontrado. Confira ou preencha o endereço abaixo.'; return; }
      if (j.logradouro) $('kRua').value = j.logradouro;
      if (j.bairro) $('kBairro').value = j.bairro;
      if (j.localidade) $('kCidade').value = j.localidade;
      if (j.uf) $('kUf').value = j.uf;
      $('kCepSt').textContent = ''; if (!$('kNum').value) $('kNum').focus();
    } catch { $('kCepSt').textContent = ''; }
  });

  ['kWhats', 'kTel'].forEach((id) => {
    $(id).addEventListener('input', () => { $(`${id}Err`).textContent = ''; $(id).removeAttribute('aria-invalid'); });
    $(id).addEventListener('blur', () => { if ($(id).value.trim() && foneOk($(id).value)) $(id).value = foneBonito($(id).value); });
  });
  ['kRazao', 'kResp', 'kEmail', 'kRua', 'kNum', 'kCidade', 'kBairro', 'kCep', 'kSeg'].forEach((id) => {
    $(id).addEventListener(id === 'kSeg' ? 'change' : 'input', () => { $(`${id}Err`).textContent = ''; $(id).removeAttribute('aria-invalid'); });
  });
  $('kEmail').addEventListener('blur', () => { $('kEmail').value = $('kEmail').value.trim().toLowerCase(); });

  $('kEnviar').onclick = async () => {
    if (jaCadastrado) { $('kJa').scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    const v = (id) => $(id).value.trim();
    const erros = {};
    const pf = ePf();
    if (!/^[A-Za-z0-9]{11,14}$/.test(v('kDoc').replace(/[^A-Za-z0-9]/g, ''))) erros.kDoc = 'Digite o CNPJ (ou CPF) completo.';
    if (v('kRazao').length < 2) erros.kRazao = pf ? 'Digite o seu nome completo.' : 'Digite a razão social.';
    if (!v('kSeg')) erros.kSeg = 'Escolha o ramo do negócio (ou “Outro”).';
    if (v('kResp').length < 2) erros.kResp = 'Digite o seu nome.';
    if (!foneOk(v('kWhats'))) erros.kWhats = 'WhatsApp com DDD, por exemplo (64) 99999-7015.';
    if (v('kTel') && !foneOk(v('kTel'))) erros.kTel = 'Telefone com DDD, por exemplo (34) 3227-0508.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v('kEmail'))) erros.kEmail = 'Digite um e-mail válido.';
    if (so(v('kCep')).length !== 8) erros.kCep = 'CEP com 8 números.';
    if (!v('kRua')) erros.kRua = 'Digite a rua ou avenida.';
    if (!v('kNum')) erros.kNum = 'Digite o número (ou S/N).';
    if (!v('kCidade')) erros.kCidade = 'Digite a cidade.';
    if (!v('kBairro')) erros.kBairro = 'Digite o bairro.';
    const ids = ['kDoc', 'kRazao', 'kSeg', 'kResp', 'kWhats', 'kEmail', 'kTel', 'kCep', 'kNum', 'kRua', 'kBairro', 'kCidade'];
    ids.forEach((id) => {
      $(`${id}Err`).textContent = erros[id] || '';
      if (erros[id]) $(id).setAttribute('aria-invalid', 'true'); else $(id).removeAttribute('aria-invalid');
    });
    if (erros.kRazao) mostrarCampos();
    const primeiro = ids.find((id) => erros[id]);
    if (primeiro) { $(primeiro).focus(); $(primeiro).scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    const b = $('kEnviar'); b.disabled = true; b.textContent = 'Enviando…';
    const d = {
      documento: v('kDoc'), razao_social: v('kRazao'), fantasia: pf ? '' : v('kFantasia'),
      inscricao_estadual: pf ? '' : ($('kIsento').checked ? 'ISENTO' : v('kIe')), responsavel: v('kResp'),
      whats: fone(v('kWhats')), telefone: v('kTel') ? fone(v('kTel')) : '', email: v('kEmail').toLowerCase(), cep: v('kCep'), logradouro: v('kRua'), numero: v('kNum'),
      complemento: v('kComp'), bairro: v('kBairro'), cidade: v('kCidade'), uf: $('kUf').value, origem: $('kOrigem').value, segmento: $('kSeg').value,
    };
    const sb = supabaseComprador();
    const { error } = sb ? await sb.rpc('portal_cadastro_solicitar', { p_loja: LOJA, d }) : { error: { message: 'Cadastro indisponível no momento.' } };
    if (error) {
      b.disabled = false; b.textContent = 'Enviar cadastro';
      $('kRes').innerHTML = `<div class="rv-aviso bad">${esc(error.message && !/^(new row|permission|JWT|fetch)/i.test(error.message) ? error.message : 'Não foi possível enviar agora. Tente de novo em instantes.')}</div>`;
      return;
    }
    marcarEmAnalise(); window.dispatchEvent(new Event('g360:cadastro-enviado'));
    $('cadBox').innerHTML = `<div class="ok"><div class="ic2">✓</div><h3>Cadastro em análise</h3>
      <p>Recebemos os dados da <b>${esc(d.razao_social)}</b>. A equipe da Souza Ribeiro confere e fala com você pelo WhatsApp <b>${esc(foneBonito(d.whats))}</b>.</p>
      <p>Quando o cadastro for aprovado, chega no e-mail <b>${esc(d.email || '')}</b> o link para você criar a sua senha e começar a comprar.</p></div>
      <div class="act" style="justify-content:center"><button type="button" class="btn pri" id="kOk">Entendi</button></div>`;
    $('kOk').onclick = () => fecharModal('mCad');
    void ctx;
  };
}
