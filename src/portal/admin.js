/* =====================================================================
   Painel do administrador no layout original (parte 1 da volta do portal antigo).
   Duas sessões, separadas das do comprador:
   - API do G360: POST operadores/sessoes; token só em memória; 401 encerra só o painel.
   - Cadastros e Ocorrências (Supabase) pela função painel-g360, com o mesmo
     token do G360: não existe conta separada do painel.
   Preço, custo e margem vêm da API; nada é calculado aqui.
   ===================================================================== */
import { sempreBloqueada } from '../estado/condicoes.js';
import {
  entrarOperador, sairOperador, consultarClienteOperador, buscarProdutosOperador, consultarPrecosOperador,
  listarPrecosCongelados, incluirPrecoCongelado, alterarPrecoCongelado, encerrarPrecoCongelado,
  consultarFichaClienteOperador, consultarCepOperador, listarFotosOperador, obterFotoOperador, incluirFotoOperador, definirCapaOperador, ordenarFotosOperador, removerFotoOperador,
} from '../api/g360.js';
import { chamarPainel } from '../api/painel.js';
import { pedirLink } from '../api/ponte.js';
import { consultarCnpj } from './cadastro.js';
import { abrirFichaG360 } from './fichag360.js';
import { paraJpeg } from './jpeg.js';
import { abrirImportacaoFotos } from './importarfotos.js';
import { abrirExportacaoFotos } from './exportarfotos.js';
import { abrirNovoClienteG360 } from './novocliente.js';
import { abrirLotesFotos, comEspera } from './lotesfotos.js';
import { abrirCacaCapa } from './cacacapa.js';
import { abrirImportarVendas } from './importarvendas.js';
import { definirEncerramentoOperador, definirAtividadeOperador } from '../estado/sessao.js';
import { mostrarMensagemErro } from '../ui/mensagem.js';
import { dinheiro, numeroPainel, dataBr } from '../ui/formato.js';
import { $, esc, toast, abrirModal, fecharModal, adiar } from './comum.js';
import { carregarExibicao, codigosAtivosPublicos, esquecerAtivosPublicos, codigosOcultos, sinonimos as sinonimosPortal, categorias, registro, nomeExibicao, categoriaExibicao, codigosDaCategoria, aplicarLocal, definirCategoriasLocal } from '../catalogo/exibicao.js';
import { nomeEcommerce, categoriaPeloNome } from '../catalogo/nomes.js';
import { buscarLocal } from '../catalogo/busca.js';
import { fichaDoProduto, descricaoBasica } from '../catalogo/descricoes.js';
import { supabaseComprador, LOJA } from '../api/supabase.js';

const op = { token: null, expira: 0, ultima: 0, minutos: 8, aviso: null };
let ctx = null;            // { loja, ir }
let relogio = null;
let aba = 'cli';
let ligado = false;
let urls = [];             // object URLs das fotos da tela (liberadas ao sair)
const capas = new Map();   // id → url da capa | null (sem foto) — cache da sessão do painel

function liberarFotos() { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; capas.clear(); }

/* Token do operador no sessionStorage da aba (chave própria, separada do comprador): o F5 não derruba o painel
   nem ocupa outra vaga de licença. No primeiro 401 ele é apagado e o painel pede login. */
const CHAVE_OP = `sr-g360-operador-${LOJA}`;
function guardarOp() { try { if (op.token) sessionStorage.setItem(CHAVE_OP, JSON.stringify({ token: op.token, expira: op.expira })); else sessionStorage.removeItem(CHAVE_OP); } catch { /* só memória */ } }
function restaurarOp() {
  if (op.token) return;
  try {
    const g = JSON.parse(sessionStorage.getItem(CHAVE_OP) || 'null');
    if (g?.token && (!g.expira || Date.now() < g.expira)) { op.token = g.token; op.expira = g.expira || 0; op.ultima = Date.now(); vigiar(); }
    else sessionStorage.removeItem(CHAVE_OP);
  } catch { /* nada guardado */ }
}

function encerrarOperador(mensagem) {
  op.token = null; op.expira = 0; op.aviso = mensagem || null;
  guardarOp();
  document.body.classList.remove('g360-op');
  liberarFotos();
  fecharModal('mod');
  if (relogio) { clearInterval(relogio); relogio = null; }
  if (document.body.classList.contains('g360-painel')) desenhar();
}
definirEncerramentoOperador((erro) => encerrarOperador(erro.message));
definirAtividadeOperador(() => { op.ultima = Date.now(); });

function vigiar() {
  if (relogio) clearInterval(relogio);
  relogio = setInterval(() => {
    if (!op.token) return;
    if (Date.now() - op.ultima > op.minutos * 60000) encerrarOperador('A sessão do painel terminou por inatividade. Entre novamente.');
    else if (op.expira && Date.now() >= op.expira) encerrarOperador('A sessão do painel terminou. Entre novamente.');
  }, 5000);
}

/** Valor digitado (vírgula ou ponto) → texto do contrato com ponto, ou null. */
function valorPreco(digitado) {
  let s = String(digitado || '').trim();
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return /^(?:0|[1-9][0-9]{0,10})(?:\.[0-9]{1,7})?$/.test(s) && !/^0(?:\.0+)?$/.test(s) ? s : null;
}
const valorTela = (v) => String(v ?? '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').replace('.', ',');
const margemHtml = (p) => (p.custo_visivel
  ? (p.margem_percentual === null ? '<span class="mg">sem custo</span>' : `<span class="mg ${p.margem_percentual < limiteMargem() ? 'bad' : 'ok'}">margem ${esc(numeroPainel(p.margem_percentual, 1))}%</span>`)
  : '<span class="mg">custo sem acesso</span>');
const vazio = (t) => `<div class="empty2">${t}</div>`;
const carregandoHtml = (t) => `<div class="empty2">${esc(t)}</div>`;
function erroEm(alvo, e, tentar) { alvo.innerHTML = '<div class="g360-erro"></div>'; mostrarMensagemErro(alvo.firstElementChild, e, { aoTentarDeNovo: tentar }); }

/* ---------------- entrada ---------------- */

export function mostrarAdmin(contexto) {
  ctx = contexto;
  op.minutos = Number(ctx.loja.sessao_minutos) || 8;
  restaurarOp();
  document.body.classList.add('g360-painel');
  document.querySelectorAll('.view').forEach((el) => { el.hidden = el.id !== 'vAdm'; });
  window.scrollTo(0, 0);
  ligar();
  desenhar();
}

/** Ao sair do /painel: volta o topo ao modo do comprador (a sessão do painel continua em memória). */
export function sairDaTelaAdmin() {
  document.body.classList.remove('g360-painel');
  fecharModal('mod');
}

function ligar() {
  if (ligado) return;
  ligado = true;
  const v = $('vAdm');
  // Cabeçalho: o que o painel do G360 não faz (exportar/importar arquivo) fica fora.
  v.querySelector('.ph').innerHTML = `<div><h2>Painel do <em>administrador</em></h2><p>Clientes, preços, margens e fotos direto do G360. As fotos aparecem no catálogo dos clientes.</p></div>
    <div class="row"><span class="hint" id="aQuem" style="margin:0"></span><button class="tool" id="aSair">Sair do admin</button></div>`;
  // Abas do portal antigo + Ocorrências.
  const abas = v.querySelector('.atabs');
  if (!abas.querySelector('[data-at="ocor"]')) abas.insertAdjacentHTML('beforeend', '<button data-at="ocor">Ocorrências</button>');
  if (!$('atOcor')) v.insertAdjacentHTML('beforeend', '<div id="atOcor" hidden><div class="panel" id="ocPanel"></div></div>');
  if (!$('aLogin')) v.querySelector('.ph').insertAdjacentHTML('afterend', '<div id="aLogin" hidden></div>');
  abas.querySelectorAll('[data-at]').forEach((b) => b.addEventListener('click', () => { aba = b.dataset.at; desenharAba(); }));
  $('aSair').addEventListener('click', async () => {
    const t = op.token;
    try { await sairOperador(t); } catch { /* sai localmente de qualquer jeito */ }
    encerrarOperador('Você saiu do painel.');
  });

  // Produtos
  $('aSt').innerHTML = '<option value="">Todos os produtos</option><option value="auto">Nome automático (revisar)</option><option value="semcat">Sem categoria definida</option><option value="baixa">Margem abaixo do mínimo</option><option value="semcusto">Sem custo cadastrado</option><option value="visivel">✅ Aparecendo no portal</option><option value="fora">🚫 Fora do portal (todos os motivos)</option><option value="oculto">🙈 Tirados pela equipe</option><option value="semdesc">Sem descrição da equipe</option>';
  $('aCat').innerHTML = '<option value="">Todas as categorias</option>';
  $('aPanel').insertAdjacentHTML('beforebegin', `<div class="afil" style="align-items:center;margin-top:-4px"><button class="btn sec" id="aGerar" style="height:36px">✨ Gerar nomes e categorias</button>
    <span class="hint" id="aGerarInfo" style="margin:0">Passa por todos os produtos do G360 e cria o nome no padrão de e-commerce e a categoria. Não mexe no que a equipe já ajustou nem nos nomes do portal antigo.</span></div>`);
  $('aGerar').addEventListener('click', gerarTudo);
  $('aGerar').insertAdjacentHTML('afterend', '<button class="btn pri" id="aImpFotos" style="height:36px">📦 Importar imagens</button>');
  $('aImpFotos').insertAdjacentHTML('beforebegin', '<button class="btn pri" id="aCaca" style="height:36px">🎯 Caça-capa</button>');
  $('aCaca').addEventListener('click', () => abrirCacaCapa({
    token: () => op.token, painel, aoSessaoEncerrada: (e) => encerrarOperador(e.message),
    aoFoto: (id) => capas.delete(id),
    aoConcluir: () => { if (aba === 'prod') carregarMiniaturas($('aPanel')); },
  }));
  $('aImpFotos').insertAdjacentHTML('afterend', '<button class="btn sec" id="aLotes" style="height:36px">📄 Planilha para fotos</button>');
  $('aLotes').insertAdjacentHTML('afterend', '<button class="btn sec" id="aVis" style="height:36px">🔄 Atualizar produtos do portal</button><span class="hint" id="aVisM" style="margin:0" aria-live="polite"></span>');
  $('aVis').addEventListener('click', atualizarProdutosDoPortal);
  $('aLotes').insertAdjacentHTML('beforebegin', '<button class="btn sec" id="aExpFotos" style="height:36px">⬇ Exportar fotos</button>');
  $('aExpFotos').addEventListener('click', () => abrirExportacaoFotos({ token: () => op.token, painel, aoSessaoEncerrada: (e) => encerrarOperador(e.message) }));
  $('aExpFotos').insertAdjacentHTML('afterend', '<button class="btn sec" id="aOtimClips" style="height:36px" title="Põe o índice dos vídeos já enviados no começo do arquivo, para começarem a tocar mais rápido">⚡ Otimizar clips</button>');
  $('aOtimClips').addEventListener('click', otimizarClipsEnviados);
  $('aLotes').addEventListener('click', () => abrirLotesFotos({ token: () => op.token, painel, aoSessaoEncerrada: (e) => encerrarOperador(e.message) }));
  $('aImpFotos').addEventListener('click', () => abrirImportacaoFotos({
    token: () => op.token,
    aoSessaoEncerrada: (e) => encerrarOperador(e.message),
    aoConcluir: (ids) => { ids.forEach((id) => capas.delete(id)); if (aba === 'prod') carregarMiniaturas($('aPanel')); },
  }));
  $('aPanel').addEventListener('change', salvarLinhaProduto);
  const buscarProd = adiar(() => { if ($('aQ').value.trim() === prod.qFeita) return; prod.pagina = 1; desenharProdutos(); }, 450);
  $('aQ').addEventListener('input', buscarProd);
  $('aQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); prod.pagina = 1; desenharProdutos(); } });
  $('aCat').addEventListener('change', () => { prod.pagina = 1; desenharProdutos(); });
  let stAntes = '';
  const PELA_LISTA = ['oculto', 'visivel', 'fora'];
  $('aSt').addEventListener('change', () => { const st = $('aSt').value; const busca = PELA_LISTA.includes(st) || PELA_LISTA.includes(stAntes); stAntes = st; if (busca) { prod.pagina = 1; visAdm = null; } desenharProdutos(busca); });
  $('aPanel').addEventListener('click', (e) => {
    const r = e.target.closest('.arow[data-id]'); if (!r) return;
    if (e.target.closest('[data-ed]') || e.target.closest('.amini')) abrirFotos(Number(r.dataset.id), r.dataset.nome);
    if (e.target.closest('[data-mais]')) { abrirEditorProduto(r); return; }
    const boc = e.target.closest('[data-oc]'); if (boc) { tirarOuVoltar(r, boc); return; }
    if (e.target.closest('[data-cg]')) { aba = 'cong'; cong.produto = { id: Number(r.dataset.id), rotulo: `${r.dataset.cod} · ${r.dataset.nome}` }; desenharAba(); }
  });

  // Clientes (fichas do portal, como no painel antigo)
  $('clQ').placeholder = 'Buscar por nome, CNPJ, código ou cidade…';
  $('clSt').innerHTML = '<option value="">Todos</option><option value="pendente">Aguardando aprovação</option><option value="aprovado">Aprovados</option><option value="recusado">Reprovados</option>';
  $('clNovo').textContent = '+ Novo cliente';
  $('clNovo').addEventListener('click', () => abrirFicha(null));
  // Roteiro da Movimento: CNPJ → ficha do G360 (alterar cadastro, liberar acesso, link), direto, sem ficha do portal.
  $('clNovo').insertAdjacentHTML('beforebegin', '<button class="btn sec" id="clG360" type="button" style="height:36px">📋 Ficha no G360 pelo CNPJ</button>');
  $('clG360').addEventListener('click', fichaPeloCnpj);
  $('clQ').addEventListener('keydown', (e) => { if (e.key === 'Enter' && docLimpo($('clQ').value).length >= 11) { e.preventDefault(); fichaPeloCnpj(); } });
  $('clQ').addEventListener('input', adiar(() => { $('clG360Err')?.remove(); desenharCadastros(false); }, 200));
  $('clSt').addEventListener('change', () => desenharCadastros(false));

  // Preços congelados: o cliente é escolhido pelo CNPJ (a API não lista clientes).
  const cgFil = $('cgCli').parentElement;
  cgFil.innerHTML = `<div class="search" style="max-width:420px"><svg class="ic" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="cgCnpj" type="search" placeholder="CNPJ do cliente" maxlength="32" autocapitalize="characters" spellcheck="false"></div>
    <button class="btn pri" id="cgCons" style="height:36px">Consultar cliente</button><span id="cgQuem" class="hint" style="margin:0;align-self:center"></span>`;
  $('cgCons').addEventListener('click', () => escolherClienteCong($('cgCnpj').value.trim()));
  $('cgCnpj').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); escolherClienteCong($('cgCnpj').value.trim()); } });
  $('cgQ').parentElement.insertAdjacentHTML('afterend', `<div class="cgadd" id="cgDatas" style="padding-top:0">
    <label class="hint" style="margin:0">Início <input id="cgIni" type="date"></label><label class="hint" style="margin:0">Fim <input id="cgFim" type="date"></label>
    <span class="hint" style="margin:0">Vale para a unidade base. A API recusa períodos que se sobrepõem.</span></div><div id="cgRes" aria-live="polite" style="padding:0 18px"></div>`);
  $('cgP').type = 'text'; $('cgP').inputMode = 'decimal';
  $('cgQ').addEventListener('input', adiar(sugerirProdutosCong, 350));
  $('cgQ').addEventListener('change', () => { const o = cong.sugestoes.get($('cgQ').value); if (o) cong.produto = o; });
  $('cgAdd').addEventListener('click', congelar);
  $('cgPanel').addEventListener('click', cliqueCongelado);
  $('cgPanel').addEventListener('change', mudancaCongelado);

  // Margens
  $('mgTipo').innerHTML = '<option value="">Preço de tabela</option>';
  $('mgLim').addEventListener('input', () => { guardarLimite($('mgLim').value); desenharMargens(false); });

  // Fotos (modal do portal antigo)
  ligarModalFotos();
}

function desenhar() {
  const logado = !!op.token;
  document.body.classList.toggle('g360-op', logado);
  $('vAdm').querySelectorAll(':scope > .atabs, :scope > [id^="at"]').forEach((el) => { el.style.display = logado ? '' : 'none'; });
  $('aSair').hidden = !logado;
  $('aLogin').hidden = logado;
  $('aQuem').textContent = logado ? 'Conectado ao G360' : '';
  if (!logado) { telaLogin(); return; }
  desenharAba();
  carregarConfigLoja().then(() => { if ($('mgLim')) $('mgLim').value = limiteMargem(); });
  contarNegociacoes();
}

/* ---------------- login do operador (usuário do G360) ---------------- */

