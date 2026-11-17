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

/** Carrega (uma vez) os nomes e as categorias. Falha → segue com o nome automático. */
export function carregarExibicao(forcar = false) {
  if (estado.carregado && !forcar) return Promise.resolve(estado);
  if (estado.carregando && !forcar) return estado.carregando;
  estado.carregando = (async () => {
    if (!supabaseConfigurado()) { estado.categorias = CATEGORIAS_PADRAO; estado.carregado = true; return estado; }
    const sb = supabaseComprador();
    try {
      const { data: cats } = await sb.from('portal_categorias').select('nome, ordem').eq('loja', LOJA).order('ordem');
      estado.categorias = cats?.length ? cats.map((c) => c.nome) : CATEGORIAS_PADRAO;
      const { data: sin } = await sb.from('portal_sinonimos').select('termo, equivalentes').eq('loja', LOJA);
      estado.sinonimos = sin || []; definirSinonimos(estado.sinonimos);
      const porCodigo = new Map(); const porId = new Map();
      for (let de = 0; de < 20000; de += 1000) {
        const { data, error } = await sb.from('portal_produtos_exibicao').select('codigo, produto_id, nome, categoria, origem, nome_g360, curva, descricao, ean')
          .eq('loja', LOJA).order('codigo').range(de, de + 999);
        if (error) throw error;
        data.forEach((r) => { porCodigo.set(String(r.codigo), r); if (r.produto_id) porId.set(Number(r.produto_id), r); });
        if (data.length < 1000) break;
      }
      estado.porCodigo = porCodigo; estado.porId = porId;
      indexar([...porCodigo.values()]);
    } catch { if (!estado.categorias.length) estado.categorias = CATEGORIAS_PADRAO; }
    estado.carregado = true; estado.carregando = null;
    return estado;
  })();
  return estado.carregando;
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
  for (const r of estado.porCodigo.values()) if (r.categoria === cat) out.push(String(r.codigo));
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
