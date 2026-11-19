/* Carrinho em qualquer navegador: o mesmo carrinho do comprador fica no Supabase
   (tabela portal_carrinhos, só pelas funções portal_carrinho_ler/gravar, com a
   sessão vinculada pela ponte). Vale a versão mais nova. Sem preço nem estoque:
   esses vêm da API na hora. Se o Supabase não responder, o carrinho do navegador
   continua valendo. Nada de chamada em intervalo fixo: lê ao entrar, ao voltar
   para a aba e ao abrir o carrinho; grava logo depois de cada mudança. */
import { sessao, garantirVinculo } from './sessao.js';
import { supabaseComprador } from '../api/supabase.js';
import { aoMudarCarrinho, donoCarrinho, carimboCarrinho, linhasParaGuardar, substituirCarrinho } from './carrinho.js';

const ESPERA_GRAVAR_MS = 800;
let timer = null;
let gravando = null;
let lendo = null;
let iniciado = false;

export function iniciarCarrinhoNuvem() {
  if (iniciado) return;
  iniciado = true;
  aoMudarCarrinho((origem) => {
    if (origem !== 'local' || !donoCarrinho()) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; gravarCarrinho(); }, ESPERA_GRAVAR_MS);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sincronizarCarrinho();
  });
}

async function gravarCarrinho() {
  const dono = donoCarrinho();
  if (!dono || !sessao.ativa) return;
  if (gravando) await gravando.catch(() => {});
  gravando = (async () => {
    if (!(await garantirVinculo()) || donoCarrinho() !== dono) return;
    const sb = supabaseComprador();
    if (!sb) return;
    await sb.rpc('portal_carrinho_gravar', { p_linhas: linhasParaGuardar(), p_em: carimboCarrinho() });
  })().catch(() => { /* sem Supabase agora: o carrinho do navegador continua valendo */ }).finally(() => { gravando = null; });
  return gravando;
}

/** Lê o carrinho do Supabase; se for mais novo que o desta tela, substitui. Se for mais velho, manda o desta tela. */
export function sincronizarCarrinho() {
  if (!lendo) lendo = ler().finally(() => { lendo = null; });
  return lendo;
}

async function ler() {
  const dono = donoCarrinho();
  if (!dono || !sessao.ativa || timer) return false; // mudança local ainda por gravar: ela é a mais nova
  try {
    if (gravando) await gravando;
    if (!(await garantirVinculo()) || donoCarrinho() !== dono || timer) return false;
    const sb = supabaseComprador();
    if (!sb) return false;
    const { data, error } = await sb.rpc('portal_carrinho_ler');
    if (error || donoCarrinho() !== dono || timer) return false;
    const em = Number(data?.em) || 0;
    if (em > carimboCarrinho()) { substituirCarrinho(data.linhas, em); return true; }
    if (em < carimboCarrinho()) gravarCarrinho();
  } catch { /* segue com o carrinho do navegador */ }
  return false;
}