function telaLogin() {
  const alvo = $('aLogin');
  alvo.innerHTML = `<div class="panel" style="max-width:440px;margin:10px auto 40px;padding:22px 22px 18px">
    <h3 style="margin:0 0 4px">Acesso do administrador</h3>
    <p class="hint" style="margin:0 0 14px">Entre com o seu usuário e a sua senha do G360.</p>
    <div id="aAviso"></div>
    <form id="aForm" novalidate>
      <label for="aUsu">Usuário do G360</label><input class="inp" id="aUsu" maxlength="20" autocomplete="username" spellcheck="false" autocapitalize="off">
      <label for="aSen">Senha</label><input class="inp" id="aSen" type="password" maxlength="8" autocomplete="current-password">
      <div class="err" id="aErr"></div><div id="aRes" aria-live="polite"></div>
      <div class="act"><button type="button" class="btn sec" id="aVoltar">Voltar ao portal</button><button type="submit" class="btn pri" id="aOk">Entrar</button></div>
    </form></div>`;
  if (op.aviso) $('aAviso').innerHTML = `<div class="rv-aviso">${esc(op.aviso)}</div>`;
  $('aVoltar').onclick = () => ctx.ir('/');
  $('aForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const u = $('aUsu').value.trim(); const s = $('aSen');
    $('aErr').textContent = ''; $('aRes').innerHTML = '';
    if (!u || !s.value) { $('aErr').textContent = 'Digite o usuário e a senha.'; return; }
    $('aOk').disabled = true; $('aOk').textContent = 'Entrando…';
    try {
      const d = await entrarOperador(u, s.value);
      s.value = '';
      op.token = d.token; op.expira = Date.parse(d.expira_em) || 0; op.ultima = Date.now(); op.aviso = null;
      guardarOp();
      vigiar();
      toast('Bem-vindo ao painel!');
      desenhar();
    } catch (e) {
      s.value = '';
      $('aOk').disabled = false; $('aOk').textContent = 'Entrar';
      mostrarMensagemErro($('aRes'), e);
    }
  };
  setTimeout(() => { if (!alvo.contains(document.activeElement)) $('aUsu')?.focus(); }, 50);
}

/* ---------------- abas ---------------- */

function desenharAba() {
  document.querySelectorAll('#vAdm [data-at]').forEach((b) => b.classList.toggle('on', b.dataset.at === aba));
  const ids = { cli: 'atCli', prod: 'atProd', cong: 'atCong', mrg: 'atMrg', intel: 'atIntel', neg: 'atNeg', souzinha: 'atSouzinha', cfg: 'atCfg', ocor: 'atOcor' };
  Object.entries(ids).forEach(([k, id]) => { $(id).hidden = k !== aba; });
  if (aba === 'cli') desenharClientes();
  else if (aba === 'prod') desenharProdutos(!prod.lista);
  else if (aba === 'cong') desenharCong();
  else if (aba === 'mrg') desenharMargens(!mrg.carregado);
  else if (aba === 'ocor') desenharOcorrencias();
  else if (aba === 'cfg') desenharConfig();
  else if (aba === 'intel') desenharInteligencia();
  else if (aba === 'souzinha') desenharEscola();
  else if (aba === 'neg') desenharNegociacoes();
}

/* ---------------- Negociações ---------------- */

const SITN = { aberta: 'Aguardando', aprovada: 'Aprovada', recusada: 'Recusada', cancelada: 'Cancelada pelo cliente' };
let negs = null;

async function contarNegociacoes() {
  try { negs = (await painel('negociacoes_listar')).dados || []; $('negN').textContent = negs.filter((n) => n.status === 'aberta').length || ''; } catch { /* badge fica vazio */ }
}

const valorPainel = (t) => { const s = String(t || '').trim().replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); return /^\d{1,11}(\.\d{1,4})?$/.test(s) && Number(s) > 0 ? s : null; };

/** Pedidos de preço dos clientes. Aprovar = grava preço congelado no G360 (API) e responde ao cliente. */
async function desenharNegociacoes() {
  const alvo = $('negAdminView');
  if (!$('ngSt')) {
    alvo.innerHTML = `<div class="afil" style="align-items:center"><select id="ngSt" class="inp" style="max-width:240px"><option value="aberta">Aguardando resposta</option><option value="">Todas</option><option value="aprovada">Aprovadas</option><option value="recusada">Recusadas</option><option value="cancelada">Canceladas pelo cliente</option></select>
      <button class="tool" id="ngRec">↻ Atualizar</button><span class="hint" style="margin:0">Aprovar grava o preço congelado do cliente no G360. Ele passa a ver o valor como "Seu preço".</span></div><div class="panel" id="ngPanel"></div>`;
    $('ngSt').onchange = () => pintarNegociacoes();
    $('ngRec').onclick = () => desenharNegociacoes();
  }
  $('ngPanel').innerHTML = carregandoHtml('Carregando negociações…');
  try { negs = (await painel('negociacoes_listar')).dados || []; } catch (e) { $('ngPanel').innerHTML = vazio(esc(e.message)); return; }
  $('negN').textContent = negs.filter((n) => n.status === 'aberta').length || '';
  pintarNegociacoes();
}

function pintarNegociacoes() {
  const alvo = $('ngPanel'); const st = $('ngSt').value;
  const L = negs.filter((n) => !st || n.status === st);
  const hoje = new Date(); const fim = new Date(hoje.getTime() + 90 * 864e5);
  const iso = (d) => d.toISOString().slice(0, 10);
  alvo.innerHTML = L.length ? L.map((n) => `<div class="negadm" data-id="${esc(n.id)}">
    <div class="nm"><b>${esc(n.produto_nome)}</b><small>Cód. ${esc(n.codigo)}${n.unidade ? ` · ${esc(n.unidade)}` : ''} · cliente <b>${esc(n.comprador_nome || '')}</b> (cód. ${esc(n.comprador_codigo)}) · ${esc(new Date(n.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}</small>
      <small>Preço de hoje: <b>${n.preco_atual ? esc(dinheiro(n.preco_atual)) : '—'}</b> · cliente pede <b style="color:var(--lima)">${esc(dinheiro(n.preco_desejado))}</b>${n.quantidade ? ` · quantidade ${esc(n.quantidade.replace('.', ','))}` : ''}</small>
      ${n.mensagem ? `<small>“${esc(n.mensagem)}”</small>` : ''}
      ${n.status !== 'aberta' ? `<small><span class="stt ${n.status === 'aprovada' ? 'aprovado' : 'reprovado'}">${SITN[n.status]}</span>${n.preco_aprovado ? ` ${esc(dinheiro(n.preco_aprovado))} até ${esc(dataBr(n.valido_ate))}` : ''}${n.resposta ? ` · ${esc(n.resposta)}` : ''}</small>` : ''}
      <div class="ngcusto hint" style="margin:4px 0 0"></div></div>
    ${n.status === 'aberta' ? `<div class="ngform">
      <div class="pin"><span>R$</span><input data-v value="${esc(String(n.preco_desejado).replace('.', ','))}" inputmode="decimal" aria-label="Preço aprovado"></div>
      <label class="hint" style="margin:0">Até <input type="date" data-ate value="${iso(fim)}" min="${iso(hoje)}"></label>
      <input class="inp" data-resp maxlength="400" placeholder="Resposta ao cliente (opcional)" aria-label="Resposta ao cliente">
      <div class="row"><button class="btn pri" data-ok type="button">Aprovar e congelar</button><button class="btn sec" data-no type="button">Recusar</button></div></div>` : ''}
  </div>`).join('') : vazio(st === 'aberta' ? 'Nenhum pedido de negociação aguardando resposta.' : 'Nenhuma negociação nesta situação.');
  // Custo e margem do produto para este cliente (quando o operador tem acesso).
  alvo.querySelectorAll('.negadm').forEach(async (el) => {
    const n = negs.find((x) => x.id === el.dataset.id); const box = el.querySelector('.ngcusto');
    if (n.status !== 'aberta') return;
    try {
      const [p] = await consultarPrecosOperador(op.token, n.comprador_codigo, [Number(n.produto_id)]);
      if (!p) { box.textContent = 'Produto fora do catálogo deste cliente.'; return; }
      const custo = p.custo_visivel && p.custo !== null ? Number(p.custo) : null;
      const mostrar = () => {
        const v = Number(valorPainel(el.querySelector('[data-v]')?.value) || 0);
        const mg = custo !== null && v > 0 ? ((v - custo) / v) * 100 : null;
        box.innerHTML = `Tabela para o cliente: <b>${esc(dinheiro(p.preco))}</b>${p.preco_congelado ? ` · já congelado: ${esc(dinheiro(p.preco_congelado))}` : ''}${custo !== null ? ` · custo R$ ${esc(numeroPainel(custo, 2))}` : ' · custo sem acesso'}${mg !== null ? ` · margem no preço digitado: <b class="mg ${mg < limiteMargem() ? 'bad' : 'ok'}">${esc(numeroPainel(mg, 1))}%</b>${mg < limiteMargem() ? ' (abaixo do mínimo)' : ''}` : ''}${dispPainel(p)}`;
      };
      mostrar(); el.querySelector('[data-v]')?.addEventListener('input', mostrar);
    } catch (e) { box.textContent = e.message; }
  });
  alvo.querySelectorAll('.negadm [data-ok], .negadm [data-no]').forEach((b) => b.addEventListener('click', async () => {
    const el = b.closest('.negadm'); const n = negs.find((x) => x.id === el.dataset.id);
    const resposta = el.querySelector('[data-resp]').value.trim();
    if (b.hasAttribute('data-no')) {
      b.disabled = true;
      try { await painel('negociacao_decidir', { id: n.id, status: 'recusada', resposta }); toast('Negociação recusada — o cliente vê a resposta em Meus Pedidos'); desenharNegociacoes(); }
      catch (e) { b.disabled = false; toast(e.message); }
      return;
    }
    const valor = valorPainel(el.querySelector('[data-v]').value); const ate = el.querySelector('[data-ate]').value;
    const inicio = new Date().toISOString().slice(0, 10);
    if (!valor) { toast('Digite o preço aprovado, por exemplo 12,50.'); return; }
    if (!ate || ate < inicio) { toast('A data final precisa ser hoje ou depois.'); return; }
    b.disabled = true; b.textContent = 'Gravando no G360…';
    try {
      await incluirPrecoCongelado(op.token, n.comprador_codigo, { produto: Number(n.produto_id), unidade_id: n.unidade_id || null, valor, inicio, fim: ate });
    } catch (e) { b.disabled = false; b.textContent = 'Aprovar e congelar'; mostrarMensagemErro(el.querySelector('.ngcusto'), e); return; }
    try { await painel('negociacao_decidir', { id: n.id, status: 'aprovada', preco_aprovado: valor, valido_ate: ate, resposta }); }
    catch (e) { toast(`Preço congelado no G360, mas a resposta ao cliente não foi gravada: ${e.message}`); }
    toast('Aprovada ✓ — preço congelado no G360'); desenharNegociacoes();
  }));
}

/* ---------------- Produtos ---------------- */

const prod = { pagina: 1, lista: null, total: 0, grupos: new Map() };

async function desenharProdutos(buscar = true) {
  const alvo = $('aPanel');
  if (buscar) {
    alvo.innerHTML = carregandoHtml('Buscando produtos no G360…');
    const q = $('aQ').value.trim();
    prod.qFeita = q;
    try {
      await carregarExibicao();
      if (!clipsAdm) { try { clipsAdm = (await painel('clips_listar')).dados || []; } catch { clipsAdm = []; } }
      preencherGrupos();
      const cat = $('aCat').value;
      let codigos = cat ? codigosDaCategoria(cat) : null;
      const st0 = $('aSt').value;
      if (st0 === 'visivel' || st0 === 'fora') { if (!visAdm) visAdm = await lerVisiveis(); }
      let porLista = null; // filtros "aparecendo" e "fora": a lista vem do portal e pagina aqui
      if (st0 === 'oculto') {
        // Os ocultos não entram em codigosDaCategoria: filtra pela categoria do registro.
        const oc = codigosOcultos();
        codigos = cat ? oc.filter((c) => registro({ codigo: c })?.categoria === cat) : oc;
      } else if ((st0 === 'visivel' || st0 === 'fora') && visAdm?.ok && !q) {
        const ocs = new Set(codigosOcultos(100000));
        porLista = st0 === 'visivel' ? visAdm.lista.visiveis.filter((c) => !ocs.has(c))
          : [...new Set([...ocs, ...visAdm.lista.baixo, ...visAdm.lista.sem])];
        if (cat) { const daCat = new Set(codigosDaCategoria(cat, 100000)); porLista = porLista.filter((c) => daCat.has(c) || registro({ codigo: c })?.categoria === cat); }
      }
      if (porLista) {
        const fatia = porLista.slice((prod.pagina - 1) * 20, prod.pagina * 20);
        prod.lista = fatia.length ? (await buscarProdutosOperador(op.token, { codigos: fatia, limite: 20 })).dados : [];
        prod.total = porLista.length;
      } else if (codigos && !codigos.length) { prod.lista = []; prod.total = 0; }
      else {
        const { dados, paginacao } = await buscarProdutosOperador(op.token, { q: q || undefined, codigos: codigos || undefined, pagina: prod.pagina, limite: 20 });
        prod.lista = dados; prod.total = paginacao?.total || 0;
      }
    } catch (e) { erroEm(alvo, e, () => desenharProdutos()); return; }
  }
  const st = $('aSt').value;
  const L = (prod.lista || []).filter((p) => !st
    || (st === 'auto' && (!registro(p) || registro(p).origem === 'automatico'))
    || (st === 'semcat' && !registro(p)?.categoria)
    || (st === 'baixa' && p.custo_visivel && p.margem_percentual !== null && p.margem_percentual < limiteMargem())
    || (st === 'semcusto' && p.custo_visivel && p.custo === null)
    || (st === 'oculto' && registro(p)?.oculto)
    || (st === 'visivel' && motivoFora(p) === null)
    || (st === 'fora' && motivoFora(p) !== null)
    || (st === 'semdesc' && !registro(p)?.descricao));
  const avisoEstoque = st === 'visivel' || st === 'fora' ? (visAdm?.ok
    ? `<div class="hint" style="margin:10px 18px">Lista de estoque do portal atualizada em ${esc(new Date(visAdm.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}. Para atualizar, clique em 🔄 Atualizar produtos do portal.</div>`
    : '<div class="rv-aviso" style="margin:10px 18px">Ainda não temos a lista de estoque do portal. Clique em 🔄 Atualizar produtos do portal (leva cerca de 1 minuto).</div>') : '';
  const paginas = Math.max(1, Math.ceil(prod.total / 20));
  const cats = categorias();
  alvo.innerHTML = avisoEstoque + `<div class="arow h"><div></div><div>Nome no portal (${prod.total})</div><div>Preço de tabela</div><div>Categoria</div><div>Custo</div><div></div></div>`
    + (L.length ? L.map((p) => { const r = registro(p); const cat = categoriaExibicao(p); return `<div class="arow" data-id="${Number(p.id)}" data-nome="${esc(nomeExibicao(p))}" data-cod="${esc(p.codigo)}" data-g360="${esc(p.nome)}">
      <div class="amini g360-mini" data-foto="${Number(p.id)}" title="Fotos"><span>…</span></div>
      <div class="nm"><input class="inp pnome" value="${esc(nomeExibicao(p))}" maxlength="160" aria-label="Nome no portal" style="width:100%;font-weight:600">
        <small>G360: ${esc(p.nome)} · Cód. ${esc(p.codigo)} · ${esc(p.unidade || '—')}${dispPainel(p)}${r?.curva ? ` · <b style="color:var(--lima)">Curva ${esc(r.curva)}</b>` : ''} · ${margemHtml(p)} · ${(() => { const m = motivoFora(p); return m ? `<b style="color:#ff8a8a">${m}</b> · ` : (visAdm?.ok ? '<b style="color:var(--lima)">✅ no portal</b> · ' : ''); })()}${clipsAdm?.some((c) => Number(c.produto_id) === Number(p.id)) ? '▶ clip · ' : ''}<span class="org">${!r ? 'nome automático (não salvo)' : r.origem === 'automatico' ? 'nome automático' : r.origem === 'legado' ? 'portal antigo' : 'ajustado pela equipe'}</span></small></div>
      <div class="num"><b>${esc(dinheiro(p.preco))}</b>${p.origem_preco ? `<small style="display:block;color:var(--tx3);font-size:11px">${esc(p.origem_preco)}</small>` : ''}</div>
      <div><select class="inp pcat" aria-label="Categoria">${cats.map((c) => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>${r?.categoria ? '' : '<small style="display:block;color:var(--tx3);font-size:11px">sugerida pelo nome</small>'}</div>
      <div class="uns">${p.custo_visivel ? (p.custo === null ? '—' : `R$ ${esc(numeroPainel(p.custo, 2))}`) : 'sem acesso'}</div>
      <div class="ab2"><button class="tool ab" data-ed>🖼 Fotos</button><button class="tool ab" data-mais aria-expanded="false">📝 Descrição e clips</button><button class="tool ab" data-cg>❄ Congelar</button>${r?.oculto ? '<button class="tool ab" data-oc="0" style="color:var(--lima)">↩ Voltar ao portal</button>' : '<button class="tool ab" data-oc="1" style="color:#ff8a8a">🚫 Tirar do portal</button>'}</div></div>`; }).join('')
      : vazio('Nenhum produto encontrado. Tente outro nome ou código.'))
    + (paginas > 1 ? `<nav class="g360-pag" style="margin:14px auto"><button class="tool" id="apA" ${prod.pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button><span>Página ${prod.pagina} de ${paginas}</span><button class="tool" id="apP" ${prod.pagina >= paginas ? 'disabled' : ''}>Próxima ›</button></nav>` : '');
  $('apA')?.addEventListener('click', () => { prod.pagina -= 1; desenharProdutos(); });
  $('apP')?.addEventListener('click', () => { prod.pagina += 1; desenharProdutos(); });
  carregarMiniaturas(alvo);
}

let clipsAdm = null;

/** Abaixo da linha do produto: descrição do portal, ocultar do catálogo e clips (vídeos). */
/** "Disponível: N" do G360 (unidade base), como veio da API, só trocando o ponto por vírgula. */
function dispPainel(p) {
  const q = p?.quantidade_disponivel;
  if (q === undefined || q === null || q === '') return '';
  return ` · <b style="color:${Number(q) > 0 ? 'var(--lima)' : '#ff8a8a'}">Disponível: ${esc(String(q).replace('.', ','))}</b>`;
}

