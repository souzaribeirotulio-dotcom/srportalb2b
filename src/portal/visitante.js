/* =====================================================================
   Catálogo para visitantes (sem sessão), pelo "Catálogo aberto para visitantes" do G360.
   Só GET vitrine/* — nome, foto, categoria e "Entre para ver os preços".
   Nada de preço, estoque ou disponibilidade. Respostas guardadas em memória
   (limite da vitrine: 30 chamadas/min por IP). Ao entrar, a tela troca para o
   catálogo autenticado; ao sair, estes dados públicos voltam do zero.
   ===================================================================== */
import { listarVitrine, listarMarcasVitrine, urlVitrine } from '../api/g360.js';
import { carregarExibicao, apresentar, codigosDaCategoria, pesoCurva, oculto, categorias as categoriasPortal, codigosAtivosPublicos, esquecerAtivosPublicos } from '../catalogo/exibicao.js';
import { buscarLocal, variacoes, corrigirBusca } from '../catalogo/busca.js';
import { esc } from './comum.js';

const POR_PAGINA = 24;
const cache = new Map();   // chave → { itens, total }
let marcas = null;
export let vitrineFechada = false;

export function limparVisitante() { cache.clear(); marcas = null; vitrineFechada = false; esquecerAtivosPublicos(); }

export async function marcasPublicas() {
  if (!marcas) marcas = await listarMarcasVitrine();
  return marcas;
}

export async function chipsPublicos() {
  await carregarExibicao();
  const ativos = await codigosAtivosPublicos(); const set = ativos ? new Set(ativos) : null;
  return categoriasPortal().map((nome) => ({ codigo: nome, nome, quantidade: codigosDaCategoria(nome, Infinity).filter((c) => !set || set.has(String(c))).length || '' }));
}

