/* =====================================================================
   Portal no layout original: topo, faixa de categorias, página inicial,
   catálogo, carrinho lateral, login e Minha conta nos modais originais.
   A lógica (API, sessão, envio, Minha Lista, ocorrências) vem dos módulos
   já testados; aqui só a tela.
   ===================================================================== */
import { carregarOcultosComprador, carregarOcultosVisitante } from '../estado/ocultos.js';
import Decimal from 'decimal.js';
import { registrarBusca, registrarAcesso, limparEventosSessao } from '../estado/eventos.js';
import { carregarExibicao, categorias as categoriasPortal, codigosDaCategoria, codigosDoFiltro, secoesDe, caminhoDoFiltro, secaoPorId, codigosDaSecao, filtroDoEndereco, enderecoDoFiltro, apresentar, pesoCurva, oculto, soEstoque, abaixoDoMinimo, estoqueMinimoAtual, codigosAtivosPublicos } from '../catalogo/exibicao.js';

import { buscarLocal, temEstoque, variacoes, corrigirBusca, nomeBate, variacoesMedida } from '../catalogo/busca.js';
import { listarProdutos, buscarProdutos, listarMarcas, produtosPorIds } from '../api/g360.js';
import { sessao, entrar, sair, trocarSenha, vinculoEmAndamento } from '../estado/sessao.js';
import { iniciarCarrinhoNuvem, sincronizarCarrinho } from '../estado/carrinho-nuvem.js';
import { adicionar, linhasCarrinho, alterarQuantidade, remover, aoMudarCarrinho, quantidadeLinhas, linhasSemPrecoAtual, atualizarLinha } from '../estado/carrinho.js';
import { carregarIds, incluirNaLista, removerDaLista, idsCarregados } from '../estado/minha-lista.js';
import { normalizarQuantidade, dinheiro, estimar } from '../ui/formato.js';
import { ligarTrocaFotos, ligarFotos, liberarFotosDaTela, htmlFoto } from '../ui/fotos.js';
import { mostrarMensagemErro } from '../ui/mensagem.js';
import { FORMATO_SENHA, REGRA_SENHA as REGRA, htmlRegraSenha, ligarRegraSenha } from '../ui/regra-senha.js';
import { $, esc, toast, abrirModal, fecharModal, saudacao, passoQuantidade, adiar } from './comum.js';
import { htmlCartao, htmlPreco, unidadeEscolhida, linhaCarrinho } from './cartao.js';
import { abrirDetalhe, ligarDetalhe } from './detalhe.js';
import { iniciarSouzinha } from './souzinha.js';
import { resultadoPublico, htmlCartaoPublico, chipsPublicos, marcasPublicas, limparVisitante } from './visitante.js';
import { abrirCheckout } from './checkout.js';
import { desenharMinhaLista } from './lista.js';
import { desenharPedidos } from './pedidos.js';
import { desenharClips, ligarClips, pausarClips, carregarClips, clipDoProduto, urlClip } from './clips.js';
import { abrirNegociacao, desenharMinhasNegociacoes } from './negociacao.js';
import { htmlDisponivel, conferir, somar } from './estoque.js';
import { abrirCadastro, cadastroEmAnalise, esquecerCadastroEmAnalise } from './cadastro.js';
import { situacaoAvisos, ativarAvisos, desativarAvisos, testarAviso } from '../estado/avisos.js';
import { convidarNoRodape } from '../ui/oferta-avisos.js';
import { desenharBanners, pausarBanners } from './banners.js';

const filtros = { q: '', grupo: '', secao: '', marca: '', pagina: 1 };
let classificacoes = null;
let produtosDaTela = new Map();
let ctx = null;          // { loja, ir }
let montado = false;
let buscaN = 0;

export function limparLoja() {
  esquecerBuscasRecentes();
  limparVisitante();
  Object.assign(filtros, { q: '', grupo: '', secao: '', marca: '', pagina: 1 });
  classificacoes = null;
  vitrine = null; busca = null;
  produtosDaTela = new Map();
  const q = $('q'); if (q) q.value = '';
}

/* ---------------- montagem única ---------------- */

function montar() {
  if (montado) return;
  montado = true;
  document.body.classList.add('g360-legado');
  // O que ainda não está ligado à API fica escondido (volta na fase dos recursos do portal antigo).
  $('ord').addEventListener('change', () => { filtros.pagina = 1; desenharCatalogo(); });

  document.querySelectorAll('.hb[data-v],.tabbar [data-v]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.v;
    if (v === 'cat') ctx.ir('/catalogo');
    else if (v === 'lista') exigirLogin(() => ctx.ir('/minha-lista'));
    else if (v === 'ped') exigirLogin(() => ctx.ir('/pedidos'));
    else if (v === 'adm') ctx.ir('/painel');
    else if (v === 'clips') ctx.ir('/clips');
  }));
  $('tbConta').addEventListener('click', () => (sessao.ativa ? abrirConta() : abrirLogin()));
  $('heroCadB').addEventListener('click', () => abrirCadastro(ctxCadastro()));
  $('heroEntrar').addEventListener('click', () => abrirLogin());
  $('heroAcesso').addEventListener('click', () => abrirCadastro(ctxCadastro(), { jaCliente: true }));
  window.addEventListener('g360:cadastro-enviado', pintarChamadaCadastro);
  $('cartBtn').addEventListener('click', () => exigirLogin(abrirCarrinho));
  $('dClose').addEventListener('click', fecharCarrinho);
  $('shade').addEventListener('click', fecharCarrinho);
  $('dGo').addEventListener('click', () => { fecharCarrinho(); abrirCheckout(ctx); });
  $('dNeg').addEventListener('click', () => exigirLogin(() => {
    const itens = linhasCarrinho().map((l) => ({ produto: { id: l.produto_id, codigo: l.codigo, nome: l.nome, unidade: l.unidadeNome, preco: l.precoTexto, unidades: [] },
      op: { id: l.unidade || '', nome: l.unidadeNome || 'UN', preco: l.precoTexto }, quantidade: l.quantidade }));
    fecharCarrinho(); abrirNegociacao(itens);
  }));
  ligarClips();
  carregarClips().catch(() => { /* sem clips: sem botão */ });

  // Busca do topo: a API procura por nome, código e aplicação.
  const q = $('q');
  // Só busca de novo quando o texto mudou de verdade (evita redesenhar a grade à toa).
  const buscar = adiar(() => { const v = q.value.trim(); if (v === filtros.q) return; filtros.q = v; filtros.pagina = 1; if (ctx.rota === 'cat') desenharCatalogo(); else ctx.ir('/catalogo'); }, 250);
  // Visitante (vitrine pública): espera mais a digitação, porque a vitrine aceita 30 chamadas por minuto.
  const buscarPublico = adiar(() => { const v = q.value.trim(); if (v === filtros.q) return; filtros.q = v; filtros.pagina = 1; if (ctx.rota === 'cat') desenharCatalogo(); else ctx.ir('/catalogo'); }, 700);
  q.addEventListener('input', () => { if (sessao.ativa) buscar(); else buscarPublico(); });
  // Como no portal antigo: ao começar a digitar, rola até os resultados (uma vez por busca), sem tirar o foco do campo.
  let rolou = false; let tRolar = null;
  q.addEventListener('input', () => {
    clearTimeout(tRolar);
    if (!q.value.trim()) { rolou = false; return; }
    if (rolou) return;
    tRolar = setTimeout(() => {
      if (rolou || !q.value.trim() || $('vCat').hidden) return;
      const topo = (document.querySelector('header')?.getBoundingClientRect().height || 0) + 12;
      const destino = Math.max(0, window.scrollY + $('grid').getBoundingClientRect().top - topo - 60);
      if (destino > window.scrollY + 40) window.scrollTo({ top: destino, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      rolou = true;
    }, 120);
  });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (q.value.trim() === filtros.q && ctx.rota === 'cat') return; filtros.q = q.value.trim(); filtros.pagina = 1; if (ctx.rota === 'cat') desenharCatalogo(); else ctx.ir('/catalogo'); } });
  $('marca').addEventListener('change', () => { filtros.marca = $('marca').value; filtros.pagina = 1; desenharCatalogo(); });
  $('cats').addEventListener('click', (e) => {
    if (e.target.closest('[data-deps]')) { abrirDepartamentos(); return; }
    const b = e.target.closest('.chip'); if (!b) return;
    filtros.grupo = b.dataset.c; filtros.secao = ''; filtros.pagina = 1; marcarEndereco(); desenharChips(); desenharCatalogo();
  });
  // Seções e linhas do departamento escolhido (segunda e terceira faixa).
  $('subcats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    filtros.secao = b.dataset.s; filtros.pagina = 1; marcarEndereco(); desenharChips(); desenharCatalogo();
  });

  $('grid').addEventListener('click', cliqueCartao);
  ligarDetalhe();
  iniciarSouzinha({
    ir: (c) => ctx.ir(c),
    exigirLogin,
    buscar: (texto) => exigirLogin(() => { $('q').value = texto; filtros.q = texto; filtros.pagina = 1; if (ctx.rota === 'cat') desenharCatalogo(); else ctx.ir('/catalogo'); }),
    abrirDetalhe: (p) => abrirDetalheLoja(p),
  });
  $('grid').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.qty input')) { e.preventDefault(); e.target.closest('.card').querySelector('.add')?.click(); } });
  $('dBody').addEventListener('click', cliqueCarrinho);
  $('dBody').addEventListener('change', mudancaCarrinho);
  iniciarCarrinhoNuvem();
  aoMudarCarrinho((origem) => {
    $('cartN').textContent = quantidadeLinhas() || '';
    if (origem === 'nuvem') atualizarCarrinhoGuardado(); // veio de outro navegador: busca preço e estoque do momento
    if ($('drawer').classList.contains('open')) desenharCarrinho();
  });

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
  if (c && !sessao.supabaseOk && !vinculoEmAndamento()) avisos.push('<div class="rv-aviso">A Minha Lista está indisponível no momento. O resto do portal funciona normalmente.</div>');
  $('g360Avisos').innerHTML = avisos.join('');
}

