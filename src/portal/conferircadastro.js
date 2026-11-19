/* =====================================================================
   "Quero ser cliente": antes de aprovar, confere o documento no G360.
   - CNPJ: POST operadores/cadastro/cnpj, uma vez por pedido aberto (gasta cota da loja quando o CNPJ é novo).
     Sem permissoes.incluir_clientes (GET operadores/me), usa POST operadores/clientes/consulta (recorte do operador).
     CPF: a API não tem consulta prévia; segue para o Novo cliente, que não confirma documento repetido.
   - Já é cliente com código → aviso "Este CNPJ já é cliente no G360", dados do pedido
     ao lado dos do G360 (GET operadores/clientes/{cliente}). O que a equipe marcar é
     gravado NO G360 (PUT operadores/clientes/{cliente}, só o que mudou, com a versao);
     depois vincula ao código existente e a ficha do portal passa a ter os dados do G360.
   - Já existe, mas sem código (fora do recorte ou duplicado) → não aprova.
   - Não é cliente → aprova e segue para o Novo cliente no G360.
   O G360 é a fonte do cadastro: o portal não guarda dados diferentes para o mesmo cliente.
   ===================================================================== */
import { preencherNovoClienteCnpj, consultarClienteOperador, consultarOperadorMe, consultarFichaClienteOperador, alterarFichaClienteOperador } from '../api/g360.js';
import { mostrarMensagemErro } from '../ui/mensagem.js';
import { $, esc, toast, abrirModal, fecharModal } from './comum.js';

const docLimpo = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const soNum = (v) => String(v || '').replace(/\D/g, '');
function fone(v) {
  let d = soNum(v);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1);
  return d;
}
const txt = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * k: pedido (portal_cadastros). o: { token(), aoSessaoEncerrada(e), aprovarNovo() → Promise, vincular(codigo) → Promise, abrirFicha(codigo) }
 */
export async function conferirPedidoNoG360(k, o) {
  abrirModal('mAdm');
  const box = $('admBox');
  const doc = docLimpo(k.documento);
  const rotuloDoc = doc.length === 11 ? 'CPF' : 'CNPJ';
  box.innerHTML = `<div class="empty2">Conferindo o ${rotuloDoc} no G360…</div>`;
  let existe;
  try { existe = await procurar(doc, o); }
  catch (e) {
    if (e.status === 401) { fecharModal('mAdm'); o.aoSessaoEncerrada?.(e); return; }
    box.innerHTML = `${topo('Conferir no G360 antes de aprovar')}<div id="vErr"></div>
      <p class="hint">Sem conferir, o pedido pode duplicar um cliente que já existe no G360. Tente de novo ou confira o ${rotuloDoc} direto no G360 antes de aprovar.</p>
      <div class="act"><button class="btn sec" id="vFechar" type="button">Fechar</button><button class="btn sec" id="vMesmo" type="button">Aprovar sem conferir</button></div>`;
    mostrarMensagemErro($('vErr'), e, { aoTentarDeNovo: () => conferirPedidoNoG360(k, o) });
    ligarFechar();
    $('vMesmo').onclick = async (ev) => {
      const b = ev.currentTarget;
      if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = `Confirmo: conferi o ${rotuloDoc} no G360`; return; }
      b.disabled = true; try { await o.aprovarNovo(); } catch (err) { b.disabled = false; toast(err.message); }
    };
    return;
  }
  if (!existe) { try { await o.aprovarNovo(); } catch (e) { fecharModal('mAdm'); toast(e.message); } return; }
  if (!existe.codigo) {
    box.innerHTML = `${topo(`Este ${rotuloDoc} já é cliente no G360`)}
      <div class="rv-aviso bad">O documento já tem cadastro no G360, mas fora do que o seu usuário enxerga ou em mais de um cadastro. O pedido não foi aprovado: confira os cadastros no G360 antes de seguir.</div>
      <div class="act"><button class="btn sec" id="vFechar" type="button">Fechar</button></div>`;
    ligarFechar(); return;
  }
  abrirComparacao(k, existe.codigo, o);
}

const meDoToken = new Map(); // token → permissões (a sessão do operador não muda de permissão no meio)
async function podeIncluir(token) {
  if (!meDoToken.has(token)) {
    try { meDoToken.set(token, (await consultarOperadorMe(token)).permissoes || {}); }
    catch (e) { if (e.status === 401) throw e; return true; } // sem a rota: tenta a consulta do CNPJ e cai para a consulta se faltar acesso
  }
  return meDoToken.get(token).incluir_clientes !== false;
}

