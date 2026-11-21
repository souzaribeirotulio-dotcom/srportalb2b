/* =====================================================================
   Portal no layout original: topo, faixa de categorias, página inicial,
   catálogo, carrinho lateral, login e Minha conta nos modais originais.
   A lógica (API, sessão, envio, Minha Lista, ocorrências) vem dos módulos
   já testados; aqui só a tela.
   ===================================================================== */
import Decimal from 'decimal.js';
import { registrarBusca, registrarAcesso, limparEventosSessao } from '../estado/eventos.js';
import { carregarExibicao, categorias as categoriasPortal, codigosDaCategoria, apresentar, pesoCurva, oculto, soEstoque, abaixoDoMinimo, estoqueMinimoAtual, codigosAtivosPublicos } from '../catalogo/exibicao.js';

import { buscarLocal, temEstoque, variacoes } from '../catalogo/busca.js';
import { listarProdutos, buscarProdutos, listarMarcas, produtosPorIds } from '../api/g360.js';
import { sessao, entrar, sair, trocarSenha, vinculoEmAndamento } from '../estado/sessao.js';
import { iniciarCarrinhoNuvem, sincronizarCarrinho } from '../estado/carrinho-nuvem.js';
import { adicionar, linhasCarrinho, alterarQuantidade, remover, aoMudarCarrinho, quantidadeLinhas, linhasSemPrecoAtual, atualizarLinha } from '../estado/carrinho.js';
import { carregarIds, incluirNaLista, removerDaLista, idsCarregados } from '../estado/minha-lista.js';
import { normalizarQuantidade, dinheiro, estimar } from '../ui/formato.js';
import { ligarTrocaFotos, ligarFotos, liberarFotosDaTela, htmlFoto } from '../ui/fotos.js';
import { mostrarMensagemErro } from '../ui/mensagem.js';
import { $, esc, toast, abrirModal, fecharModal, saudacao, passoQuantidade, adiar } from './comum.js';
import { htmlCartao, htmlPreco, unidadeEscolhida, linhaCarrinho } from './cartao.js';
import { abrirDetalhe, ligarDetalhe } from './detalhe.js';
import { iniciarSouzinha } from './souzinha.js';
import { resultadoPublico, htmlCartaoPublico, chipsPublicos, marcasPublicas, limparVisitante } from './visitante.js';
import { abrirCheckout } from './checkout.js';
import { desenharMinhaLista } from './lista.js';
import { desenharPedidos } from './pedidos.js';
import { desenharClips, ligarClips, pausarClips, carregarClips, clipDoProduto } from './clips.js';
import { abrirNegociacao, desenharMinhasNegociacoes } from './negociacao.js';
import { htmlDisponivel, conferir, somar } from './estoque.js';
import { abrirCadastro } from './cadastro.js';
import { desenharBanners, pausarBanners } from './banners.js';

const filtros = { q: '', grupo: '', marca: '', pagina: 1 };
let classificacoes = null;
let produtosDaTela = new Map();
let ctx = null;          // { loja, ir }
let montado = false;
let buscaN = 0;

export function limparLoja() {
  esquecerBuscasRecentes();
  limparVisitante();
  Object.assign(filtros, { q: '', grupo: '', marca: '', pagina: 1 });
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
    const b = e.target.closest('.chip'); if (!b) return;
    filtros.grupo = b.dataset.c; filtros.pagina = 1; desenharChips(); desenharCatalogo();
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
  montar();
  liberarFotosDaTela();
  document.querySelectorAll('.view').forEach((el) => { el.hidden = el.id !== { cat: 'vCat', lista: 'vLista', ped: 'vPed', clips: 'vClips' }[rota]; });
  document.body.classList.toggle('clipsmode', rota === 'clips');
  if (rota !== 'clips') pausarClips();
  if (rota !== 'cat') pausarBanners();
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
  if (rota === 'ped') { desenharPedidos(ctx, params[0]); desenharMinhasNegociacoes(); }
  if (rota === 'clips') desenharClips(estado.clip || null, opcoesClips());
  if (estado.abrirCarrinho) exigirLogin(abrirCarrinho);
  if (estado.abrirConta && sessao.ativa) abrirConta();
}