/** Topo do layout original sem tela de compra (usado pelo painel do administrador). */
export function prepararCasca(contexto) {
  ctx = { ...contexto, rota: 'adm' };
  montar();
  liberarFotosDaTela();
  desenharTopo();
}

/** Mostra a tela pedida no layout original. rota: cat | lista | ped. */
export function mostrarLoja(contexto, rota, params = [], estado = {}) {
  ctx = { ...contexto, rota };
  pintarChamadaCadastro();
  montar();
  liberarFotosDaTela();
  document.querySelectorAll('.view').forEach((el) => { el.hidden = el.id !== { cat: 'vCat', lista: 'vLista', ped: 'vPed', clips: 'vClips' }[rota]; });
  document.body.classList.toggle('clipsmode', rota === 'clips');
  if (rota !== 'clips') pausarClips();
  if (rota !== 'cat') pausarBanners();
  document.querySelector('header nav').style.display = rota === 'cat' ? '' : 'none';
  if (rota !== 'cat') document.body.classList.remove('com-dep');
  desenharTopo();
  window.scrollTo(0, 0);
  if (estado.aviso === 'sessao_encerrada' || estado.aviso === 'entre') {
    abrirLogin(null, estado.aviso === 'entre' ? 'Entre para continuar.' : (estado.mensagem || 'Sua sessão terminou. Entre novamente.'));
  } else if (estado.aviso === 'senha_definida') {
    abrirLogin(null, null, 'Senha definida. Agora é só entrar com o seu CPF ou CNPJ e a senha nova.');
  } else if (estado.aviso === 'saiu') toast('Você saiu da conta');
  else if (estado.aviso === 'entrou_senha_nova' && sessao.ativa) {
    // Entrou pela página de senha nova: mesmos passos do login comum.
    pintarChamadaCadastro(); limparEventosSessao(); registrarAcesso();
    toast(`Senha criada. Bem-vindo, ${sessao.comprador?.fantasia || sessao.comprador?.nome || ''}!`);
  }
  if (rota === 'cat') {
    desenharHero();
    lerEndereco().then(() => { if (ctx.rota === 'cat') { desenharChips(); desenharCatalogo(); } });
  }
  if (rota === 'lista') desenharMinhaLista(ctx);
  if (rota === 'ped') { desenharPedidos(ctx, params[0]); desenharMinhasNegociacoes(); }
  if (rota === 'clips') desenharClips(estado.clip || null, opcoesClips());
  if (estado.abrirCarrinho) exigirLogin(abrirCarrinho);
  if (estado.abrirConta && sessao.ativa) abrirConta();
}

/* ---------------- página inicial e filtros ---------------- */

function desenharHero() {
  $('hi').innerHTML = `${saudacao()}<em>Seus suprimentos</em>num só lugar.`;
  // Versão curta da saudação: no celular, com banner no topo, ela substitui o título grande.
  const nome = sessao.ativa ? String(sessao.comprador?.fantasia || sessao.comprador?.nome || '').trim() : '';
  $('hiCurto').textContent = `${saudacao().replace('.', '')}${nome ? `, ${nome}` : ''}! 👋`;
  if (!sessao.ativa) { $('nMarcas').textContent = '—'; }
}

async function carregarClassificacoes() {
  if (classificacoes && classificacoes.token === sessao.token) return classificacoes;
  const [marcas] = await Promise.all([listarMarcas(sessao.token), carregarExibicao()]);
  // Categorias definidas pela equipe no painel (não vêm do G360). O número de cada uma conta só o que aparece no
  // portal (com estoque e não tirado pela equipe), igual ao "Mostrando X de Y" e à tela de quem não entrou.
  const ativos = await codigosAtivosPublicos(); const set = ativos ? new Set(ativos) : null;
  const grupos = categoriasPortal().map((nome) => ({ codigo: nome, nome, quantidade: codigosDaCategoria(nome, Infinity).filter((c) => !set || set.has(String(c))).length || '' }));
  classificacoes = { token: sessao.token, grupos, marcas, total: ativos ? ativos.length : null };
  $('marca').innerHTML = '<option value="">Todas as marcas</option>' + marcas.map((m) => `<option value="${Number(m.codigo)}">${esc(m.nome)}</option>`).join('');
  $('marca').value = filtros.marca;
  $('nMarcas').textContent = marcas.length;
  return classificacoes;
}

/** Topo da página para quem não entrou: botão de cadastro (ou "em análise", se já mandou daqui). */
function pintarChamadaCadastro() {
  const box = $('heroCad'); if (!box) return;
  if (sessao.ativa) { box.hidden = true; esquecerCadastroEmAnalise(); return; }
  const enviado = cadastroEmAnalise();
  box.hidden = false; box.classList.toggle('analise', !!enviado);
  $('heroAcesso').hidden = !!enviado || ctx?.loja?.troca_senha !== true;
  $('heroCadB').textContent = enviado ? 'Ver meu cadastro' : 'Quero ser cliente';
  $('heroCadT').textContent = enviado
    ? `Seu cadastro está em análise (enviado em ${enviado.split('-').reverse().join('/')}). Quando for aprovado, o link para criar a senha chega no e-mail cadastrado.`
    : 'Cadastro em 2 minutos: digite o CNPJ e a gente preenche o resto.';
}

function desenharChips() {
  pintarChamadaCadastro();
  const el = $('cats');
  if (!sessao.ativa) {
    chipsPublicos().then((grupos) => {
      if (sessao.ativa) return;
      el.innerHTML = BOTAO_DEPS + [['', 'Todos', ''], ...grupos.filter((g) => g.quantidade).map((g) => [g.codigo, g.nome, g.quantidade])]
        .map(([c, n, qt]) => `<button type="button" class="chip ${c === String(filtros.grupo) ? 'on' : ''}" data-c="${esc(c)}">${esc(n)}<span>${Number(qt) || ''}</span></button>`).join('');
      desenharSubcats(); desenharTrilha();
    }).catch(() => { el.innerHTML = ''; });
    marcasPublicas().then((ms) => {
      if (sessao.ativa) return;
      $('marca').innerHTML = '<option value="">Todas as marcas</option>' + ms.map((m) => `<option value="${Number(m.codigo)}">${esc(m.nome)}</option>`).join('');
      $('marca').value = filtros.marca; $('nMarcas').textContent = ms.length;
    }).catch(() => {});
    return;
  }
  if (!classificacoes) { carregarClassificacoes().then(desenharChips).catch(() => { el.innerHTML = ''; }); return; }
  const grupos = classificacoes.grupos.filter((g) => g.quantidade);
  const total = classificacoes.total ?? '';
  el.innerHTML = BOTAO_DEPS + [['', 'Todos', total], ...grupos.map((g) => [String(g.codigo), g.nome, g.quantidade])]
    .map(([c, n, q]) => `<button type="button" class="chip ${c === String(filtros.grupo) ? 'on' : ''}" data-c="${esc(c)}">${esc(n)}<span>${Number(q) || ''}</span></button>`).join('');
  desenharSubcats();
  desenharTrilha();
}

/* ---------------- árvore: departamento → seção ---------------- */

