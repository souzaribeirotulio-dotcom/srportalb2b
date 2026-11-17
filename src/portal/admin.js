/* =====================================================================
   Painel do administrador no layout original (parte 1 da volta do portal antigo).
   Duas sessões, separadas das do comprador:
   - API do G360: POST operadores/sessoes; token só em memória; 401 encerra só o painel.
   - Cadastros e Ocorrências (Supabase) pela função painel-g360, com o mesmo
     token do G360: não existe conta separada do painel.
   Preço, custo e margem vêm da API; nada é calculado aqui.
   ===================================================================== */
import {
  entrarOperador, sairOperador, consultarClienteOperador, buscarProdutosOperador, consultarPrecosOperador,
  listarPrecosCongelados, incluirPrecoCongelado, alterarPrecoCongelado, encerrarPrecoCongelado,
  listarFotosOperador, obterFotoOperador, incluirFotoOperador, definirCapaOperador, ordenarFotosOperador, removerFotoOperador,
} from '../api/g360.js';
import { chamarPainel } from '../api/painel.js';
import { definirEncerramentoOperador, definirAtividadeOperador } from '../estado/sessao.js';
import { mostrarMensagemErro } from '../ui/mensagem.js';
import { dinheiro, numeroPainel, dataBr } from '../ui/formato.js';
import { $, esc, toast, abrirModal, fecharModal, adiar } from './comum.js';
import { carregarExibicao, sinonimos as sinonimosPortal, categorias, registro, nomeExibicao, categoriaExibicao, codigosDaCategoria, aplicarLocal, definirCategoriasLocal } from '../catalogo/exibicao.js';
import { nomeEcommerce, categoriaPeloNome } from '../catalogo/nomes.js';

const op = { token: null, expira: 0, ultima: 0, minutos: 8, aviso: null };
let ctx = null;            // { loja, ir }
let relogio = null;
let aba = 'cli';
let ligado = false;
let urls = [];             // object URLs das fotos da tela (liberadas ao sair)
const capas = new Map();   // id → url da capa | null (sem foto) — cache da sessão do painel

function liberarFotos() { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; capas.clear(); }