/** "Atualizar produtos do portal": lê o catálogo do G360 com o login do operador, devagar
 *  (1 página de 50 a cada 0,7 s, cerca de 85 chamadas por minuto, bem abaixo do limite de 240),
 *  e grava a lista que o visitante e os filtros do painel usam. Só roda quando a equipe clica. */
let atualizandoVis = false;
async function atualizarProdutosDoPortal() {
  if (atualizandoVis) return;
  const b = $('aVis'); const m = $('aVisM');
  atualizandoVis = true; b.disabled = true;
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await carregarConfigLoja(true);
    const min = Number(cfgLoja?.estoque_minimo) || 0;
    const lista = { visiveis: [], baixo: [], sem: [] };
    let pagina = 1; let paginas = 1;
    do {
      m.textContent = `Lendo o catálogo do G360… página ${pagina} de ${paginas}`;
      const { dados, paginacao } = await comEspera(() => buscarProdutosOperador(op.token, { pagina, limite: 50 }));
      paginas = Math.max(1, Math.ceil((paginacao?.total || 0) / 50));
      for (const p of dados) {
        const n = Number(p.quantidade_disponivel);
        const tem = p.preco !== null && p.preco !== undefined && n > 0;
        (!tem ? lista.sem : min > 0 && n <= min ? lista.baixo : lista.visiveis).push(String(p.codigo));
      }
      pagina += 1;
      if (pagina <= paginas) await espera(700);
    } while (pagina <= paginas);
    m.textContent = 'Gravando a lista…';
    await painel('visiveis_gravar', { visiveis: lista.visiveis, estoque_baixo: lista.baixo, sem_estoque: lista.sem, estoque_minimo: min });
    visAdm = null;
    m.textContent = `✓ Lista atualizada: ${lista.visiveis.length.toLocaleString('pt-BR')} produtos aparecendo no portal (${(lista.baixo.length + lista.sem.length).toLocaleString('pt-BR')} fora por estoque).`;
    if (aba === 'prod') desenharProdutos(true);
  } catch (e) {
    if (e.status === 401) { encerrarOperador(e.message); return; }
    m.textContent = `Não foi possível atualizar: ${e.message || 'tente de novo em instantes.'} A lista anterior continua valendo.`;
  } finally { atualizandoVis = false; b.disabled = false; }
}

/* Lista do que aparece no portal (gravada pelo botão "Atualizar produtos do portal"). */
let visAdm = null;
async function lerVisiveis() {
  try {
    const d = (await painel('visiveis_ler')).dados;
    if (!d) return { ok: false };
    return { ok: true, em: d.atualizado_em, minimo: Number(d.estoque_minimo) || 0,
      lista: { visiveis: d.visiveis || [], baixo: d.estoque_baixo || [], sem: d.sem_estoque || [] },
      set: { visiveis: new Set(d.visiveis || []), baixo: new Set(d.estoque_baixo || []), sem: new Set(d.sem_estoque || []) } };
  } catch { return { ok: false }; }
}
/** null = aparece no portal; texto = motivo de estar fora. Sem a lista, só sabe dos tirados pela equipe. */
function motivoFora(p) {
  if (registro(p)?.oculto) return '🙈 Tirado pela equipe';
  // A busca do operador já traz a quantidade (pacote 18/11 tarde): vale o número do momento.
  if (p.quantidade_disponivel !== undefined && p.quantidade_disponivel !== null) {
    const n = Number(p.quantidade_disponivel); const min = Number(cfgLoja?.estoque_minimo ?? visAdm?.minimo) || 0;
    if (!(n > 0)) return '⛔ Sem estoque';
    if (min > 0 && n <= min) return `📉 Estoque baixo (${String(min).replace('.', ',')} un. ou menos)`;
    if (!visAdm?.ok) return null;
  }
  if (!visAdm?.ok) return null;
  const c = String(p.codigo);
  if (p.quantidade_disponivel !== undefined && p.quantidade_disponivel !== null) return visAdm.set.visiveis.has(c) || visAdm.set.baixo.has(c) || visAdm.set.sem.has(c) ? null : '❔ Fora do catálogo dos clientes';
  if (visAdm.set.baixo.has(c)) return `📉 Estoque baixo (${visAdm.minimo} un. ou menos)`;
  if (visAdm.set.sem.has(c)) return '⛔ Sem estoque';
  if (!visAdm.set.visiveis.has(c)) return '❔ Fora do catálogo dos clientes';
  return null;
}

/** Tira o produto do catálogo do portal (ou devolve). Não apaga nada no G360: o produto continua lá, no histórico e na Minha Lista. */
async function tirarOuVoltar(r, b) {
  const p = (prod.lista || []).find((x) => Number(x.id) === Number(r.dataset.id)); if (!p) return;
  const oc = b.dataset.oc === '1';
  if (oc && b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = 'Confirmar: tirar do portal'; setTimeout(() => { if (b.isConnected && b.dataset.confirmar === '1') { b.dataset.confirmar = ''; b.textContent = '🚫 Tirar do portal'; } }, 5000); return; }
  b.disabled = true;
  try {
    await painel('produto_extra_salvar', { codigo: String(p.codigo), produto_id: Number(p.id), nome: nomeExibicao(p), nome_g360: p.nome, categoria: categoriaExibicao(p), oculto: oc });
    aplicarLocal([{ codigo: String(p.codigo), produto_id: Number(p.id), oculto: oc, ...(registro(p) ? {} : { nome: nomeExibicao(p), origem: 'automatico' }) }]);
    toast(oc ? 'Produto tirado do portal ✓ — os clientes não veem mais' : 'Produto de volta ao portal ✓');
    desenharProdutos(false);
  } catch (e) { b.disabled = false; toast(e.message); }
}

function abrirEditorProduto(r) {
  const prox = r.nextElementSibling;
  const botao = r.querySelector('[data-mais]');
  if (prox?.classList.contains('aedit')) { prox.remove(); botao.setAttribute('aria-expanded', 'false'); return; }
  botao.setAttribute('aria-expanded', 'true');
  const p = prod.lista.find((x) => Number(x.id) === Number(r.dataset.id));
  const reg = registro(p);
  const vis = { ...p, nome: nomeExibicao(p), categoria: categoriaExibicao(p) };
  const sugerida = fichaDoProduto({ ...vis, aplicacao: p.aplicacao }, null).texto;
  r.insertAdjacentHTML('afterend', `<div class="aedit">
    <div><label class="hint" for="ed${p.id}" style="margin:0 0 4px;display:block">Descrição no portal</label>
      <textarea class="inp" id="ed${p.id}" rows="4" maxlength="1500" style="width:100%;resize:vertical" placeholder="${esc(sugerida)}">${esc(reg?.descricao || '')}</textarea>
      <small class="hint" style="display:block;margin:4px 0 0">Em branco, o cliente vê o texto cinza acima (${reg?.descricao ? '' : 'descrição automática pelo tipo do produto'}${reg?.descricao ? 'automático' : ''}).</small>
      <label class="hint" style="display:flex;gap:8px;align-items:center;margin:10px 0 0;cursor:pointer"><input type="checkbox" class="eOculto" ${reg?.oculto ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--lima)"> Ocultar este produto do catálogo do portal <span style="color:var(--tx3)">(continua no G360, no histórico e na Minha Lista)</span></label>
      <div class="row" style="margin-top:10px"><button class="btn pri eSalvar" type="button">Salvar</button><span class="hint eRes" style="margin:0 0 0 10px" aria-live="polite"></span></div></div>
    <div><b style="font-size:13px">Clips (vídeos do produto)</b>
      <div class="eclips"></div>
      <div class="fxurl" style="margin:8px 0 0"><input class="eTit" maxlength="120" placeholder="Título do clip (opcional)" aria-label="Título do clip">
        <label class="btn sec" style="height:38px;display:flex;align-items:center;cursor:pointer">⬆ Enviar vídeo<input type="file" class="eArq" accept="video/mp4,video/webm,video/quicktime" hidden></label></div>
      <small class="hint" style="display:block;margin:4px 0 0">Vídeo vertical em MP4, WebM ou MOV, até 50 MB. Aparece em Clips e no botão "Ver clip" do produto.</small>
      <div class="hint eClipRes" style="margin:4px 0 0" aria-live="polite"></div></div></div>`);
  const ed = r.nextElementSibling;
  const pintarClips = () => {
    const L = (clipsAdm || []).filter((c) => Number(c.produto_id) === Number(p.id));
    const base = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
    ed.querySelector('.eclips').innerHTML = L.length ? L.map((c) => `<div class="eclip" data-id="${esc(c.id)}"><video src="${esc(`${base}/storage/v1/object/public/portal-clips/${c.caminho}`)}" muted playsinline preload="metadata"></video>
      <div><input value="${esc(c.titulo || '')}" maxlength="120" aria-label="Título do clip" data-tit><small>${c.ativo ? 'No ar' : 'Pausado'} · enviado em ${esc(new Date(c.criado_em).toLocaleDateString('pt-BR'))}</small></div>
      <button type="button" class="tool" data-at title="${c.ativo ? 'Pausar' : 'Publicar'}">${c.ativo ? '⏸' : '▶'}</button><button type="button" class="rm" data-rm title="Apagar clip">×</button></div>`).join('') : '<small class="hint" style="display:block;margin:6px 0">Nenhum clip para este produto.</small>';
    ed.querySelectorAll('.eclip').forEach((el) => {
      const c = clipsAdm.find((x) => x.id === el.dataset.id);
      el.querySelector('[data-tit]').onchange = async (e) => { try { await painel('clip_salvar', { id: c.id, titulo: e.target.value }); c.titulo = e.target.value; toast('Título salvo ✓'); } catch (err) { toast(err.message); } };
      el.querySelector('[data-at]').onclick = async () => { try { await painel('clip_salvar', { id: c.id, ativo: !c.ativo }); c.ativo = !c.ativo; pintarClips(); } catch (err) { toast(err.message); } };
      el.querySelector('[data-rm]').onclick = async (e) => {
        const b = e.currentTarget;
        if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = 'Apagar?'; b.style.width = 'auto'; return; }
        try { await painel('clip_apagar', { id: c.id }); clipsAdm = clipsAdm.filter((x) => x.id !== c.id); pintarClips(); toast('Clip apagado'); } catch (err) { toast(err.message); }
      };
    });
  };
  pintarClips();
  ed.querySelector('.eSalvar').onclick = async (e) => {
    const b = e.currentTarget; const desc = ed.querySelector('textarea').value.trim(); const oc = ed.querySelector('.eOculto').checked;
    b.disabled = true;
    try {
      await painel('produto_extra_salvar', { codigo: String(p.codigo), produto_id: Number(p.id), nome: nomeExibicao(p), nome_g360: p.nome, categoria: categoriaExibicao(p), descricao: desc, oculto: oc });
      const rg = registro(p);
      if (rg) { rg.descricao = desc || null; rg.oculto = oc; } else await carregarExibicao(true);
      ed.querySelector('.eRes').textContent = 'Salvo ✓ — o cliente já vê assim';
      toast(oc ? 'Salvo ✓ — produto oculto no catálogo' : 'Salvo ✓');
    } catch (err) { ed.querySelector('.eRes').textContent = err.message; } finally { b.disabled = false; }
  };
  ed.querySelector('.eArq').onchange = async (e) => {
    const arq = e.target.files?.[0]; e.target.value = '';
    const res = ed.querySelector('.eClipRes');
    if (!arq) return;
    if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(arq.type)) { res.textContent = 'Envie o vídeo em MP4, WebM ou MOV.'; return; }
    if (arq.size > 50 * 1024 * 1024) { res.textContent = 'O vídeo pode ter até 50 MB.'; return; }
    res.textContent = `Preparando ${arq.name}…`;
    try {
      // Índice do vídeo no começo do arquivo: no portal o clip começa a tocar sem esperar o fim do download.
      let envio = arq;
      if (arq.type !== 'video/webm') {
        try { const { inicioRapido } = await import('./mp4rapido.js'); const r = inicioRapido(await arq.arrayBuffer()); if (r) envio = new Blob([r], { type: arq.type }); } catch { /* manda como veio */ }
      }
      res.textContent = `Enviando ${arq.name}…`;
      const up = (await painel('clip_upload_url', { tipo: arq.type, tamanho: envio.size })).dados;
      // Cada envio tem nome novo: o aparelho pode guardar o vídeo por 1 ano.
      const { error } = await supabaseComprador().storage.from('portal-clips').uploadToSignedUrl(up.caminho, up.token, envio, { contentType: arq.type, cacheControl: '31536000' });
      if (error) throw new Error('Não foi possível enviar o vídeo agora. Tente de novo em instantes.');
      const novo = (await painel('clip_salvar', { produto_id: Number(p.id), codigo: String(p.codigo), caminho: up.caminho, titulo: ed.querySelector('.eTit').value.trim() })).dados;
      clipsAdm.unshift({ id: novo.id, produto_id: Number(p.id), codigo: String(p.codigo), titulo: ed.querySelector('.eTit').value.trim() || null, caminho: up.caminho, ativo: true, criado_em: new Date().toISOString() });
      ed.querySelector('.eTit').value = '';
      res.textContent = 'Clip enviado ✓ — já aparece em Clips';
      pintarClips();
    } catch (err) { res.textContent = err.message; }
  };
}