/** O endereço manda no departamento/seção: /limpeza/sacos-de-lixo → filtros. Início e /catalogo = sem departamento. */
async function lerEndereco() {
  const c = location.pathname.replace(/\/+$/, '') || '/';
  if (c === '/' || c === '/catalogo' || c === '/carrinho' || c === '/minha-conta') {
    if (c === '/' || c === '/catalogo') { filtros.grupo = ''; filtros.secao = ''; }
    tituloDaPagina(); return;
  }
  await carregarExibicao();
  const f = filtroDoEndereco(c);
  if (!f) { history.replaceState(null, '', '/'); filtros.grupo = ''; filtros.secao = ''; tituloDaPagina(); return; }
  if (f.grupo !== filtros.grupo || f.secao !== filtros.secao) { filtros.grupo = f.grupo; filtros.secao = f.secao; filtros.q = ''; filtros.pagina = 1; const q = $('q'); if (q) q.value = ''; }
  if (f.incompleto) history.replaceState(null, '', enderecoDoFiltro(filtros)); // seção que mudou de nome: fica no que existe
  tituloDaPagina();
}
/** Grava o departamento/seção escolhido no endereço (dá para compartilhar o link e usar o Voltar do navegador). */
function marcarEndereco() {
  const destino = enderecoDoFiltro(filtros) || '/';
  if ((location.pathname.replace(/\/+$/, '') || '/') !== destino) history.pushState(null, '', destino);
  tituloDaPagina();
}
/** "Início › Limpeza › Sacos de lixo" acima dos produtos (cada parte leva de volta àquele nível). */
function desenharTrilha() {
  const el = $('trilha'); if (!el) return;
  document.body.classList.toggle('com-dep', !!filtros.grupo && ctx?.rota === 'cat');
  if (!filtros.grupo) { el.hidden = true; el.innerHTML = ''; return; }
  const s = filtros.secao ? secaoPorId(filtros.secao) : null; const m = s?.pai ? secaoPorId(s.pai) : null;
  const niveis = [['/', 'Início', '', ''], [null, filtros.grupo, filtros.grupo, '']];
  if (m) niveis.push([null, m.nome, filtros.grupo, m.id]);
  if (s) niveis.push([null, s.nome, filtros.grupo, s.id]);
  el.innerHTML = niveis.map(([, nome, g, sid], i) => (i === niveis.length - 1
    ? `<span aria-current="page">${esc(nome)}</span>` : `<button type="button" data-g="${esc(g)}" data-s="${esc(sid)}">${esc(nome)}</button>`)).join('<span class="sep" aria-hidden="true">›</span>');
  el.hidden = false;
  el.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; filtros.grupo = b.dataset.g; filtros.secao = b.dataset.s; filtros.pagina = 1; marcarEndereco(); desenharChips(); desenharCatalogo(); };
}
function tituloDaPagina() {
  const nome = ctx?.loja?.nome || 'Souza Ribeiro';
  const partes = caminhoDoFiltro(filtros);
  document.title = partes.length ? `${partes.reverse().join(' | ')} | ${nome}` : nome;
}
const BOTAO_DEPS = '<button type="button" class="chip deps" data-deps aria-haspopup="dialog"><span aria-hidden="true">☰</span> Departamentos</button>';

/** Contagem do que aparece no portal (mesma regra dos números dos departamentos). */
async function contadorAtivos() {
  const ativos = await codigosAtivosPublicos(); const set = ativos ? new Set(ativos) : null;
  return (cods) => cods.filter((c) => !set || set.has(String(c))).length;
}

/** Segunda faixa: seções do departamento escolhido. */
async function desenharSubcats() {
  const el = $('subcats'); if (!el) return;
  const grupo = filtros.grupo;
  if (!grupo) { el.hidden = true; el.innerHTML = ''; return; }
  await carregarExibicao();
  const conta = await contadorAtivos();
  if (grupo !== filtros.grupo) return; // trocou no meio
  const secs = secoesDe(grupo).map((s) => ({ ...s, n: conta(codigosDaSecao(s.id)) })).filter((s) => s.n);
  if (!secs.length) { el.hidden = true; el.innerHTML = ''; return; }
  const atual = filtros.secao ? secaoPorId(filtros.secao) : null;
  const mae = atual ? secs.find((s) => s.id === (atual.pai || atual.id)) : null;
  const chip = (id, nome, n, on) => `<button type="button" class="chip sub ${on ? 'on' : ''}" data-s="${esc(id)}" aria-pressed="${on}">${esc(nome)}${n ? `<span>${n}</span>` : ''}</button>`;
  el.innerHTML = `<div class="sub-l1" role="group" aria-label="Seções de ${esc(grupo)}">${chip('', `Tudo em ${grupo}`, 0, !filtros.secao)}${secs.map((s) => chip(s.id, s.nome, s.n, mae?.id === s.id)).join('')}</div>`;
  el.hidden = false;
  // A escolha fica à vista na faixa (no celular a faixa rola de lado).
  el.querySelectorAll('.chip.on').forEach((c) => { const f = c.parentElement; f.scrollLeft = c.offsetLeft - (f.clientWidth - c.offsetWidth) / 2; });
  const cat = $('cats')?.querySelector('.chip.on'); if (cat) { const f = cat.parentElement; f.scrollLeft = cat.offsetLeft - (f.clientWidth - cat.offsetWidth) / 2; }
}

/** Menu "Departamentos" (como nos grandes atacados online), dois níveis: departamento → seção.
 *  computador = lista de departamentos à esquerda e as seções abrindo ao lado;
 *  celular = tela cheia que entra de nível em nível, com "‹ Voltar" e "Ver tudo em…". */
async function abrirDepartamentos() {
  await carregarExibicao();
  const conta = await contadorAtivos();
  const deps = categoriasPortal().map((nome) => ({ nome, n: conta(codigosDaCategoria(nome, Infinity)),
    secoes: secoesDe(nome).map((s) => ({ ...s, n: conta(codigosDaSecao(s.id)), linhas: [] })).filter((s) => s.n) })).filter((d) => d.n);
  document.getElementById('mDeps')?.remove();
  const largo = window.matchMedia('(min-width: 900px)').matches;
  const seta = '<svg class="dm-seta" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  const m = document.createElement('div');
  m.id = 'mDeps'; m.className = `dm-fundo ${largo ? 'largo' : 'cel'}`;
  m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Departamentos');
  // estado: dep (índice) e sec (índice) abertos; no celular, o nível mostrado
  let dep = Math.max(0, deps.findIndex((d) => d.nome === filtros.grupo)); let sec = -1;
  if (!largo) dep = -1; // celular começa sempre pela lista de departamentos
  const ir = (g, s) => {
    filtros.grupo = g; filtros.secao = s || ''; filtros.q = ''; filtros.pagina = 1;
    const q = $('q'); if (q) q.value = '';
    fechar();
    if (ctx.rota === 'cat') { marcarEndereco(); desenharChips(); desenharCatalogo(); } else ctx.ir(enderecoDoFiltro(filtros) || '/catalogo');
    document.querySelector('.bar')?.scrollIntoView({ behavior: 'smooth' });
  };
  const item = (attrs, texto, n, on, temFilhos) => `<li><button type="button" class="dm-item ${on ? 'on' : ''}" ${attrs}><span>${esc(texto)}${n ? ` <small>${n}</small>` : ''}</span>${temFilhos ? seta : ''}</button></li>`;
  const colDeps = () => `<ul class="dm-col dm-deps" role="list">${deps.map((d, i) => item(`data-dep="${i}"`, d.nome, 0, i === dep, true)).join('')}</ul>`;
  const colSecs = (d) => `<ul class="dm-col dm-secs" role="list"><li><button type="button" class="dm-tudo" data-ir-dep="${dep}">Ver tudo em ${esc(d.nome)} <small>${d.n}</small>${seta}</button></li>
    ${d.secoes.map((s, j) => item(`data-sec="${j}"`, s.nome, s.n, j === sec, s.linhas.length > 0)).join('') || '<li class="dm-vazio">Ainda sem seções.</li>'}</ul>`;
  const colLins = (d, s) => `<ul class="dm-col dm-lins" role="list"><li><button type="button" class="dm-tudo" data-ir-sec="${sec}">Ver tudo em ${esc(s.nome)} <small>${s.n}</small>${seta}</button></li>
    ${s.linhas.map((l) => item(`data-lin="${esc(l.id)}"`, l.nome, l.n, filtros.secao === l.id, false)).join('')}</ul>`;
  function pintar() {
    const d = deps[dep]; const s = d && sec >= 0 ? d.secoes[sec] : null;
    let corpo;
    if (largo) corpo = colDeps() + (d ? colSecs(d) : '') + (s && s.linhas.length ? colLins(d, s) : '');
    else if (s && s.linhas.length) corpo = `<button type="button" class="dm-voltar" data-voltar="sec">‹ Voltar</button><p class="dm-onde">${esc(d.nome)}</p>${colLins(d, s)}`;
    else if (d) corpo = `<button type="button" class="dm-voltar" data-voltar="dep">‹ Voltar</button>${colSecs(d)}`;
    else corpo = colDeps();
    m.innerHTML = `<div class="dm-caixa"><div class="dm-topo"><b>Departamentos</b><button type="button" class="dm-x" aria-label="Fechar">✕</button></div><div class="dm-corpo">${corpo}</div></div>`;
    if (largo) { const b = $('cats')?.querySelector('[data-deps]'); const r = b?.getBoundingClientRect(); const cx = m.querySelector('.dm-caixa'); if (r) { cx.style.top = `${Math.round(r.bottom + 6)}px`; cx.style.left = `${Math.max(12, Math.round(r.left))}px`; } }
  }
  const fechar = () => { m.remove(); document.removeEventListener('keydown', tecla); $('cats')?.querySelector('[data-deps]')?.focus(); };
  function tecla(e) { if (e.key === 'Escape') fechar(); }
  document.addEventListener('keydown', tecla);
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.closest('.dm-x')) { fechar(); return; }
    const b = e.target.closest('button'); if (!b) return;
    const d = deps[dep];
    if (b.dataset.voltar === 'sec') { sec = -1; pintar(); return; }
    if (b.dataset.voltar === 'dep') { dep = -1; sec = -1; pintar(); return; }
    if (b.dataset.dep !== undefined) {
      const i = Number(b.dataset.dep);
      if (largo && i === dep) { ir(deps[i].nome, ''); return; } // segundo clique no mesmo departamento: abre tudo dele
      dep = i; sec = -1; pintar(); m.querySelector('.dm-secs .dm-tudo')?.focus(); return;
    }
    if (b.dataset.irDep !== undefined) { ir(d.nome, ''); return; }
    if (b.dataset.sec !== undefined) {
      const j = Number(b.dataset.sec); const s = d.secoes[j];
      if (!s.linhas.length || (largo && j === sec)) { ir(d.nome, s.id); return; }
      sec = j; pintar(); m.querySelector('.dm-lins .dm-tudo')?.focus(); return;
    }
    if (b.dataset.irSec !== undefined) { ir(d.nome, d.secoes[Number(b.dataset.irSec)].id); return; }
    if (b.dataset.lin) ir(d.nome, b.dataset.lin);
  });
  // Computador: passar o mouse abre o departamento e a seção (sem precisar clicar).
  if (largo) {
    let espera = null;
    m.addEventListener('mouseover', (e) => {
      const b = e.target.closest('button[data-dep], button[data-sec]'); if (!b) return;
      clearTimeout(espera);
      espera = setTimeout(() => {
        if (b.dataset.dep !== undefined && Number(b.dataset.dep) !== dep) { dep = Number(b.dataset.dep); sec = -1; pintar(); }
        else if (b.dataset.sec !== undefined && Number(b.dataset.sec) !== sec) { sec = Number(b.dataset.sec); pintar(); }
      }, 120);
    });
  }
  pintar();
  document.body.appendChild(m);
  (m.querySelector('.dm-item.on') || m.querySelector('.dm-item'))?.focus();
}