async function procurar(doc, o) {
  if (doc.length !== 14) return null; // CPF: sem consulta prévia na API
  if (await podeIncluir(o.token())) {
    try {
      const r = await preencherNovoClienteCnpj(o.token(), doc);
      return r.ja_existe ? { codigo: r.cliente_id || null } : null;
    } catch (e) { if (!(e.status === 403 && e.codigo === 'OPERADOR_SEM_ACESSO')) throw e; }
  }
  try { const c = await consultarClienteOperador(o.token(), doc); return { codigo: c.codigo }; }
  catch (e) {
    if (e.codigo === 'CLIENTE_NAO_LOCALIZADO') return null;
    if (e.codigo === 'CLIENTE_AMBIGUO') return { codigo: null };
    throw e;
  }
}

function topo(titulo, sub = '') {
  return `<div class="fxh"><div><h3>${esc(titulo)}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}</div><button class="fxx" id="vX" title="Fechar">×</button></div>`;
}
function ligarFechar() {
  $('vX').onclick = () => fecharModal('mAdm');
  if ($('vFechar')) $('vFechar').onclick = () => fecharModal('mAdm');
}

async function abrirComparacao(k, codigo, o, aviso = '') {
  const box = $('admBox');
  box.innerHTML = '<div class="empty2">Abrindo a ficha no G360…</div>';
  let f;
  try { f = await consultarFichaClienteOperador(o.token(), codigo); }
  catch (e) {
    if (e.status === 401) { fecharModal('mAdm'); o.aoSessaoEncerrada?.(e); return; }
    box.innerHTML = `${topo('Este CNPJ já é cliente no G360')}<p class="hint">Cadastro no G360: cód. <b>${esc(codigo)}</b>. Não foi possível abrir a ficha para comparar.</p><div id="vErr"></div>
      <div class="act"><button class="btn sec" id="vFechar" type="button">Fechar</button></div>`;
    mostrarMensagemErro($('vErr'), e, { aoTentarDeNovo: () => abrirComparacao(k, codigo, o) });
    ligarFechar(); return;
  }
  desenhar(k, f, o, aviso);
}

