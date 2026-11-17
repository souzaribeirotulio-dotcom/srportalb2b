/* =====================================================================
   Portal no layout original: topo, faixa de categorias, página inicial,
   catálogo, carrinho lateral, login e Minha conta nos modais originais.
   A lógica (API, sessão, envio, Minha Lista, ocorrências) vem dos módulos
   já testados; aqui só a tela.
   ===================================================================== */
import { listarProdutos, listarGrupos, listarMarcas } from '../api/g360.js';
import { sessao, entrar, sair, trocarSenha } from '../estado/sessao.js';
import { adicionar, linhasCarrinho, alterarQuantidade, remover, aoMudarCarrinho, quantidadeLinhas } from '../estado/carrinho.js';
import { carregarIds, incluirNaLista, removerDaLista, idsCarregados } from '../estado/minha-lista.js';
import { normalizarQuantidade, dinheiro, estimar } from '../ui/formato.js';
import { ligarFotos, liberarFotosDaTela, htmlFoto } from '../ui/fotos.js';
import { mostrarMensagemErro } from '../ui/mensagem.js';
import { $, esc, toast, abrirModal, fecharModal, saudacao, passoQuantidade, adiar } from './comum.js';
import { htmlCartao, htmlPreco, unidadeEscolhida, linhaCarrinho } from './cartao.js';
import { abrirCheckout } from './checkout.js';
import { desenharMinhaLista } from './lista.js';
import { desenharPedidos } from './pedidos.js';

const LIMITE = 20;
const filtros = { q: '', grupo: '', marca: '', pagina: 1 };
let classificacoes = null;
let produtosDaTela = new Map();
let ctx = null;          // { loja, ir }
let montado = false;
let buscaN = 0;

export function limparLoja() {
  Object.assign(filtros, { q: '', grupo: '', marca: '', pagina: 1 });
  classificacoes = null;
  produtosDaTela = new Map();
  const q = $('q'); if (q) q.value = '';
}

/* ---------------- montagem única ---------------- */

function montar() {
  if (montado) return;
  montado = true;
  document.body.classList.add('g360-legado');
  // O que ainda não está ligado à API fica escondido (volta na fase dos recursos do portal antigo).
  $('ord').innerHTML = '<option value="nome">Ordenar: Nome A–Z</option>';

  document.querySelectorAll('.hb[data-v],.tabbar [data-v]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.v;
    if (v === 'cat') ctx.ir('/catalogo');
    else if (v === 'lista') exigirLogin(() => ctx.ir('/minha-lista'));
    else if (v === 'ped') exigirLogin(() => ctx.ir('/pedidos'));
  }));
  $('tbConta').addEventListener('click', () => (sessao.ativa ? abrirConta() : abrirLogin()));
  $('cartBtn').addEventListener('click', () => exigirLogin(abrirCarrinho));
  $('dClose').addEventListener('click', fecharCarrinho);
  $('shade').addEventListener('click', fecharCarrinho);
  $('dGo').addEventListener('click', () => { fecharCarrinho(); abrirCheckout(ctx); });

  // Busca do topo: a API procura por nome, código e aplicação.
  const q = $('q');
  // Só busca de novo quando o texto mudou de verdade (evita redesenhar a grade à toa).
  const buscar = adiar(() => { const v = q.value.trim(); if (v === filtros.q) return; filtros.q = v; filtros.pagina = 1; if (ctx.rota === 'cat') desenharCatalogo(); else ctx.ir('/catalogo'); }, 450);
  q.addEventListener('input', () => { if (sessao.ativa) buscar(); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (sessao.ativa) { filtros.q = q.value.trim(); filtros.pagina = 1; if (ctx.rota === 'cat') desenharCatalogo(); else ctx.ir('/catalogo'); } else abrirLogin(); } });
  q.addEventListener('focus', () => { if (!sessao.ativa) abrirLogin(); });
  $('marca').addEventListener('change', () => { filtros.marca = $('marca').value; filtros.pagina = 1; desenharCatalogo(); });
  $('cats').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    filtros.grupo = b.dataset.c; filtros.pagina = 1; desenharChips(); desenharCatalogo();
  });
  $('grid').addEventListener('click', cliqueCartao);
  $('grid').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.qty input')) { e.preventDefault(); e.target.closest('.card').querySelector('.add')?.click(); } });
  $('dBody').addEventListener('click', cliqueCarrinho);
  $('dBody').addEventListener('change', mudancaCarrinho);
  aoMudarCarrinho(() => { $('cartN').textContent = quantidadeLinhas() || ''; if ($('drawer').classList.contains('open')) desenharCarrinho(); });

  ligarLogin();
  // Paginação abaixo da grade.
  if (!$('g360Pag')) $('grid').insertAdjacentHTML('afterend', '<nav class="g360-pag" id="g360Pag" aria-label="Páginas do catálogo"></nav>');
  // Aviso de compra bloqueada / Minha Lista fora do ar, logo abaixo do topo.
  if (!$('g360Avisos')) document.querySelector('header').insertAdjacentHTML('afterend', '<div id="g360Avisos" class="g360-avisos" aria-live="polite"></div>');
}

