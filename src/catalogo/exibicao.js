/* =====================================================================
   Nome e categoria do produto no portal (tabelas portal_produtos_exibicao e
   portal_categorias, leitura liberada; gravação só pelo painel).
   Sem registro: nome automático no padrão de e-commerce e categoria pelo nome.
   ===================================================================== */
import { supabaseComprador, supabaseConfigurado, LOJA } from '../api/supabase.js';
import { nomeEcommerce, categoriaPeloNome } from './nomes.js';
import { indexar, definirSinonimos } from './busca.js';

const estado = { carregado: false, carregando: null, porCodigo: new Map(), porId: new Map(), categorias: [] };

export const CATEGORIAS_PADRAO = ['Limpeza', 'Descartáveis', 'Embalagens', 'Copa & Alimentos', 'Higiene', 'Utensílios & EPI', 'Papelaria', 'Outros'];

/* Cópia local da lista (nomes, categorias, sinônimos e configuração): da segunda visita em diante o catálogo
   aparece na hora com ela, e a lista nova chega por trás. São dados públicos do catálogo, nada do comprador. */
const CHAVE_LOCAL = `g360:${LOJA}:exibicao:v1`;
const COLUNAS = 'codigo, produto_id, nome, categoria, origem, nome_g360, curva, ean, oculto';

function aplicar(d) {
  estado.categorias = d.categorias?.length ? d.categorias : CATEGORIAS_PADRAO;
  estado.sinonimos = d.sinonimos || []; definirSinonimos(estado.sinonimos);
  const porCodigo = new Map(); const porId = new Map();
  for (const r of d.linhas || []) { porCodigo.set(String(r.codigo), r); if (r.produto_id) porId.set(Number(r.produto_id), r); }
  estado.porCodigo = porCodigo; estado.porId = porId;
  indexar([...porCodigo.values()].filter((r) => !r.oculto));
  estado.soEstoque = d.soEstoque === true; estado.estoqueMinimo = Number(d.estoqueMinimo) || 0;
}

/** Busca tudo no Supabase de uma vez: as páginas da lista saem juntas, e as descrições (poucas) à parte. */
async function baixar() {
  const sb = supabaseComprador();
  const pagina = (de, contar) => sb.from('portal_produtos_exibicao').select(COLUNAS, contar ? { count: 'exact' } : undefined)
    .eq('loja', LOJA).order('codigo').range(de, de + 999);
  const [cats, sin, cfg, desc, p1] = await Promise.all([
    sb.from('portal_categorias').select('nome, ordem').eq('loja', LOJA).order('ordem'),
    sb.from('portal_sinonimos').select('termo, equivalentes').eq('loja', LOJA),
    sb.rpc('portal_config_publica', { p_loja: LOJA }).then((r) => r, () => ({ data: null })),
    sb.from('portal_produtos_exibicao').select('codigo, descricao, palavras_chave').eq('loja', LOJA).or('descricao.not.is.null,palavras_chave.not.is.null').limit(5000),
    pagina(0, true),
  ]);
  if (p1.error) throw p1.error;
  const total = Math.min(p1.count ?? p1.data.length, 20000);
  const resto = [];
  for (let de = 1000; de < total; de += 1000) resto.push(pagina(de, false));
  const paginas = await Promise.all(resto);
  const linhas = [...p1.data];
  for (const r of paginas) { if (r.error) throw r.error; linhas.push(...r.data); }
  const textos = new Map((desc.data || []).map((x) => [String(x.codigo), x]));
  linhas.forEach((r) => { const t = textos.get(String(r.codigo)); if (t) { r.descricao = t.descricao; r.palavras_chave = t.palavras_chave; } });
  const c = cfg?.data;
  return {
    categorias: (cats.data || []).map((x) => x.nome), sinonimos: sin.data || [], linhas,
    soEstoque: c?.so_estoque === true, estoqueMinimo: Number(c?.estoque_minimo) || 0,
  };
}

function lerLocal() { try { const t = localStorage.getItem(CHAVE_LOCAL); return t ? JSON.parse(t) : null; } catch { return null; } }
function gravarLocal(d) { try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(d)); } catch { /* sem espaço ou bloqueado: segue sem cópia */ } }

/** Carrega (uma vez) os nomes e as categorias. Falha → segue com o nome automático.
 *  Com cópia local, responde na hora com ela e atualiza por trás (aoAtualizar avisa quem quiser redesenhar). */
let aoAtualizar = null;
export function aoAtualizarExibicao(fn) { aoAtualizar = fn; }
export function carregarExibicao(forcar = false) {
  if (estado.carregado && !forcar) return Promise.resolve(estado);
  if (estado.carregando && !forcar) return estado.carregando;
  if (!supabaseConfigurado()) { estado.categorias = CATEGORIAS_PADRAO; estado.carregado = true; return Promise.resolve(estado); }
  const local = !forcar && !estado.carregado ? lerLocal() : null;
  const rede = baixar().then((d) => { aplicar(d); gravarLocal(d); return true; }, () => false);
  if (local?.linhas?.length) {
    aplicar(local);
    estado.carregado = true;
    rede.then((ok) => { if (ok) aoAtualizar?.(); });
    return Promise.resolve(estado);
  }
  estado.carregando = rede.then((ok) => {
    if (!ok && !estado.categorias.length) estado.categorias = CATEGORIAS_PADRAO;
    estado.carregado = true; estado.carregando = null;
    return estado;
  });
  return estado.carregando;
}