function linhas(k, f) {
  const e = f.endereco || {};
  const endPedido = [k.logradouro, k.numero, k.complemento].filter(Boolean).join(', ') + (k.bairro ? ` · ${k.bairro}` : '') + (k.cidade ? ` · ${k.cidade}${k.uf ? `/${k.uf}` : ''}` : '') + (k.cep ? ` · CEP ${k.cep}` : '');
  const endG360 = [e.logradouro, e.numero, e.complemento].filter(Boolean).join(', ') + (e.bairro?.nome ? ` · ${e.bairro.nome}` : '') + (e.cidade?.nome ? ` · ${e.cidade.nome}${e.uf ? `/${e.uf}` : ''}` : '') + (e.cep ? ` · CEP ${soNum(e.cep)}` : '');
  const L = [
    { id: 'nome', rot: 'Razão social', p: k.razao_social, g: f.nome, igual: (a, b) => txt(a) === txt(b) },
    { id: 'fantasia', rot: 'Nome fantasia', p: k.fantasia, g: f.fantasia, igual: (a, b) => txt(a) === txt(b) },
    { id: 'ie_rg', rot: 'IE ou RG', p: k.inscricao_estadual, g: f.ie_rg, igual: (a, b) => docLimpo(a) === docLimpo(b), travado: f.ie_travada ? 'IE travada no G360 (cliente com nota emitida)' : '' },
    { id: 'email', rot: 'E-mail (recebe o link de acesso)', p: k.email, g: f.email, igual: (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase() },
    { id: 'telefone1', rot: 'WhatsApp / telefone 1', p: k.whats, g: f.telefone1, igual: (a, b) => fone(a) === fone(b) },
    { id: 'telefone2', rot: 'Telefone 2', p: k.telefone, g: f.telefone2, igual: (a, b) => fone(a) === fone(b) },
    { id: 'contato', rot: 'Contato', p: k.responsavel, g: f.contato, igual: (a, b) => txt(a) === txt(b) },
    { id: 'endereco', rot: 'Endereço principal', p: endPedido, g: endG360, igual: () => soNum(k.cep) === soNum(e.cep) && txt(k.logradouro) === txt(e.logradouro) && txt(k.numero) === txt(e.numero) && txt(k.complemento) === txt(e.complemento),
      travado: soNum(k.cep).length === 8 && k.logradouro && k.numero ? '' : 'O endereço do pedido está incompleto' },
  ];
  return L.map((l) => ({ ...l, difere: !l.igual(l.p, l.g), vazio: !String(l.p || '').trim() }));
}

function desenhar(k, f, o, aviso) {
  const box = $('admBox');
  const L = linhas(k, f);
  const pode = f.pode_alterar === true;
  const difs = L.filter((l) => l.difere && !l.vazio);
  box.innerHTML = `${topo('Este CNPJ já é cliente no G360', `Cód. <b>${esc(f.id)}</b> no G360 · o pedido do portal vai ser vinculado a este cadastro, sem criar outro.`)}
    ${aviso ? `<div class="rv-aviso">${esc(aviso)}</div>` : ''}
    <p class="hint" style="margin:8px 0 12px">O G360 é a fonte do cadastro: a ficha do portal fica com os dados do G360. ${difs.length
      ? (pode ? 'Onde o pedido tiver um dado mais novo, marque para gravar <b>no G360</b> antes de vincular.' : 'Seu usuário só pode consultar a ficha no G360 (falta o acesso 00502): os dados diferentes do pedido não serão usados.')
      : 'Os dados do pedido conferem com o G360.'}</p>
    <div class="vcmp" style="display:grid;gap:8px">${L.map((l) => `<div class="ci2" style="display:block;margin:0;padding:10px 12px;${l.difere && !l.vazio ? 'border-left:3px solid #ffd45c' : ''}">
      <small style="display:block;color:var(--tx3);text-transform:uppercase;letter-spacing:.6px;font-size:10.5px">${esc(l.rot)}${l.difere && !l.vazio ? ' · <span style="color:#ffd45c">diferente</span>' : ''}</small>
      <div class="fgrid" style="gap:4px 12px;margin-top:4px"><div><small style="color:var(--tx3)">Pedido do portal</small><div>${esc(l.p || '—')}</div></div>
        <div><small style="color:var(--tx3)">G360</small><div><b>${esc(l.g || '—')}</b></div></div></div>
      ${l.difere && !l.vazio && pode ? (l.travado ? `<small style="display:block;margin-top:6px;color:var(--tx3)">${esc(l.travado)}: corrija direto no G360.</small>`
        : `<label class="isen" style="margin-top:6px!important"><input type="checkbox" data-gravar="${l.id}"> Gravar o dado do pedido no G360</label>`) : ''}</div>`).join('')}</div>
    <div class="rv-aviso" style="margin-top:12px">O link de primeiro acesso vai para o e-mail do G360: <b id="vEmail">${esc(f.email || 'sem e-mail no cadastro')}</b>. Confira antes de gerar o link.</div>
    <div id="vErr" aria-live="polite"></div>
    <div class="act"><button class="btn sec" id="vFechar" type="button">Cancelar</button><button class="btn pri" id="vOk" type="button">Vincular ao cód. ${esc(f.id)}</button></div>`;
  ligarFechar();
  const atualizarBotao = () => {
    const n = box.querySelectorAll('[data-gravar]:checked').length;
    $('vOk').textContent = n ? `Gravar ${n} no G360 e vincular` : `Vincular ao cód. ${f.id}`;
    const em = box.querySelector('[data-gravar="email"]:checked');
    $('vEmail').textContent = em ? String(k.email || '').trim().toLowerCase() : (f.email || 'sem e-mail no cadastro');
  };
  box.querySelectorAll('[data-gravar]').forEach((c) => c.addEventListener('change', atualizarBotao));
  $('vOk').onclick = async (ev) => {
    const b = ev.currentTarget; $('vErr').innerHTML = '';
    const marcados = new Set([...box.querySelectorAll('[data-gravar]:checked')].map((c) => c.dataset.gravar));
    b.disabled = true;
    if (marcados.size) {
      const corpo = { versao: f.versao };
      const valor = { nome: k.razao_social, fantasia: k.fantasia, ie_rg: String(k.inscricao_estadual || '').toUpperCase(), email: String(k.email || '').trim().toLowerCase(), telefone1: fone(k.whats), telefone2: fone(k.telefone), contato: k.responsavel };
      for (const c of marcados) {
        if (c === 'endereco') corpo.endereco = { cep: soNum(k.cep), logradouro: String(k.logradouro || '').trim(), numero: String(k.numero || '').trim(), complemento: String(k.complemento || '').trim() };
        else corpo[c] = String(valor[c] || '').trim();
      }
      b.textContent = 'Gravando no G360…';
      try { await alterarFichaClienteOperador(o.token(), f.id, corpo); }
      catch (e) {
        b.disabled = false; atualizarBotao();
        if (e.status === 401) { fecharModal('mAdm'); o.aoSessaoEncerrada?.(e); return; }
        if (e.codigo === 'CADASTRO_ALTERADO') { abrirComparacao(k, f.id, o, e.message); return; }
        mostrarMensagemErro($('vErr'), e); return;
      }
    }
    b.textContent = 'Vinculando…';
    try { await o.vincular(f.id); }
    catch (e) { b.disabled = false; atualizarBotao(); $('vErr').innerHTML = `<div class="rv-aviso bad">${esc(e.message)}</div>`; return; }
    toast(marcados.size ? 'Gravado no G360 e vinculado ✓' : 'Vinculado ao cadastro do G360 ✓');
    o.abrirFicha(f.id);
  };
}