function preencherGrupos() {
  const sel = $('aCat'); const atual = sel.value;
  sel.innerHTML = '<option value="">Todas as categorias</option>' + categorias().map((c) => `<option ${c === atual ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

/** Nome ou categoria mudou numa linha: grava como ajuste da equipe. */
async function salvarLinhaProduto(e) {
  if (!e.target.matches('.pnome, .pcat')) return;
  const r = e.target.closest('.arow'); const nome = r.querySelector('.pnome').value.trim().replace(/\s+/g, ' ');
  if (nome.length < 2) { toast('O nome precisa ter pelo menos 2 letras.'); return; }
  const linha = { codigo: r.dataset.cod, produto_id: Number(r.dataset.id), nome, categoria: r.querySelector('.pcat').value, origem: 'equipe', nome_g360: r.dataset.g360 };
  e.target.disabled = true;
  try {
    await painel('exibicao_salvar', { linhas: [linha] });
    aplicarLocal([linha]); r.dataset.nome = nome;
    r.querySelector('.org').textContent = 'ajustado pela equipe';
    toast('Salvo ✓ — o cliente já vê assim no catálogo');
  } catch (err) { toast(err.message); } finally { e.target.disabled = false; }
}

/** Passa por todo o catálogo do G360 e grava nome e categoria automáticos (sem mexer no que já foi ajustado). */
async function gerarTudo() {
  const b = $('aGerar'); const info = $('aGerarInfo');
  if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = 'Confirmar: gerar para todos'; return; }
  b.dataset.confirmar = ''; b.disabled = true;
  await carregarExibicao();
  let pagina = 1; let paginas = 1; let gravados = 0; let vistos = 0;
  try {
    do {
      info.textContent = `Lendo o G360… página ${pagina} de ${paginas}`;
      const { dados, paginacao } = await buscarProdutosOperador(op.token, { pagina, limite: 50 });
      paginas = Math.max(1, Math.ceil((paginacao?.total || 0) / 50));
      vistos += dados.length;
      const linhas = dados.map((p) => {
        const r = registro(p);
        const nome = r && r.origem !== 'automatico' ? r.nome : nomeEcommerce(p.nome, p.marca?.nome || '');
        return { codigo: String(p.codigo), produto_id: Number(p.id), nome, categoria: r && r.origem !== 'automatico' && r.categoria ? r.categoria : categoriaPeloNome(p.nome, nome), origem: 'automatico', nome_g360: p.nome };
      });
      if (linhas.length) {
        const res = await painel('exibicao_salvar', { linhas, preservar: true });
        gravados += res.gravados || 0;
        aplicarLocal(linhas.filter((l) => { const r = registro({ codigo: l.codigo }); return !r || r.origem === 'automatico'; }));
      }
      pagina += 1;
    } while (pagina <= paginas);
    await carregarExibicao(true);
    info.textContent = `Pronto: ${vistos} produtos conferidos, ${gravados} com nome e categoria automáticos. Use o filtro "Nome automático (revisar)" para conferir.`;
    toast('Nomes e categorias gerados ✓');
    desenharProdutos();
  } catch (e) { info.textContent = `Parou na página ${pagina}: ${e.message}. Clique de novo para continuar do começo (o que já foi gravado fica).`; }
  finally { b.disabled = false; b.textContent = '✨ Gerar nomes e categorias'; }
}

/** Capa de cada produto visível (galeria + foto), com cache; falha vira espaço reservado. */
function carregarMiniaturas(alvo) {
  alvo.querySelectorAll('[data-foto]').forEach(async (el) => {
    const id = Number(el.dataset.foto);
    const pinta = (u) => { el.innerHTML = u ? `<img src="${u}" alt="">` : '<span>sem foto</span>'; };
    if (capas.has(id)) { pinta(capas.get(id)); return; }
    try {
      const g = await listarFotosOperador(op.token, id);
      if (!g.capa) { capas.set(id, null); pinta(null); return; }
      const u = URL.createObjectURL(await obterFotoOperador(op.token, id, g.capa)); urls.push(u);
      capas.set(id, u); pinta(u);
    } catch { capas.set(id, null); pinta(null); }
  });
}

/* ---------------- Fotos (modal do portal antigo) ---------------- */

const fx = { id: null, nome: '', gal: null, sel: null, urls: new Map() };

function ligarModalFotos() {
  // O G360 recebe foto por arquivo; link de imagem e "restaurar originais" não existem na API.
  document.querySelector('#mod .fxurl')?.remove();
  $('mDel').remove(); $('mCan').remove();
  $('mOk').textContent = 'Fechar';
  $('mOk').onclick = fecharFotos; $('mCan2').onclick = fecharFotos;
  $('fxP').onclick = () => moverSel(-1); $('fxN').onclick = () => moverSel(1);
  $('mFile').accept = 'image/*';
  $('mFile').onchange = () => { enviarArquivos([...$('mFile').files]); $('mFile').value = ''; };
  const drop = $('fxDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('on'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('on'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('on'); enviarArquivos([...e.dataTransfer.files]); });
  $('fxTh').addEventListener('click', (e) => { const b = e.target.closest('[data-item]'); if (b) { fx.sel = Number(b.dataset.item); desenharFotos(); } });
  $('fxAct').addEventListener('click', acaoFoto);
  const hint = document.querySelector('#mod .hint');
  if (hint) hint.innerHTML = 'Achou a foto no Google ou no Mercado Livre? Salve a imagem no computador ou celular e envie acima. Fotos em outro formato viram JPEG automaticamente (até 2 MB, no máximo 12 por produto).';
  if (!$('fxRes')) $('opts').insertAdjacentHTML('beforebegin', '<div id="fxRes" aria-live="polite"></div>');
}

function fecharFotos() {
  fecharModal('mod');
  fx.urls.forEach((u) => URL.revokeObjectURL(u)); fx.urls.clear();
  if (fx.id) { capas.delete(fx.id); }
  fx.id = null; fx.gal = null;
  if (aba === 'prod') carregarMiniaturas($('aPanel'));
}

async function abrirFotos(id, nome) {
  fx.id = id; fx.nome = nome; fx.gal = null; fx.sel = null;
  $('mT').textContent = nome; $('mS').textContent = 'Fotos do G360 · aparecem no catálogo dos clientes';
  $('gG').href = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(nome)}`;
  $('gM').href = `https://lista.mercadolivre.com.br/${encodeURIComponent(nome)}`;
  $('fxTh').innerHTML = '<span class="hint">Carregando a galeria…</span>'; $('fxAct').innerHTML = ''; $('fxRes').innerHTML = '';
  $('mImg').removeAttribute('src'); $('mTag').textContent = '';
  abrirModal('mod');
  try { fx.gal = await listarFotosOperador(op.token, id); } catch (e) { mostrarMensagemErro($('fxRes'), e); $('fxTh').innerHTML = ''; return; }
  fx.sel = fx.gal.capa;
  desenharFotos();
}

async function urlFoto(item) {
  if (fx.urls.has(item)) return fx.urls.get(item);
  const u = URL.createObjectURL(await obterFotoOperador(op.token, fx.id, item));
  fx.urls.set(item, u); return u;
}

function desenharFotos() {
  const g = fx.gal; if (!g) return;
  const id = fx.id;
  const fotos = g.fotos;
  if (!fotos.some((f) => f.item === fx.sel)) fx.sel = fotos[0]?.item ?? null;
  $('fxTh').innerHTML = fotos.length ? fotos.map((f) => `<div class="fxt ${f.item === fx.sel ? 'on' : ''}" data-item="${f.item}" role="button" tabindex="0" title="${esc(f.descricao || `Foto ${f.item}`)}"><span class="ld">…</span>${f.item === g.capa ? '<span class="n1">CAPA</span>' : ''}</div>`).join('')
    : '<div class="fxempty">Nenhuma foto. Envie a primeira abaixo; ela vira a capa.</div>';
  $('fxTh').querySelectorAll('[data-item]').forEach(async (b) => {
    try { const u = await urlFoto(Number(b.dataset.item)); if (fx.id === id) b.querySelector('.ld').outerHTML = `<img src="${u}" alt="">`; } catch { b.classList.add('bad'); }
  });
  $('fxDrop').style.display = fotos.length >= g.maximo ? 'none' : '';
  $('mTag').textContent = fx.sel === g.capa && fx.sel ? 'Capa' : '';
  const i = fotos.findIndex((f) => f.item === fx.sel);
  $('fxP').style.visibility = i > 0 ? '' : 'hidden'; $('fxN').style.visibility = i >= 0 && i < fotos.length - 1 ? '' : 'hidden';
  if (fx.sel) urlFoto(fx.sel).then((u) => { if (fx.id === id) $('mImg').src = u; }).catch(() => $('mImg').removeAttribute('src'));
  else $('mImg').removeAttribute('src');
  $('fxAct').innerHTML = fx.sel ? `<span class="hint" style="margin:0">${fotos.length} de ${g.maximo} fotos</span>
    ${fx.sel !== g.capa ? '<button class="tool" data-a="capa">★ Tornar capa</button>' : ''}
    ${i > 0 ? '<button class="tool" data-a="esq">← Mover</button>' : ''}${i < fotos.length - 1 ? '<button class="tool" data-a="dir">Mover →</button>' : ''}
    <button class="tool" data-a="rm" style="color:#ff8a8a">Remover</button>` : '';
}

function moverSel(d) {
  const f = fx.gal?.fotos || []; const i = f.findIndex((x) => x.item === fx.sel);
  if (f[i + d]) { fx.sel = f[i + d].item; desenharFotos(); }
}

async function acaoFoto(e) {
  const b = e.target.closest('[data-a]'); if (!b || !fx.gal) return;
  const a = b.dataset.a; const ordem = fx.gal.fotos.map((f) => f.item); const i = ordem.indexOf(fx.sel);
  if (a === 'rm' && b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = 'Confirmar remoção'; return; }
  b.disabled = true; $('fxRes').innerHTML = '';
  try {
    if (a === 'capa') fx.gal = await definirCapaOperador(op.token, fx.id, fx.sel);
    if (a === 'esq' || a === 'dir') { const j = a === 'esq' ? i - 1 : i + 1; [ordem[i], ordem[j]] = [ordem[j], ordem[i]]; fx.gal = await ordenarFotosOperador(op.token, fx.id, ordem); }
    if (a === 'rm') { fx.gal = await removerFotoOperador(op.token, fx.id, fx.sel); fx.sel = fx.gal.capa; }
    toast('Fotos atualizadas no G360 ✓');
    desenharFotos();
  } catch (err) { b.disabled = false; mostrarMensagemErro($('fxRes'), err); }
}

async function enviarArquivos(lista) {
  if (!fx.gal || !lista.length) return;
  $('fxRes').innerHTML = '';
  for (const arq of lista) {
    if (fx.gal.fotos.length >= fx.gal.maximo) { $('fxRes').innerHTML = '<div class="rv-aviso">A galeria chegou a 12 fotos. Remova uma para incluir outra.</div>'; break; }
    if (!arq.type.startsWith('image/')) { $('fxRes').innerHTML = `<div class="rv-aviso">${esc(arq.name)} não é uma imagem.</div>`; continue; }
    $('fxAct').innerHTML = `<span class="hint" style="margin:0">Enviando ${esc(arq.name)}…</span>`;
    let dados;
    try { dados = await paraJpeg(arq); } catch { $('fxRes').innerHTML = `<div class="rv-aviso">Não deu para preparar ${esc(arq.name)}. Tente outra imagem.</div>`; continue; }
    try { fx.gal = await incluirFotoOperador(op.token, fx.id, dados); fx.sel = fx.gal.item ?? fx.sel; toast('Foto enviada ao G360 ✓'); }
    catch (e) { mostrarMensagemErro($('fxRes'), e); break; }
  }
  desenharFotos();
}

/* ---------------- Clientes ---------------- */

function desenharClientes() {
  const p = $('clPanel');
  if (!$('clCad')) p.innerHTML = '<div id="clLista"></div><div id="clCad"></div><div id="clPortal"></div>';
  desenharCadastros();
  desenharClientesPortal();
}

/** Minha Lista do cliente montada pela equipe: ele já encontra pronta no login. */
async function montarLista(c) {
  const alvo = $('clLista');
  let ids = [];
  const pintar = async () => {
    alvo.innerHTML = `<div class="panel" style="margin:12px 18px 16px"><div style="padding:14px 16px 4px;position:relative"><button class="fxx" data-fechar style="position:absolute;right:12px;top:10px" title="Fechar">×</button><b>Minha Lista de ${esc(c.nome)}</b>
      <small class="hint" style="display:block;margin:2px 0 0">O cliente vê esta lista ao entrar, com preço e estoque do momento. Ele pode tirar ou pôr produtos depois.</small></div>
      <div class="fxurl" style="margin:10px 16px"><input id="mlQ" placeholder="Buscar produto para adicionar (nome ou código)" aria-label="Buscar produto"><button class="btn sec" id="mlBuscar">Buscar</button></div>
      <div style="margin:0 16px 8px"><button class="tool ab" id="mlPdf" type="button">📄 Importar relatório de vendas (PDF do G360)</button></div><div id="mlPdfBox"></div>
      <div id="mlRes"></div><div id="mlItens">${carregandoHtml('Carregando a lista…')}</div></div>`;
    alvo.querySelector('[data-fechar]').onclick = () => { alvo.innerHTML = ''; };
    $('mlPdf').onclick = async () => {
      if ($('mlPdfBox').innerHTML) { $('mlPdfBox').innerHTML = ''; return; }
      if (!ativos) { try { await carregarExibicao(); const cods = await codigosAtivosPublicos(); ativos = cods ? new Set(cods) : null; } catch { /* sem a lista: trata todos como ativos */ } }
      abrirImportarVendas({
        alvo: $('mlPdfBox'), cliente: c, token: () => op.token, painel, limiteMargem, noPortal,
        aoMudarLista: (novos) => { if (Array.isArray(novos)) ids = novos; itens(); },
        aoSessaoEncerrada: (e) => encerrarOperador(e.message),
      });
    };
    $('mlBuscar').onclick = buscar; $('mlQ').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } };
    $('mlQ').addEventListener('input', adiar(() => { if ($('mlQ').value.trim().length >= 3) buscar(); }, 450));
    await itens();
  };
  let ativos = null; // códigos ativos no portal (null = sem a lista ainda: trata todos como ativos)
  const noPortal = (p) => !!p && registro(p)?.oculto !== true && (!ativos || ativos.has(String(p.codigo)));
  async function itens() {
    const box = $('mlItens');
    if (!ids.length) { box.innerHTML = vazio('Lista vazia. Busque acima e clique em "+ Adicionar".'); return; }
    let precos = [];
    try {
      esquecerAtivosPublicos();
      const cods = await codigosAtivosPublicos(); ativos = cods ? new Set(cods) : null;
      for (let i = 0; i < ids.length; i += 50) precos = precos.concat(await consultarPrecosOperador(op.token, c.codigo, ids.slice(i, i + 50)));
    } catch (e) { erroEm(box, e, itens); return; }
    const porId = new Map(precos.map((p) => [Number(p.id), p]));
    const ordem = [...ids].sort((x, y) => Number(noPortal(porId.get(y))) - Number(noPortal(porId.get(x))));
    const fora = ids.filter((id) => !noPortal(porId.get(id))).length;
    box.innerHTML = `<div class="hint" style="padding:0 16px 6px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span>${ids.length} produto${ids.length === 1 ? '' : 's'} na lista · <b style="color:var(--lima)">${ids.length - fora} aparecendo para o cliente</b>${fora ? ` · <b style="color:#ff8a8a">${fora} fora do portal (o cliente não vê)</b>` : ''}</span>
        <button class="btn sec" id="mlEsv" type="button" style="height:32px;margin-left:auto">🗑 Esvaziar lista</button></div>` + ordem.map((id) => {
      const p = porId.get(id); const ativo = noPortal(p);
      return `<div class="crow" data-id="${id}" style="${ativo ? '' : 'opacity:.6'}"><div class="g360-mini" data-foto="${id}"><span>…</span></div>
        <div class="nm">${esc(p ? nomeExibicao(p) : `Produto ${id}`)}<small>Cód. ${esc(p?.codigo || id)}${p ? dispPainel(p) : ' · fora do catálogo deste cliente'}${ativo ? '' : ' · <b style="color:#ff8a8a">fora do portal (o cliente não vê)</b>'}</small></div>
        <div class="g">Preço do cliente<b>${p ? esc(dinheiro(p.preco)) : '—'}</b>${p?.preco_congelado ? `<small style="display:block;color:var(--lima)">❄ congelado ${esc(dinheiro(p.preco_congelado))}</small>` : ''}</div>
        <div class="df2">${p ? margemHtml(p) : ''}</div>
        ${p ? '<button class="tool ab" data-cgl type="button" style="white-space:nowrap">❄ Congelar</button>' : '<div></div>'}
        <button class="rm" data-rm title="Tirar da lista">×</button></div>
        <div class="mlcg" data-cgbox="${id}" hidden></div>`;
    }).join('');
    carregarMiniaturas(box);
    box.querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try { ids = (await painel('lista_remover', { comprador: c.codigo, produto_id: Number(b.closest('.crow').dataset.id) })).dados; itens(); }
      catch (e) { b.disabled = false; toast(e.message); }
    });
    const esv = $('mlEsv');
    esv.onclick = async () => {
      if (esv.dataset.confirmar !== '1') { esv.dataset.confirmar = '1'; esv.textContent = `Tirar os ${ids.length}? Clique de novo`; return; }
      esv.disabled = true; esv.textContent = 'Esvaziando…';
      try { for (const id of [...ids]) ids = (await painel('lista_remover', { comprador: c.codigo, produto_id: id })).dados; toast('Lista do cliente esvaziada'); }
      catch (e) { toast(e.message); }
      itens();
    };
    box.querySelectorAll('[data-cgl]').forEach((b) => b.onclick = () => abrirCongelarNaLista(b.closest('.crow'), porId.get(Number(b.closest('.crow').dataset.id))));
  }
  /** Congelar o preço do produto para este cliente direto da lista (grava no G360). */
  function abrirCongelarNaLista(row, p) {
    const box = row.nextElementSibling;
    if (!box.hidden) { box.hidden = true; return; }
    const hoje = new Date().toISOString().slice(0, 10); const f = new Date(); f.setFullYear(f.getFullYear() + 1);
    const custo = p.custo_visivel && p.custo !== null ? Number(p.custo) : null;
    box.hidden = false;
    box.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;padding:4px 16px 14px 16px">
      <div class="pin"><span>R$</span><input data-cgv inputmode="decimal" placeholder="${esc(valorTela(p.preco_congelado || p.preco))}" aria-label="Preço congelado"></div>
      <label class="hint" style="margin:0">De <input type="date" data-cgi value="${hoje}"></label>
      <label class="hint" style="margin:0">Até <input type="date" data-cgf value="${f.toISOString().slice(0, 10)}" min="${hoje}"></label>
      <button class="btn pri" data-cgok type="button" style="height:36px">Congelar no G360</button>
      <span class="hint" data-cgmg style="margin:0">Tabela para o cliente: <b>${esc(dinheiro(p.preco))}</b>${custo !== null ? ` · custo R$ ${esc(numeroPainel(custo, 2))}` : ''}${p.preco_congelado ? ' · já tem preço congelado: para alterar o atual, use a aba Preços congelados' : ''}</span>
      <div data-cgerr style="flex-basis:100%" aria-live="polite"></div></div>`;
    const inp = box.querySelector('[data-cgv]'); inp.focus();
    inp.addEventListener('input', () => {
      const v = Number(valorPreco(inp.value) || 0); const el = box.querySelector('[data-cgmg]');
      const base = `Tabela para o cliente: <b>${esc(dinheiro(p.preco))}</b>${custo !== null ? ` · custo R$ ${esc(numeroPainel(custo, 2))}` : ''}`;
      const mg = custo !== null && v > 0 ? ((v - custo) / v) * 100 : null;
      el.innerHTML = base + (mg !== null ? ` · margem no preço digitado: <b class="mg ${mg < limiteMargem() ? 'bad' : 'ok'}">${esc(numeroPainel(mg, 1))}%</b>${mg < limiteMargem() ? ' (abaixo do mínimo)' : ''}` : '');
    });
    box.querySelector('[data-cgok]').onclick = async (ev) => {
      const b = ev.currentTarget; const err = box.querySelector('[data-cgerr]'); err.innerHTML = '';
      const valor = valorPreco(inp.value);
      const inicio = box.querySelector('[data-cgi]').value; const fim = box.querySelector('[data-cgf]').value;
      if (!valor) { err.innerHTML = '<div class="okmsg bad">Digite o preço, por exemplo 12,50.</div>'; inp.focus(); return; }
      if (!inicio || !fim || fim < inicio) { err.innerHTML = '<div class="okmsg bad">A data final precisa ser igual ou depois da inicial.</div>'; return; }
      b.disabled = true; b.textContent = 'Gravando no G360…';
      try {
        await incluirPrecoCongelado(op.token, c.codigo, { produto: Number(p.id), unidade_id: null, valor, inicio, fim });
        toast(`Preço congelado no G360 ✓ ${dinheiro(valor)}`); itens();
      } catch (e) { b.disabled = false; b.textContent = 'Congelar no G360'; if (e.status === 401) { encerrarOperador(e.message); return; } mostrarMensagemErro(err, e); }
    };
  }
  async function buscar() {
    const q = $('mlQ').value.trim(); const res = $('mlRes');
    if (q.length < 2) return;
    res.innerHTML = carregandoHtml('Buscando…');
    try {
      await carregarExibicao();
      const locais = buscarLocal(q, { max: 20 });
      let { dados } = locais.length ? await buscarProdutosOperador(op.token, { codigos: locais.map((l) => l.codigo), limite: 20 })
        : await buscarProdutosOperador(op.token, { q, limite: 20 });
      const ordem = new Map(locais.map((l, i) => [l.codigo, i]));
      dados.sort((a, b) => (ordem.get(String(a.codigo)) ?? 99) - (ordem.get(String(b.codigo)) ?? 99));
      if (!ativos) { const cods = await codigosAtivosPublicos(); ativos = cods ? new Set(cods) : null; }
      const todos = dados.length; dados = dados.filter((p) => noPortal(p));
      if (!dados.length && todos) { res.innerHTML = vazio('Os produtos encontrados não estão ativos no portal. Só dá para pôr na lista o que aparece para o cliente.'); return; }
      res.innerHTML = dados.length ? dados.map((p) => `<div class="crow" data-id="${Number(p.id)}"><div class="g360-mini" data-foto="${Number(p.id)}"><span>…</span></div>
          <div class="nm">${esc(nomeExibicao(p))}<small>Cód. ${esc(p.codigo)} · ${esc(p.unidade || '')}</small></div><div class="g">Tabela<b>${esc(dinheiro(p.preco))}</b></div><div></div>
          <div></div><button class="btn ${ids.includes(Number(p.id)) ? 'sec' : 'pri'}" data-add style="height:34px;white-space:nowrap" ${ids.includes(Number(p.id)) ? 'disabled' : ''}>${ids.includes(Number(p.id)) ? 'Na lista ✓' : '+ Adicionar'}</button></div>`).join('')
        : vazio('Nenhum produto encontrado.');
      carregarMiniaturas(res);
      res.querySelectorAll('[data-add]').forEach((b) => b.onclick = async () => {
        b.disabled = true;
        try { ids = (await painel('lista_incluir', { comprador: c.codigo, produto_ids: [Number(b.closest('.crow').dataset.id)] })).dados; b.textContent = 'Na lista ✓'; b.className = 'btn sec'; itens(); }
        catch (e) { b.disabled = false; toast(e.message); }
      });
    } catch (e) { erroEm(res, e); }
  }
  alvo.innerHTML = carregandoHtml('Carregando a lista…');
  try { ids = (await painel('lista_ler', { comprador: c.codigo })).dados; } catch (e) { alvo.innerHTML = vazio(esc(e.message)); return; }
  await pintar();
  alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Clientes que já entraram no portal (contas abertas pela ponte + nome gravado no login). */
async function desenharClientesPortal() {
  const alvo = $('clPortal');
  alvo.innerHTML = carregandoHtml('Carregando clientes do portal…');
  let lista;
  try { lista = (await painel('clientes_listar')).dados || []; } catch (e) { alvo.innerHTML = vazio(esc(e.message)); return; }
  const dt = (t) => (t ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  alvo.innerHTML = `<div class="crow2 h"><div>Clientes que já entraram no portal (${lista.length})</div><div>Cód. G360</div><div>Último acesso</div><div>Pedidos pelo portal</div><div></div></div>`
    + (lista.length ? lista.map((c) => `<div class="crow2"><div class="nm"><b>${esc(c.nome || 'Nome aparece no próximo acesso')}</b><small>Primeiro acesso: ${esc(dt(c.primeiro_em))}${c.acessos ? ` · ${c.acessos} acesso${c.acessos === 1 ? '' : 's'}` : ''}</small></div>
        <div class="sm sm2">${esc(c.codigo)}</div><div class="sm">${esc(dt(c.ultimo_em))}</div>
        <div class="sm">${c.pedidos ? `<b>${c.pedidos}</b> · ${esc(brl(c.valor))}` : '—'}</div><div><button class="tool ab" data-mlc="${esc(c.codigo)}" data-nome="${esc(c.nome || '')}" type="button">⭐ Minha Lista</button></div></div>`).join('')
      : vazio('Nenhum cliente entrou no portal ainda.'))
    + '<div class="hint" style="padding:10px 18px">A lista mostra quem já entrou pelo menos uma vez. Quem tem acesso liberado no G360 mas nunca entrou ainda não aparece (pedido feito à Movimento).</div>';
  alvo.querySelectorAll('[data-mlc]').forEach((b) => b.onclick = () => montarLista({ codigo: Number(b.dataset.mlc), nome: b.dataset.nome || `cliente ${b.dataset.mlc}` }));
}

/* Dados do Supabase pelo mesmo login do G360 (função painel-g360). 401 encerra o painel. */
async function painel(acao, dados) {
  try { return await chamarPainel(op.token, acao, dados); }
  catch (e) { if (e.status === 401) encerrarOperador(e.message); throw e; }
}

const SIT = { pendente: 'Aguardando', aprovado: 'Aprovado', recusado: 'Reprovado' };
let cadastros = null;
let vendedores = null;

async function carregarVendedores(recarregar = false) {
  if (vendedores && !recarregar) return vendedores;
  try { vendedores = (await painel('vendedores_listar')).dados || []; } catch { vendedores = vendedores || []; }
  return vendedores;
}

const soNum = (t) => String(t || '').replace(/\D/g, '');
const docLimpo = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function fmtDoc(t) {
  const d = docLimpo(t);
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return d;
}
const fmtTel = (t) => { const d = soNum(t); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : d; };
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function desenharCadastros(recarregar = true) {
  const alvo = $('clCad'); if (!alvo) return;
  if (!recarregar && cadastros) { pintarCadastros(); return; }
  listar();
  async function listar() {
    alvo.innerHTML = carregandoHtml('Carregando clientes…');
    try { cadastros = (await painel('cadastros_listar')).dados || []; }
    catch (e) { alvo.innerHTML = vazio(esc(e.message)); return; }
    pintarCadastros();
  }
}

function pintarCadastros() {
  const alvo = $('clCad'); if (!alvo || !cadastros) return;
  const st = $('clSt').value; const q = semAcento($('clQ').value.trim()); const qd = docLimpo(q);
  const L = cadastros
    .filter((k) => (!st || k.status === st) && (!q || semAcento([k.razao_social, k.fantasia, k.documento, fmtDoc(k.documento), k.codigo_g360, k.cidade, k.vendedor, k.responsavel].join(' ')).includes(q) || (qd.length >= 4 && k.documento.includes(qd))))
    .sort((a, b) => (a.status === 'pendente' ? 0 : 1) - (b.status === 'pendente' ? 0 : 1) || String(b.criado_em).localeCompare(String(a.criado_em)));
  $('cliN').textContent = cadastros.filter((k) => k.status === 'pendente').length || '';
  alvo.innerHTML = `<div class="crow2 h"><div>Cliente (${L.length})</div><div>Cód. G360</div><div>Cidade</div><div>Situação</div><div></div></div>`
    + (L.length ? L.map((k) => `<div class="crow2" data-id="${esc(k.id)}">
      <div class="nm"><b>${esc(k.fantasia || k.razao_social)}</b><small>${esc(fmtDoc(k.documento))} · ${esc(k.razao_social)}</small>
        <small>IE: ${esc(k.inscricao_estadual || 'não informada')}${k.email ? ` · ${esc(k.email)}` : ''}</small>
        <small>${esc(k.origem || (k.criado_por === 'equipe' ? 'Cadastrado pela equipe' : 'Quero ser cliente'))}${k.whats ? ` · ${esc(fmtTel(k.whats))}` : ''}${k.vendedor ? ` · Vendedor: ${esc(k.vendedor)}` : ''}</small>
        ${k.observacao_equipe ? `<small>Obs.: ${esc(k.observacao_equipe)}</small>` : ''}</div>
      <div class="sm sm2">${k.codigo_g360 ? esc(k.codigo_g360) : '<span style="color:var(--tx3)">—</span>'}</div>
      <div class="sm">${esc(k.cidade || '')}${k.uf ? `/${esc(k.uf)}` : ''}${k.codigo_g360 ? `<span class="som"> · cód. ${esc(k.codigo_g360)}</span>` : ''}</div>
      <div class="stw"><span class="stt ${k.status === 'recusado' ? 'reprovado' : esc(k.status)}">${SIT[k.status] || esc(k.status)}</span></div>
      <div class="ab2">${k.status === 'pendente' ? '<button class="ap" data-d="aprovado">Aprovar</button><button class="rp" data-d="recusado">Reprovar</button>' : ''}${k.status === 'aprovado' && !k.codigo_g360 ? '<button class="ap" data-novo>➕ Cadastrar no G360</button>' : ''}<button data-lista ${k.codigo_g360 ? '' : 'disabled title="Cadastre no G360 primeiro (➕ Cadastrar no G360)"'}>⭐ Minha Lista</button>${k.codigo_g360 ? '<button data-g360>📋 Ficha G360</button>' : ''}<button data-ed>Editar</button></div></div>`).join('')
      : vazio(cadastros.length ? 'Nenhum cliente encontrado com essa busca.' : 'Nenhum cliente ainda. Clique em "+ Novo cliente" ou aguarde os pedidos de "Quero ser cliente".'))
    + '<div class="hint" style="padding:10px 18px">A ficha é do portal: preço, condições de pagamento, crédito e endereços de entrega continuam vindo do G360. Para o cliente entrar, ele precisa estar no G360 com "Acesso à API dos sistemas externos" marcado.</div>';
  alvo.querySelectorAll('.crow2[data-id] button').forEach((b) => b.addEventListener('click', async () => {
    const k = cadastros.find((x) => String(x.id) === b.closest('.crow2').dataset.id);
    if (b.hasAttribute('data-ed')) { abrirFicha(k); return; }
    if (b.hasAttribute('data-g360')) { abrirFichaG360(k.codigo_g360, opcoesFichaG360()); return; }
    if (b.hasAttribute('data-novo')) { novoClienteG360(k); return; }
    if (b.hasAttribute('data-lista')) { montarLista({ codigo: k.codigo_g360, nome: k.fantasia || k.razao_social }); return; }
    b.disabled = true;
    try { await painel('cadastro_decidir', { id: k.id, status: b.dataset.d, observacao: k.observacao_equipe || '' }); }
    catch (e) { b.disabled = false; toast(e.message); return; }
    toast(b.dataset.d === 'aprovado' ? 'Cliente aprovado ✓ — avise o cliente.' : 'Cadastro reprovado');
    desenharCadastros();
  }));
}

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

/** DDD + número, sem +55 nem 0 na frente (o preenchimento automático costuma pôr). */
function foneLimpo(t) {
  let d = soNum(t);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1);
  return d;
}

/** Novo / Editar cliente (mesmo formulário do painel antigo). Não altera nada no G360. */
async function abrirFicha(k) {
  const d = k || { status: 'aprovado' };
  const vend = await carregarVendedores();
  const origens = [...vend.map((v) => `Vendedor: ${v}`), 'Instagram', 'Google', 'Indicação de outro cliente', 'Outro'];
  if (d.origem && !origens.includes(d.origem)) origens.push(d.origem);
  const vendOpc = [...vend]; if (d.vendedor && !vendOpc.includes(d.vendedor)) vendOpc.push(d.vendedor);
  const isento = String(d.inscricao_estadual || '').toUpperCase() === 'ISENTO';
  const req = ' <span class="req">*</span>';
  const inp = (id, v = '', extra = '') => `<input class="inp" id="${id}" value="${esc(v ?? '')}" ${extra}>`;
  $('admBox').innerHTML = `<div class="fxh"><div><h3>${k ? 'Editar cliente' : 'Novo cliente'}</h3><div class="sub">${k ? `Cadastrado em ${esc(new Date(k.criado_em).toLocaleDateString('pt-BR'))}${k.criado_por === 'equipe' ? ' pela equipe' : ' pelo "Quero ser cliente"'}` : 'Cadastro feito pela equipe já entra aprovado.'}</div></div><button class="fxx" id="kX" title="Fechar">×</button></div>
    <div class="csec">Empresa</div>
    <label for="kCnpj">CNPJ${req}</label>
    <div class="cnpjrow">${inp('kCnpj', d.documento ? fmtDoc(d.documento) : '', 'maxlength="18" autocapitalize="characters" spellcheck="false" placeholder="00.000.000/0000-00"')}<button class="btn sec" id="kBusca" type="button">Buscar dados</button></div>
    <div class="okmsg" id="kCnpjM" aria-live="polite">${d.documento ? '' : 'Digite o CNPJ e clique em Buscar dados: o código vem do G360 e o resto da Receita.'}</div>
    <div class="fgrid"><div class="full"><label for="kRaz">Razão social${req}</label>${inp('kRaz', d.razao_social, 'maxlength="200"')}</div>
      <div class="full"><label for="kFan">Nome fantasia</label>${inp('kFan', d.fantasia, 'maxlength="200"')}</div>
      <div class="full"><label for="kIE">Inscrição estadual${req}</label>
        <div class="cnpjrow">${inp('kIE', isento ? '' : d.inscricao_estadual, `maxlength="30" ${isento ? 'disabled' : ''}`)}<label class="isen"><input type="checkbox" id="kIsento" ${isento ? 'checked' : ''}> Isento</label></div></div></div>
    <div class="csec">Endereço da empresa</div>
    <div class="fgrid"><div><label for="kCep">CEP${req}</label>${inp('kCep', d.cep, 'inputmode="numeric" maxlength="9"')}<div class="okmsg" id="kCepM"></div></div>
      <div><label for="kNum">Número${req}</label>${inp('kNum', d.numero, 'maxlength="20"')}</div>
      <div class="full"><label for="kLog">Rua / avenida${req}</label>${inp('kLog', d.logradouro, 'maxlength="200"')}</div>
      <div><label for="kCom">Complemento</label>${inp('kCom', d.complemento, 'maxlength="120"')}</div>
      <div><label for="kBai">Bairro${req}</label>${inp('kBai', d.bairro, 'maxlength="120"')}</div>
      <div><label for="kCid">Cidade${req}</label>${inp('kCid', d.cidade, 'maxlength="120"')}</div>
      <div><label for="kUf">UF${req}</label><select class="inp" id="kUf"><option value="">—</option>${UFS.map((u) => `<option ${u === d.uf ? 'selected' : ''}>${u}</option>`).join('')}</select></div></div>
    <div class="okmsg" style="color:var(--tx3)">Só para consulta da equipe. O pedido usa os endereços de entrega cadastrados no G360.</div>
    <div class="csec">Contato</div>
    <div class="fgrid"><div class="full"><label for="kResp">Nome do responsável pelas compras${req}</label>${inp('kResp', d.responsavel, 'maxlength="120"')}</div>
      <div><label for="kWa">WhatsApp${req}</label>${inp('kWa', soNum(d.whats), 'inputmode="tel" maxlength="16" placeholder="DDD + número"')}</div>
      <div><label for="kTel">Telefone da empresa</label>${inp('kTel', soNum(d.telefone), 'inputmode="numeric" maxlength="11"')}</div>
      <div class="full"><label for="kEm">E-mail${req}</label>${inp('kEm', d.email, 'type="email" maxlength="160"')}</div>
      <div class="full"><label for="kOri">Como conheceu a Souza Ribeiro?${k ? "" : req}</label><select class="inp" id="kOri"><option value="">Selecione…</option>${origens.map((o) => `<option ${o === d.origem ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div></div>
    <div class="csec">Liberação (admin)</div>
    <div class="fgrid"><div><label for="kCod">Código do cliente no G360</label>${inp('kCod', d.codigo_g360 || '', 'inputmode="numeric" maxlength="9" placeholder="Vem pelo Buscar dados"')}</div>
      <div><label for="kSt">Situação</label><select class="inp" id="kSt">${Object.entries({ pendente: 'Aguardando aprovação', aprovado: 'Aprovado', recusado: 'Reprovado' }).map(([v, t]) => `<option value="${v}" ${v === d.status ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="full"><div class="okmsg" id="kG360M" aria-live="polite"></div><button type="button" class="btn sec" id="kAbrirG360" style="margin-top:6px" ${d.codigo_g360 ? '' : 'hidden'}>📋 Abrir ficha no G360 (alterar cadastro e liberar acesso)</button></div>
      <div class="full"><label for="kVend">Vendedor responsável</label><select class="inp" id="kVend"><option value="">—</option>${vendOpc.map((v) => `<option ${v === d.vendedor ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
        ${vend.length ? '' : '<div class="okmsg" style="color:var(--tx3)">Cadastre os vendedores em Configurações.</div>'}</div></div>
    <div class="ci2" style="display:block;margin-top:12px"><b>Formas de pagamento no portal</b><small>Preço e crédito vêm do cadastro do cliente no G360. Aqui você escolhe quais condições de pagamento liberadas pelo G360 aparecem para este cliente.</small>
      <div id="kCond" style="margin-top:10px">${d.codigo_g360 ? '' : '<div class="hint" style="margin:0">Disponível depois de ligar a ficha a um cliente do G360 (código do cliente).</div>'}</div></div>
    <div class="csec">Acesso</div>
    <div class="ci2" style="display:block"><small>A senha é criada pelo próprio cliente. O botão abaixo envia o link de acesso para o e-mail cadastrado <b>no G360</b> (vale 30 minutos e só uma vez). O cliente também pode usar "Primeiro acesso" no portal.</small>
      <div class="row" style="margin-top:10px"><button class="btn sec" id="kLink" type="button">✉ Enviar link de acesso</button><span class="hint" id="kLinkM" style="margin:0 0 0 10px" aria-live="polite"></span></div></div>
    <div class="err" id="kE" aria-live="polite"></div>
    <div class="act"><button class="btn sec" id="kC" type="button">Cancelar</button><button class="btn pri" id="kOk" type="button">Salvar cliente</button></div>`;
  abrirModal('mAdm');
  const fechar = () => fecharModal('mAdm');
  $('kX').onclick = fechar; $('kC').onclick = fechar;
  if (d.codigo_g360) painelCondicoes($('kCond'), Number(d.codigo_g360));
  $('mAdm').onclick = (e) => { if (e.target.id === 'mAdm') fechar(); };
  setTimeout(() => (k ? $('kRaz') : $('kCnpj')).focus(), 60);

  ['kWa', 'kTel'].forEach((id) => $(id).addEventListener('input', (e) => { e.target.value = foneLimpo(e.target.value).slice(0, 11); }));
  $('kCod').addEventListener('input', (e) => { e.target.value = soNum(e.target.value).slice(0, 9); });
  $('kIsento').onchange = () => { $('kIE').disabled = $('kIsento').checked; if ($('kIsento').checked) $('kIE').value = ''; };
  $('kCnpj').addEventListener('input', () => { const c = docLimpo($('kCnpj').value); if (c.length === 14) $('kCnpj').value = fmtDoc(c); });

  const pre = (id, v) => { if (v && !$(id).value.trim()) $(id).value = String(v).trim(); };
  $('kCep').addEventListener('input', async () => {
    const c = soNum($('kCep').value).slice(0, 8); $('kCep').value = c;
    if (c.length !== 8) { $('kCepM').textContent = ''; return; }
    try {
      // CEP pela API do G360 (operador), no lugar do ViaCEP.
      const j = await consultarCepOperador(op.token, c);
      pre('kLog', j.logradouro); pre('kBai', j.bairro?.nome); pre('kCid', j.cidade?.nome); if (j.uf && !$('kUf').value) $('kUf').value = j.uf;
      $('kCepM').className = 'okmsg'; $('kCepM').textContent = '✓ Endereço encontrado';
    } catch (e) { $('kCepM').className = 'okmsg bad'; $('kCepM').textContent = e.message || 'Não foi possível consultar o CEP agora.'; }
  });

  $('kBusca').onclick = async () => {
    const c = docLimpo($('kCnpj').value); const m = $('kCnpjM'); const g = $('kG360M');
    if (c.length !== 14) { m.className = 'okmsg bad'; m.textContent = 'Digite o CNPJ completo (14 caracteres).'; return; }
    const ja = cadastros?.find((x) => x.documento === c && x.id !== d.id);
    if (ja) { m.className = 'okmsg bad'; m.textContent = 'Já existe uma ficha com este CNPJ. Abrindo a ficha existente…'; setTimeout(() => abrirFicha(ja), 900); return; }
    $('kBusca').disabled = true;
    m.className = 'okmsg'; m.textContent = 'Buscando no G360 e na Receita…'; g.textContent = '';
    const [r360, rec] = await Promise.allSettled([consultarClienteOperador(op.token, c), consultarCnpj(c)]);
    $('kBusca').disabled = false;
    if (r360.status === 'fulfilled') {
      const cli = r360.value; $('kCod').value = cli.codigo;
      g.className = cli.acesso_portal ? 'okmsg' : 'okmsg bad';
      g.textContent = cli.acesso_portal ? `✓ Cliente ${cli.codigo} no G360 (${cli.nome}) com acesso ao portal liberado.`
        : `Cliente ${cli.codigo} no G360 (${cli.nome}), mas falta marcar "Acesso à API dos sistemas externos" no G360. Sem isso ele não consegue entrar.`;
      pre('kRaz', cli.nome);
      $('kAbrirG360').hidden = false;
      // Dados do cadastro no G360 (endereço, e-mail, contato) antes da Receita.
      try {
        const fg = await consultarFichaClienteOperador(op.token, cli.codigo);
        const en = fg.endereco || {};
        pre('kRaz', fg.nome); pre('kFan', fg.fantasia); if (fg.ie_rg && /isento/i.test(fg.ie_rg)) $('kIsento').checked = true; else pre('kIE', fg.ie_rg);
        pre('kEm', fg.email); pre('kResp', fg.contato); pre('kTel', foneLimpo(fg.telefone1).slice(0, 11));
        pre('kCep', soNum(en.cep)); pre('kLog', en.logradouro); pre('kNum', en.numero); pre('kCom', en.complemento);
        pre('kBai', en.bairro?.nome); pre('kCid', en.cidade?.nome); if (en.uf && !$('kUf').value) $('kUf').value = en.uf;
        g.textContent += ' Dados do cadastro do G360 preenchidos.';
      } catch { /* sem a ficha (acesso 00500 ou base antiga): segue com a Receita */ }
    } else {
      const e = r360.reason;
      if (e?.status === 401) { encerrarOperador(e.message); return; }
      g.className = 'okmsg bad';
      g.textContent = e?.codigo === 'CLIENTE_NAO_LOCALIZADO' || e?.status === 404
        ? 'Cliente não encontrado no G360 (ou inativo). Cadastre no G360 primeiro e clique em Buscar dados de novo. A ficha pode ficar como "Aguardando aprovação".'
        : `G360: ${e?.message || 'não foi possível consultar agora.'}`;
      if (!k && !$('kCod').value) $('kSt').value = 'pendente';
    }
    const j = rec.status === 'fulfilled' ? rec.value : null;
    if (j) {
      pre('kRaz', j.razao); pre('kFan', j.fantasia); if (j.ie && !$('kIsento').checked) pre('kIE', j.ie);
      pre('kCep', j.cep); pre('kLog', j.rua); pre('kNum', j.numero); pre('kCom', j.complemento); pre('kBai', j.bairro);
      pre('kCid', j.cidade); if (j.uf && !$('kUf').value) $('kUf').value = j.uf; pre('kTel', soNum(j.telefone)); pre('kEm', j.email);
      m.className = j.situacao && !/ativa/i.test(j.situacao) ? 'okmsg bad' : 'okmsg';
      m.textContent = `✓ ${j.situacao ? `Situação na Receita: ${j.situacao}` : 'Dados encontrados'} — confira e complete.`;
    } else { m.className = 'okmsg bad'; m.textContent = 'Consulta da Receita indisponível agora. Preencha manualmente.'; }
  };

  $('kAbrirG360').onclick = () => {
    const cod = Number($('kCod').value);
    if (!cod) { toast('Busque os dados pelo CNPJ para achar o código do G360.'); return; }
    abrirFichaG360(cod, { ...opcoesFichaG360(), aoVoltar: () => abrirFicha(k) });
  };
  $('kCod').addEventListener('input', () => { $('kAbrirG360').hidden = !$('kCod').value; });
  $('kLink').onclick = async () => {
    const c = docLimpo($('kCnpj').value);
    if (c.length < 11) { $('kLinkM').textContent = 'Digite o CNPJ primeiro.'; return; }
    $('kLink').disabled = true; $('kLinkM').textContent = 'Enviando…';
    try { $('kLinkM').textContent = await pedirLink(c); }
    catch (e) { $('kLinkM').textContent = e.message; }
    finally { $('kLink').disabled = false; }
  };

  $('kOk').onclick = async () => {
    const v = (id) => $(id).value.trim();
    const n = {
      id: d.id || null, documento: docLimpo(v('kCnpj')), razao_social: v('kRaz'), fantasia: v('kFan'),
      inscricao_estadual: $('kIsento').checked ? 'ISENTO' : v('kIE'), cep: soNum(v('kCep')), numero: v('kNum'), logradouro: v('kLog'),
      complemento: v('kCom'), bairro: v('kBai'), cidade: v('kCid'), uf: $('kUf').value, responsavel: v('kResp'), whats: foneLimpo(v('kWa')),
      telefone: foneLimpo(v('kTel')), email: v('kEm'), origem: $('kOri').value, codigo_g360: v('kCod') || null, status: $('kSt').value, vendedor: $('kVend').value,
    };
    const falta = [];
    if (!/^[A-Z0-9]{14}$/.test(n.documento) && !/^[0-9]{11}$/.test(n.documento)) falta.push('CNPJ completo');
    if (n.razao_social.length < 2) falta.push('razão social');
    if (!n.inscricao_estadual) falta.push('inscrição estadual (ou marque Isento)');
    if (n.cep.length !== 8 || !n.numero || !n.logradouro || !n.bairro || !n.cidade || !n.uf) falta.push('endereço completo');
    if (n.responsavel.length < 2) falta.push('responsável');
    if (!/^[0-9]{10,11}$/.test(n.whats)) falta.push('WhatsApp com DDD');
    if (n.telefone && !/^[0-9]{10,11}$/.test(n.telefone)) falta.push('telefone com DDD');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(n.email)) falta.push('e-mail válido');
    // Fichas antigas (e as do "Quero ser cliente" de antes) podem não ter a origem: só é obrigatória no cadastro novo.
    if (!n.origem && !d.id) falta.push('como nos conheceu');
    document.querySelectorAll('#admBox .inp.faltou').forEach((el) => el.classList.remove('faltou'));
    if (falta.length) {
      const marcar = { 'CNPJ completo': ['kCnpj'], 'razão social': ['kRaz'], 'inscrição estadual (ou marque Isento)': ['kIE'], 'responsável': ['kResp'],
        'WhatsApp com DDD': ['kWa'], 'telefone com DDD': ['kTel'], 'e-mail válido': ['kEm'], 'como nos conheceu': ['kOri'],
        'endereço completo': ['kCep', 'kNum', 'kLog', 'kBai', 'kCid', 'kUf'].filter((id) => !$(id).value.trim() || (id === 'kCep' && soNum($(id).value).length !== 8)) };
      falta.forEach((f) => (marcar[f] || []).forEach((id) => $(id).classList.add('faltou')));
      $('kE').textContent = `Não salvou. Falta preencher: ${falta.join(', ')}.`;
      const prim = document.querySelector('#admBox .inp.faltou');
      (prim || $('kE')).scrollIntoView({ block: 'center', behavior: 'smooth' }); prim?.focus({ preventScroll: true });
      return;
    }
    $('kE').textContent = ''; $('kOk').disabled = true; $('kOk').textContent = 'Salvando…';
    try {
      const salvo = (await painel('cliente_salvar', { cliente: n })).dados;
      const i = cadastros ? cadastros.findIndex((x) => x.id === salvo.id) : -1;
      if (cadastros) { if (i >= 0) cadastros[i] = salvo; else cadastros.unshift(salvo); }
      fechar(); pintarCadastros(); toast('Cliente salvo ✓');
    } catch (e) {
      $('kOk').disabled = false; $('kOk').textContent = 'Salvar cliente';
      if (e.status === 409 && e.corpo?.id) {
        $('kE').textContent = e.message;
        await desenharCadastros(); const ja = cadastros?.find((x) => x.id === e.corpo.id);
        if (ja) setTimeout(() => abrirFicha(ja), 1200);
        return;
      }
      $('kE').textContent = e.message || 'Não foi possível salvar agora. Tente de novo.';
      $('kE').scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };
  $('admBox').addEventListener('input', (e) => { if (e.target.classList?.contains('faltou')) e.target.classList.remove('faltou'); });
}

/** "Quero ser cliente" aprovado → cadastro no G360 (nasce bloqueado) → vincula o pedido ao código devolvido → ficha para liberar e mandar o link. */
function novoClienteG360(k) {
  abrirNovoClienteG360(k, {
    token: () => op.token,
    aoSessaoEncerrada: (e) => encerrarOperador(e.message),
    vincular: async (codigo) => {
      const r = (await painel('cadastro_vincular', { id: k.id, codigo_g360: codigo })).dados;
      if (cadastros && r) { const i = cadastros.findIndex((x) => x.id === r.id); if (i >= 0) cadastros[i] = r; }
      pintarCadastros();
    },
    abrirFicha: (codigo) => abrirFichaG360(codigo, opcoesFichaG360()),
  });
}

async function fichaPeloCnpj() {
  const doc = docLimpo($('clQ').value);
  if (doc.length < 11) { toast('Digite o CNPJ (ou CPF) completo na busca e clique de novo.'); $('clQ').focus(); return; }
  const b = $('clG360'); b.disabled = true; b.textContent = 'Consultando no G360…';
  try {
    const c = await consultarClienteOperador(op.token, doc);
    abrirFichaG360(c.codigo, opcoesFichaG360());
  } catch (e) {
    if (e.status === 401) { encerrarOperador(e.message); return; }
    $('clG360Err')?.remove();
    $('clCad').insertAdjacentHTML('beforebegin', '<div class="g360-erro" id="clG360Err" style="margin:12px 18px"></div>');
    mostrarMensagemErro($('clG360Err'), e);
  } finally { b.disabled = false; b.textContent = '📋 Ficha no G360 pelo CNPJ'; }
}

function opcoesFichaG360() {
  return { token: () => op.token, aoSessaoEncerrada: (e) => encerrarOperador(e.message), aoMudar: () => { /* a ficha do portal não muda sozinha */ } };
}

/* ---------------- Preços congelados ---------------- */

const cong = { cliente: null, produto: null, sugestoes: new Map(), itens: [], precos: new Map() };

async function escolherClienteCong(cnpj) {
  if (!cnpj) return;
  $('cgQuem').textContent = 'Consultando…';
  try { const c = await consultarClienteOperador(op.token, cnpj); cong.cliente = { codigo: c.codigo, nome: c.nome, cnpj }; desenharCong(); }
  catch (e) { $('cgQuem').textContent = ''; erroEm($('cgPanel'), e); }
}

function desenharCong() {
  const hoje = new Date().toISOString().slice(0, 10);
  if (!$('cgIni').value) $('cgIni').value = hoje;
  if (!$('cgFim').value) { const f = new Date(); f.setFullYear(f.getFullYear() + 1); $('cgFim').value = f.toISOString().slice(0, 10); }
  if (cong.produto) $('cgQ').value = cong.produto.rotulo;
  if (!cong.cliente) { $('cgQuem').textContent = ''; $('cgPanel').innerHTML = vazio('Digite o CNPJ do cliente acima para ver e negociar os preços congelados dele.'); return; }
  $('cgCnpj').value = cong.cliente.cnpj || '';
  $('cgQuem').innerHTML = `<b style="color:var(--tx)">${esc(cong.cliente.nome)}</b> · cód. ${esc(cong.cliente.codigo)}`;
  carregarCongelados();
}

async function sugerirProdutosCong() {
  const q = $('cgQ').value.trim();
  if (cong.sugestoes.has(q)) { cong.produto = cong.sugestoes.get(q); return; }
  if (q.length < 2) return;
  try {
    const { dados } = await buscarProdutosOperador(op.token, { q, limite: 20 });
    cong.sugestoes = new Map(dados.map((p) => [`${p.codigo} · ${p.nome}`, { id: Number(p.id), rotulo: `${p.codigo} · ${p.nome}`, preco: p.preco }]));
    $('cgList').innerHTML = [...cong.sugestoes.keys()].map((k) => `<option value="${esc(k)}">`).join('');
  } catch { /* a lista só some; o erro aparece ao congelar */ }
}

async function congelar() {
  const res = $('cgRes'); res.innerHTML = '';
  if (!cong.cliente) { toast('Escolha o cliente pelo CNPJ primeiro.'); return; }
  const p = cong.sugestoes.get($('cgQ').value) || (cong.produto?.rotulo === $('cgQ').value ? cong.produto : null);
  if (!p) { toast('Escolha um produto da lista.'); $('cgQ').focus(); return; }
  const valor = valorPreco($('cgP').value);
  if (!valor) { toast('Informe um preço válido.'); $('cgP').focus(); return; }
  const inicio = $('cgIni').value; const fim = $('cgFim').value;
  if (!inicio || !fim || fim < inicio) { toast('A data final precisa ser igual ou depois da inicial.'); return; }
  $('cgAdd').disabled = true;
  try {
    await incluirPrecoCongelado(op.token, cong.cliente.codigo, { produto: p.id, unidade_id: null, valor, inicio, fim });
    $('cgQ').value = ''; $('cgP').value = ''; cong.produto = null;
    toast('Preço congelado no G360 ✓');
    carregarCongelados();
  } catch (e) { mostrarMensagemErro(res, e); } finally { $('cgAdd').disabled = false; }
}

async function carregarCongelados() {
  const alvo = $('cgPanel');
  alvo.innerHTML = carregandoHtml('Carregando preços congelados…');
  try {
    let itens = []; let apos;
    let d;
    do { d = await listarPrecosCongelados(op.token, cong.cliente.codigo, apos); if (!d.disponivel) break; itens = itens.concat(d.itens); apos = d.proximo; } while (apos && itens.length < 500);
    if (!d.disponivel) { alvo.innerHTML = vazio('Preço congelado indisponível: a base do G360 precisa ser atualizada para usar este recurso.'); return; }
    cong.itens = itens.filter((r) => r.situacao === 'ativo').concat(itens.filter((r) => r.situacao !== 'ativo'));
    const ids = [...new Set(cong.itens.map((r) => Number(r.produto)))];
    cong.precos = new Map();
    for (let i = 0; i < ids.length; i += 50) {
      (await consultarPrecosOperador(op.token, cong.cliente.codigo, ids.slice(i, i + 50))).forEach((p) => cong.precos.set(Number(p.id), p));
    }
    pintarCongelados();
  } catch (e) { erroEm(alvo, e, carregarCongelados); }
}

function pintarCongelados() {
  const alvo = $('cgPanel');
  if (!cong.itens.length) { alvo.innerHTML = vazio('Nenhum preço congelado para este cliente. Busque um produto acima e informe o preço.'); return; }
  alvo.innerHTML = cong.itens.map((r) => {
    const p = cong.precos.get(Number(r.produto)); const ativo = r.situacao === 'ativo';
    return `<div class="crow" data-id="${Number(r.id)}" style="${ativo ? '' : 'opacity:.55'}"><div class="g360-mini" data-foto="${Number(r.produto)}"><span>…</span></div>
      <div class="nm">${esc(p?.nome || `Produto ${r.produto}`)}<small>Cód. ${esc(p?.codigo || r.produto)} · ${esc(r.unidade_id || p?.unidade || 'unidade base')} · ${esc(dataBr(r.inicio))} a ${esc(dataBr(r.fim))}${ativo ? '' : ' · encerrado'}${dispPainel(p)}</small></div>
      <div class="g">Preço de tabela<b>${esc(dinheiro(p?.preco))}</b></div>
      <div class="pin"><span>R$</span><input value="${esc(valorTela(r.valor))}" inputmode="decimal" data-cg ${ativo ? '' : 'disabled'}></div>
      <div class="df2">${p ? margemHtml(p) : ''}<br><span style="font-size:11px;color:var(--tx3)">margem sobre a tabela</span></div>
      ${ativo ? '<button class="rm" data-rm title="Encerrar">×</button>' : '<span></span>'}</div>`;
  }).join('') + '<div id="cgRes2" style="padding:0 18px 12px" aria-live="polite"></div>';
  carregarMiniaturas(alvo);
}

async function cliqueCongelado(e) {
  const b = e.target.closest('[data-rm]'); if (!b) return;
  if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = 'Encerrar?'; b.style.width = 'auto'; return; }
  b.disabled = true;
  try { await encerrarPrecoCongelado(op.token, cong.cliente.codigo, Number(b.closest('.crow').dataset.id)); toast('Preço congelado encerrado'); carregarCongelados(); }
  catch (err) { b.disabled = false; mostrarMensagemErro($('cgRes2'), err); }
}

async function mudancaCongelado(e) {
  if (!e.target.matches('[data-cg]')) return;
  const r = cong.itens.find((x) => x.id === Number(e.target.closest('.crow').dataset.id));
  const valor = valorPreco(e.target.value);
  if (!valor) { toast('Informe um preço válido'); e.target.value = valorTela(r.valor); return; }
  e.target.disabled = true;
  try { await alterarPrecoCongelado(op.token, cong.cliente.codigo, r.id, { valor, inicio: r.inicio, fim: r.fim }); toast(`Preço alterado: ${dinheiro(valor)}`); carregarCongelados(); }
  catch (err) { e.target.disabled = false; e.target.value = valorTela(r.valor); mostrarMensagemErro($('cgRes2'), err); }
}

/* ---------------- Margens ---------------- */

let limiteMem = null;
let cfgLoja = null;
function limiteMargem() { return limiteMem ?? 15; }
/** Margem mínima e "só com estoque" ficam no Supabase (valem para toda a equipe). */
async function carregarConfigLoja(forcar = false) {
  if (cfgLoja && !forcar) return cfgLoja;
  try { cfgLoja = (await painel('config_ler')).dados; limiteMem = Number(cfgLoja.margem_minima); } catch { cfgLoja = cfgLoja || { so_estoque: false, margem_minima: 15 }; }
  return cfgLoja;
}
const gravarLimite = adiar(async (n) => { try { cfgLoja = (await painel('config_salvar', { margem_minima: n })).dados; toast('Margem mínima salva ✓'); } catch (e) { toast(e.message); } }, 800);
function guardarLimite(v) { const n = Number(String(v).replace(',', '.')); if (!(n >= 0 && n <= 100)) return; limiteMem = n; gravarLimite(n); }

const mrg = { carregado: false, lista: [], pagina: 0, total: 0, semAcesso: false };

async function desenharMargens(carregarMais = false) {
  $('mgLim').value = limiteMargem();
  const alvo = $('mgPanel');
  if (carregarMais) {
    const btn = $('mgMais'); if (btn) { btn.disabled = true; btn.textContent = 'Verificando…'; } else alvo.innerHTML = carregandoHtml('Verificando as margens no G360…');
    try {
      const { dados, paginacao } = await buscarProdutosOperador(op.token, { pagina: mrg.pagina + 1, limite: 50 });
      mrg.pagina += 1; mrg.total = paginacao?.total || 0; mrg.lista = mrg.lista.concat(dados); mrg.carregado = true;
      mrg.semAcesso = dados.length > 0 && dados.every((p) => !p.custo_visivel);
    } catch (e) { erroEm(alvo, e, () => desenharMargens(true)); return; }
  }
  const lim = limiteMargem();
  const baixo = mrg.lista.filter((p) => p.custo_visivel && p.margem_percentual !== null && p.margem_percentual < lim).sort((a, b) => a.margem_percentual - b.margem_percentual);
  const sem = mrg.lista.filter((p) => p.custo_visivel && p.custo === null);
  $('mrgN').textContent = baixo.length || '';
  const resta = mrg.total - mrg.lista.length;
  alvo.innerHTML = (mrg.semAcesso ? '<div class="rv-aviso" style="margin:16px 18px 0">Seu usuário do G360 não tem acesso a custo e margem (permissão 01110). Peça a liberação no G360.</div>' : '')
    + `<div style="padding:16px 18px 0" class="mgsum"><div class="stat bad"><b>${baixo.length}</b><span>Abaixo de ${esc(String(lim))}%</span></div><div class="stat"><b>${mrg.lista.length}</b><span>Preços verificados de ${mrg.total}</span></div><div class="stat"><b>${sem.length}</b><span>Sem custo</span></div></div>`
    + (baixo.length ? `<div class="mrow h"><div></div><div>Produto</div><div>Origem do preço</div><div style="text-align:right">Preço</div><div style="text-align:right">Custo</div><div style="text-align:right">Margem</div><div></div></div>`
      + baixo.map((p) => `<div class="mrow" data-id="${Number(p.id)}" data-nome="${esc(p.nome)}" data-cod="${esc(p.codigo)}"><div class="g360-mini" data-foto="${Number(p.id)}"><span>…</span></div>
        <div class="nm">${esc(p.nome)}<small>Cód. ${esc(p.codigo)}</small></div><div class="src">${esc(p.origem_preco || 'tabela')}</div>
        <div class="num">${esc(dinheiro(p.preco))}</div><div class="num">R$ ${esc(numeroPainel(p.custo, 2))}</div><div class="mg bad">${esc(numeroPainel(p.margem_percentual, 1))}%</div>
        <button class="tool ab" data-cg>❄ Congelar</button></div>`).join('')
      : vazio(mrg.lista.length ? `✓ Nenhum preço verificado abaixo de ${esc(String(lim))}% de margem bruta.` : 'Clique em "Verificar" para conferir as margens dos produtos.'))
    + (sem.length ? `<div style="padding:12px 18px;font-size:12px;color:var(--tx3)">Sem custo cadastrado: ${sem.map((p) => esc(p.codigo)).join(', ')}</div>` : '')
    + (resta > 0 || !mrg.carregado ? `<div style="padding:12px 18px 18px"><button class="btn sec" id="mgMais">${mrg.carregado ? `Verificar mais ${Math.min(50, resta)} produtos (faltam ${resta})` : 'Verificar os primeiros 50 produtos'}</button>
        <span class="hint" style="margin-left:8px">A verificação vai de 50 em 50 para não pesar no G360.</span></div>` : '');
  $('mgMais')?.addEventListener('click', () => desenharMargens(true));
  alvo.querySelectorAll('.mrow [data-cg]').forEach((b) => b.addEventListener('click', () => {
    const r = b.closest('.mrow'); aba = 'cong'; cong.produto = { id: Number(r.dataset.id), rotulo: `${r.dataset.cod} · ${r.dataset.nome}` }; desenharAba();
  }));
  carregarMiniaturas(alvo);
}

/* ---------------- Condições de pagamento no portal ---------------- */

/** Caixinhas das condições de pagamento: comprador 0 = vale para todos (Configurações); código = só este cliente (ficha).
 *  A lista vem das condições que o G360 já liberou e que apareceram no fechamento do pedido dos clientes. */
async function painelCondicoes(alvo, comprador = 0) {
  if (!alvo) return;
  alvo.innerHTML = '<div class="hint" style="margin:0">Carregando as condições…</div>';
  let d;
  try { d = (await painel('condicoes_ler', comprador ? { comprador } : {})).dados; }
  catch (e) { alvo.innerHTML = `<div class="okmsg bad">${esc(e.message)}</div>`; return; }
  const todos = new Set(d.ocultas_todos.map(Number));
  const doCliente = new Set(d.ocultas_cliente.map(Number));
  if (!d.condicoes.length) {
    alvo.innerHTML = `<div class="hint" style="margin:0">${comprador
      ? 'Ainda não sabemos quais condições o G360 libera para este cliente. A lista aparece aqui depois que ele abrir o fechamento do pedido no portal pela primeira vez.'
      : 'A lista aparece aqui depois que algum cliente abrir o fechamento do pedido no portal. O G360 não informa as condições para o painel.'}</div>`;
    return;
  }
  const dt = (t) => new Date(t).toLocaleDateString('pt-BR');
  alvo.innerHTML = `<div style="display:grid;gap:6px">${d.condicoes.map((c) => {
      if (sempreBloqueada(c)) return `<label class="hint" style="display:flex;gap:8px;align-items:center;margin:0">
        <input type="checkbox" disabled style="width:18px;height:18px"><span><b style="color:var(--tx)">${esc(c.descricao)}</b> <span style="color:var(--tx3)">· cód. ${c.id} · sempre bloqueada no portal, para todos os clientes</span></span></label>`;
      const geral = todos.has(c.id);
      const marcado = comprador ? !geral && !doCliente.has(c.id) : !geral;
      return `<label class="hint" style="display:flex;gap:8px;align-items:center;margin:0;cursor:${geral && comprador ? 'default' : 'pointer'}">
        <input type="checkbox" data-cond="${c.id}" ${marcado ? 'checked' : ''} ${geral && comprador ? 'disabled' : ''} style="width:18px;height:18px;accent-color:var(--lima)">
        <span><b style="color:var(--tx)">${esc(c.descricao)}</b> <span style="color:var(--tx3)">· cód. ${c.id}${comprador ? ` · liberada pelo G360 (visto em ${esc(dt(c.visto_em))})` : ` · liberada para ${c.clientes} cliente${c.clientes === 1 ? '' : 's'}`}${geral && comprador ? ' · escondida para todos em Configurações' : ''}</span></span></label>`;
    }).join('')}</div>
    <div class="row" style="margin-top:10px;align-items:center"><button class="btn pri" type="button" data-cond-salvar>Salvar formas de pagamento</button><span class="hint" data-cond-res style="margin:0 0 0 10px" aria-live="polite"></span></div>
    <div class="hint" style="margin:6px 0 0">Desmarcada = o cliente não vê essa opção no portal. Se todas ficarem desmarcadas, ele não consegue fechar o pedido e o portal pede para falar com o vendedor.</div>`;
  alvo.querySelector('[data-cond-salvar]').onclick = async (ev) => {
    const b = ev.currentTarget; const res = alvo.querySelector('[data-cond-res]');
    const ocultas = [...alvo.querySelectorAll('[data-cond]')].filter((i) => !i.checked && !i.disabled).map((i) => Number(i.dataset.cond));
    b.disabled = true;
    try { await painel('condicoes_salvar', { comprador, condicoes: ocultas }); res.textContent = 'Salvo ✓ — vale no próximo fechamento de pedido'; }
    catch (e) { res.textContent = e.message; } finally { b.disabled = false; }
  };
}

/* ---------------- Configurações: categorias do portal ---------------- */

async function desenharConfig() {
  const alvo = $('cfgPanel');
  alvo.innerHTML = carregandoHtml('Carregando categorias…');
  await Promise.all([carregarExibicao(), carregarVendedores(true), carregarConfigLoja(true)]);
  let lista = categorias().map((c) => ({ de: c, para: c }));
  const pintar = () => {
    alvo.innerHTML = `<div class="ci2" style="display:block"><b>Categorias do catálogo</b><small>Definidas pela Souza Ribeiro (não vêm do G360). A ordem aqui é a ordem dos botões no catálogo. Para pôr um produto numa categoria, use a aba Produtos.</small>
      <div id="cfCats" style="margin-top:10px;display:grid;gap:6px">${lista.map((c, i) => `<div class="fxurl" data-i="${i}" style="margin:0">
        <input value="${esc(c.para)}" maxlength="40" aria-label="Nome da categoria"><button class="tool" data-up ${i ? '' : 'disabled'} aria-label="Subir">↑</button><button class="tool" data-dn ${i < lista.length - 1 ? '' : 'disabled'} aria-label="Descer">↓</button><button class="tool" data-rm style="color:#ff8a8a" aria-label="Remover">×</button></div>`).join('')}</div>
      <div class="fxurl" style="margin-top:10px"><input id="cfNova" maxlength="40" placeholder="Nova categoria (ex.: Hotelaria)"><button class="btn sec" id="cfAdd">Adicionar</button></div>
      <div class="row" style="margin-top:12px"><button class="btn pri" id="cfSalvar">Salvar categorias</button><span class="hint" id="cfRes" style="margin:0 0 0 10px"></span></div></div>
      <div class="ci2" style="display:block"><b>Sinônimos da busca</b><small>Uma linha por palavra: o que o cliente digita = como o produto aparece no cadastro (separe vários com vírgula). Vale nos dois sentidos.<br>Ex.: <code>durex = fita adesiva</code> · <code>papel de mão = papel toalha</code> · <code>bombril = palha de aço, lã de aço</code></small>
        <textarea id="cfSin" rows="12" class="inp" style="width:100%;margin-top:10px;font-family:var(--mono);font-size:12.5px" spellcheck="false">${esc(sinonimosPortal().map((x) => `${x.termo} = ${x.equivalentes.join(', ')}`).join('\n'))}</textarea>
        <div class="row" style="margin-top:10px"><button class="btn pri" id="cfSinSalvar">Salvar sinônimos</button><span class="hint" id="cfSinRes" style="margin:0 0 0 10px"></span></div></div>
      <div class="ci2" style="display:block"><b>Vendedores</b><small>Um por linha. Aparecem no cadastro do cliente em "Vendedor responsável" e em "Como conheceu a Souza Ribeiro?".</small>
        <textarea id="cfVend" rows="5" class="inp" style="width:100%;margin-top:10px" spellcheck="false">${esc((vendedores || []).join('\n'))}</textarea>
        <div class="row" style="margin-top:10px"><button class="btn pri" id="cfVendSalvar">Salvar vendedores</button><span class="hint" id="cfVendRes" style="margin:0 0 0 10px"></span></div></div>
      <div class="ci2" style="display:block"><b>Catálogo e margem</b>
        <label class="hint" style="display:flex;gap:8px;align-items:center;margin:10px 0 0;cursor:pointer"><input type="checkbox" id="cfEst" ${cfgLoja?.so_estoque ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--lima)"> Mostrar só produtos com estoque também na busca <span style="color:var(--tx3)">(a página inicial já mostra só os com estoque)</span></label>
        <div class="row" style="margin-top:10px;align-items:center;gap:8px"><span class="hint" style="margin:0">Mostrar só produtos com mais de</span><div class="pin" style="width:110px"><input id="cfEstMin" inputmode="decimal" value="${esc(String(Number(cfgLoja?.estoque_minimo) || 0).replace('.', ','))}" style="text-align:right"><span>un.</span></div><span class="hint" style="margin:0">disponíveis (0 = todos com estoque). Vale no catálogo e na busca, quando o G360 manda a quantidade.</span></div>
        <div class="row" style="margin-top:10px;align-items:center;gap:8px"><span class="hint" style="margin:0">Margem mínima para alerta</span><div class="pin" style="width:110px"><input id="cfMg" inputmode="decimal" value="${esc(String(limiteMargem()).replace('.', ','))}" style="text-align:right"><span>%</span></div>
          <button class="btn pri" id="cfCatSalvar">Salvar</button><span class="hint" id="cfCatRes" style="margin:0 0 0 6px"></span></div>
        <small class="hint" style="display:block;margin:6px 0 0">A margem mínima vale para toda a equipe: alertas em Produtos, Margens e Negociações.</small></div>
      <div class="ci2" style="display:block"><b>Formas de pagamento no portal (todos os clientes)</b><small>O G360 decide quais condições cada cliente pode usar. Aqui você esconde do portal as que não quer oferecer. Para um cliente só, use a ficha dele em Clientes.</small>
        <div id="cfCond" style="margin-top:10px"></div></div>`;
    painelCondicoes($('cfCond'), 0);
    alvo.querySelectorAll('#cfCats input').forEach((inp) => inp.addEventListener('input', () => { lista[Number(inp.parentElement.dataset.i)].para = inp.value; }));
    alvo.querySelectorAll('#cfCats button').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.parentElement.dataset.i);
      if (b.hasAttribute('data-up')) [lista[i - 1], lista[i]] = [lista[i], lista[i - 1]];
      if (b.hasAttribute('data-dn')) [lista[i + 1], lista[i]] = [lista[i], lista[i + 1]];
      if (b.hasAttribute('data-rm')) lista.splice(i, 1);
      pintar();
    }));
    $('cfSinSalvar').onclick = async () => {
      const linhas = $('cfSin').value.split('\n').map((l) => l.trim()).filter(Boolean);
      const ruins = linhas.filter((l) => !/^[^=]{1,60}=\s*\S/.test(l));
      if (ruins.length) { $('cfSinRes').textContent = `Linha sem "=": ${ruins[0].slice(0, 40)}`; return; }
      const lista = linhas.map((l) => { const [t, ...r] = l.split('='); return { termo: t.trim(), equivalentes: r.join('=').split(',').map((x) => x.trim()).filter(Boolean) }; });
      $('cfSinSalvar').disabled = true;
      try { const r = await painel('sinonimos_salvar', { sinonimos: lista }); await carregarExibicao(true); $('cfSinRes').textContent = `${r.gravados} sinônimos salvos ✓ — a busca já usa`; toast('Sinônimos salvos ✓'); }
      catch (e) { $('cfSinRes').textContent = e.message; } finally { $('cfSinSalvar').disabled = false; }
    };
    $('cfCatSalvar').onclick = async () => {
      const m = Number($('cfMg').value.replace(',', '.'));
      if (!(m >= 0 && m <= 100)) { $('cfCatRes').textContent = 'Margem entre 0 e 100%.'; return; }
      const em = Number($('cfEstMin').value.replace(',', '.'));
      if (!(em >= 0 && em <= 100000)) { $('cfCatRes').textContent = 'Estoque mínimo inválido.'; return; }
      $('cfCatSalvar').disabled = true;
      try { cfgLoja = (await painel('config_salvar', { so_estoque: $('cfEst').checked, margem_minima: m, estoque_minimo: em })).dados; limiteMem = Number(cfgLoja.margem_minima); $('cfCatRes').textContent = 'Salvo ✓ — vale para o portal na próxima abertura'; }
      catch (e) { $('cfCatRes').textContent = e.message; } finally { $('cfCatSalvar').disabled = false; }
    };
    $('cfVendSalvar').onclick = async () => {
      const nomes = $('cfVend').value.split('\n').map((l) => l.trim()).filter(Boolean);
      $('cfVendSalvar').disabled = true;
      try { vendedores = (await painel('vendedores_salvar', { vendedores: nomes })).dados; $('cfVendRes').textContent = `${vendedores.length} vendedor${vendedores.length === 1 ? '' : 'es'} salvo${vendedores.length === 1 ? '' : 's'} ✓`; }
      catch (e) { $('cfVendRes').textContent = e.message; } finally { $('cfVendSalvar').disabled = false; }
    };
    $('cfAdd').onclick = () => { const v = $('cfNova').value.trim(); if (v) { lista.push({ de: null, para: v }); pintar(); } };
    $('cfSalvar').onclick = async () => {
      const nomes = lista.map((c) => c.para.trim()).filter(Boolean);
      if (new Set(nomes).size !== nomes.length) { $('cfRes').textContent = 'Há categorias com o mesmo nome.'; return; }
      $('cfSalvar').disabled = true;
      try {
        await painel('categorias_salvar', { categorias: nomes, renomear: lista.filter((c) => c.de && c.de !== c.para.trim()).map((c) => ({ de: c.de, para: c.para.trim() })) });
        definirCategoriasLocal(nomes); await carregarExibicao(true);
        lista = nomes.map((c) => ({ de: c, para: c })); pintar(); toast('Categorias salvas ✓');
      } catch (e) { $('cfRes').textContent = e.message; $('cfSalvar').disabled = false; }
    };
  };
  pintar();
}