/* ---------------- catálogo ---------------- */

/** "Mostrando 24 de 1.600 produtos". Sem o total (filtro por marca), só "Mostrando 24 produtos". */
/** "Você quis dizer" e "nada nesta categoria": avisa acima da contagem por que os resultados são outros. */
export function htmlAviso(aviso) {
  if (!aviso) return '';
  const partes = [];
  if (aviso.corrigida) partes.push(`Você quis dizer <b>“${esc(aviso.corrigida)}”</b>? Mostrando os resultados.`);
  if (aviso.grupo) partes.push(`Nada em ${esc(aviso.grupo)}: mostrando de todo o catálogo.`);
  return `<span class="g360-aviso-busca">${partes.join(' ')}</span> `;
}

function mostrando(vistos, total, q = '') {
  const pal = q ? (n) => (n === 1 ? 'resultado' : 'resultados') : (n) => (n === 1 ? 'produto' : 'produtos');
  const fim = q ? ` para “${esc(q)}”` : (filtros.grupo ? ` em ${esc(caminhoDoFiltro(filtros).join(' › '))}` : '');
  if (total == null) return `Mostrando <b>${vistos.toLocaleString('pt-BR')}</b> ${pal(vistos)}${fim}`;
  const t = Math.max(total, vistos);
  return `Mostrando <b>${vistos.toLocaleString('pt-BR')} de ${t.toLocaleString('pt-BR')}</b> ${pal(t)}${fim}`;
}

/** Quantos produtos estão ativos no portal (lista pronta no Supabase, uma consulta rápida).
 *  Com categoria, só os dela. Com marca, não dá para saber sem ler o catálogo: null. */
async function totalNoPortal() {
  if (filtros.marca) return null;
  const cods = await codigosAtivosPublicos();
  if (!cods) return null;
  if (!filtros.grupo) return cods.length;
  const ativos = new Set(cods);
  return codigosDoFiltro(filtros).filter((c) => ativos.has(String(c))).length;
}

/* ---------- vitrine (sem busca): só produtos com estoque ---------- */
const POR_PAGINA = 24;
let vitrine = null;   // { chave, apiPagina, apiPaginas, itens, fim }
let busca = null;     // { chave, itens, semEstoque }

/** Ordem escolhida em "Ordenar": por nome, ou pelo preço que a API mandou (só para exibir; com estoque primeiro). */
function ordenar(lista) {
  const o = $('ord').value;
  const preco = (p) => { try { return new Decimal(p.preco ?? (o === 'menor' ? '1e15' : '-1')); } catch { return new Decimal(0); } };
  lista.sort((a, b) => (temEstoque(b) - temEstoque(a))
    || (o === 'menor' ? preco(a).cmp(preco(b)) : o === 'maior' ? preco(b).cmp(preco(a)) : (pesoCurva(a) - pesoCurva(b)) || a.nome.localeCompare(b.nome, 'pt')));
  return lista;
}

/** Lê o catálogo em blocos de 50 e guarda só o que tem estoque, até encher a página pedida. */
async function resultadoVitrine() {
  const chave = `${sessao.token}|${filtros.grupo}|${filtros.secao}|${filtros.marca}|${$('ord').value}`;
  // fixos = quantos itens já apareceram em alguma página: eles não mudam mais de lugar quando chegam produtos novos
  // da API (antes, a reordenação jogava produtos da página anterior para a seguinte e alguns nunca apareciam).
  if (!vitrine || vitrine.chave !== chave) vitrine = { chave, apiPagina: 0, apiPaginas: 1, itens: [], ids: new Set(), fixos: 0, fim: false };
  const precisa = filtros.pagina * POR_PAGINA + 1;
  // Categoria do portal: a API aceita até 500 códigos por consulta, então vai em blocos de 500.
  const codigos = codigosDoFiltro(filtros);
  const blocos = codigos ? Array.from({ length: Math.ceil(codigos.length / 500) }, (_, i) => codigos.slice(i * 500, i * 500 + 500)) : [null];
  if (codigos && !codigos.length) vitrine.fim = true;
  vitrine.bloco ??= 0;
  let lidas = 0;
  while (!vitrine.fim && vitrine.itens.length < precisa && lidas < 8) {
    const pagina = vitrine.apiPagina + 1;
    const marca = filtros.marca ? Number(filtros.marca) : undefined;
    const bloco = blocos[vitrine.bloco];
    const { dados, paginacao } = bloco
      ? await buscarProdutos(sessao.token, { codigos: bloco, marca, pagina, limite: 50 })
      : await listarProdutos(sessao.token, { marca, pagina, limite: 50 });
    vitrine.apiPagina = pagina; lidas += 1;
    // Páginas pelo limite que a API devolveu (se ela entregar menos que 50 por página, continua lendo).
    vitrine.apiPaginas = Math.max(1, Math.ceil((paginacao?.total || 0) / (Number(paginacao?.limite) || 50)));
    // Sem repetir: o mesmo produto em duas páginas da API (ou em dois blocos) entra uma vez só.
    for (const p of dados.map(apresentar)) {
      if (vitrine.ids.has(Number(p.id)) || !temEstoque(p) || oculto(p) || abaixoDoMinimo(p)) continue;
      vitrine.ids.add(Number(p.id)); vitrine.itens.push(p);
    }
    if (pagina >= vitrine.apiPaginas) {
      if (vitrine.bloco + 1 < blocos.length) { vitrine.bloco += 1; vitrine.apiPagina = 0; } else vitrine.fim = true;
    }
  }
  // Só reordena o que ainda não foi mostrado; as páginas já vistas ficam como estavam.
  const novos = vitrine.itens.splice(vitrine.fixos); ordenar(novos); vitrine.itens.push(...novos);
  const ini = (filtros.pagina - 1) * POR_PAGINA;
  const itens = vitrine.itens.slice(ini, ini + POR_PAGINA);
  vitrine.fixos = Math.max(vitrine.fixos, Math.min(vitrine.itens.length, ini + POR_PAGINA));
  const temMais = !vitrine.fim || vitrine.itens.length > ini + POR_PAGINA;
  return { itens, total: vitrine.itens.length, temMais, aindaLendo: !vitrine.fim, paginas: temMais ? filtros.pagina + 1 : filtros.pagina };
}

/* A lista do que aparece no portal (visitante e filtros do painel) é gravada pelo painel,
   no botão "Atualizar produtos do portal". O navegador do cliente só lê a página que está vendo. */

/* Busca rápida: todas as consultas da busca saem juntas (em paralelo), e produto já consultado há pouco
   não é pedido de novo. Os preços e o estoque desta lista servem para mostrar; quem decide é a revisão. */
const RECENTE_MS = 90_000;
const produtosRecentes = new Map(); // codigo → { p, t } (resposta da API, já apresentada)
const buscasRecentes = new Map();   // chave da busca → { itens, semEstoque, t }
// A chave leva o token: preço é do comprador logado, nunca passa para outro.
function guardarRecente(p) { produtosRecentes.set(`${sessao.token}|${p.codigo}`, { p, t: Date.now() }); }
function recente(codigo) { const r = produtosRecentes.get(`${sessao.token}|${codigo}`); return r && Date.now() - r.t < RECENTE_MS ? r.p : null; }
export function esquecerBuscasRecentes() { produtosRecentes.clear(); buscasRecentes.clear(); }