/** Página pública: { itens, total, paginas }. */
export async function resultadoPublico(filtros) {
  await carregarExibicao();
  // Só o que aparece no portal (estoque acima do mínimo e não tirado pela equipe), quando a lista existe.
  const ativos = await codigosAtivosPublicos(); const set = ativos ? new Set(ativos) : null;
  const ativo = (p) => !set || set.has(String(p.codigo));
  const marca = filtros.marca ? Number(filtros.marca) : undefined;
  // Uma rodada da busca numa categoria ('' = catálogo inteiro).
  const rodada = async (q, grupo) => {
    const locais = buscarLocal(q, { categoria: grupo, max: 100 }).filter((l) => !set || set.has(String(l.codigo)));
    const pontos = new Map(locais.map((l) => [l.codigo, l.pontos]));
    const maxPontos = Math.max(1, ...locais.map((l) => l.pontos));
    const faixa = (p) => { const v = pontos.get(String(p.codigo)) || 0; return v >= maxPontos * 0.8 ? 2 : v >= maxPontos * 0.5 ? 1 : 0; };
    const achados = new Map();
    for (let i = 0; i < locais.length; i += 50) {
      const { dados } = await listarVitrine({ codigos: locais.slice(i, i + 50).map((l) => l.codigo), marca, limite: 50 });
      dados.forEach((p) => achados.set(Number(p.id), apresentar(p)));
    }
    try {
      const vs = variacoes(q);
      const { dados } = await listarVitrine(vs.length > 1 ? { termos: [q, ...vs.slice(1)], marca, limite: 50 } : { q: q, marca, limite: 50 });
      dados.map(apresentar).filter((p) => !grupo || p.categoria === grupo)
        .forEach((p) => { if (!achados.has(Number(p.id))) { achados.set(Number(p.id), p); pontos.set(String(p.codigo), maxPontos * 0.6); } });
    } catch (e) { if (!achados.size) throw e; }
    const itens = [...achados.values()].filter((p) => !oculto(p) && ativo(p)).sort((a, b) => (faixa(b) - faixa(a)) || (pesoCurva(a) - pesoCurva(b))
      || ((pontos.get(String(b.codigo)) || 0) - (pontos.get(String(a.codigo)) || 0)) || a.nome.localeCompare(b.nome, 'pt'));
    return itens;
  };
  const tentar = async (q, g) => { try { return await rodada(q, g); } catch { return []; } };
  if (filtros.q) {
    const chave = `q|${filtros.q}|${filtros.grupo}|${filtros.marca}`;
    if (!cache.has(chave)) {
      // 1) Na categoria. 2) Nada lá: catálogo inteiro. 3) Ainda nada: "Você quis dizer" ("liva" → "luva").
      let itens = await rodada(filtros.q, filtros.grupo); let aviso = null;
      if (!itens.length && filtros.grupo) { const t = await tentar(filtros.q, ''); if (t.length) { itens = t; aviso = { grupo: filtros.grupo }; } }
      if (!itens.length) {
        const certo = corrigirBusca(filtros.q);
        if (certo) {
          let t = await tentar(certo, filtros.grupo); let g = null;
          if (!t.length && filtros.grupo) { t = await tentar(certo, ''); g = filtros.grupo; }
          if (t.length) { itens = t; aviso = { corrigida: certo, grupo: g }; }
        }
      }
      cache.set(chave, { itens, total: itens.length, aviso });
    }
    const r = cache.get(chave); const ini = (filtros.pagina - 1) * POR_PAGINA;
    return { itens: r.itens.slice(ini, ini + POR_PAGINA), total: r.total, aviso: r.aviso, paginas: Math.max(1, Math.ceil(r.total / POR_PAGINA)) };
  }
  // Sem busca: pela categoria do portal (códigos em blocos de 100) ou o catálogo inteiro paginado pela API.
  if (filtros.grupo) {
    const codigos = codigosDaCategoria(filtros.grupo, Infinity).filter((c) => !set || set.has(String(c)));
    const chave = `g|${filtros.grupo}|${filtros.marca}|${filtros.pagina}`;
    if (!cache.has(chave)) {
      // A página N da categoria: busca os códigos daquela fatia e ordena pela curva.
      const fatia = codigos.slice((filtros.pagina - 1) * POR_PAGINA, filtros.pagina * POR_PAGINA);
      const { dados } = fatia.length ? await listarVitrine({ codigos: fatia, marca, limite: 50 }) : { dados: [] };
      cache.set(chave, { itens: dados.map(apresentar).filter((p) => !oculto(p)).sort((a, b) => (pesoCurva(a) - pesoCurva(b)) || a.nome.localeCompare(b.nome, 'pt')), total: codigos.length });
    }
    const r = cache.get(chave);
    return { itens: r.itens, total: r.total, paginas: Math.max(1, Math.ceil(r.total / POR_PAGINA)) };
  }
  if (set && !marca) {
    // Catálogo inteiro: pagina pela lista do que aparece no portal (mais vendidos primeiro).
    const ordem = ativos.map((c, i) => ({ c, i, w: pesoCurva({ codigo: c }) })).sort((a, b) => a.w - b.w || a.i - b.i).map((x) => x.c);
    const chaveA = `a|${filtros.pagina}`;
    if (!cache.has(chaveA)) {
      const fatia = ordem.slice((filtros.pagina - 1) * POR_PAGINA, filtros.pagina * POR_PAGINA);
      const { dados } = fatia.length ? await listarVitrine({ codigos: fatia, limite: 50 }) : { dados: [] };
      const pos = new Map(fatia.map((c, i) => [c, i]));
      cache.set(chaveA, { itens: dados.map(apresentar).filter((p) => !oculto(p)).sort((a, b) => (pos.get(String(a.codigo)) ?? 99) - (pos.get(String(b.codigo)) ?? 99)), total: ordem.length });
    }
    const r = cache.get(chaveA);
    return { itens: r.itens, total: r.total, paginas: Math.max(1, Math.ceil(r.total / POR_PAGINA)), totalCatalogo: r.total };
  }
  const chave = `t|${filtros.marca}|${filtros.pagina}`;
  if (!cache.has(chave)) {
    const { dados, paginacao } = await listarVitrine({ marca, pagina: filtros.pagina, limite: POR_PAGINA });
    cache.set(chave, { itens: dados.map(apresentar).filter((p) => !oculto(p) && ativo(p)).sort((a, b) => (pesoCurva(a) - pesoCurva(b)) || a.nome.localeCompare(b.nome, 'pt')), total: paginacao?.total || 0 });
  }
  const r = cache.get(chave);
  return { itens: r.itens, total: r.total, paginas: Math.max(1, Math.ceil(r.total / POR_PAGINA)), totalCatalogo: !filtros.marca ? r.total : null };
}

/** Cartão do visitante: foto pública, nome, categoria e "Entre para ver os preços". */
export function htmlCartaoPublico(p) {
  const capa = urlVitrine(p.imagem);
  const marca = typeof p.marca === 'object' ? p.marca?.nome : p.marca;
  return `
  <article class="card publico" data-id="${Number(p.id)}">
    <div class="img">${p.categoria ? `<span class="cat">${esc(p.categoria)}</span>` : ''}
      ${capa ? `<div class="foto com-foto g360-foto"${Array.isArray(p.fotos) && p.fotos.length > 1 ? ` data-publico data-produto="${Number(p.id)}" data-fotos="${p.fotos.slice(0, 3).map(Number).join(',')}"` : ''}><img src="${esc(capa)}" alt="${esc(p.nome)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentElement.classList.add('vazia');this.replaceWith(Object.assign(document.createElement('span'),{textContent:'Sem foto'}))"></div>`
        : '<div class="foto vazia g360-foto" aria-hidden="true"><span>Sem foto</span></div>'}
    </div>
    <div class="info">
      <div class="brand">${esc(marca || '')}</div>
      <div class="name">${esc(p.nome)}</div>
      <div class="meta">Cód. ${esc(p.codigo)}</div>
      <button type="button" class="lockp" data-entrar><svg class="ic" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Entre para ver os preços</button>
    </div>
  </article>`;
}