/* ---------------- Escola do Souzinha (mesma tela do portal antigo) ---------------- */

const MODELOS = {
  academia: ['Academia ou estúdio de treino', 'segmento', 'Quando o cliente tiver academia ou estúdio, pergunte se tem banheiros, vestiários e o fluxo de alunos. Ofereça por finalidade: papel toalha, sabonete líquido, papel higiênico, sacos de lixo, desinfetante e copos, escolhendo produtos reais do catálogo. Não indique químicos para aparelhos sem verificar instruções dos fabricantes.'],
  clinica: ['Clínicas e consultórios', 'segmento', 'Pergunte quais áreas precisam de reposição. Apresente papel toalha, sabonete líquido, papel higiênico e itens de limpeza compatíveis. Nunca garanta eficácia hospitalar ou de desinfecção sem rótulo e indicação específica.'],
  restaurante: ['Restaurantes e lanchonetes', 'segmento', 'Pergunte se a operação atende salão, delivery ou ambos. Sugira embalagens adequadas, guardanapos, copos descartáveis e materiais de limpeza do catálogo. Confirme capacidade e dimensões antes de indicar embalagens.'],
  escritorio: ['Escritórios', 'segmento', 'Pergunte quantos colaboradores usam os banheiros e copa. Sugira papel higiênico, papel toalha, sabonete líquido, copos, sacos de lixo e produtos de limpeza encontrados no catálogo.'],
};
let escola = { linhas: [], editando: null };