/** Uma rodada da busca (nomes do portal + API) numa categoria ('' = catálogo inteiro). */
async function buscarItens(q, grupo) {
  const marca = filtros.marca ? Number(filtros.marca) : undefined;
  const locais = buscarLocal(q, { categoria: grupo, max: 150 });
  const pontos = new Map(locais.map((l) => [l.codigo, l.pontos]));
  // Faixa de relevância: o que bate bem com a busca vem antes do que só bate de leve (ex.: só o começo de uma palavra).
  const maxPontos = Math.max(1, ...locais.map((l) => l.pontos));
  const faixa = (p) => { const v = pontos.get(String(p.codigo)) || 0; return v >= maxPontos * 0.8 ? 2 : v >= maxPontos * 0.5 ? 1 : 0; };
  const achados = new Map();
  // 1) Os mais relevantes pelo nome do portal: o que já foi consultado há pouco não vai de novo à API.
  const faltam = [];
  for (const l of locais) { const r = !marca && recente(l.codigo); if (r) achados.set(Number(r.id), r); else faltam.push(l.codigo); }
  const blocos = [];
  for (let i = 0; i < faltam.length; i += 50) blocos.push(faltam.slice(i, i + 50));
  // 2) A busca do G360 (pega código de barras, aplicação e o que ainda não tem nome no portal).
  //    Termos alternativos: a busca digitada e as variações pelos sinônimos (basta um bater).
  const vs = variacoes(q);
  // Uma palavra só (código de barras, aplicação): vale o que o G360 achar. Duas ou mais: precisa bater no nome.
  const umaPalavra = q.trim().split(/\s+/).length === 1;
  const pedidos = [
    ...blocos.map((b) => buscarProdutos(sessao.token, { codigos: b, marca, limite: 50 })),
    listarProdutos(sessao.token, termosG360(q, vs) ? { termos: termosG360(q, vs), marca, limite: 50 } : { q: q, marca, limite: 50 }),
  ];
  const res = await Promise.allSettled(pedidos);
  res.slice(0, blocos.length).forEach((r) => { if (r.status === 'fulfilled') r.value.dados.forEach((p) => { const a = apresentar(p); guardarRecente(a); achados.set(Number(p.id), a); }); });
  const api = res[res.length - 1];
  if (api.status === 'fulfilled') {
    // A busca do G360 acha palavra solta em qualquer lugar ("5" e "litros" no Removedor 5L): só entra o que tem
    // todas as palavras da busca no nome (ou numa das variações pelos sinônimos).
    api.value.dados.map(apresentar).filter((p) => (!grupo || p.categoria === grupo) && (pontos.has(String(p.codigo)) || umaPalavra || vs.some((v) => nomeBate(v, `${p.nome} ${p.nome_g360 || ''} ${p.codigo}`))))
      .forEach((p) => { guardarRecente(p); if (!achados.has(Number(p.id))) { achados.set(Number(p.id), p); if (!pontos.has(String(p.codigo))) pontos.set(String(p.codigo), maxPontos * 0.6); } });
  }
  const falha = res.find((r) => r.status === 'rejected');
  if (falha && (!achados.size || falha.reason?.status === 401)) throw falha.reason;
  // Ordem: com estoque primeiro; depois o que mais bate com a busca; na mesma faixa, os mais vendidos (curva A, B, C).
  const naSecao = filtros.secao && grupo ? new Set(codigosDoFiltro(filtros) || []) : null;
  const todos = [...achados.values()].filter((p) => !oculto(p) && !abaixoDoMinimo(p) && (!soEstoque() || temEstoque(p)) && (!naSecao || naSecao.has(String(p.codigo)))).sort((a, b) => (temEstoque(b) - temEstoque(a)) || (faixa(b) - faixa(a))
    || (pesoCurva(a) - pesoCurva(b)) || ((pontos.get(String(b.codigo)) || 0) - (pontos.get(String(a.codigo)) || 0)) || a.nome.localeCompare(b.nome, 'pt'));
  return { todos, falha };
}

/** Busca: nomes do portal (tolerante) + busca da API (código, EAN, aplicação); com estoque primeiro. */
async function resultadoBusca() {
  const chave = `${sessao.token}|${filtros.q}|${filtros.grupo}|${filtros.secao}|${filtros.marca}`;
  if (!busca || busca.chave !== chave) {
    const guardada = buscasRecentes.get(chave);
    if (guardada && Date.now() - guardada.t < RECENTE_MS) busca = { chave, itens: [...guardada.itens], semEstoque: guardada.semEstoque, aviso: guardada.aviso, ordem: '' };
  }
  if (!busca || busca.chave !== chave) {
    // 1) Na categoria escolhida. 2) Nada lá: no catálogo inteiro. 3) Ainda nada: corrige a palavra ("liva" → "luva").
    let r = await buscarItens(filtros.q, filtros.grupo);
    let aviso = null;
    // As rodadas extras não derrubam a tela: se falharem (fora a sessão encerrada), fica o "nada encontrado".
    const tentar = async (q, g) => { try { return await buscarItens(q, g); } catch (e) { if (e?.status === 401) throw e; return { todos: [], falha: e }; } };
    if (!r.todos.length && filtros.grupo) { const t = await tentar(filtros.q, ''); if (t.todos.length) { r = t; aviso = { grupo: filtros.grupo }; } }
    if (!r.todos.length) {
      const certo = corrigirBusca(filtros.q);
      if (certo) {
        let t = await tentar(certo, filtros.grupo); let g = null;
        if (!t.todos.length && filtros.grupo) { t = await tentar(certo, ''); g = filtros.grupo; }
        if (t.todos.length) { r = t; aviso = { corrigida: certo, grupo: g }; }
      }
    }
    const todos = r.todos;
    busca = { chave, itens: todos, semEstoque: todos.filter((p) => !temEstoque(p)).length, ordem: '', aviso };
    if (!r.falha) {
      buscasRecentes.set(chave, { itens: [...todos], semEstoque: busca.semEstoque, aviso, t: Date.now() });
      if (buscasRecentes.size > 30) buscasRecentes.delete(buscasRecentes.keys().next().value);
    }
    registrarBusca(filtros.q, todos.length);
  }
  if (busca.ordem !== $('ord').value) { busca.ordem = $('ord').value; if (busca.ordem !== 'nome') ordenar(busca.itens); }
  const ini = (filtros.pagina - 1) * POR_PAGINA;
  return { itens: busca.itens.slice(ini, ini + POR_PAGINA), total: busca.itens.length, semEstoque: busca.semEstoque, aviso: busca.aviso, temMais: false, paginas: Math.max(1, Math.ceil(busca.itens.length / POR_PAGINA)) };
}

function conviteEntrar(grid, extra = '') {
  grid.innerHTML = `<div class="empty g360-convite">${extra}<b>Entre para ver o catálogo e os seus preços.</b>
    <p>O portal é exclusivo para empresas clientes da Souza Ribeiro.</p>
    <div class="act" style="justify-content:center"><button type="button" class="btn pri" id="gEntrar">Entrar</button><button type="button" class="btn out" id="gCadastro">Quero ser cliente</button></div></div>`;
  $('gCadastro').onclick = () => abrirCadastro(ctxCadastro());
  $('gEntrar').onclick = () => abrirLogin();
}

/** Visitante: catálogo aberto (vitrine) com "Entre para ver os preços". Vitrine fechada → convite para entrar. */
async function desenharCatalogoPublico(grid, pag) {
  const meu = ++buscaN;
  grid.innerHTML = '<div class="empty">Carregando produtos…</div>';
  try {
    // Visitante que veio pelo link de um executivo: os produtos que os clientes dele não veem já ficam de fora.
    await carregarExibicao();
    if (await carregarOcultosVisitante(() => { limparVisitante(); desenharCatalogo(); })) limparVisitante();
    const r = await resultadoPublico(filtros);
    if (meu !== buscaN || sessao.ativa) return;
    $('cnt').innerHTML = htmlAviso(r.aviso) + mostrando((filtros.pagina - 1) * POR_PAGINA + r.itens.length, r.total, r.aviso?.corrigida || filtros.q) + ' · entre para ver os preços';
    grid.innerHTML = r.itens.length ? r.itens.map(htmlCartaoPublico).join('')
      : `<div class="empty">${filtros.q ? `Nada encontrado para “${esc(filtros.q)}”. Tente outra palavra ou o código do produto.` : 'Nenhum produto nesta seleção.'}</div>`;
    ligarTrocaFotos(grid);
    if (r.paginas > 1) {
      pag.innerHTML = `<button type="button" class="tool" id="gAnt" ${filtros.pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button><span>Página <b>${filtros.pagina}</b> de ${r.paginas}</span><button type="button" class="tool" id="gProx" ${filtros.pagina >= r.paginas ? 'disabled' : ''}>Próxima ›</button>`;
      const mudar = (d) => { filtros.pagina += d; desenharCatalogo(); document.querySelector('.bar')?.scrollIntoView({ behavior: 'smooth' }); };
      $('gAnt').onclick = () => mudar(-1); $('gProx').onclick = () => mudar(1);
    }
  } catch {
    if (meu !== buscaN || sessao.ativa) return;
    // Vitrine fechada ou indisponível (às vezes aparece como erro de CORS): oferece o login.
    $('cnt').innerHTML = '';
    document.querySelector('.bar').style.display = 'none';
    conviteEntrar(grid);
  }
}