function encerrarOperador(mensagem) {
  op.token = null; op.expira = 0; op.aviso = mensagem || null;
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
  $('aSt').innerHTML = '<option value="">Todos os produtos</option><option value="auto">Nome automático (revisar)</option><option value="semcat">Sem categoria definida</option><option value="baixa">Margem abaixo do mínimo</option><option value="semcusto">Sem custo cadastrado</option>';
  $('aCat').innerHTML = '<option value="">Todas as categorias</option>';
  $('aPanel').insertAdjacentHTML('beforebegin', `<div class="afil" style="align-items:center;margin-top:-4px"><button class="btn sec" id="aGerar" style="height:36px">✨ Gerar nomes e categorias</button>
    <span class="hint" id="aGerarInfo" style="margin:0">Passa por todos os produtos do G360 e cria o nome no padrão de e-commerce e a categoria. Não mexe no que a equipe já ajustou nem nos nomes do portal antigo.</span></div>`);
  $('aGerar').addEventListener('click', gerarTudo);
  $('aPanel').addEventListener('change', salvarLinhaProduto);
  const buscarProd = adiar(() => { prod.pagina = 1; desenharProdutos(); }, 450);
  $('aQ').addEventListener('input', buscarProd);
  $('aQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); prod.pagina = 1; desenharProdutos(); } });
  $('aCat').addEventListener('change', () => { prod.pagina = 1; desenharProdutos(); });
  $('aSt').addEventListener('change', () => desenharProdutos(false));
  $('aPanel').addEventListener('click', (e) => {
    const r = e.target.closest('.arow[data-id]'); if (!r) return;
    if (e.target.closest('[data-ed]') || e.target.closest('.amini')) abrirFotos(Number(r.dataset.id), r.dataset.nome);
    if (e.target.closest('[data-cg]')) { aba = 'cong'; cong.produto = { id: Number(r.dataset.id), rotulo: `${r.dataset.cod} · ${r.dataset.nome}` }; desenharAba(); }
  });

  // Clientes
  $('clQ').placeholder = 'CNPJ do cliente (consulta no G360) ou nome/CNPJ dos cadastros…';
  $('clSt').innerHTML = '<option value="pendente">Aguardando aprovação</option><option value="aprovado">Aprovados</option><option value="recusado">Reprovados</option><option value="">Todos</option>';
  $('clNovo').textContent = 'Consultar no G360';
  $('clNovo').addEventListener('click', consultarCliente);
  $('clQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); consultarCliente(); } });
  $('clQ').addEventListener('input', adiar(() => desenharCadastros(false), 300));
  $('clSt').addEventListener('change', () => desenharCadastros());

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

const PARTE = { neg: ['Negociações', 3], souzinha: ['Escola do Souzinha', 2] };

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
  else emPreparacao(aba);
}

function emPreparacao(a) {
  const [nome, parte] = PARTE[a];
  const alvo = { intel: 'intelPanel', neg: 'negAdminView', souzinha: 'souzinhaEscola', cfg: 'cfgPanel' }[a];
  $(alvo).innerHTML = `<div class="panel">${vazio(`<b>${esc(nome)}</b><br>Esta aba volta na próxima parte da restauração do painel antigo (parte ${parte}).`)}</div>`;
}

/* ---------------- Produtos ---------------- */

const prod = { pagina: 1, lista: null, total: 0, grupos: new Map() };

async function desenharProdutos(buscar = true) {
  const alvo = $('aPanel');
  if (buscar) {
    alvo.innerHTML = carregandoHtml('Buscando produtos no G360…');
    const q = $('aQ').value.trim();
    try {
      await carregarExibicao();
      preencherGrupos();
      const cat = $('aCat').value;
      const codigos = cat ? codigosDaCategoria(cat) : null;
      if (codigos && !codigos.length) { prod.lista = []; prod.total = 0; }
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
    || (st === 'semcusto' && p.custo_visivel && p.custo === null));
  const paginas = Math.max(1, Math.ceil(prod.total / 20));
  const cats = categorias();
  alvo.innerHTML = `<div class="arow h"><div></div><div>Nome no portal (${prod.total})</div><div>Preço de tabela</div><div>Categoria</div><div>Custo</div><div></div></div>`
    + (L.length ? L.map((p) => { const r = registro(p); const cat = categoriaExibicao(p); return `<div class="arow" data-id="${Number(p.id)}" data-nome="${esc(nomeExibicao(p))}" data-cod="${esc(p.codigo)}" data-g360="${esc(p.nome)}">
      <div class="amini g360-mini" data-foto="${Number(p.id)}" title="Fotos"><span>…</span></div>
      <div class="nm"><input class="inp pnome" value="${esc(nomeExibicao(p))}" maxlength="160" aria-label="Nome no portal" style="width:100%;font-weight:600">
        <small>G360: ${esc(p.nome)} · Cód. ${esc(p.codigo)} · ${esc(p.unidade || '—')} · ${margemHtml(p)} · <span class="org">${!r ? 'nome automático (não salvo)' : r.origem === 'automatico' ? 'nome automático' : r.origem === 'legado' ? 'portal antigo' : 'ajustado pela equipe'}</span></small></div>
      <div class="num"><b>${esc(dinheiro(p.preco))}</b>${p.origem_preco ? `<small style="display:block;color:var(--tx3);font-size:11px">${esc(p.origem_preco)}</small>` : ''}</div>
      <div><select class="inp pcat" aria-label="Categoria">${cats.map((c) => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>${r?.categoria ? '' : '<small style="display:block;color:var(--tx3);font-size:11px">sugerida pelo nome</small>'}</div>
      <div class="uns">${p.custo_visivel ? (p.custo === null ? '—' : `R$ ${esc(numeroPainel(p.custo, 2))}`) : 'sem acesso'}</div>
      <div class="ab2"><button class="tool ab" data-ed>🖼 Fotos</button><button class="tool ab" data-cg>❄ Congelar</button></div></div>`; }).join('')
      : vazio('Nenhum produto encontrado. Tente outro nome ou código.'))
    + (paginas > 1 ? `<nav class="g360-pag" style="margin:14px auto"><button class="tool" id="apA" ${prod.pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button><span>Página ${prod.pagina} de ${paginas}</span><button class="tool" id="apP" ${prod.pagina >= paginas ? 'disabled' : ''}>Próxima ›</button></nav>` : '');
  $('apA')?.addEventListener('click', () => { prod.pagina -= 1; desenharProdutos(); });
  $('apP')?.addEventListener('click', () => { prod.pagina += 1; desenharProdutos(); });
  carregarMiniaturas(alvo);
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

/** Qualquer imagem vira JPEG (máx. 1600 px, até 2 MB) antes de ir para a API. */
function paraJpeg(arquivo) {
  return new Promise((ok, falha) => {
    if (arquivo.type === 'image/jpeg' && arquivo.size <= 2 * 1024 * 1024) {
      const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => falha(new Error('leitura')); r.readAsDataURL(arquivo); return;
    }
    const img = new Image(); const u = URL.createObjectURL(arquivo);
    img.onload = () => {
      URL.revokeObjectURL(u);
      let w = img.naturalWidth; let h = img.naturalHeight; const max = 1600;
      if (Math.max(w, h) > max) { const f = max / Math.max(w, h); w = Math.round(w * f); h = Math.round(h * f); }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const c2 = cv.getContext('2d'); c2.fillStyle = '#fff'; c2.fillRect(0, 0, w, h); c2.drawImage(img, 0, 0, w, h);
      for (const q of [0.88, 0.8, 0.7, 0.6, 0.5]) {
        const d = cv.toDataURL('image/jpeg', q);
        if ((d.length - 23) * 0.75 <= 2 * 1024 * 1024) { ok(d); return; }
      }
      falha(new Error('grande'));
    };
    img.onerror = () => { URL.revokeObjectURL(u); falha(new Error('formato')); };
    img.src = u;
  });
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

let clienteG360 = null;

function desenharClientes() {
  const p = $('clPanel');
  if (!$('clG360')) p.innerHTML = '<div id="clG360"></div><div id="clPortal"></div><div id="clCad"></div>';
  mostrarClienteG360();
  desenharClientesPortal();
  desenharCadastros();
}

async function consultarCliente() {
  const cnpj = $('clQ').value.trim();
  if (cnpj.replace(/[^0-9A-Za-z]/g, '').length < 11) { desenharCadastros(false); toast('Digite o CNPJ completo para consultar no G360.'); return; }
  const alvo = $('clG360');
  alvo.innerHTML = carregandoHtml('Consultando o cliente no G360…');
  try { clienteG360 = { ...(await consultarClienteOperador(op.token, cnpj)), cnpj }; mostrarClienteG360(); }
  catch (e) { clienteG360 = null; erroEm(alvo, e); }
}

function mostrarClienteG360() {
  const alvo = $('clG360');
  if (!clienteG360) { alvo.innerHTML = ''; return; }
  const c = clienteG360;
  alvo.innerHTML = `<div class="crow2 h"><div>Cliente no G360</div><div>Cód. G360</div><div>Segmento</div><div>Portal</div><div></div></div>
    <div class="crow2"><div class="nm"><b>${esc(c.nome)}</b><small>${esc(c.cnpj)}</small></div>
      <div class="sm sm2">${esc(c.codigo)}</div><div class="sm">${esc(c.segmento?.descricao || '—')}</div>
      <div class="stw"><span class="stt ${c.acesso_portal ? 'aprovado' : 'bloqueado'}">${c.acesso_portal ? 'Liberado' : 'Sem acesso'}</span></div>
      <div class="ab2"><button data-ircg>❄ Preços congelados</button></div></div>
    ${c.acesso_portal ? '' : '<div class="hint" style="padding:0 18px 12px">Para liberar, marque "Acesso à API dos sistemas externos" no cadastro do cliente no G360 (Gestão comercial).</div>'}`;
  alvo.querySelector('[data-ircg]').onclick = () => { aba = 'cong'; cong.cliente = { codigo: c.codigo, nome: c.nome, cnpj: c.cnpj }; desenharAba(); };
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
        <div class="sm">${c.pedidos ? `<b>${c.pedidos}</b> · ${esc(brl(c.valor))}` : '—'}</div><div></div></div>`).join('')
      : vazio('Nenhum cliente entrou no portal ainda.'))
    + '<div class="hint" style="padding:10px 18px">A lista mostra quem já entrou pelo menos uma vez. Quem tem acesso liberado no G360 mas nunca entrou ainda não aparece (pedido feito à Movimento).</div>';
}

/* Dados do Supabase pelo mesmo login do G360 (função painel-g360). 401 encerra o painel. */
async function painel(acao, dados) {
  try { return await chamarPainel(op.token, acao, dados); }
  catch (e) { if (e.status === 401) encerrarOperador(e.message); throw e; }
}

const SIT = { pendente: 'Aguardando', aprovado: 'Aprovado', recusado: 'Reprovado' };
let cadastros = null;

function desenharCadastros(recarregar = true) {
  const alvo = $('clCad'); if (!alvo) return;
  if (!recarregar && cadastros) { pintarCadastros(); return; }
  listar();
  async function listar() {
    alvo.innerHTML = carregandoHtml('Carregando cadastros…');
    try { cadastros = (await painel('cadastros_listar')).dados || []; }
    catch (e) { alvo.innerHTML = vazio(esc(e.message)); return; }
    pintarCadastros();
  }
  function pintarCadastros() {
    const st = $('clSt').value; const q = $('clQ').value.trim().toLowerCase();
    const L = cadastros.filter((k) => (!st || k.status === st) && (!q || [k.razao_social, k.fantasia, k.documento, k.cidade].join(' ').toLowerCase().includes(q)));
    $('cliN').textContent = cadastros.filter((k) => k.status === 'pendente').length || '';
    alvo.innerHTML = `<div class="crow2 h"><div>Cadastros pelo portal (${L.length})</div><div>Responsável</div><div>Cidade</div><div>Situação</div><div></div></div>`
      + (L.length ? L.map((k) => `<div class="crow2" data-id="${esc(k.id)}">
        <div class="nm"><b>${esc(k.fantasia || k.razao_social)}</b><small>${esc(k.documento)} · ${esc(k.razao_social)}</small>
          <small>IE: ${esc(k.inscricao_estadual || 'não informada')} · ${esc(k.email)}</small>
          <small>${esc(k.origem || '')}${k.whats ? ` · WhatsApp ${esc(k.whats)}` : ''}${k.telefone ? ` · ${esc(k.telefone)}` : ''} · enviado em ${esc(new Date(k.criado_em).toLocaleString('pt-BR'))}</small>
          <small>${esc([k.logradouro, k.numero, k.complemento].filter(Boolean).join(', '))} — ${esc(k.bairro || '')} · CEP ${esc(k.cep || '')}</small>
          ${k.observacao_equipe ? `<small>Obs.: ${esc(k.observacao_equipe)}</small>` : ''}${k.decidido_por ? `<small>Decidido por ${esc(k.decidido_por)}</small>` : ''}</div>
        <div class="sm sm2">${esc(k.responsavel)}</div><div class="sm">${esc(k.cidade || '')}${k.uf ? `/${esc(k.uf)}` : ''}</div>
        <div class="stw"><span class="stt ${k.status === 'recusado' ? 'reprovado' : esc(k.status)}">${SIT[k.status] || esc(k.status)}</span></div>
        <div class="ab2">${k.status !== 'aprovado' ? '<button class="ap" data-d="aprovado">Aprovar</button>' : ''}${k.status !== 'recusado' ? '<button class="rp" data-d="recusado">Reprovar</button>' : ''}${k.status !== 'pendente' ? '<button data-d="pendente">Voltar p/ análise</button>' : ''}<button data-obs>Observação</button></div></div>`).join('')
        : vazio('Nenhum cadastro nesta situação. Os pedidos feitos em "Quero ser cliente" aparecem aqui.'))
      + '<div class="hint" style="padding:10px 18px">Depois de aprovar, cadastre a empresa no G360 e marque "Acesso à API dos sistemas externos" em Gestão comercial. Aí ela usa "Primeiro acesso" no portal para criar a senha.</div>';
    alvo.querySelectorAll('.crow2[data-id] button').forEach((b) => b.addEventListener('click', async () => {
      const r = b.closest('.crow2'); const k = cadastros.find((x) => String(x.id) === r.dataset.id);
      let obs = k.observacao_equipe || '';
      if (b.dataset.obs !== undefined) {
        // Observação: campo na própria linha, gravado com a situação atual.
        if (r.querySelector('.kobs')) return;
        r.querySelector('.nm').insertAdjacentHTML('beforeend', `<div class="kobs fxurl" style="margin-top:6px"><input maxlength="500" value="${esc(obs)}" placeholder="Observação da equipe"><button class="btn sec" type="button">Salvar</button></div>`);
        const caixa = r.querySelector('.kobs'); caixa.querySelector('input').focus();
        caixa.querySelector('button').onclick = async () => {
          try { await painel('cadastro_decidir', { id: k.id, status: k.status, observacao: caixa.querySelector('input').value }); }
          catch (e2) { toast(e2.message); return; }
          toast('Observação salva ✓'); desenharCadastros();
        };
        return;
      }
      b.disabled = true;
      try { await painel('cadastro_decidir', { id: k.id, status: b.dataset.d || k.status, observacao: obs }); }
      catch (e) { b.disabled = false; toast(e.message); return; }
      toast(b.dataset.d === 'aprovado' ? 'Cadastro aprovado ✓ — avise o cliente.' : 'Cadastro atualizado ✓');
      desenharCadastros();
    }));
  }
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
      <div class="nm">${esc(p?.nome || `Produto ${r.produto}`)}<small>Cód. ${esc(p?.codigo || r.produto)} · ${esc(r.unidade_id || p?.unidade || 'unidade base')} · ${esc(dataBr(r.inicio))} a ${esc(dataBr(r.fim))}${ativo ? '' : ' · encerrado'}</small></div>
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
function limiteMargem() {
  if (limiteMem === null) { try { limiteMem = Number(localStorage.getItem('sr-painel-margem-min')); } catch { /* sem armazenamento */ } if (!(limiteMem >= 0) || limiteMem === 0) limiteMem = 15; }
  return limiteMem;
}
function guardarLimite(v) { const n = Number(String(v).replace(',', '.')); if (!(n >= 0)) return; limiteMem = n; try { localStorage.setItem('sr-painel-margem-min', String(n)); } catch { /* ok */ } }

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

/* ---------------- Configurações: categorias do portal ---------------- */

async function desenharConfig() {
  const alvo = $('cfgPanel');
  alvo.innerHTML = carregandoHtml('Carregando categorias…');
  await carregarExibicao();
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
      <div class="ci2"><div><b>Outras configurações</b><small>Margem mínima e o restante do painel antigo voltam na parte 5.</small></div></div>`;
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