async function desenharEscola() {
  const root = $('souzinhaEscola');
  if (!$('szSalvar')) {
    root.innerHTML = `<div class="sz-school-head"><div><h3>🎓 Escola do Souzinha</h3><p>Ensine o Souzinha a atender, sugerir produtos e montar listas por segmento. Cada orientação ativa é usada nas próximas conversas.</p></div><button class="tool" id="szReload">↻ Atualizar</button></div>
      <div class="sz-school-grid"><section class="panel sz-school-form">
        <h3 id="szFormTitle">Novo ensinamento</h3><p class="hint">Escreva como se estivesse treinando um vendedor da Souza Ribeiro.</p>
        <label>Exemplo (opcional)</label><select id="szTemplate" class="inp"><option value="">Escrever meu ensinamento</option><option value="academia">Academia</option><option value="clinica">Clínica</option><option value="restaurante">Restaurante</option><option value="escritorio">Escritório</option></select>
        <label>Assunto</label><input class="inp" id="szTitulo" maxlength="100" placeholder="Ex.: Produtos para academias">
        <label>Tipo de conhecimento</label><select id="szCategoria" class="inp"><option value="segmento">Segmento de cliente</option><option value="produto">Conhecimento de produto</option><option value="atendimento">Como atender</option><option value="geral">Geral</option></select>
        <label>O que ele deve aprender?</label><textarea class="inp" id="szConteudo" rows="8" maxlength="3000" placeholder="Quando o cliente disser..., o Souzinha deve..." style="resize:vertical;min-height:150px;width:100%"></textarea>
        <label class="sz-check"><input type="checkbox" id="szAtivo" checked> Ativo nos próximos atendimentos</label>
        <p class="hint">Nunca ensine senhas, preços de custo, dados pessoais ou informações sigilosas.</p>
        <div class="row"><button class="btn pri" id="szSalvar">💾 Salvar ensinamento</button><button class="btn sec" id="szCancelar">Limpar</button></div>
        <p id="szStatus" role="status" aria-live="polite"></p>
      </section><section class="panel sz-school-saved"><div class="sz-school-list-head"><h3>Ensinamentos</h3><span id="szCount"></span></div><div id="szSchoolList" aria-live="polite"></div></section></div>`;
    const limpar = () => { escola.editando = null; $('szFormTitle').textContent = 'Novo ensinamento'; $('szTemplate').value = ''; $('szTitulo').value = ''; $('szConteudo').value = ''; $('szCategoria').value = 'segmento'; $('szAtivo').checked = true; };
    const status = (t, ruim) => { $('szStatus').textContent = t; $('szStatus').style.color = ruim ? '#ff9999' : '#b2e04a'; };
    const salvar = async (x) => {
      $('szSalvar').disabled = true;
      try { await painel('ensinos_salvar', x); limpar(); status('✓ Salvo! O Souzinha usa a orientação nas próximas conversas.'); await desenharEscola(); }
      catch (e) { status(e.message, true); } finally { $('szSalvar').disabled = false; }
    };
    $('szTemplate').onchange = () => { const m = MODELOS[$('szTemplate').value]; if (m) { $('szTitulo').value = m[0]; $('szCategoria').value = m[1]; $('szConteudo').value = m[2]; } };
    $('szCancelar').onclick = () => { limpar(); status(''); };
    $('szReload').onclick = () => desenharEscola();
    $('szSalvar').onclick = () => {
      const x = { id: escola.editando, categoria: $('szCategoria').value, titulo: $('szTitulo').value.trim(), conteudo: $('szConteudo').value.trim(), ativo: $('szAtivo').checked };
      if (x.titulo.length < 3 || x.conteudo.length < 10) { status('Preencha assunto e orientação (mínimo 10 caracteres).', true); return; }
      salvar(x);
    };
    $('szSchoolList').onclick = async (e) => {
      const b = e.target.closest('[data-school]'); if (!b) return;
      const x = escola.linhas.find((v) => v.id === b.dataset.id); if (!x) return;
      if (b.dataset.school === 'edit') {
        escola.editando = x.id; $('szFormTitle').textContent = 'Editar ensinamento'; $('szTitulo').value = x.titulo; $('szConteudo').value = x.conteudo; $('szCategoria').value = x.categoria; $('szAtivo').checked = x.ativo;
        root.querySelector('.sz-school-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return;
      }
      if (b.dataset.school === 'toggle') { salvar({ ...x, ativo: !x.ativo }); return; }
      if (b.dataset.school === 'remove') {
        if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = 'Confirmar exclusão'; return; }
        try { await painel('ensinos_apagar', { id: x.id }); await desenharEscola(); } catch (err) { status(err.message, true); }
      }
    };
  }
  $('szSchoolList').textContent = 'Carregando…';
  try { escola.linhas = (await painel('ensinos_listar')).dados || []; } catch (e) { $('szSchoolList').textContent = e.message; return; }
  $('szCount').textContent = `${escola.linhas.filter((x) => x.ativo).length} ativos / ${escola.linhas.length} no total`;
  $('szSchoolList').innerHTML = escola.linhas.length ? escola.linhas.map((x) => `<article class="sz-school-item"><div class="sz-school-item-top"><b>${esc(x.titulo)}</b><span class="sz-school-pill${x.ativo ? '' : ' off'}">${x.ativo ? 'Ativo' : 'Pausado'}</span></div>
    <small>${esc(x.categoria)}</small><p>${esc(x.conteudo)}</p><div class="row">
    <button class="tool" data-school="edit" data-id="${esc(x.id)}">Editar</button><button class="tool" data-school="toggle" data-id="${esc(x.id)}">${x.ativo ? 'Desativar' : 'Ativar'}</button><button class="tool" data-school="remove" data-id="${esc(x.id)}">Excluir</button></div></article>`).join('')
    : '<p class="hint">Nenhum ensinamento salvo ainda.</p>';
}