/** Carrinho guardado (F5 ou novo login): busca preço, selo e estoque do momento na API (filtro ids, de uma vez). */
let atualizandoCarrinho = null;
function atualizarCarrinhoGuardado() {
  if (!sessao.ativa || atualizandoCarrinho || !linhasSemPrecoAtual().length) return;
  const token = sessao.token;
  atualizandoCarrinho = (async () => {
    try {
      await carregarExibicao();
      const achados = await produtosPorIds(token, linhasSemPrecoAtual().map((l) => l.produto_id));
      if (sessao.token !== token) return;
      for (const l of linhasSemPrecoAtual()) {
        const p = achados.get(Number(l.produto_id));
        if (!p) { atualizarLinha(l.produto_id, l.unidade, { precoTexto: null }); continue; }
        const n = linhaCarrinho(apresentar(p), l.unidade || '', l.quantidade);
        atualizarLinha(l.produto_id, l.unidade, { nome: n.nome, codigo: n.codigo, unidadeNome: n.unidadeNome, precoTexto: n.precoTexto, seu_preco: n.seu_preco, disponivel: n.disponivel, fotos: n.fotos });
      }
    } catch { /* sem preço agora: a revisão do pedido confere tudo */ } finally { atualizandoCarrinho = null; }
  })();
}

/* ---------------- banners ---------------- */

// Banners só na vitrine principal: some durante uma busca ou com categoria escolhida.
function atualizarBanners() {
  const el = $('banners'); if (!el) return;
  if (ctx?.rota !== 'cat' || filtros.q || filtros.grupo) { el.hidden = true; pausarBanners(); return; }
  desenharBanners(el, abrirDestinoBanner);
}