/* ---------------- página inicial e filtros ---------------- */

function desenharHero() {
  $('hi').innerHTML = `${saudacao()}<em>Seus suprimentos</em>num só lugar.`;
  if (!sessao.ativa) { $('nMarcas').textContent = '—'; }
}

async function carregarClassificacoes() {
  if (classificacoes && classificacoes.token === sessao.token) return classificacoes;
  const [marcas] = await Promise.all([listarMarcas(sessao.token), carregarExibicao()]);
  // Categorias definidas pela equipe no painel (não vêm do G360).
  const grupos = categoriasPortal().map((nome) => ({ codigo: nome, nome, quantidade: codigosDaCategoria(nome, Infinity).length || '' }));
  classificacoes = { token: sessao.token, grupos, marcas, total: null };
  $('marca').innerHTML = '<option value="">Todas as marcas</option>' + marcas.map((m) => `<option value="${Number(m.codigo)}">${esc(m.nome)}</option>`).join('');
  $('marca').value = filtros.marca;
  $('nMarcas').textContent = marcas.length;
  return classificacoes;
}

function desenharChips() {
  const el = $('cats');
  if (!sessao.ativa) {
    chipsPublicos().then((grupos) => {
      if (sessao.ativa) return;
      el.innerHTML = [['', 'Todos', ''], ...grupos.filter((g) => g.quantidade).map((g) => [g.codigo, g.nome, g.quantidade])]
        .map(([c, n, qt]) => `<button type="button" class="chip ${c === String(filtros.grupo) ? 'on' : ''}" data-c="${esc(c)}">${esc(n)}<span>${Number(qt) || ''}</span></button>`).join('');
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
  el.innerHTML = [['', 'Todos', total], ...grupos.map((g) => [String(g.codigo), g.nome, g.quantidade])]
    .map(([c, n, q]) => `<button type="button" class="chip ${c === String(filtros.grupo) ? 'on' : ''}" data-c="${esc(c)}">${esc(n)}<span>${Number(q) || ''}</span></button>`).join('');
}

/* ---------------- catálogo ---------------- */

/** "Mostrando 24 de 1.600 produtos". Sem o total (filtro por marca), só "Mostrando 24 produtos". */
function mostrando(vistos, total, q = '') {
  const pal = q ? (n) => (n === 1 ? 'resultado' : 'resultados') : (n) => (n === 1 ? 'produto' : 'produtos');
  const fim = q ? ` para “${esc(q)}”` : (filtros.grupo ? ` em ${esc(filtros.grupo)}` : '');
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
  return codigosDaCategoria(filtros.grupo, Infinity).filter((c) => ativos.has(String(c))).length;
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
  const chave = `${sessao.token}|${filtros.grupo}|${filtros.marca}|${$('ord').value}`;
  if (!vitrine || vitrine.chave !== chave) vitrine = { chave, apiPagina: 0, apiPaginas: 1, itens: [], fim: false };
  const precisa = filtros.pagina * POR_PAGINA + 1;
  // Categoria do portal: a API aceita até 500 códigos por consulta, então vai em blocos de 500.
  const codigos = filtros.grupo ? codigosDaCategoria(filtros.grupo, Infinity) : null;
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
    vitrine.apiPaginas = Math.max(1, Math.ceil((paginacao?.total || 0) / 50));
    vitrine.itens.push(...dados.map(apresentar).filter((p) => temEstoque(p) && !oculto(p) && !abaixoDoMinimo(p)));
    if (pagina >= vitrine.apiPaginas) {
      if (vitrine.bloco + 1 < blocos.length) { vitrine.bloco += 1; vitrine.apiPagina = 0; } else vitrine.fim = true;
    }
  }
  ordenar(vitrine.itens);
  const ini = (filtros.pagina - 1) * POR_PAGINA;
  const itens = vitrine.itens.slice(ini, ini + POR_PAGINA);
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

/** Busca: nomes do portal (tolerante) + busca da API (código, EAN, aplicação); com estoque primeiro. */
async function resultadoBusca() {
  const chave = `${sessao.token}|${filtros.q}|${filtros.grupo}|${filtros.marca}`;
  if (!busca || busca.chave !== chave) {
    const guardada = buscasRecentes.get(chave);
    if (guardada && Date.now() - guardada.t < RECENTE_MS) busca = { chave, itens: [...guardada.itens], semEstoque: guardada.semEstoque, ordem: '' };
  }
  if (!busca || busca.chave !== chave) {
    const marca = filtros.marca ? Number(filtros.marca) : undefined;
    const locais = buscarLocal(filtros.q, { categoria: filtros.grupo, max: 150 });
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
    const vs = variacoes(filtros.q);
    const pedidos = [
      ...blocos.map((b) => buscarProdutos(sessao.token, { codigos: b, marca, limite: 50 })),
      listarProdutos(sessao.token, vs.length > 1 ? { termos: [filtros.q, ...vs.slice(1)], marca, limite: 50 } : { q: filtros.q, marca, limite: 50 }),
    ];
    const res = await Promise.allSettled(pedidos);
    res.slice(0, blocos.length).forEach((r) => { if (r.status === 'fulfilled') r.value.dados.forEach((p) => { const a = apresentar(p); guardarRecente(a); achados.set(Number(p.id), a); }); });
    const api = res[res.length - 1];
    if (api.status === 'fulfilled') {
      api.value.dados.map(apresentar).filter((p) => !filtros.grupo || p.categoria === filtros.grupo)
        .forEach((p) => { guardarRecente(p); if (!achados.has(Number(p.id))) { achados.set(Number(p.id), p); if (!pontos.has(String(p.codigo))) pontos.set(String(p.codigo), maxPontos * 0.6); } });
    }
    const falha = res.find((r) => r.status === 'rejected');
    if (falha && (!achados.size || falha.reason?.status === 401)) throw falha.reason;
    // Ordem: com estoque primeiro; depois o que mais bate com a busca; na mesma faixa, os mais vendidos (curva A, B, C).
    const todos = [...achados.values()].filter((p) => !oculto(p) && !abaixoDoMinimo(p) && (!soEstoque() || temEstoque(p))).sort((a, b) => (temEstoque(b) - temEstoque(a)) || (faixa(b) - faixa(a))
      || (pesoCurva(a) - pesoCurva(b)) || ((pontos.get(String(b.codigo)) || 0) - (pontos.get(String(a.codigo)) || 0)) || a.nome.localeCompare(b.nome, 'pt'));
    busca = { chave, itens: todos, semEstoque: todos.filter((p) => !temEstoque(p)).length, ordem: '' };
    if (!falha) {
      buscasRecentes.set(chave, { itens: [...todos], semEstoque: busca.semEstoque, t: Date.now() });
      if (buscasRecentes.size > 30) buscasRecentes.delete(buscasRecentes.keys().next().value);
    }
    registrarBusca(filtros.q, todos.length);
  }
  if (busca.ordem !== $('ord').value) { busca.ordem = $('ord').value; if (busca.ordem !== 'nome') ordenar(busca.itens); }
  const ini = (filtros.pagina - 1) * POR_PAGINA;
  return { itens: busca.itens.slice(ini, ini + POR_PAGINA), total: busca.itens.length, semEstoque: busca.semEstoque, temMais: false, paginas: Math.max(1, Math.ceil(busca.itens.length / POR_PAGINA)) };
}

function conviteEntrar(grid, extra = '') {
  grid.innerHTML = `<div class="empty g360-convite">${extra}<b>Entre para ver o catálogo e os seus preços.</b>
    <p>O portal é exclusivo para empresas clientes da Souza Ribeiro.</p>
    <div class="act" style="justify-content:center"><button type="button" class="btn pri" id="gEntrar">Entrar</button><button type="button" class="btn out" id="gPrimeiro">Primeiro acesso</button><button type="button" class="btn out" id="gCadastro">Quero ser cliente</button></div></div>`;
  $('gCadastro').onclick = () => abrirCadastro(ctxCadastro());
  $('gEntrar').onclick = () => abrirLogin();
  $('gPrimeiro').onclick = () => ctx.ir('/primeiro-acesso');
  if (ctx.loja.troca_senha !== true) $('gPrimeiro').style.display = 'none';
}

/** Visitante: catálogo aberto (vitrine) com "Entre para ver os preços". Vitrine fechada → convite para entrar. */
async function desenharCatalogoPublico(grid, pag) {
  const meu = ++buscaN;
  grid.innerHTML = '<div class="empty">Carregando produtos…</div>';
  try {
    const r = await resultadoPublico(filtros);
    if (meu !== buscaN || sessao.ativa) return;
    $('cnt').innerHTML = mostrando((filtros.pagina - 1) * POR_PAGINA + r.itens.length, r.total, filtros.q) + ' · entre para ver os preços';
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
    const r = filtros.q ? await resultadoBusca() : await resultadoVitrine();
    if (idsP) { await idsP; desenharTopo(); }
    if (meu !== buscaN) return;
    grid.classList.remove('buscando');
    const dados = r.itens;
    if (!filtros.q && !filtros.grupo && !filtros.marca && classificacoes && classificacoes.total === null) { classificacoes.total = ''; }
    const vistos = (filtros.pagina - 1) * POR_PAGINA + dados.length;
    $('cnt').innerHTML = filtros.q
      ? mostrando(vistos, r.total, filtros.q) + (r.semEstoque ? ` · ${r.semEstoque} sem estoque no fim da lista` : '')
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

function ligarLogin() {
  $('lgCad').textContent = 'Quero ser cliente';
  $('lgCad').onclick = () => { fecharModal('mLogin'); abrirCadastro(ctxCadastro()); };
  $('lgEsqL').textContent = 'Primeiro acesso ou esqueci minha senha';
  $('lgEsqL').onclick = () => { fecharModal('mLogin'); ctx.ir('/primeiro-acesso'); };
  $('lgAdm').textContent = 'Acesso da equipe Souza Ribeiro';
  $('lgAdm').onclick = () => { fecharModal('mLogin'); ctx.ir('/painel'); };
  $('lgVolta').hidden = true; $('lgEsq').hidden = true; $('lgAdmT').hidden = true;
  $('lgL').textContent = 'CPF ou CNPJ';
  const doc = $('lgC');
  doc.placeholder = 'Digite com ou sem pontuação'; doc.inputMode = 'text'; doc.maxLength = 32; doc.autocapitalize = 'characters';
  $('lgS').maxLength = 64;
  if (!$('lgRes')) $('lgE').insertAdjacentHTML('afterend', '<div id="lgRes" aria-live="polite"></div><p class="hint" id="lgSessao"></p>');
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
      await entrar(usuario, senha);
      $('lgS').value = '';
      fecharModal('mLogin');
      ctx.aoEntrar();
      limparEventosSessao(); registrarAcesso();
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

/** "Quero ser cliente" com atalhos para quem já tem cadastro: Entrar (com o documento já digitado) e Primeiro acesso. */
function ctxCadastro() {
  return { ...ctx, abrirLogin: (documento) => { abrirLogin(); if (documento) { $('lgC').value = documento; setTimeout(() => $('lgS').focus(), 80); } } };
}

export function abrirLogin(depois = null, mensagemErro = null, mensagemOk = null) {
  depoisDoLogin = depois;
  $('lgE').textContent = mensagemErro || '';
  $('lgRes').innerHTML = mensagemOk ? `<div class="rv-aviso">${esc(mensagemOk)}</div>` : '';
  const min = Number(ctx?.loja?.sessao_minutos);
  $('lgSessao').textContent = Number.isFinite(min) ? `Por segurança, a sessão encerra após ${min} minuto${min === 1 ? '' : 's'} sem uso.` : '';
  const semTroca = ctx?.loja?.troca_senha !== true;
  $('lgEsqL').style.display = semTroca ? 'none' : '';
  abrirModal('mLogin');
  // Foca o documento só se a pessoa ainda não clicou em outro campo do modal.
  setTimeout(() => { if (!$('mLogin').contains(document.activeElement)) $('lgC').focus(); }, 50);
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
