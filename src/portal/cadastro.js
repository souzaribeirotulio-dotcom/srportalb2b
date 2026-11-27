/* =====================================================================
   "Criar cadastro" para quem ainda não é cliente (modal original #mCad).
   O pedido fica no Supabase da Souza Ribeiro (portal_cadastro_solicitar) e a
   equipe aprova no painel. Depois de cadastrar e liberar no G360, o cliente
   usa o "Primeiro acesso" para criar a senha. O portal não cria cliente no G360.
   CNPJ e CEP preenchem os campos por consultas públicas (BrasilAPI e ViaCEP).
   ===================================================================== */
import { codigoExecutivoGuardado } from '../estado/executivo.js';
import { supabaseComprador, LOJA } from '../api/supabase.js';
import { cadastroAutomatico } from '../api/cadastroauto.js';
import { guardarDocCadastro } from '../estado/doccadastro.js';
import { pedirLink, ErroPonte, MENSAGEM_PONTE_FALHOU } from '../api/ponte.js';
import { $, esc, abrirModal, fecharModal } from './comum.js';
import { avisarEvento } from '../api/push.js';
import { FORMATO_SENHA, htmlRegraSenha, ligarRegraSenha } from '../ui/regra-senha.js';
import { entrar } from '../estado/sessao.js';
import { descartarEnvioDeOutroComprador } from '../estado/envio.js';

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
export const ORIGEM_EXECUTIVO = 'Indicação de um executivo de contas';
const ORIGENS = ['Indicação de um cliente', ORIGEM_EXECUTIVO, 'Vendedor da Souza Ribeiro', 'Instagram', 'Google', 'Mercado Livre', 'WhatsApp', 'Outro'];

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

