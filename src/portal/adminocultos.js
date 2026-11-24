/* Painel › Executivos: escolher os produtos que os clientes de um executivo não veem.
   Pesquisa no catálogo do operador (POST operadores/produtos/busca), marca um a um ou
   "Selecionar todos da pesquisa", e mostra a lista do que está escondido.
   Guarda só os códigos dos produtos (ocultar_codigos). */
import { buscarProdutosOperador } from '../api/g360.js';
import { esc } from './comum.js';

const MAXIMO = 500;   // a função executivos-g360 guarda até 500 códigos
const LIMITE = 50;    // por página da API

/**
 * Monta o seletor dentro de "alvo". Devolve { codigos: () => string[] }.
 * opcoes: { token: () => string, codigos: string[], aoEncerrar(msg), aoMudar(codigos) }
 */
export function montarSeletorOcultos(alvo, { token, codigos = [], aoEncerrar, aoMudar }) {
  const marcados = new Map(codigos.map((c) => [String(c).toUpperCase(), null])); // código → nome (null = ainda não carregado)
  let busca = { q: '', pagina: 1, total: 0, lista: [], carregando: false, erro: '' };

  alvo.innerHTML = `
    <div class="oc-box">
      <div class="oc-busca">
        <input class="inp" id="ocQ" type="search" maxlength="80" placeholder="Pesquisar produto pelo nome ou código (ex.: saco lixo)" autocomplete="off" aria-label="Pesquisar produto para esconder">
        <button class="btn sec" type="button" id="ocBuscar">Pesquisar</button>
      </div>
      <div id="ocRes" aria-live="polite"></div>
      <div class="oc-sel"><div class="oc-sel-cab"><b id="ocTit"></b><button class="tool" type="button" id="ocLimpar" hidden>Limpar tudo</button></div>
        <div id="ocLista" class="oc-chips"></div></div>
    </div>`;
  const $ = (s) => alvo.querySelector(s);

  async function chamar(filtros) {
    try { return await buscarProdutosOperador(token(), filtros); }
    catch (e) { if (e.status === 401) aoEncerrar?.(e.message); throw e; }
  }

  function pintarSelecionados() {
    const n = marcados.size;
    aoMudar?.([...marcados.keys()]);
    $('#ocTit').textContent = n ? `Escondidos para os clientes dele (${n})` : 'Nenhum produto escondido';
    $('#ocLimpar').hidden = !n;
    $('#ocLista').innerHTML = n
      ? [...marcados].map(([c, nome]) => `<span class="oc-chip"><span><b>${esc(c)}</b>${nome ? ` · ${esc(nome)}` : ''}</span><button type="button" data-tira="${esc(c)}" aria-label="Mostrar de novo o produto ${esc(c)}">✕</button></span>`).join('')
      : '<small class="hint">Pesquise acima e marque os produtos. Os clientes vinculados a ele, quando logados, não veem esses produtos no portal. O G360 continua vendendo normalmente.</small>';
    $('#ocLista').querySelectorAll('[data-tira]').forEach((b) => { b.onclick = () => { marcados.delete(b.dataset.tira); pintarSelecionados(); pintarResultados(); }; });
  }

  function pintarResultados() {
    const el = $('#ocRes');
    if (busca.carregando) { el.innerHTML = '<small class="hint">Pesquisando…</small>'; return; }
    if (busca.erro) { el.innerHTML = `<small class="hint" style="color:#ff9a9a">${esc(busca.erro)}</small>`; return; }
    if (!busca.q) { el.innerHTML = ''; return; }
    if (!busca.lista.length) { el.innerHTML = '<small class="hint">Nenhum produto encontrado com essa pesquisa.</small>'; return; }
    const todosMarcados = busca.lista.every((p) => marcados.has(String(p.codigo).toUpperCase()));
    const paginas = Math.ceil(busca.total / LIMITE);
    el.innerHTML = `
      <div class="oc-acoes">
        <small class="hint">${busca.total} ${busca.total === 1 ? 'produto encontrado' : 'produtos encontrados'}</small>
        <button class="btn ${todosMarcados && busca.total <= busca.lista.length ? 'sec' : 'pri'}" type="button" id="ocTodos">${todosMarcados && busca.total <= busca.lista.length ? 'Desmarcar todos da pesquisa' : `Selecionar todos da pesquisa (${busca.total})`}</button>
      </div>
      <div class="oc-lista">${busca.lista.map((p) => {
        const c = String(p.codigo).toUpperCase();
        return `<label class="oc-item"><input type="checkbox" data-c="${esc(c)}" data-n="${esc(p.nome || '')}" ${marcados.has(c) ? 'checked' : ''}><span><b>${esc(p.codigo)}</b> · ${esc(p.nome || '')}</span></label>`;
      }).join('')}</div>
      ${paginas > 1 ? `<div class="oc-pag"><button class="tool" type="button" id="ocAnt" ${busca.pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button><small class="hint">Página ${busca.pagina} de ${paginas}</small><button class="tool" type="button" id="ocProx" ${busca.pagina >= paginas ? 'disabled' : ''}>Próxima ›</button></div>` : ''}`;
    el.querySelectorAll('input[data-c]').forEach((i) => {
      i.onchange = () => {
        if (i.checked) {
          if (marcados.size >= MAXIMO) { i.checked = false; busca.erro = ''; $('#ocTit').textContent = `Limite de ${MAXIMO} produtos escondidos.`; return; }
          marcados.set(i.dataset.c, i.dataset.n || null);
        } else marcados.delete(i.dataset.c);
        pintarSelecionados(); pintarResultados();
      };
    });
    $('#ocTodos').onclick = selecionarTodos;
    if ($('#ocAnt')) $('#ocAnt').onclick = () => pesquisar(busca.pagina - 1);
    if ($('#ocProx')) $('#ocProx').onclick = () => pesquisar(busca.pagina + 1);
  }

  async function pesquisar(pagina = 1) {
    const q = $('#ocQ').value.trim();
    if (q.length < 2) { busca = { ...busca, q: '', lista: [], erro: 'Digite pelo menos 2 letras.' }; pintarResultados(); return; }
    busca = { ...busca, q, pagina, carregando: true, erro: '' }; pintarResultados();
    try {
      const { dados, paginacao } = await chamar({ q, pagina, limite: LIMITE });
      busca = { ...busca, lista: dados || [], total: paginacao?.total ?? (dados || []).length, carregando: false };
    } catch (e) { busca = { ...busca, lista: [], carregando: false, erro: e.message || 'Não foi possível pesquisar agora.' }; }
    pintarResultados();
  }

  /** Marca (ou desmarca) todos os produtos da pesquisa, em todas as páginas. */
  async function selecionarTodos() {
    const b = $('#ocTodos'); b.disabled = true;
    const todosMarcados = busca.lista.every((p) => marcados.has(String(p.codigo).toUpperCase())) && busca.total <= busca.lista.length;
    if (todosMarcados) { for (const p of busca.lista) marcados.delete(String(p.codigo).toUpperCase()); pintarSelecionados(); pintarResultados(); return; }
    b.textContent = 'Selecionando…';
    try {
      const paginas = Math.ceil(busca.total / LIMITE);
      const todos = [...busca.lista];
      for (let pg = 1; pg <= paginas; pg++) {
        if (pg === busca.pagina) continue;
        const { dados } = await chamar({ q: busca.q, pagina: pg, limite: LIMITE });
        todos.push(...(dados || []));
      }
      let cortou = false;
      for (const p of todos) {
        const c = String(p.codigo).toUpperCase();
        if (marcados.has(c)) continue;
        if (marcados.size >= MAXIMO) { cortou = true; break; }
        marcados.set(c, p.nome || null);
      }
      pintarSelecionados(); pintarResultados();
      if (cortou) $('#ocTit').textContent = `Limite de ${MAXIMO} produtos escondidos: nem todos da pesquisa entraram.`;
    } catch (e) { busca.erro = e.message || 'Não foi possível selecionar agora.'; pintarResultados(); }
  }

  /** Nomes dos códigos que já estavam escondidos (carrega em lotes de 50). */
  async function carregarNomes() {
    const sem = [...marcados].filter(([, n]) => !n).map(([c]) => c);
    for (let i = 0; i < sem.length; i += LIMITE) {
      try {
        const { dados } = await chamar({ codigos: sem.slice(i, i + LIMITE), limite: LIMITE });
        for (const p of dados || []) { const c = String(p.codigo).toUpperCase(); if (marcados.has(c)) marcados.set(c, p.nome || null); }
      } catch { break; }
    }
    pintarSelecionados();
  }

  $('#ocBuscar').onclick = () => pesquisar(1);
  $('#ocQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pesquisar(1); } });
  $('#ocLimpar').onclick = (ev) => {
    const b = ev.currentTarget;
    if (b.dataset.conf !== '1') { b.dataset.conf = '1'; b.textContent = 'Toque de novo para limpar'; setTimeout(() => { b.dataset.conf = ''; b.textContent = 'Limpar tudo'; }, 3000); return; }
    marcados.clear(); pintarSelecionados(); pintarResultados();
  };
  pintarSelecionados();
  if (marcados.size) carregarNomes();
  return { codigos: () => [...marcados.keys()] };
}
