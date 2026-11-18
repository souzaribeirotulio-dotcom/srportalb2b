/* =====================================================================
   Sessão do comprador (seção 7 do CLAUDE.md).
   - Token da API na memória e no sessionStorage da aba (chave só dele), para o F5
     não derrubar a sessão. Fechar a aba ou abrir outra pede login. Nada de
     localStorage, cookie ou URL. Ao recarregar: GET me e abrir_sessao de novo.
   - Inatividade contada a partir da última chamada autenticada aceita.
   - Vínculo do Supabase (Minha Lista, ocorrências) conferido antes de ler
     ou gravar; vencido, reabre pela ponte com o token em memória.
   ===================================================================== */
import { entrar as entrarApi, sair as sairApi, trocarSenha as trocarSenhaApi, consultarComprador, definirGancho, ErroApi } from '../api/g360.js';
import { abrirSessaoPonte, ErroPonte } from '../api/ponte.js';
import { supabaseComprador, supabaseConfigurado, LOJA } from '../api/supabase.js';

const CHAVE_TOKEN = `sr-g360-comprador-${LOJA}`;
function guardarToken(t) { try { if (t) sessionStorage.setItem(CHAVE_TOKEN, t); else sessionStorage.removeItem(CHAVE_TOKEN); } catch { /* sem storage: vale só a memória */ } }
function tokenGuardado() { try { return sessionStorage.getItem(CHAVE_TOKEN); } catch { return null; } }

const MARGEM_VINCULO_MS = 15000;

const estado = {
  token: null,
  comprador: null,
  loja: null,
  expiraEm: 0,
  inatividadeMin: 8,
  ultimaAtividade: 0,
  vinculoExpira: 0,
  supabaseOk: false,
};
let relogio = null;
const ouvintes = new Set();

/** A tela é avisada quando a sessão termina: fn(motivo, mensagem). */
export function aoEncerrar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }

export const sessao = {
  get ativa() { return !!estado.token; },
  get token() { return estado.token; },
  get comprador() { return estado.comprador; },
  get loja() { return estado.loja; },
  get supabaseOk() { return estado.supabaseOk; },
};

function limparEstado() {
  estado.token = null;
  guardarToken(null);
  estado.comprador = null;
  estado.expiraEm = 0;
  estado.ultimaAtividade = 0;
  estado.vinculoExpira = 0;
  estado.supabaseOk = false;
  if (relogio) { clearInterval(relogio); relogio = null; }
}

async function encerrarSupabaseLocal() {
  const sb = supabaseComprador();
  if (sb) { try { await sb.auth.signOut({ scope: 'local' }); } catch { /* sessão local já limpa */ } }
}

/** Encerra tudo do lado do navegador e avisa as telas. */
export async function encerrarSessao(motivo, mensagem) {
  if (!estado.token && motivo !== 'forcar') return;
  limparEstado();
  await encerrarSupabaseLocal();
  ouvintes.forEach((fn) => { try { fn(motivo, mensagem); } catch { /* nada */ } });
}

function vigiar() {
  if (relogio) clearInterval(relogio);
  // Só confere o relógio local: não faz chamada para manter a sessão viva.
  relogio = setInterval(() => {
    if (!estado.token) return;
    const agora = Date.now();
    if (agora - estado.ultimaAtividade > estado.inatividadeMin * 60000) {
      encerrarSessao('inatividade', 'Sua sessão terminou por inatividade. Entre novamente.');
    } else if (estado.expiraEm && agora >= estado.expiraEm) {
      encerrarSessao('expirou', 'Sua sessão terminou. Entre novamente.');
    }
  }, 5000);
}

// Ganchos do módulo da API: atividade e 401 do comprador.
const ganchoOperador = { fn: null, atividade: null };
export function definirEncerramentoOperador(fn) { ganchoOperador.fn = fn; }
export function definirAtividadeOperador(fn) { ganchoOperador.atividade = fn; }
definirGancho('aoAtividade', (escopo) => {
  if (escopo === 'comprador') estado.ultimaAtividade = Date.now();
  else if (escopo === 'operador' && ganchoOperador.atividade) ganchoOperador.atividade();
});
definirGancho('aoSessaoEncerrada', (escopo, erro) => {
  if (escopo === 'comprador') encerrarSessao('401', erro.message);
  else if (escopo === 'operador' && ganchoOperador.fn) ganchoOperador.fn(erro);
});

/**
 * Abre o vínculo do Supabase pela ponte. Devolve true/false.
 * No 401 a sessão da API não vale mais: volta ao login. No 503 segue sem Supabase.
 */