/** jaCliente: "Já sou cliente e ainda não tenho senha". Mesmo formulário; o pedido chega ao painel marcado. */
export const ORIGEM_JA_CLIENTE = 'Já é cliente (pedir acesso)';
export function abrirCadastro(ctx, { jaCliente = false } = {}) {
  // Senha já no cadastro (decisão da Souza Ribeiro em 26/11/2026): sem e-mail de confirmação para cliente novo.
  // Pré-cadastro (27/11/2026): quem já é cliente também cria a senha aqui; se estiver na lista da equipe, entra na hora.
  const comSenha = ctx.loja?.troca_senha !== false;
  const longa = Number(ctx.loja?.continuar_conectado_dias) > 0;
  const opcoes = (lista) => `<option value="">Selecione…</option>${lista.map((o) => `<option>${esc(o)}</option>`).join('')}`;
  $('cadBox').innerHTML = `<div class="kcad"><h3>${jaCliente ? 'Pedir acesso ao portal' : 'Quero ser cliente'}</h3>
    <div class="sub">${jaCliente
      ? (comSenha ? 'Já compra com a Souza Ribeiro e ainda não tem senha? Preencha os dados da empresa e crie a sua senha. Se o seu cadastro já estiver liberado para o portal, você entra na hora. Se não, a equipe confere e fala com você.'
        : 'Já compra com a Souza Ribeiro e ainda não tem senha? Preencha os dados da empresa. A equipe confere o seu cadastro e manda por e-mail o link para criar a sua senha.')
      : comSenha ? 'Leva uns 2 minutos. Digite o CNPJ que a gente preenche o resto pela Receita, crie a sua senha e pronto: você já entra vendo os preços.'
      : 'Leva uns 2 minutos. Digite o CNPJ que a gente preenche o resto pela Receita. A equipe da Souza Ribeiro confere e, depois de aprovado, você recebe por e-mail o link para criar a sua senha.'}</div>

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
        ${campo('kEmail', 'E-mail', 'type="email" maxlength="160" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" enterkeyhint="next"', true, comSenha ? 'Para recuperar a senha e receber os avisos dos pedidos.' : 'O link para criar a senha chega neste e-mail.')}
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

    ${comSenha ? `<div class="ksec"><div class="ktit"><span>4</span>Sua senha</div>
      <div class="kc"><label for="kSenha">Crie uma senha</label><input class="inp" id="kSenha" type="password" maxlength="8" autocomplete="new-password" spellcheck="false" autocapitalize="off" aria-describedby="kSenhaRs kSenhaErr"></div>
      ${htmlRegraSenha('kSenhaRs')}
      <div class="kc"><label for="kSenha2">Repita a senha</label><input class="inp" id="kSenha2" type="password" maxlength="8" autocomplete="new-password" spellcheck="false" autocapitalize="off" aria-describedby="kSenhaErr"><div class="err" id="kSenhaErr" aria-live="polite"></div></div>
      <label class="kchk"><input type="checkbox" id="kMostrar"> Mostrar senha</label>
      ${longa ? '<label class="kchk"><input type="checkbox" id="kCont" checked> Continuar conectado</label><div class="hint">Desmarque em computador compartilhado.</div>' : ''}
      <div class="hint">Se o seu CPF ou CNPJ já tiver cadastro com a gente, a equipe confere os seus dados e libera o seu acesso.</div>
    </div>` : ''}
    <div class="ksec"${jaCliente ? ' hidden' : ''}><div class="kc"><label for="kOrigem">Como conheceu a Souza Ribeiro <span class="kop">(opcional)</span></label><select class="inp" id="kOrigem">${opcoes(ORIGENS)}</select></div></div>
    <div class="ksec" id="kExecBox" hidden><div class="kc"><label for="kExec">Código do executivo</label><input class="inp" id="kExec" maxlength="20" autocapitalize="characters" spellcheck="false" autocomplete="off" value="" placeholder="Ex.: JOAO"><small class="hint" id="kExecHint" style="display:block;margin-top:4px">O código que o executivo passou para você (opcional).</small></div></div>
    <div id="kRes" aria-live="polite"></div>
    <div class="act kact"><button type="button" class="btn sec" id="kCancelar">Cancelar</button><button type="button" class="btn pri" id="kEnviar">Enviar cadastro</button></div></div>`;
  abrirModal('mCad');
  setTimeout(() => $('kDoc').focus(), 50);
  $('kCancelar').onclick = () => fecharModal('mCad');
  // Veio pelo link de um executivo: "Como conheceu" já marca a indicação e o código vem preenchido.
  {
    const guardado = codigoExecutivoGuardado();
    const mostrar = () => { $('kExecBox').hidden = $('kOrigem').value !== ORIGEM_EXECUTIVO; };
    if (guardado) {
      $('kOrigem').value = ORIGEM_EXECUTIVO; $('kExec').value = guardado;
      $('kExecHint').textContent = 'Preenchido pelo link do executivo.';
    }
    $('kOrigem').addEventListener('change', mostrar); mostrar();
    $('kExec').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  }

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
    pre('kRazao', dados.razao); pre('kFantasia', dados.fantasia); pre('kIe', dados.ie);
    // E-mail nunca vem da Receita (costuma estar errado ou ser do contador): a pessoa digita o dela. O link de senha vai para ele.
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
  // Cliente novo ainda não tem código: o item "diferente do código de cliente" não se aplica aqui.
  $('kSenhaRs')?.querySelector('[data-r="cod"]')?.remove();
  const senhaOk = comSenha ? ligarRegraSenha($('kSenhaRs'), $('kSenha'), $('kSenha2')) : () => true;
  $('kMostrar')?.addEventListener('change', (e) => { ['kSenha', 'kSenha2'].forEach((id) => { $(id).type = e.target.checked ? 'text' : 'password'; }); });

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
    // Senha: confere aqui; quem valida de verdade é a API do G360 ao gravar.
    let senha = null;
    if (comSenha) {
      const s1 = $('kSenha').value; const s2 = $('kSenha2').value;
      const errS = !FORMATO_SENHA.test(s1) ? 'A senha precisa ter de 6 a 8 caracteres, sem espaços nem acentos.' : s1 !== s2 ? 'As duas senhas não são iguais.' : '';
      $('kSenhaErr').textContent = errS;
      if (errS || !senhaOk()) {
        if (!errS) $('kSenhaErr').textContent = 'Confira a regra da senha.';
        const alvo = !FORMATO_SENHA.test(s1) ? $('kSenha') : $('kSenha2');
        alvo.focus(); alvo.scrollIntoView({ block: 'center', behavior: 'smooth' }); return;
      }
      senha = s1;
    }
    const continuar = comSenha && longa && $('kCont')?.checked === true;
    const b = $('kEnviar'); b.disabled = true; b.textContent = 'Enviando…';
    const d = {
      documento: v('kDoc'), razao_social: v('kRazao'), fantasia: pf ? '' : v('kFantasia'),
      inscricao_estadual: pf ? '' : ($('kIsento').checked ? 'ISENTO' : v('kIe')), responsavel: v('kResp'),
      whats: fone(v('kWhats')), telefone: v('kTel') ? fone(v('kTel')) : '', email: v('kEmail').toLowerCase(), cep: v('kCep'), logradouro: v('kRua'), numero: v('kNum'),
      complemento: v('kComp'), bairro: v('kBairro'), cidade: v('kCidade'), uf: $('kUf').value, origem: jaCliente ? ORIGEM_JA_CLIENTE : $('kOrigem').value, segmento: $('kSeg').value,
      executivo: $('kOrigem').value !== ORIGEM_EXECUTIVO ? '' : String($('kExec').value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
    };
    const sb = supabaseComprador();
    const { error } = sb ? await sb.rpc('portal_cadastro_solicitar', { p_loja: LOJA, d }) : { error: { message: 'Cadastro indisponível no momento.' } };
    if (error) {
      b.disabled = false; b.textContent = 'Enviar cadastro';
      $('kRes').innerHTML = `<div class="rv-aviso bad">${esc(error.message && !/^(new row|permission|JWT|fetch)/i.test(error.message) ? error.message : 'Não foi possível enviar agora. Tente de novo em instantes.')}</div>`;
      return;
    }
    marcarEmAnalise(); window.dispatchEvent(new Event('g360:cadastro-enviado'));
    // Cliente novo (CNPJ ou CPF): a função cria a ficha no G360 e já manda o link de senha.
    let auto = { resultado: 'analise' };
    const docLen = d.documento.replace(/[^A-Za-z0-9]/g, '').length;
    if ((!jaCliente || senha) && (docLen === 14 || docLen === 11)) {
      $('cadBox').innerHTML = `<div class="ok cad-criando" role="status" aria-live="polite"><div class="ic2 cad-pontos" aria-hidden="true"><i></i><i></i><i></i></div>
        <h3>Criando o seu acesso</h3><p id="kEtapa">${jaCliente ? 'Conferindo o seu cadastro…' : docLen === 14 ? 'Conferindo o CNPJ na Receita…' : 'Conferindo o seu CPF…'}</p><div class="cad-barra" aria-hidden="true"><span></span></div>
        <small class="hint">Leva alguns segundos. Não feche esta tela.</small></div>`;
      // As etapas só mostram que está andando; o resultado de verdade vem da função.
      const etapas = jaCliente ? ['Conferindo o seu cadastro…', 'Liberando os seus preços…', 'Criando a sua senha…']
        : [docLen === 14 ? 'Conferindo o CNPJ na Receita…' : 'Conferindo o seu CPF…', 'Criando o seu cadastro…', 'Liberando os seus preços…', senha ? 'Criando a sua senha…' : 'Enviando o link para o seu e-mail…'];
      let ie = 0;
      const relogio = setInterval(() => { ie = Math.min(ie + 1, etapas.length - 1); const el = $('kEtapa'); if (el) el.textContent = etapas[ie]; }, 3500);
      try { auto = await cadastroAutomatico(d.documento, senha); } finally { clearInterval(relogio); }
    }
    // Aviso para os gestores só depois do cadastro automático: "cliente cadastrado" ou "para aprovar".
    avisarEvento('cadastro');
    if (auto.resultado === 'criado' && auto.senha === 'gravada' && senha) {
      // Ficha e senha criadas: entra direto, como no login comum (sem e-mail de confirmação).
      esquecerCadastroEmAnalise(); window.dispatchEvent(new Event('g360:cadastro-enviado'));
      $('cadBox').innerHTML = `<div class="ok cad-criando" role="status" aria-live="polite"><div class="ic2 cad-pontos" aria-hidden="true"><i></i><i></i><i></i></div><h3>Acesso criado!</h3><p>Entrando no portal…</p></div>`;
      try {
        await entrar(d.documento, senha, continuar);
        senha = null; descartarEnvioDeOutroComprador();
        fecharModal('mCad');
        ctx.ir('/', { aviso: 'entrou_senha_nova' });
      } catch {
        // A senha já está gravada; se a entrada automática não deu (rede), entra pelo login de sempre.
        senha = null;
        $('cadBox').innerHTML = `<div class="ok"><div class="ic2">✓</div><h3>Pronto! Seu acesso foi criado</h3>
          <p>Entre com o seu CPF ou CNPJ e a senha que você acabou de criar.</p></div>
          <div class="act" style="justify-content:center"><button type="button" class="btn pri" id="kEntrarJa">Entrar</button></div>`;
        $('kEntrarJa').onclick = () => { fecharModal('mCad'); ctx.abrirLogin?.(d.documento); };
      }
      return;
    }
    senha = null;
    if (auto.resultado === 'criado') {
      // Acesso criado: o topo volta ao normal ("Já sou cliente: entrar"), sem o aviso de análise.
      esquecerCadastroEmAnalise(); window.dispatchEvent(new Event('g360:cadastro-enviado'));
      guardarDocCadastro(d.documento); // a página do link já abre com o CNPJ preenchido neste aparelho
      $('cadBox').innerHTML = `<div class="ok"><div class="ic2">✓</div><h3>Pronto! Seu acesso foi criado</h3>
        <p>Mandamos o link para criar a senha para<br><b class="cad-email">${esc(d.email || '')}</b>.</p>
        <ol class="cad-passos"><li><span>Abra o e-mail <b>Defina sua senha</b></span></li><li><span>Crie a sua senha</span></li><li><span>Pronto: você já entra vendo os preços</span></li></ol>
        <p class="hint">O link vale 30 minutos. Não achou? Veja o spam ou a aba Promoções.</p></div>
        <div class="act cad-acoes"><button type="button" class="btn pri" id="kOk">Entendi</button><button type="button" class="cad-reenviar" id="kReenviar">Não chegou? Mandar o link de novo</button></div>
        <div id="kReRes" aria-live="polite" style="text-align:center"></div>`;
      $('kOk').onclick = () => fecharModal('mCad');
      // Mesmo pedido do "Esqueci minha senha": um link novo invalida o anterior (no máximo 3 a cada 15 minutos).
      $('kReenviar').onclick = async () => {
        const b = $('kReenviar'); b.disabled = true; b.textContent = 'Mandando…';
        try { $('kReRes').innerHTML = `<p class="hint">${esc(await pedirLink(d.documento))} Vale sempre o e-mail mais recente.</p>`; }
        catch (e) { $('kReRes').innerHTML = `<p class="hint">${esc(e instanceof ErroPonte ? e.message : MENSAGEM_PONTE_FALHOU)}</p>`; }
        // Espera 1 minuto antes de deixar pedir outro, para não gastar o limite de pedidos.
        b.textContent = 'Não chegou? Mandar o link de novo'; setTimeout(() => { b.disabled = false; }, 60000);
      };
      return;
    }
    $('cadBox').innerHTML = `<div class="ok"><div class="ic2">✓</div><h3>${jaCliente ? 'Pedido de acesso em análise' : 'Cadastro em análise'}</h3>
      <p>Recebemos os dados da <b>${esc(d.razao_social)}</b>. A equipe da Souza Ribeiro confere e fala com você pelo WhatsApp <b>${esc(foneBonito(d.whats))}</b>.</p>
      <p>${jaCliente ? `Quando o acesso for liberado, chega no e-mail <b>${esc(d.email || '')}</b> o link para você criar a sua senha e começar a comprar.`
        : `Se esse ${docLen === 14 ? 'CNPJ' : 'CPF'} já tem cadastro com a gente, a equipe confere os seus dados e manda o link para criar a senha no e-mail do cadastro.`}</p></div>
      <div class="act" style="justify-content:center"><button type="button" class="btn pri" id="kOk">Entendi</button></div>`;
    $('kOk').onclick = () => fecharModal('mCad');
    void ctx;
  };
}
