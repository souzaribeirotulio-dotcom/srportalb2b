/* =====================================================================
   Eventos para o painel de desempenho (tabela portal_eventos e portal_acessos).
   Só grava com a sessão do comprador vinculada pela ponte. Nunca derruba a tela.
   Nada de documento, senha ou token: só código do cliente, termo buscado,
   número/valor do pedido (como o G360 devolveu) e os itens (id, código, qtd, total).
   ===================================================================== */
import { sessao, garantirVinculo } from './sessao.js';
import { supabaseComprador, LOJA } from '../api/supabase.js';

const buscasGravadas = new Set();

/** Só o tipo de aparelho (computador, celular ou tablet) e se está no app instalado. */
export function tipoAparelho() {
  const ua = navigator.userAgent || '';
  const ipad = /ipad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ipad || /tablet|android(?!.*mobile)/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android/i.test(ua)) return 'celular';
  return 'computador';
}
const noApp = () => { try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch { return false; } };
const aparelho = () => ({ aparelho: tipoAparelho(), app: noApp() });

/** Acesso ao portal (login ou sessão reaberta): no máximo um registro por aba a cada 30 min. */
const CHAVE_ACESSO = 'g360:acesso-registrado-em';
export function registrarEntrada() {
  try {
    const ult = Number(sessionStorage.getItem(CHAVE_ACESSO) || 0);
    if (Date.now() - ult < 30 * 60_000) return;
    sessionStorage.setItem(CHAVE_ACESSO, String(Date.now()));
  } catch { /* sem armazenamento: registra assim mesmo */ }
  gravar({ tipo: 'acesso', ...aparelho() });
}

async function gravar(linha) {
  try {
    if (!sessao.ativa || !sessao.comprador) return;
    if (!(await garantirVinculo())) return;
    await supabaseComprador().from('portal_eventos').insert({ loja: LOJA, comprador_codigo: sessao.comprador.codigo, ...linha });
  } catch { /* silencioso */ }
}

/** Busca feita (uma vez por termo na sessão). */
export function registrarBusca(termo, resultados) {
  const t = String(termo || '').trim().toLowerCase().slice(0, 80);
  if (t.length < 2 || buscasGravadas.has(t)) return;
  buscasGravadas.add(t);
  gravar({ tipo: 'busca', termo: t, resultados: Number(resultados) || 0 });
}

/** Pedido gravado no G360 (201 ou 200 da repetição). */
export function registrarPedido(p) {
  if (!p) return;
  const valor = /^-?\d+(\.\d+)?$/.test(String(p.total ?? '')) ? String(p.total) : null;
  gravar({
    tipo: 'pedido', ...aparelho(), pedido_id: Number(p.id) || null, pedido_numero: p.numero ? String(p.numero) : null, valor,
    itens: (p.itens || []).slice(0, 100).map((i) => ({ produto_id: i.produto_id, codigo: i.codigo, nome: i.nome, quantidade: i.quantidade, total: i.total, unidade_id: i.unidade_id ?? null })),
  });
}

/** Login: guarda nome e último acesso do cliente. */
export async function registrarAcesso() {
  try {
    if (!sessao.ativa || !sessao.comprador) return;
    if (!(await garantirVinculo())) return;
    await supabaseComprador().rpc('portal_registrar_acesso', { p_nome: sessao.comprador.fantasia || sessao.comprador.nome || null });
    registrarEntrada();
  } catch { /* silencioso */ }
}

export function limparEventosSessao() { buscasGravadas.clear(); try { sessionStorage.removeItem(CHAVE_ACESSO); } catch { /* */ } }