/* Uma abertura de vínculo por vez: quem chega durante a abertura espera a mesma. */
let abrindo = null;
export function vinculoEmAndamento() { return !!abrindo; }
function abrirVinculo() {
  if (!abrindo) abrindo = abrirVinculoAgora().finally(() => { abrindo = null; });
  return abrindo;
}
async function abrirVinculoAgora() {
  estado.supabaseOk = false;
  const sb = supabaseComprador();
  if (!sb || !estado.token) return false;
  try {
    const r = await abrirSessaoPonte(estado.token);
    const { error } = await sb.auth.setSession(r.sessao);
    if (error) return false;
    estado.vinculoExpira = Date.parse(r.api_vinculo_expira_em) || 0;
    const exp = Date.parse(r.api_expira_em);
    if (exp) estado.expiraEm = exp;
    if (Number.isInteger(r.api_inatividade_minutos) && r.api_inatividade_minutos > 0) estado.inatividadeMin = r.api_inatividade_minutos;
    estado.supabaseOk = true;
    return true;
  } catch (e) {
    if (e instanceof ErroPonte && e.status === 401) {
      await encerrarSessao('401', 'Sua sessão terminou. Entre novamente.');
    }
    return false;
  }
}

/**
 * Antes de ler ou gravar no Supabase: confere o prazo do vínculo.
 * Vencido, encerra a sessão local e reabre com o token em memória (nunca em intervalo fixo).
 */
export async function garantirVinculo() {
  if (!estado.token || !supabaseConfigurado()) return false;
  if (abrindo) await abrindo;
  if (estado.supabaseOk && Date.now() < estado.vinculoExpira - MARGEM_VINCULO_MS) return true;
  await encerrarSupabaseLocal();
  return abrirVinculo();
}

/** Login: POST sessoes e, em seguida, abrir_sessao na ponte. */
export async function entrar(usuario, senha) {
  const d = await entrarApi(usuario, senha);
  estado.token = d.token;
  guardarToken(d.token); // substitui o de outro comprador, se houver
  estado.comprador = d.comprador;
  estado.loja = d.loja;
  estado.expiraEm = Date.parse(d.expira_em) || 0;
  estado.inatividadeMin = Number(d.loja?.sessao_minutos) || 8;
  estado.ultimaAtividade = Date.now();
  vigiar();
  await abrirVinculo();
  return d;
}

/** Sair: DELETE sessao na API e signOut local no Supabase. */
export async function sair() {
  const token = estado.token;
  if (token) { try { await sairApi(token); } catch { /* a saída local acontece de qualquer jeito */ } }
  await encerrarSessao('saida', null);
}

/** PUT senha: o token novo substitui o anterior; as sessões do Supabase são encerradas em todo lugar. */
export async function trocarSenha(senhaAtual, senhaNova) {
  const d = await trocarSenhaApi(estado.token, senhaAtual, senhaNova);
  guardarToken(d.token);
  const sb = supabaseComprador();
  if (sb) { try { await sb.auth.signOut({ scope: 'global' }); } catch { /* segue */ } }
  estado.token = d.token;
  estado.comprador = d.comprador || estado.comprador;
  estado.expiraEm = Date.parse(d.expira_em) || estado.expiraEm;
  estado.ultimaAtividade = Date.now();
  estado.supabaseOk = false;
  estado.vinculoExpira = 0;
  await abrirVinculo();
  return d;
}

/**
 * Depois do F5: com um token guardado na aba, confere com GET me antes de mostrar qualquer tela privada.
 * 200 → segue logado e reabre o vínculo do Supabase. 401 → apaga o token (a tela mostra o login).
 * Falha de rede → segue sem sessão nesta carga, sem apagar o token.
 */
export async function restaurarSessao() {
  const t = tokenGuardado();
  if (!t || estado.token) return false;
  let d;
  try { d = await consultarComprador(t); }
  catch (e) { if (e instanceof ErroApi && e.status === 401) guardarToken(null); return false; }
  estado.token = t;
  estado.comprador = d.comprador;
  estado.loja = d.loja;
  estado.expiraEm = Date.parse(d.expira_em) || 0;
  estado.inatividadeMin = Number(d.loja?.sessao_minutos) || 8;
  estado.ultimaAtividade = Date.now();
  vigiar();
  // F5: os cards não esperam o vínculo do Supabase (só a Minha Lista precisa dele).
  abrirVinculo().catch(() => false);
  return !!estado.token;
}