export function exigirLogin(fn) { if (sessao.ativa) fn(); else abrirLogin(fn); }

/* ---------------- topo ---------------- */

function desenharTopo() {
  const c = sessao.comprador;
  document.querySelector('.logo b').textContent = ctx.loja.nome || 'Souza Ribeiro';
  $('user').innerHTML = c
    ? `<b id="uName" style="cursor:pointer" title="Minha conta">${esc(c.fantasia || c.nome)}</b><a id="sair">Sair</a>`
    : '<a id="entrar">Entrar</a>';
  if (c) { $('sair').onclick = () => sair(); $('uName').onclick = abrirConta; } else $('entrar').onclick = () => abrirLogin();
  $('tbContaT').textContent = c ? (c.fantasia || c.nome || 'Conta').split(' ')[0] : 'Entrar';
  $('cartN').textContent = quantidadeLinhas() || '';
  document.querySelectorAll('.hb[data-v],.tabbar [data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === ctx.rota));
  const avisos = [];
  if (c?.compra_bloqueada) avisos.push('<div class="rv-aviso bad"><b>Compras bloqueadas.</b> Você pode consultar o catálogo, mas não pode enviar pedidos agora. Fale com o seu vendedor da Souza Ribeiro.</div>');
  if (c && !sessao.supabaseOk) avisos.push('<div class="rv-aviso">A Minha Lista está indisponível no momento. O resto do portal funciona normalmente.</div>');
  $('g360Avisos').innerHTML = avisos.join('');
}

/** Mostra a tela pedida no layout original. rota: cat | lista | ped. */
export function mostrarLoja(contexto, rota, params = [], estado = {}) {
  ctx = { ...contexto, rota };
  montar();
  liberarFotosDaTela();
  document.querySelectorAll('.view').forEach((el) => { el.hidden = el.id !== { cat: 'vCat', lista: 'vLista', ped: 'vPed' }[rota]; });
  document.querySelector('header nav').style.display = rota === 'cat' ? '' : 'none';
  desenharTopo();
  window.scrollTo(0, 0);
  if (estado.aviso === 'sessao_encerrada' || estado.aviso === 'entre') {
    abrirLogin(null, estado.aviso === 'entre' ? 'Entre para continuar.' : (estado.mensagem || 'Sua sessão terminou. Entre novamente.'));
  } else if (estado.aviso === 'senha_definida') {
    abrirLogin(null, null, 'Senha definida. Agora é só entrar com o seu CPF ou CNPJ e a senha nova.');
  } else if (estado.aviso === 'saiu') toast('Você saiu da conta');
  if (rota === 'cat') { desenharHero(); desenharChips(); desenharCatalogo(); }
  if (rota === 'lista') desenharMinhaLista(ctx);
  if (rota === 'ped') desenharPedidos(ctx, params[0]);
  if (estado.abrirCarrinho) exigirLogin(abrirCarrinho);
  if (estado.abrirConta && sessao.ativa) abrirConta();
}

/* ---------------- página inicial e filtros ---------------- */

function desenharHero() {
  $('hi').innerHTML = `${saudacao()}<em>Seus suprimentos</em>num só lugar.`;
  if (!sessao.ativa) { $('tot').textContent = '—'; $('nMarcas').textContent = '—'; }
}

async function carregarClassificacoes() {
  if (classificacoes && classificacoes.token === sessao.token) return classificacoes;
  const [grupos, marcas] = await Promise.all([listarGrupos(sessao.token), listarMarcas(sessao.token)]);
  classificacoes = { token: sessao.token, grupos, marcas, total: null };
  $('marca').innerHTML = '<option value="">Todas as marcas</option>' + marcas.map((m) => `<option value="${Number(m.codigo)}">${esc(m.nome)}</option>`).join('');
  $('marca').value = filtros.marca;
  $('nMarcas').textContent = marcas.length;
  return classificacoes;
}

function desenharChips() {
  const el = $('cats');
  if (!sessao.ativa) { el.innerHTML = ''; return; }
  if (!classificacoes) { carregarClassificacoes().then(desenharChips).catch(() => { el.innerHTML = ''; }); return; }
  const grupos = [...classificacoes.grupos].sort((a, b) => b.quantidade - a.quantidade);
  const total = classificacoes.total ?? grupos.reduce((s, g) => s + Number(g.quantidade || 0), 0);
  el.innerHTML = [['', 'Todos', total], ...grupos.map((g) => [String(g.codigo), g.nome, g.quantidade])]
    .map(([c, n, q]) => `<button type="button" class="chip ${c === String(filtros.grupo) ? 'on' : ''}" data-c="${esc(c)}">${esc(n)}<span>${Number(q) || ''}</span></button>`).join('');
}

/* ---------------- catálogo ---------------- */

export async function desenharCatalogo() {
  const grid = $('grid'); const pag = $('g360Pag');
  pag.innerHTML = '';
  document.querySelector('.bar').style.display = sessao.ativa ? '' : 'none';
  if (!sessao.ativa) {
    $('cnt').innerHTML = '';
    grid.innerHTML = `<div class="empty g360-convite"><b>Entre para ver o catálogo e os seus preços.</b>
      <p>O portal é exclusivo para empresas clientes da Souza Ribeiro.</p>
      <div class="act" style="justify-content:center"><button type="button" class="btn pri" id="gEntrar">Entrar</button><button type="button" class="btn out" id="gPrimeiro">Primeiro acesso</button></div></div>`;
    $('gEntrar').onclick = () => abrirLogin();
    $('gPrimeiro').onclick = () => ctx.ir('/primeiro-acesso');
    if (ctx.loja.troca_senha !== true) $('gPrimeiro').style.display = 'none';
    return;
  }
  const meu = ++buscaN;
  grid.innerHTML = '<div class="empty">Carregando produtos…</div>';
  if (sessao.supabaseOk && idsCarregados() === null) { try { await carregarIds(); } catch { /* sem lista: sem botão */ } }
  try {
    const { dados, paginacao } = await listarProdutos(sessao.token, {
      q: filtros.q || undefined, grupo: filtros.grupo || undefined, marca: filtros.marca || undefined, pagina: filtros.pagina, limite: LIMITE,
    });
    if (meu !== buscaN) return;
    const total = paginacao?.total || 0;
    if (!filtros.q && !filtros.grupo && !filtros.marca) {
      $('tot').textContent = total.toLocaleString('pt-BR');
      if (classificacoes && classificacoes.total === null) { classificacoes.total = total; desenharChips(); }
    }
    const paginas = Math.max(1, Math.ceil(total / LIMITE));
    $('cnt').innerHTML = `<b>${total.toLocaleString('pt-BR')}</b> produto${total === 1 ? '' : 's'}${paginas > 1 ? ` · página ${filtros.pagina} de ${paginas}` : ''}`;
    produtosDaTela = new Map(dados.map((p) => [Number(p.id), p]));
    const lista = idsCarregados();
    grid.innerHTML = dados.length ? dados.map((p) => htmlCartao(p, { naLista: lista ? lista.has(Number(p.id)) : null })).join('')
      : `<div class="empty">Nenhum produto encontrado.${filtros.q || filtros.grupo || filtros.marca ? '<br><button type="button" class="tool" id="gLimpar" style="margin-top:12px">Limpar busca e filtros</button>' : ''}</div>`;
    $('gLimpar')?.addEventListener('click', () => { limparLoja(); desenharChips(); $('marca').value = ''; desenharCatalogo(); });
    ligarFotos(grid);
    if (paginas > 1) {
      pag.innerHTML = `<button type="button" class="tool" id="gAnt" ${filtros.pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button>
        <span>Página <b>${filtros.pagina}</b> de ${paginas}</span>
        <button type="button" class="tool" id="gProx" ${filtros.pagina >= paginas ? 'disabled' : ''}>Próxima ›</button>`;
      const mudar = (d) => { filtros.pagina += d; desenharCatalogo(); document.querySelector('.bar')?.scrollIntoView({ behavior: 'smooth' }); };
      $('gAnt').onclick = () => mudar(-1); $('gProx').onclick = () => mudar(1);
    }
  } catch (e) {
    if (meu !== buscaN) return;
    grid.innerHTML = '<div class="empty g360-erro"></div>';
    mostrarMensagemErro(grid.firstElementChild, e, { aoTentarDeNovo: desenharCatalogo });
  }
}

async function cliqueCartao(e) {
  const card = e.target.closest('.card'); if (!card) return;
  const p = produtosDaTela.get(Number(card.dataset.id)); if (!p) return;
  const un = e.target.closest('.unsel [data-un]');
  if (un) {
    card.dataset.un = un.dataset.un;
    card.querySelectorAll('.unsel button').forEach((b) => b.classList.toggle('on', b === un));
    card.querySelector('.price').innerHTML = htmlPreco(unidadeEscolhida(p, un.dataset.un));
    return;
  }
  const d = e.target.closest('[data-d]');
  if (d) { const i = card.querySelector('.qty input'); i.value = passoQuantidade(i.value, Number(d.dataset.d)); return; }
  if (e.target.closest('.add')) {
    const campo = card.querySelector('.qty input');
    const q = normalizarQuantidade(campo.value);
    if (!q) { toast('Quantidade inválida: use um número maior que zero, com até 4 casas depois da vírgula.'); campo.focus(); return; }
    const r = adicionar(linhaCarrinho(p, card.dataset.un, q));
    if (r === 'limite') { toast('O carrinho aceita até 100 linhas. Envie este pedido ou remova itens.'); return; }
    campo.value = '1';
    toast(`${r === 'somado' ? 'Quantidade somada' : 'Adicionado'} · ${p.nome.slice(0, 40)}${p.nome.length > 40 ? '…' : ''}`);
    return;
  }
  const fav = e.target.closest('.fav');
  if (fav) {
    const estava = fav.classList.contains('on');
    fav.disabled = true;
    try {
      if (estava) await removerDaLista(p.id); else await incluirNaLista(p.id);
      fav.classList.toggle('on', !estava); fav.setAttribute('aria-pressed', String(!estava));
      fav.textContent = estava ? '☆ Lista' : '⭐ Na lista';
      toast(estava ? 'Removido da Minha Lista' : 'Adicionado à Minha Lista ⭐');
    } catch (err) { toast(err.message); } finally { fav.disabled = false; }
  }
}

/* ---------------- carrinho lateral ---------------- */

export function abrirCarrinho() {
  desenharCarrinho();
  $('drawer').classList.add('open'); $('shade').classList.add('open');
}
export function fecharCarrinho() { $('drawer').classList.remove('open'); $('shade').classList.remove('open'); liberarFotosDaTela(); }

function desenharCarrinho() {
  const it = linhasCarrinho();
  $('dBody').innerHTML = it.length ? it.map((l) => `<div class="ci" data-k="${esc(`${l.produto_id}|${l.unidade ?? ''}`)}">
      ${htmlFoto({ id: l.produto_id, nome: l.nome, fotos: l.fotos }, 'g360-mini')}
      <div class="n">${esc(l.nome)}<small>${l.precoTexto ? `${esc(dinheiro(l.precoTexto))} / ${esc(String(l.unidadeNome).toLowerCase())}` : esc(l.unidadeNome)}${l.seu_preco ? ' <span class="tagcg">Seu preço</span>' : ''}</small>
        <div class="qty" style="margin-top:6px;width:max-content"><button type="button" data-d="-1" aria-label="Diminuir">−</button><input type="text" inputmode="decimal" value="${esc(String(l.quantidade).replace('.', ','))}" maxlength="13" aria-label="Quantidade"><button type="button" data-d="1" aria-label="Aumentar">+</button></div></div>
      <div class="r">${l.precoTexto ? esc(dinheiro(estimar([l]).total)) : '—'}<br><button type="button" class="x">Remover</button></div></div>`).join('')
    : '<div class="empty2">Seu carrinho está vazio.</div>';
  const est = estimar(it);
  $('dTot').textContent = dinheiro(est.total);
  const rot = document.querySelector('.df .t span'); if (rot) rot.textContent = 'Total estimado';
  if (!$('dEst')) document.querySelector('.df .t').insertAdjacentHTML('afterend', '<p class="hint" id="dEst" style="margin:-8px 0 12px">Os valores que valem aparecem na revisão do pedido.</p>');
  $('dGo').disabled = !it.length;
  $('dGo').textContent = 'Revisar pedido';
  ligarFotos($('dBody'));
}

function cliqueCarrinho(e) {
  const r = e.target.closest('.ci'); if (!r) return;
  const [pid, uni] = r.dataset.k.split('|');
  if (e.target.classList.contains('x')) { remover(Number(pid), uni || null); return; }
  const d = e.target.closest('[data-d]');
  if (d) {
    const i = r.querySelector('.qty input');
    const novo = passoQuantidade(i.value, Number(d.dataset.d));
    if (Number(d.dataset.d) < 0 && i.value.replace(',', '.') === '1') { remover(Number(pid), uni || null); return; }
    const q = normalizarQuantidade(novo); if (q) alterarQuantidade(Number(pid), uni || null, q);
  }
}
function mudancaCarrinho(e) {
  const r = e.target.closest('.ci'); if (!r) return;
  const [pid, uni] = r.dataset.k.split('|');
  const q = normalizarQuantidade(e.target.value);
  if (!q) { toast('Quantidade inválida: use um número maior que zero.'); desenharCarrinho(); return; }
  alterarQuantidade(Number(pid), uni || null, q);
}

/* ---------------- login (modal original) ---------------- */

let depoisDoLogin = null;

function ligarLogin() {
  $('lgCad').textContent = 'Primeiro acesso';
  $('lgCad').onclick = () => { fecharModal('mLogin'); ctx.ir('/primeiro-acesso'); };
  $('lgEsqL').onclick = () => { fecharModal('mLogin'); ctx.ir('/esqueci-senha'); };
  $('lgAdm').textContent = 'Acesso da equipe Souza Ribeiro';
  $('lgAdm').onclick = () => { fecharModal('mLogin'); ctx.ir('/painel'); };
  $('lgVolta').hidden = true; $('lgEsq').hidden = true; $('lgAdmT').hidden = true;
  $('lgL').textContent = 'CPF ou CNPJ';
  const doc = $('lgC');
  doc.placeholder = 'Digite com ou sem pontuação'; doc.inputMode = 'text'; doc.maxLength = 32; doc.autocapitalize = 'characters';
  $('lgS').maxLength = 64;
  if (!$('lgRes')) $('lgE').insertAdjacentHTML('afterend', '<div id="lgRes" aria-live="polite"></div><p class="hint" id="lgSessao"></p>');
  $('lgX').onclick = () => { fecharModal('mLogin'); depoisDoLogin = null; };
  $('lgS').onkeydown = (e) => { if (e.key === 'Enter') $('lgOk').click(); };
  $('lgC').onkeydown = (e) => { if (e.key === 'Enter') $('lgS').focus(); };
  $('lgOk').onclick = async () => {
    const usuario = doc.value.trim(); const senha = $('lgS').value;
    $('lgE').textContent = ''; $('lgRes').innerHTML = '';
    if (!usuario) { $('lgE').textContent = 'Digite o CPF ou CNPJ.'; doc.focus(); return; }
    if (!senha) { $('lgE').textContent = 'Digite a senha.'; $('lgS').focus(); return; }
    $('lgOk').disabled = true; $('lgOk').textContent = 'Entrando…';
    try {
      await entrar(usuario, senha);
      $('lgS').value = '';
      fecharModal('mLogin');
      ctx.aoEntrar();
      toast(`Bem-vindo, ${sessao.comprador?.fantasia || sessao.comprador?.nome || ''}!`);
      const f = depoisDoLogin; depoisDoLogin = null; if (f) f();
    } catch (e) {
      $('lgS').value = '';
      // Sem "tentar de novo" automático: várias senhas erradas bloqueiam o login por um tempo.
      mostrarMensagemErro($('lgRes'), e);
      $('lgS').focus();
    } finally { $('lgOk').disabled = false; $('lgOk').textContent = 'Entrar'; }
  };
}

export function abrirLogin(depois = null, mensagemErro = null, mensagemOk = null) {
  depoisDoLogin = depois;
  $('lgE').textContent = mensagemErro || '';
  $('lgRes').innerHTML = mensagemOk ? `<div class="rv-aviso">${esc(mensagemOk)}</div>` : '';
  const min = Number(ctx?.loja?.sessao_minutos);
  $('lgSessao').textContent = Number.isFinite(min) ? `Por segurança, a sessão encerra após ${min} minuto${min === 1 ? '' : 's'} sem uso.` : '';
  const semTroca = ctx?.loja?.troca_senha !== true;
  $('lgCad').style.display = semTroca ? 'none' : '';
  $('lgEsqL').style.display = semTroca ? 'none' : '';
  abrirModal('mLogin');
  setTimeout(() => $('lgC').focus(), 50);
}

/* ---------------- Minha conta (modal original) ---------------- */

const FORMATO_SENHA = /^[!-~]{6,8}$/;
const REGRA = 'De 6 a 8 caracteres, sem espaços nem acentos, diferente do seu código de cliente.';

export function abrirConta() {
  const c = sessao.comprador || {};
  const troca = (sessao.loja?.troca_senha ?? ctx.loja.troca_senha) === true;
  $('contaBox').innerHTML = `<h3>Minha conta</h3><div class="sub">${esc(c.nome || '')}</div>
    <div class="rv">
      ${c.fantasia ? `<div><span>Nome fantasia</span><b>${esc(c.fantasia)}</b></div>` : ''}
      <div><span>CPF/CNPJ</span><b>${esc(c.documento || '')}</b></div>
      <div><span>Código de cliente</span><b>${esc(c.codigo ?? '')}</b></div>
      ${c.segmento?.descricao ? `<div><span>Segmento</span><b>${esc(c.segmento.descricao)}</b></div>` : ''}
    </div>
    ${c.compra_bloqueada ? '<div class="rv-aviso bad">Compras bloqueadas no momento. Fale com o seu vendedor.</div>' : ''}
    ${troca ? `<h3 style="margin-top:18px">Trocar senha</h3>
      <label for="tAtual">Senha atual</label><input id="tAtual" type="password" maxlength="64" autocomplete="current-password">
      <label for="tNova1">Senha nova</label><input id="tNova1" type="password" maxlength="8" autocomplete="new-password" aria-describedby="tRegra">
      <div class="hint" id="tRegra">${esc(REGRA)}</div>
      <label for="tNova2">Repita a senha nova</label><input id="tNova2" type="password" maxlength="8" autocomplete="new-password">
      <div class="err" id="tErro"></div><div id="tRes" aria-live="polite"></div>`
      : '<div class="hint" style="margin-top:14px">A senha de acesso é definida pela Souza Ribeiro. Para trocar a sua, fale com o seu vendedor.</div>'}
    <div class="act"><button type="button" class="btn del" id="cSair">Sair da conta</button><button type="button" class="btn sec" id="cFechar">Fechar</button>${troca ? '<button type="button" class="btn pri" id="cTrocar">Trocar senha</button>' : ''}</div>`;
  abrirModal('mConta');
  $('cFechar').onclick = () => fecharModal('mConta');
  $('cSair').onclick = () => { fecharModal('mConta'); sair(); };
  const b = $('cTrocar'); if (!b) return;
  b.onclick = async () => {
    const atual = $('tAtual'); const n1 = $('tNova1'); const n2 = $('tNova2'); const erro = $('tErro');
    erro.textContent = ''; $('tRes').innerHTML = '';
    if (!atual.value) { erro.textContent = 'Digite a senha atual.'; atual.focus(); return; }
    if (!FORMATO_SENHA.test(n1.value)) { erro.textContent = `A senha nova não segue a regra: ${REGRA}`; n1.focus(); return; }
    if (n1.value !== n2.value) { erro.textContent = 'As duas senhas novas não são iguais.'; n2.focus(); return; }
    b.disabled = true;
    try {
      await trocarSenha(atual.value, n1.value);
      atual.value = n1.value = n2.value = '';
      $('tRes').innerHTML = '<div class="rv-aviso"><b>Senha trocada.</b> Use a senha nova no próximo acesso. As outras sessões abertas foram encerradas.</div>';
    } catch (e) { mostrarMensagemErro($('tRes'), e); } finally { b.disabled = false; }
  };
}

export function fecharTudo() {
  ['mLogin', 'mConta', 'mChk'].forEach(fecharModal);
  fecharCarrinho();
}