function rolarParaGrade() {
  setTimeout(() => {
    const topo = (document.querySelector('header')?.getBoundingClientRect().height || 0) + 12;
    window.scrollTo({ top: Math.max(0, window.scrollY + $('grid').getBoundingClientRect().top - topo - 60), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, 80);
}

async function abrirDestinoBanner(b) {
  const v = String(b.destino_valor || '');
  if (b.destino_tipo === 'categoria' || b.destino_tipo === 'busca') {
    filtros.grupo = b.destino_tipo === 'categoria' ? v : '';
    filtros.q = b.destino_tipo === 'busca' ? v : ''; $('q').value = filtros.q;
    filtros.pagina = 1; desenharChips(); desenharCatalogo(); rolarParaGrade();
  } else if (b.destino_tipo === 'produto') {
    if (!sessao.ativa) { filtros.grupo = ''; filtros.q = v; $('q').value = v; filtros.pagina = 1; desenharChips(); desenharCatalogo(); rolarParaGrade(); return; }
    try {
      const { dados } = await buscarProdutos(sessao.token, { codigos: [v], limite: 1 });
      if (dados[0]) abrirDetalheLoja(apresentar(dados[0])); else toast('Este produto não está disponível no momento.');
    } catch (e) { toast(e.message); }
  } else if (b.destino_tipo === 'lista') exigirLogin(() => ctx.ir('/minha-lista'));
  else if (b.destino_tipo === 'cadastro') abrirCadastro(ctxCadastro());
}

export async function desenharCatalogo() {
  atualizarBanners();
  atualizarCarrinhoGuardado();
  sincronizarCarrinho();
  const grid = $('grid'); const pag = $('g360Pag');
  pag.innerHTML = '';
  document.querySelector('.bar').style.display = '';
  if (!sessao.ativa) { await desenharCatalogoPublico(grid, pag); return; }
  const meu = ++buscaN;
  // Durante a busca, os cartões anteriores ficam na tela (esmaecidos) até chegar o resultado novo.
  if (filtros.q && filtros.pagina === 1 && grid.querySelector('.card')) grid.classList.add('buscando');
  else grid.innerHTML = '<div class="empty">Carregando produtos…</div>';
  // Minha Lista em paralelo com os produtos (antes, um esperava o outro).
  const idsP = idsCarregados() === null ? carregarIds().catch(() => null) : null;
  try {
    await carregarExibicao();
    // Cliente de executivo com produtos escondidos: a lista vem antes dos produtos (no máximo 2,5 s).
    const esquecer = () => { vitrine = null; busca = null; esquecerBuscasRecentes(); };
    if (await carregarOcultosComprador(() => { esquecer(); desenharCatalogo(); })) esquecer();
    const r = filtros.q ? await resultadoBusca() : await resultadoVitrine();
    if (idsP) { await idsP; desenharTopo(); }
    if (meu !== buscaN) return;
    grid.classList.remove('buscando');
    const dados = r.itens;
    if (!filtros.q && !filtros.grupo && !filtros.marca && classificacoes && classificacoes.total === null) { classificacoes.total = ''; }
    const vistos = (filtros.pagina - 1) * POR_PAGINA + dados.length;
    $('cnt').innerHTML = filtros.q
      ? htmlAviso(r.aviso) + mostrando(vistos, r.total, r.aviso?.corrigida || filtros.q) + (r.semEstoque ? ` · ${r.semEstoque} sem estoque no fim da lista` : '')
      : (dados.length ? mostrando(vistos, await totalNoPortal()) : '');
    produtosDaTela = new Map(dados.map((p) => [Number(p.id), p]));
    const lista = idsCarregados();
    grid.innerHTML = dados.length ? dados.map((p) => htmlCartao(p, { naLista: lista ? lista.has(Number(p.id)) : null })).join('')
      : `<div class="empty">${filtros.q ? `Nada encontrado para “${esc(filtros.q)}”. Tente outra palavra, o código do produto ou menos palavras.` : 'Nenhum produto com estoque nesta seleção.'}${filtros.q || filtros.grupo || filtros.marca ? '<br><button type="button" class="tool" id="gLimpar" style="margin-top:12px">Limpar busca e filtros</button>' : ''}</div>`;
    $('gLimpar')?.addEventListener('click', () => { limparLoja(); desenharChips(); $('marca').value = ''; desenharCatalogo(); });
    ligarFotos(grid);
    const paginas = r.paginas;
    if (paginas > 1 || r.temMais) {
      pag.innerHTML = `<button type="button" class="tool" id="gAnt" ${filtros.pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button>
        <span>Página <b>${filtros.pagina}</b>${r.temMais ? '' : ` de ${paginas}`}</span>
        <button type="button" class="tool" id="gProx" ${filtros.pagina >= paginas && !r.temMais ? 'disabled' : ''}>Próxima ›</button>`;
      const mudar = (d) => { filtros.pagina += d; desenharCatalogo(); document.querySelector('.bar')?.scrollIntoView({ behavior: 'smooth' }); };
      $('gAnt').onclick = () => mudar(-1); $('gProx').onclick = () => mudar(1);
    }
  } catch (e) {
    if (meu !== buscaN) return;
    grid.classList.remove('buscando');
    grid.innerHTML = '<div class="empty g360-erro"></div>';
    mostrarMensagemErro(grid.firstElementChild, e, { aoTentarDeNovo: desenharCatalogo });
  }
}

/** Janela de detalhes com Minha Lista, clip do produto e "Negociar preço". */
function abrirDetalheLoja(p, aoMudarLista) {
  const lista = idsCarregados();
  const clip = clipDoProduto(p);
  abrirDetalhe(p, {
    naLista: lista ? lista.has(Number(p.id)) : null,
    aoFavoritar: async (prod, estava) => {
      if (estava) await removerDaLista(prod.id); else await incluirNaLista(prod.id);
      aoMudarLista?.(!estava);
      toast(estava ? 'Removido da Minha Lista' : 'Adicionado à Minha Lista ⭐');
      return !estava;
    },
    aoClip: clip ? () => ctx.ir('/clips', { clip: clip.id }) : null,
    videoUrl: clip ? urlClip(clip.caminho) : null,
    aoNegociar: sessao.ativa && sessao.supabaseOk ? (prod, op, qtd) => abrirNegociacao([{ produto: prod, op, quantidade: qtd }]) : null,
  });
}

function opcoesClips() {
  return {
    exigirLogin,
    abrirDetalhe: (p) => abrirDetalheLoja(p),
    naLista: (p) => { const l = idsCarregados(); return l ? l.has(Number(p.id)) : null; },
    alternarLista: async (p) => { const l = idsCarregados(); const estava = l?.has(Number(p.id)); if (estava) await removerDaLista(p.id); else await incluirNaLista(p.id); toast(estava ? 'Removido da Minha Lista' : 'Adicionado à Minha Lista ⭐'); return !estava; },
  };
}

async function cliqueCartao(e) {
  const card = e.target.closest('.card'); if (!card) return;
  if (card.classList.contains('publico')) { abrirLogin(); return; }
  const p = produtosDaTela.get(Number(card.dataset.id)); if (!p) return;
  const un = e.target.closest('.unsel [data-un]');
  if (un) {
    card.dataset.un = un.dataset.un;
    card.querySelectorAll('.unsel button').forEach((b) => b.classList.toggle('on', b === un));
    card.querySelector('.price').innerHTML = htmlPreco(unidadeEscolhida(p, un.dataset.un), true);
    return;
  }
  const d = e.target.closest('[data-d]');
  if (d) {
    const i = card.querySelector('.qty input');
    const r = somar(p, card.dataset.un, normalizarQuantidade(i.value) || '1', normalizarQuantidade(passoQuantidade(i.value, Number(d.dataset.d))) || '1');
    i.value = String(r.valor).replace('.', ','); if (r.msg) toast(r.msg);
    return;
  }
  if (e.target.closest('.add')) {
    const campo = card.querySelector('.qty input');
    const q = normalizarQuantidade(campo.value);
    if (!q) { toast('Quantidade inválida: use um número maior que zero, com até 4 casas depois da vírgula.'); campo.focus(); return; }
    const semSaldo = conferir(p, card.dataset.un, q); if (semSaldo) { toast(semSaldo); campo.focus(); return; }
    const r = adicionar(linhaCarrinho(p, card.dataset.un, q));
    if (r === 'limite') { toast('O carrinho aceita até 100 linhas. Envie este pedido ou remova itens.'); return; }
    campo.value = '1';
    toast(`${r === 'somado' ? 'Quantidade somada' : 'Adicionado'} · ${p.nome.slice(0, 40)}${p.nome.length > 40 ? '…' : ''}`);
    return;
  }
  // Foto ou nome: abre o detalhe do produto.
  if (!e.target.closest('.fav') && (e.target.closest('.img') || e.target.closest('.name'))) {
    abrirDetalheLoja(p, (agora) => {
      const f = card.querySelector('.fav');
      if (f) { f.classList.toggle('on', agora); f.setAttribute('aria-pressed', String(agora)); f.textContent = agora ? '⭐ Na lista' : '☆ Lista'; }
    });
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
  sincronizarCarrinho();
  desenharCarrinho();
  $('drawer').classList.add('open'); $('shade').classList.add('open');
}
export function fecharCarrinho() { $('drawer').classList.remove('open'); $('shade').classList.remove('open'); liberarFotosDaTela(); }

function desenharCarrinho() {
  const it = linhasCarrinho();
  $('dBody').innerHTML = it.length ? it.map((l) => `<div class="ci" data-k="${esc(`${l.produto_id}|${l.unidade ?? ''}`)}">
      ${htmlFoto({ id: l.produto_id, nome: l.nome, fotos: (l.fotos || []).slice(0, 1) }, 'g360-mini')}
      <div class="n">${esc(l.nome)}<small>${l.precoTexto ? `${esc(dinheiro(l.precoTexto))}${l.unidade ? ` / ${esc(String(l.unidadeNome).toLowerCase())}` : ''}` : (l.unidade ? esc(l.unidadeNome) : '')}${l.seu_preco ? ' <span class="tagcg">Seu preço</span>' : ''}</small>
        <div class="qty" style="margin-top:6px;width:max-content"><button type="button" data-d="-1" aria-label="Diminuir">−</button><input type="text" inputmode="decimal" value="${esc(String(l.quantidade).replace('.', ','))}" maxlength="13" aria-label="Quantidade"><button type="button" data-d="1" aria-label="Aumentar">+</button></div></div>
      <div class="r">${l.precoTexto ? esc(dinheiro(estimar([l]).total)) : '—'}<br><button type="button" class="x">Remover</button></div></div>`).join('')
    : '<div class="empty2">Seu carrinho está vazio.</div>';
  const est = estimar(it);
  $('dTot').textContent = dinheiro(est.total);
  const rot = document.querySelector('.df .t span'); if (rot) rot.textContent = 'Total estimado';
  if (!$('dEst')) document.querySelector('.df .t').insertAdjacentHTML('afterend', '<p class="hint" id="dEst" style="margin:-8px 0 12px">Os valores que valem aparecem na revisão do pedido.</p>');
  // Pedido mínimo da loja (GET loja). Quem decide se pode enviar é a revisão (pendência PEDIDO_MINIMO_LOJA).
  const minimo = ctx?.loja?.pedido_minimo;
  if (!$('dMin')) $('dEst').insertAdjacentHTML('afterend', '<p class="hint" id="dMin" style="margin:-6px 0 12px"></p>');
  $('dMin').innerHTML = minimo ? `Pedido mínimo: <b>${esc(dinheiro(minimo))}</b> em produtos (sem frete).` : '';
  $('dGo').disabled = !it.length;
  $('dGo').textContent = 'Revisar pedido';
  ligarFotos($('dBody'));
}

/** No carrinho: com a loja bloqueando venda sem estoque, a linha não passa do disponível guardado ao adicionar. */
function limiteLinha(pid, uni, q) {
  if (sessao.loja?.bloqueia_sem_estoque !== true) return null;
  const l = linhasCarrinho().find((x) => Number(x.produto_id) === pid && String(x.unidade ?? '') === String(uni || ''));
  if (!l || l.disponivel === null || l.disponivel === undefined) return null;
  return Number(q) > Number(l.disponivel) ? 'Quantidade acima do estoque disponível.' : null;
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
    const q = normalizarQuantidade(novo); if (!q) return;
    const msg = limiteLinha(Number(pid), uni, q); if (msg) { toast(msg); return; }
    alterarQuantidade(Number(pid), uni || null, q);
  }
}
function mudancaCarrinho(e) {
  const r = e.target.closest('.ci'); if (!r) return;
  const [pid, uni] = r.dataset.k.split('|');
  const q = normalizarQuantidade(e.target.value);
  if (!q) { toast('Quantidade inválida: use um número maior que zero.'); desenharCarrinho(); return; }
  const msg = limiteLinha(Number(pid), uni, q); if (msg) { toast(msg); desenharCarrinho(); return; }
  alterarQuantidade(Number(pid), uni || null, q);
}

/* ---------------- login (modal original) ---------------- */

let depoisDoLogin = null;

/* CPF/CNPJ lembrado: só no app instalado (o celular é do próprio cliente), nunca no navegador comum,
   que pode ser um computador compartilhado. A senha NUNCA é guardada pelo portal: quem guarda e
   preenche com o Face ID é o gerenciador de senhas do aparelho. "Usar outro CPF/CNPJ" apaga. */
const CHAVE_DOC = `g360:${String(import.meta.env.VITE_G360_LOJA || '').trim()}:comprador:documento`;
const ehAppInstalado = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
function docLembrado() { try { return ehAppInstalado() ? localStorage.getItem(CHAVE_DOC) || '' : ''; } catch { return ''; } }
function lembrarDoc(d) { try { if (d && ehAppInstalado()) localStorage.setItem(CHAVE_DOC, d); else localStorage.removeItem(CHAVE_DOC); } catch { /* sem armazenamento */ } }

function ligarLogin() {
  $('lgCad').textContent = 'Quero ser cliente';
  $('lgCad').onclick = () => { fecharModal('mLogin'); abrirCadastro(ctxCadastro()); };
  // Sem "Primeiro acesso" (23/11): quem ainda não é cliente usa "Quero ser cliente"; a equipe confere o e-mail no G360
  // e manda o link pelo painel. O "Esqueci minha senha" continua para quem já tem senha.
  $('lgEsqL').textContent = 'Esqueci minha senha';
  if (!$('lgSemSenha')) $('lgEsqL').insertAdjacentHTML('afterend', ' · <a id="lgSemSenha" href="#" role="button">Ainda não tenho senha</a>');
  $('lgSemSenha').onclick = (e) => { e.preventDefault(); fecharModal('mLogin'); abrirCadastro(ctxCadastro(), { jaCliente: true }); };
  $('lgEsqL').onclick = () => { fecharModal('mLogin'); ctx.ir('/esqueci-senha'); };
  $('lgAdm').textContent = 'Acesso da equipe Souza Ribeiro';
  $('lgAdm').onclick = () => { fecharModal('mLogin'); ctx.ir('/painel'); };
  $('lgVolta').hidden = true; $('lgEsq').hidden = true; $('lgAdmT').hidden = true;
  $('lgL').textContent = 'CPF ou CNPJ';
  const doc = $('lgC');
  doc.placeholder = 'Digite com ou sem pontuação'; doc.inputMode = 'text'; doc.maxLength = 32; doc.autocapitalize = 'characters';
  $('lgS').maxLength = 64;
  if (!$('lgOutro')) $('lgL').insertAdjacentHTML('afterend', '<button type="button" class="lg-outro" id="lgOutro" hidden>Usar outro CPF/CNPJ</button>');
  $('lgOutro').onclick = () => { lembrarDoc(''); doc.value = ''; $('lgOutro').hidden = true; doc.focus(); };
  if (!$('lgRes')) $('lgE').insertAdjacentHTML('afterend', '<div id="lgRes" aria-live="polite"></div><p class="hint" id="lgSessao"></p>');
  if (!$('lgContW')) $('lgE').insertAdjacentHTML('beforebegin', `<div class="lg-cont" id="lgContW" hidden>
    <label for="lgCont"><input type="checkbox" id="lgCont"><span>Continuar conectado</span></label>
    <small>Não marque em computador compartilhado.</small></div>`);
  $('lgX').onclick = () => { fecharModal('mLogin'); depoisDoLogin = null; };
  // Formulário de verdade: o navegador oferece salvar o CNPJ e a senha e preenche no próximo login.
  // O Enter na senha envia o formulário (clique no botão Entrar); a página não recarrega.
  $('lgForm').onsubmit = (e) => e.preventDefault();
  $('lgC').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('lgS').focus(); } };
  $('lgS').onkeydown = null;
  $('lgOk').onclick = async () => {
    const usuario = doc.value.trim(); const senha = $('lgS').value;
    $('lgE').textContent = ''; $('lgRes').innerHTML = '';
    if (!usuario) { $('lgE').textContent = 'Digite o CPF ou CNPJ.'; doc.focus(); return; }
    if (!senha) { $('lgE').textContent = 'Digite a senha.'; $('lgS').focus(); return; }
    $('lgOk').disabled = true; $('lgOk').textContent = 'Entrando…';
    try {
      const continuar = !$('lgContW').hidden && $('lgCont').checked;
      await entrar(usuario, senha, continuar);
      lembrarDoc(usuario);
      // Para o iPhone/Safari (e o Chrome) oferecerem "Salvar senha": depois do login aceito,
      // o formulário sai da página ainda preenchido e volta vazio (mesmos elementos, mesmos eventos).
      const form = $('lgForm'); const lugar = document.createComment('lgForm');
      form.replaceWith(lugar);
      await new Promise((r) => setTimeout(r, 120));
      form.querySelector('#lgS').value = '';
      lugar.replaceWith(form);
      fecharModal('mLogin');
      ctx.aoEntrar(); pintarChamadaCadastro();
      limparEventosSessao(); registrarAcesso();
      setTimeout(() => { convidarNoRodape().catch(() => {}); }, 1500); // convite para os avisos do pedido (se ainda não ativou)
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

/** "Quero ser cliente" com atalhos para quem já tem cadastro: Entrar (com o documento já digitado) e Esqueci minha senha. */
function ctxCadastro() {
  return { ...ctx, abrirLogin: (documento) => { abrirLogin(); if (documento) { $('lgC').value = documento; setTimeout(() => $('lgS').focus(), 80); } } };
}

export function abrirLogin(depois = null, mensagemErro = null, mensagemOk = null) {
  depoisDoLogin = depois;
  $('lgE').textContent = mensagemErro || '';
  $('lgRes').innerHTML = mensagemOk ? `<div class="rv-aviso">${esc(mensagemOk)}</div>` : '';
  const min = Number(ctx?.loja?.sessao_minutos);
  // Continuar conectado: só com continuar_conectado_dias > 0 em GET loja; sem o campo, vale zero.
  const dias = Number(ctx?.loja?.continuar_conectado_dias);
  const comLonga = Number.isFinite(dias) && dias > 0;
  $('lgContW').hidden = !comLonga;
  $('lgCont').checked = false; // sempre começa desmarcada
  $('lgSessao').textContent = Number.isFinite(min)
    ? `Por segurança, a sessão encerra após ${min} minuto${min === 1 ? '' : 's'} sem uso${comLonga ? ', a menos que você marque Continuar conectado' : ''}.`
    : '';
  const semTroca = ctx?.loja?.troca_senha !== true;
  $('lgEsqL').style.display = semTroca ? 'none' : '';
  // Sem troca de senha pelo portal, a senha é do fornecedor: não oferece "Ainda não tenho senha".
  $('lgSemSenha').style.display = semTroca ? 'none' : ''; $('lgSemSenha').previousSibling.textContent = semTroca ? '' : ' · ';
  const lembrado = docLembrado();
  if (lembrado && !$('lgC').value) $('lgC').value = lembrado;
  $('lgOutro').hidden = !lembrado;
  abrirModal('mLogin');
  // Com o CPF/CNPJ já preenchido, vai direto para a senha; senão, para o documento
  // (só se a pessoa ainda não clicou em outro campo do modal).
  setTimeout(() => { if (!$('mLogin').contains(document.activeElement)) ($('lgC').value ? $('lgS') : $('lgC')).focus(); }, 50);
}

/* ---------------- Minha conta (modal original) ---------------- */


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
    <section class="avisos-conta" aria-labelledby="avTit"><h3 id="avTit" style="margin-top:18px">Avisos neste celular</h3><div id="avCorpo" aria-live="polite"><div class="hint">Verificando…</div></div></section>
    ${troca ? `<h3 style="margin-top:18px">Trocar senha</h3>
      <label for="tAtual">Senha atual</label><input id="tAtual" type="password" maxlength="64" autocomplete="current-password">
      <label for="tNova1">Senha nova</label><input id="tNova1" type="password" maxlength="8" autocomplete="new-password" aria-describedby="tRegra">
      ${htmlRegraSenha('tRegra')}
      <label for="tNova2">Repita a senha nova</label><input id="tNova2" type="password" maxlength="8" autocomplete="new-password">
      <div class="err" id="tErro"></div><div id="tRes" aria-live="polite"></div>`
      : '<div class="hint" style="margin-top:14px">A senha de acesso é definida pela Souza Ribeiro. Para trocar a sua, fale com o seu vendedor.</div>'}
    <div class="act"><button type="button" class="btn del" id="cSair">Sair da conta</button><button type="button" class="btn sec" id="cFechar">Fechar</button>${troca ? '<button type="button" class="btn pri" id="cTrocar">Trocar senha</button>' : ''}</div>`;
  abrirModal('mConta');
  desenharAvisos();
  $('cFechar').onclick = () => fecharModal('mConta');
  $('cSair').onclick = () => { fecharModal('mConta'); sair(); };
  const b = $('cTrocar'); if (!b) return;
  ligarRegraSenha($('tRegra'), $('tNova1'), $('tNova2'), c.codigo);
  b.onclick = async () => {
    const atual = $('tAtual'); const n1 = $('tNova1'); const n2 = $('tNova2'); const erro = $('tErro');
    erro.textContent = ''; $('tRes').innerHTML = '';
    if (!atual.value) { erro.textContent = 'Digite a senha atual.'; atual.focus(); return; }
    if (!FORMATO_SENHA.test(n1.value)) { erro.textContent = `A senha nova não segue a regra: ${REGRA}`; n1.focus(); return; }
    if (n1.value !== n2.value) { erro.textContent = 'As duas senhas novas não são iguais.'; n2.focus(); return; }
    if (c.codigo != null && n1.value === String(c.codigo)) { erro.textContent = 'A senha nova não pode ser igual ao seu código de cliente.'; n1.focus(); return; }
    b.disabled = true;
    try {
      await trocarSenha(atual.value, n1.value);
      atual.value = n1.value = n2.value = '';
      $('tRes').innerHTML = '<div class="rv-aviso"><b>Senha trocada.</b> Use a senha nova no próximo acesso. As outras sessões abertas foram encerradas.</div>';
    } catch (e) { mostrarMensagemErro($('tRes'), e); } finally { b.disabled = false; }
  };
}

/* ---------------- avisos no celular (Minha conta) ---------------- */

async function desenharAvisos(msg = '') {
  const el = $('avCorpo'); if (!el) return;
  const st = await situacaoAvisos();
  const extra = msg ? `<div class="rv-aviso" style="margin-top:8px">${esc(msg)}</div>` : '';
  if (st === 'instalar_primeiro') { el.innerHTML = '<div class="hint">No iPhone, os avisos funcionam com o app instalado. Instale pelo link "Instalar app no celular", no rodapé, e abra o portal pelo ícone na tela de início.</div>' + extra; return; }
  if (st === 'sem_suporte') { el.innerHTML = '<div class="hint">Este navegador não recebe avisos. No iPhone, use o app instalado (iOS 16.4 ou mais novo).</div>' + extra; return; }
  if (st === 'bloqueado') { el.innerHTML = '<div class="hint">Os avisos estão bloqueados para este app. Para liberar: Ajustes do celular → Notificações → Souza Ribeiro → Permitir Notificações.</div>' + extra; return; }
  if (st === 'ativo') {
    el.innerHTML = `<div class="hint">Avisos <b>ativados</b> neste celular.</div>
      <div class="avisos-acoes"><button type="button" class="btn pri" id="avTeste">Enviar aviso de teste</button><button type="button" class="btn sec" id="avDesl">Desativar</button></div>${extra}`;
    $('avTeste').onclick = async () => {
      $('avTeste').disabled = true;
      try { const r = await testarAviso(); desenharAvisos(r.enviados ? 'Aviso de teste enviado. Ele chega em alguns segundos.' : 'Não foi possível entregar o aviso neste celular. Desative e ative de novo.'); }
      catch (e) { desenharAvisos(e.message); }
    };
    $('avDesl').onclick = async () => { $('avDesl').disabled = true; try { await desativarAvisos(); desenharAvisos('Avisos desativados neste celular.'); } catch { desenharAvisos('Não foi possível desativar agora. Tente de novo.'); } };
    return;
  }
  el.innerHTML = `<div class="hint">Receba aqui no celular os avisos do seu pedido. O celular vai pedir a sua permissão.</div>
    <div class="avisos-acoes"><button type="button" class="btn pri" id="avAtivar">Ativar avisos</button></div>${extra}`;
  $('avAtivar').onclick = async () => {
    $('avAtivar').disabled = true; $('avAtivar').textContent = 'Ativando…';
    try { await ativarAvisos(); desenharAvisos('Pronto! Avisos ativados. Toque em "Enviar aviso de teste" para conferir.'); }
    catch (e) { desenharAvisos(e.message); }
  };
}

export function fecharTudo() {
  ['mLogin', 'mConta', 'mChk'].forEach(fecharModal);
  fecharCarrinho();
}

/** Termos alternativos para a busca do G360 (basta um bater): a busca, os sinônimos de frase e a medida escrita
    de outros jeitos ("5 litros" → "5l", "5lt"...). null = só a busca digitada. Máximo de 10, como no contrato. */
function termosG360(q, vs) {
  const t = [...new Set([q, ...vs.slice(1), ...variacoesMedida(q)].map((x) => x.trim().slice(0, 80)).filter(Boolean))].slice(0, 10);
  return t.length > 1 ? t : null;
}
