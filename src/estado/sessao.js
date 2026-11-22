/* =====================================================================
   Sessão do comprador (seção 7 do CLAUDE.md).
   - Sessão normal: token na memória e no sessionStorage da aba (g360:<loja>:comprador:sessao),
     para o F5 não derrubar a sessão. Fechar a aba ou o app pede login.
   - "Continuar conectado" efetivo (resposta do POST sessoes): token no localStorage
     (g360:<loja>:comprador:persistente). Vale ao fechar e abrir o app; o G360 renova
     o prazo pelo uso, até 90 dias do login. Sem inatividade em minutos nesse caso.
   - Antes de guardar um token novo, e ao sair / 401, as duas chaves são apagadas.
     Nada de cookie ou URL. Ao reabrir: GET me e abrir_sessao de novo.
   - Inatividade (só na sessão normal) contada a partir da última chamada autenticada aceita.
   - Vínculo do Supabase (Minha Lista, ocorrências) conferido antes de ler
     ou gravar; vencido, reabre pela ponte com o token em memória.
   ===================================================================== */
import { entrar as entrarApi, sair as sairApi, trocarSenha as trocarSenhaApi, consultarComprador, definirGancho, ErroApi } from '../api/g360.js';
import { abrirSessaoPonte, ErroPonte } from '../api/ponte.js';
import { vincularCarrinho, desvincularCarrinho } from './carrinho.js';
import { supabaseComprador, supabaseConfigurado, LOJA } from '../api/supabase.js';

const CHAVE_SESSAO = `g360:${LOJA}:comprador:sessao`;
const CHAVE_PERSISTENTE = `g360:${LOJA}:comprador:persistente`;
const CHAVE_ANTIGA = `sr-g360-comprador-${LOJA}`; // versão anterior (só sessionStorage)

function apagarTokens() {
  try { sessionStorage.removeItem(CHAVE_SESSAO); sessionStorage.removeItem(CHAVE_ANTIGA); } catch { /* sem storage */ }
  try { localStorage.removeItem(CHAVE_PERSISTENTE); } catch { /* sem storage */ }
}
/** Guarda o token: apaga os dois lugares e grava no localStorage só com Continuar conectado efetivo. */
function guardarToken(t, persistente = false) {
  apagarTokens();
  if (!t) return;
  try { (persistente ? localStorage : sessionStorage).setItem(persistente ? CHAVE_PERSISTENTE : CHAVE_SESSAO, t); } catch { /* sem storage: vale só a memória */ }
}
/** Token guardado: primeiro o da aba (sessão normal), depois o persistente. */
function tokenGuardado() {
  try { const t = sessionStorage.getItem(CHAVE_SESSAO) || sessionStorage.getItem(CHAVE_ANTIGA); if (t) return { token: t, persistente: false }; } catch { /* sem storage */ }
  try { const t = localStorage.getItem(CHAVE_PERSISTENTE); if (t) return { token: t, persistente: true }; } catch { /* sem storage */ }
  return null;
}

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
  longa: false, // Continuar conectado efetivo
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
  get continuarConectado() { return estado.longa; },
};

function limparEstado() {
  desvincularCarrinho();
  estado.token = null;
  guardarToken(null);
  estado.comprador = null;
  estado.expiraEm = 0;
  estado.ultimaAtividade = 0;
  estado.vinculoExpira = 0;
  estado.supabaseOk = false;
  estado.longa = false;
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
    // Sessão longa: sem inatividade em minutos e sem encerrar pelo expira_em antigo
    // (o G360 renova pelo uso). Quem decide é o GET me / o primeiro 401.
    if (estado.longa) return;
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
    if (!estado.longa && Number.isInteger(r.api_inatividade_minutos) && r.api_inatividade_minutos > 0) estado.inatividadeMin = r.api_inatividade_minutos;
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
export async function entrar(usuario, senha, continuarConectado = false) {
  const d = await entrarApi(usuario, senha, continuarConectado);
  estado.token = d.token;
  estado.longa = d.continuar_conectado === true; // vale o efetivo da resposta, não a caixa
  guardarToken(d.token, estado.longa); // apaga os dois lugares (inclusive de outro comprador) e guarda o novo
  estado.comprador = d.comprador;
  estado.loja = d.loja;
  estado.expiraEm = Date.parse(d.expira_em) || 0;
  estado.inatividadeMin = Number(d.loja?.sessao_minutos) || 8;
  estado.ultimaAtividade = Date.now();
  vigiar();
  vincularCarrinho(chaveCarrinho());
  await abrirVinculo();
  return d;
}

/** Carrinho guardado no navegador: um por loja e comprador. */
function chaveCarrinho() { return `sr-carrinho-${LOJA}-${estado.comprador?.codigo || ''}`; }

/** Sair: DELETE sessao na API e signOut local no Supabase. */
export async function sair() {
  const token = estado.token;
  if (token) { try { await sairApi(token); } catch { /* a saída local acontece de qualquer jeito */ } }
  await encerrarSessao('saida', null);
}

/** PUT senha: o token novo substitui o anterior; as sessões do Supabase são encerradas em todo lugar. */
export async function trocarSenha(senhaAtual, senhaNova) {
  const d = await trocarSenhaApi(estado.token, senhaAtual, senhaNova);
  // O token novo é de sessão normal: sai do localStorage e vai para a aba.
  guardarToken(d.token, false);
  estado.longa = false;
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
 * Depois do F5 (ou ao reabrir o app com Continuar conectado): com um token guardado, confere com GET me antes de mostrar qualquer tela privada.
 * 200 → segue logado e reabre o vínculo do Supabase. 401 → apaga o token (a tela mostra o login).
 * Falha de rede → segue sem sessão nesta carga, sem apagar o token.
 */
export async function restaurarSessao() {
  const g = tokenGuardado();
  if (!g || estado.token) return false;
  const t = g.token;
  let d;
  try { d = await consultarComprador(t); }
  catch (e) { if (e instanceof ErroApi && e.status === 401) guardarToken(null); return false; }
  estado.token = t;
  estado.longa = g.persistente;
  estado.comprador = d.comprador;
  estado.loja = d.loja;
  estado.expiraEm = Date.parse(d.expira_em) || 0;
  estado.inatividadeMin = Number(d.loja?.sessao_minutos) || 8;
  estado.ultimaAtividade = Date.now();
  vigiar();
  vincularCarrinho(chaveCarrinho());
  // F5: os cards não esperam o vínculo do Supabase (só a Minha Lista precisa dele).
  abrirVinculo().catch(() => false);
  return !!estado.token;
}