/* ---------------- Inteligência: desempenho do portal ---------------- */

let intelLigado = false;
async function desenharInteligencia() {
  const alvo = $('intelPanel');
  if (!intelLigado) {
    intelLigado = true;
    $('intelPeriodo').innerHTML = '<option value="7">Últimos 7 dias</option><option value="30" selected>Últimos 30 dias</option><option value="90">Últimos 90 dias</option>';
    $('intelPeriodo').onchange = desenharInteligencia; $('intelAtualizar').onclick = desenharInteligencia;
  }
  alvo.innerHTML = `<div class="panel">${carregandoHtml('Calculando…')}</div>`;
  let d;
  try { d = (await painel('inteligencia', { dias: Number($('intelPeriodo').value) })).dados; } catch (e) { alvo.innerHTML = `<div class="panel">${vazio(esc(e.message))}</div>`; return; }
  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const tab = (titulo, cab, linhas, vaziaTxt) => `<div class="panel" style="margin-top:14px"><div style="padding:14px 18px 6px"><b>${titulo}</b></div>
    ${linhas.length ? `<div class="mrow h" style="grid-template-columns:${cab.map((c) => c[1]).join(' ')}">${cab.map((c) => `<div>${c[0]}</div>`).join('')}</div>${linhas.join('')}` : vazio(vaziaTxt)}</div>`;
  const linha = (cols, tam) => `<div class="mrow" style="grid-template-columns:${tam}">${cols.map((c) => `<div class="sm">${c}</div>`).join('')}</div>`;
  const maxDia = Math.max(1, ...d.por_dia.map((x) => x.valor));
  alvo.innerHTML = `<div class="panel"><div style="padding:16px 18px" class="mgsum">
      <div class="stat"><b>${esc(brl(d.valor))}</b><span>Vendido pelo portal</span></div>
      <div class="stat"><b>${d.pedidos}</b><span>Pedidos</span></div>
      <div class="stat"><b>${esc(brl(d.ticket))}</b><span>Ticket médio</span></div>
      <div class="stat"><b>${d.clientes_compraram}</b><span>Clientes que compraram</span></div>
      <div class="stat"><b>${d.clientes_entraram}</b><span>Clientes que entraram</span></div>
      <div class="stat"><b>${d.buscas}</b><span>Buscas</span></div>
      <div class="stat ${d.buscas_sem_resultado ? 'bad' : ''}"><b>${d.buscas_sem_resultado}</b><span>Buscas sem resultado</span></div></div>
      ${d.por_dia.length ? `<div style="padding:0 18px 16px"><div class="hint" style="margin:0 0 6px">Vendas por dia</div><div style="display:flex;align-items:flex-end;gap:4px;height:90px">${d.por_dia.map((x) => `<div title="${esc(x.dia.split('-').reverse().join('/'))}: ${esc(brl(x.valor))} · ${x.pedidos} pedido(s)" style="flex:1;min-width:6px;background:var(--lima);border-radius:4px 4px 0 0;height:${Math.max(4, Math.round((x.valor / maxDia) * 86))}px"></div>`).join('')}</div></div>` : ''}
      <div class="hint" style="padding:0 18px 14px">Os números contam a partir de 17/11/2026, quando o portal passou a registrar. Valores como o G360 devolveu em cada pedido.</div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:0 14px">
    ${tab('Buscas mais feitas', [['Busca', '1fr'], ['Vezes', '70px']], d.top_buscas.map((b) => linha([esc(b.termo), b.vezes], '1fr 70px')), 'Nenhuma busca no período.')}
    ${tab('Buscas sem resultado <small class="hint" style="margin:0">— cadastre sinônimo ou produto</small>', [['Busca', '1fr'], ['Vezes', '70px']], d.sem_resultado.map((b) => linha([esc(b.termo), b.vezes], '1fr 70px')), 'Nenhuma busca ficou sem resultado. 👏')}
    ${tab('Produtos mais vendidos', [['Produto', '1fr'], ['Pedidos', '70px'], ['Total', '110px']], d.top_produtos.map((p) => linha([`${esc(p.nome)}<br><small>Cód. ${esc(p.codigo)}</small>`, p.pedidos, esc(brl(p.total))], '1fr 70px 110px')), 'Nenhum pedido no período.')}
    ${tab('Clientes que mais compraram', [['Cliente', '1fr'], ['Pedidos', '70px'], ['Total', '110px']], d.top_clientes.map((c) => linha([`${esc(c.nome || '—')}<br><small>Cód. ${esc(c.codigo)}</small>`, c.pedidos, esc(brl(c.total))], '1fr 70px 110px')), 'Nenhum pedido no período.')}
    </div>
    ${tab('Últimos pedidos', [['Quando', '150px'], ['Cliente', '1fr'], ['Número', '110px'], ['Valor', '110px']], d.ultimos_pedidos.map((p) => linha([esc(new Date(p.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })), esc(p.cliente), esc(p.numero || 'aguardando aprovação'), esc(brl(p.valor))], '150px 1fr 110px 110px')), 'Nenhum pedido no período.')}`;
}