/** Visitante: códigos que aparecem no portal (lista da última contagem de estoque de um cliente). null = sem lista. */
let ativosPublicos; // promessa: chips e catálogo pedem juntos, uma chamada só
export function codigosAtivosPublicos() {
  if (!ativosPublicos) ativosPublicos = (async () => {
    try {
      const sb = supabaseConfigurado() ? supabaseComprador() : null;
      if (!sb) return null;
      const { data } = await sb.rpc('portal_vitrine_codigos', { p_loja: LOJA });
      const c = (Array.isArray(data) ? data[0] : data)?.codigos;
      return c?.length ? c.map(String) : null;
    } catch { return null; } // sem lista: catálogo inteiro da vitrine
  })();
  return ativosPublicos;
}
export function esquecerAtivosPublicos() { ativosPublicos = undefined; }

/** Produto escondido do catálogo pela equipe (continua no G360, no histórico e na Minha Lista). */
export function oculto(p) { return registro(p)?.oculto === true; }
/** Configuração da loja: mostrar só produtos com estoque também na busca. */
export function soEstoque() { return estado.soEstoque === true; }
export function estoqueMinimoAtual() { return estado.estoqueMinimo || 0; }
/** "Só produtos com mais de N unidades" (quando a API manda a quantidade). Sem número, não esconde. */
export function abaixoDoMinimo(p) {
  const min = estado.estoqueMinimo || 0;
  if (!(min > 0) || p?.quantidade_disponivel === null || p?.quantidade_disponivel === undefined) return false;
  return Number(p.quantidade_disponivel) <= min;
}

export function sinonimos() { return estado.sinonimos || []; }

export function categorias() { return estado.categorias.length ? estado.categorias : CATEGORIAS_PADRAO; }

/** Registro do portal para um produto da API (por código ou id). */
export function registro(p) {
  if (!p) return null;
  return estado.porCodigo.get(String(p.codigo ?? '')) || estado.porId.get(Number(p.id ?? p.produto_id)) || null;
}

const marcaTexto = (m) => (m && typeof m === 'object' ? m.nome : m) || '';

/** Nome que o cliente vê. */
export function nomeExibicao(p) {
  const r = registro(p);
  return r?.nome || nomeEcommerce(p?.nome, marcaTexto(p?.marca));
}

export function categoriaExibicao(p) {
  const r = registro(p);
  return r?.categoria || categoriaPeloNome(p?.nome_g360 ?? p?.nome, nomeExibicao(p));
}

/** Produto da API com o nome do portal (o nome do G360 fica em nome_g360). */
export function apresentar(p) {
  if (!p || p.nome_g360 !== undefined) return p;
  return { ...p, nome_g360: p.nome, nome: nomeExibicao(p), categoria: categoriaExibicao(p), curva: registro(p)?.curva || null };
}

/** Item de revisão/pedido (tem produto_id e nome): troca o nome se o portal conhecer o produto. */
export function nomeDoItem(i) {
  const r = estado.porId.get(Number(i?.produto_id)) || (i?.codigo ? estado.porCodigo.get(String(i.codigo)) : null);
  return r?.nome || nomeEcommerce(i?.nome, '');
}

/** Códigos G360 de uma categoria (para o filtro do catálogo, até 500). */
export function codigosDaCategoria(cat, max = 500) {
  const out = [];
  for (const r of estado.porCodigo.values()) if (r.categoria === cat && !r.oculto) out.push(String(r.codigo));
  return out.slice(0, max);
}

/** Códigos dos produtos tirados do portal pela equipe (para o filtro do painel, até 500). */
export function codigosOcultos(max = 500) {
  const out = [];
  for (const r of estado.porCodigo.values()) if (r.oculto) out.push(String(r.codigo));
  return out.slice(0, max);
}

/** Depois de gravar no painel: atualiza a memória sem recarregar tudo. */
export function aplicarLocal(linhas) {
  for (const r of linhas) {
    const atual = { ...(estado.porCodigo.get(String(r.codigo)) || {}), ...r };
    estado.porCodigo.set(String(r.codigo), atual);
    if (atual.produto_id) estado.porId.set(Number(atual.produto_id), atual);
  }
}
export function definirCategoriasLocal(lista) { estado.categorias = lista; }

/** Curva ABC (importada do G360): A=0, B=1, C=2, sem curva=3. Só ordena; não muda preço nem compra. */
export function pesoCurva(p) { return { A: 0, B: 1, C: 2 }[(p?.curva ?? registro(p)?.curva) || ''] ?? 3; }