/* ---------------- Ocorrências ---------------- */

function desenharOcorrencias() {
  const alvo = $('ocPanel');
  listar();
  async function listar() {
    alvo.innerHTML = carregandoHtml('Carregando ocorrências…');
    let data;
    try { data = (await painel('ocorrencias_listar')).dados || []; }
    catch (e) { alvo.innerHTML = vazio(esc(e.message)); return; }
    alvo.innerHTML = `<div style="padding:14px 18px 0" class="row"><button class="tool" id="ocAt">↻ Atualizar</button></div>`
      + (data.length ? `<div class="mrow h" style="grid-template-columns:150px 1fr 1fr 90px 1.2fr"><div>Quando</div><div>Código</div><div>Operação</div><div>Cliente</div><div>Código para o suporte</div></div>`
        + data.map((o) => `<div class="mrow" style="grid-template-columns:150px 1fr 1fr 90px 1.2fr"><div class="sm">${esc(new Date(o.registrada_em).toLocaleString('pt-BR'))}</div><div><b>${esc(o.codigo)}</b></div>
          <div class="sm">${esc(o.operacao)}</div><div class="sm">${esc(o.comprador_codigo ?? '—')}</div><div class="sm" style="font-family:monospace;font-size:11px;word-break:break-all">${esc(o.request_id)}</div></div>`).join('')
        : vazio('Nenhuma ocorrência registrada.'));
    $('ocAt').onclick = listar;
  }
}

/* Clips enviados antes do "início rápido": baixa cada vídeo, põe o índice no começo e envia de novo
   (novo arquivo + novo registro; o antigo é apagado). Vídeo que já está certo fica como está. */
async function otimizarClipsEnviados() {
  const b = $('aOtimClips'); if (b.disabled) return;
  b.disabled = true; const txt = b.textContent;
  const base = `${String(import.meta.env.VITE_SUPABASE_URL || '').trim()}/storage/v1/object/public/portal-clips/`;
  let feitos = 0; let certos = 0; let falhas = 0;
  try {
    const { inicioRapido } = await import('./mp4rapido.js');
    const todos = (await painel('clips_listar')).dados || [];
    for (const [i, c] of todos.entries()) {
      b.textContent = `Otimizando ${i + 1} de ${todos.length}…`;
      try {
        if (!/\.(mp4|mov)$/i.test(c.caminho)) { certos++; continue; }
        const r = await fetch(base + c.caminho.split('/').map(encodeURIComponent).join('/'), { credentials: 'omit' });
        if (!r.ok) throw new Error('download');
        const novo = inicioRapido(await r.arrayBuffer());
        if (!novo) { certos++; continue; }
        const tipo = /\.mov$/i.test(c.caminho) ? 'video/quicktime' : 'video/mp4';
        const up = (await painel('clip_upload_url', { tipo, tamanho: novo.byteLength })).dados;
        const { error } = await supabaseComprador().storage.from('portal-clips').uploadToSignedUrl(up.caminho, up.token, new Blob([novo], { type: tipo }), { contentType: tipo, cacheControl: '31536000' });
        if (error) throw error;
        const criado = (await painel('clip_salvar', { produto_id: Number(c.produto_id), codigo: String(c.codigo || ''), caminho: up.caminho, titulo: c.titulo || '' })).dados;
        if (c.ativo === false && criado?.id) await painel('clip_salvar', { id: criado.id, ativo: false }); // continua desligado
        await painel('clip_apagar', { id: c.id });
        feitos++;
      } catch (e) { if (e?.status === 401) return; falhas++; }
    }
    clipsAdm = null;
    toast(`Clips: ${feitos} otimizado${feitos === 1 ? '' : 's'}${certos ? `, ${certos} já estava${certos === 1 ? '' : 'm'} certo${certos === 1 ? '' : 's'}` : ''}${falhas ? `, ${falhas} com erro (tente de novo)` : ''} ✓`);
  } catch (e) { toast(e.message || 'Não foi possível otimizar agora. Tente de novo.'); }
  finally { b.disabled = false; b.textContent = txt; }
}
