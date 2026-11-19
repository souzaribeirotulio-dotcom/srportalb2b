/* =====================================================================
   Envio do pedido sem duplicar (seção 9 do CLAUDE.md).
   Cada intenção de compra tem uma chave (Idempotency-Key). A chave e o corpo
   exato ficam no sessionStorage com o código do comprador até haver resposta
   final — não são segredo. Matriz de reenvio:
   - 201/200 → pedido; apaga.
   - tempo/conexão → consulta por chave; achou → pedido; 404 → reenvia igual.
   - 409 OPERACAO/VENDA_EM_ANDAMENTO → espera 3 s e reenvia (até 3 vezes).
   - 409 REVISAO_ALTERADA → a tela revisa de novo e pede confirmação (mesma chave).
   - 409 CHAVE_REUTILIZADA → consulta pela chave antes de qualquer coisa.
   - 422 REVISAO_BLOQUEADA → mostra as pendências; pedido não gravado.
   - 503 → espera 30 s, consulta pela chave e reenvia com a mesma chave.
   ===================================================================== */
import { enviarPedido, consultarPedidoPorChave, ErroApi } from '../api/g360.js';
import { sessao } from './sessao.js';

const CHAVE_STORAGE = 'sr_g360_envio_pendente';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export function lerPendente() {
  try {
    const v = JSON.parse(sessionStorage.getItem(CHAVE_STORAGE) || 'null');
    return v && typeof v.chave === 'string' && v.corpo && Number.isInteger(v.comprador) ? v : null;
  } catch { return null; }
}
function gravarPendente(v) { try { sessionStorage.setItem(CHAVE_STORAGE, JSON.stringify(v)); } catch { /* sem storage: segue em memória */ } }
export function apagarPendente() { try { sessionStorage.removeItem(CHAVE_STORAGE); } catch { /* nada */ } }

/** Pendente deste comprador, ou null. A chave pertence a quem a criou. */
export function pendenteDoComprador() {
  const p = lerPendente();
  return p && sessao.comprador && p.comprador === sessao.comprador.codigo ? p : null;
}

/** Ao entrar outro comprador, descarta chave e corpo do anterior. */
export function descartarEnvioDeOutroComprador() {
  const p = lerPendente();
  if (p && sessao.comprador && p.comprador !== sessao.comprador.codigo) apagarPendente();
}

/** Chave nova: letras, números e hífen, 36 caracteres. */
export function novaChave() { return crypto.randomUUID(); }

/** Prepara uma intenção de envio e grava antes de mandar. */
export function prepararEnvio(corpo, chaveExistente = null) {
  const p = { comprador: sessao.comprador.codigo, chave: chaveExistente || novaChave(), corpo };
  gravarPendente(p);
  return p;
}

/** Atualiza a assinatura mantendo a mesma chave (REVISAO_ALTERADA confirmada). */
export function atualizarAssinatura(pendente, assinatura) {
  const p = { ...pendente, corpo: { ...pendente.corpo, assinatura } };
  gravarPendente(p);
  return p;
}

/** Consulta pela chave: { tipo: 'pedido' | 'nao_gravado' | 'sem_rede' | 'erro' }. */
export async function consultarPorChave(pendente) {
  try {
    const pedido = await consultarPedidoPorChave(sessao.token, pendente.chave);
    apagarPendente();
    return { tipo: 'pedido', pedido };
  } catch (e) {
    // Aqui o 404 NAO_ENCONTRADO é esperado: o pedido não foi gravado.
    if (e instanceof ErroApi && e.status === 404 && e.codigo === 'NAO_ENCONTRADO') return { tipo: 'nao_gravado' };
    if (e instanceof ErroApi && (e.tipo === 'rede' || e.tipo === 'tempo')) return { tipo: 'sem_rede' };
    return { tipo: 'erro', erro: e };
  }
}

/**
 * Executa o envio seguindo a matriz. aoProgresso(texto, segundos?) atualiza a tela.
 * Resultado: { tipo: 'pedido' | 'revisao_alterada' | 'bloqueada' | 'chave_reutilizada' | 'sem_conexao' | 'erro' | 'sessao', ... }.
 */
export async function executarEnvio(pendente, aoProgresso = () => {}, { consultarPrimeiro = false } = {}) {
  let conflitos = 0;
  let reenviosAutomaticos = 0;

  if (consultarPrimeiro) {
    aoProgresso('Conferindo se o pedido já foi gravado…');
    const c = await consultarPorChave(pendente);
    if (c.tipo === 'pedido') return c;
    if (c.tipo === 'sem_rede') return { tipo: 'sem_conexao' };
    if (c.tipo === 'erro') return { tipo: 'erro', erro: c.erro, podeTentar: true };
  }

  for (;;) {
    if (!sessao.ativa) return { tipo: 'sessao' };
    aoProgresso('Enviando o pedido…');
    try {
      const r = await enviarPedido(sessao.token, pendente.corpo, pendente.chave);
      apagarPendente();
      return { tipo: 'pedido', pedido: r.dados, repeticao: r.status === 200 };
    } catch (e) {
      if (!(e instanceof ErroApi)) return { tipo: 'erro', erro: e, podeTentar: true };

      if (e.tipo === 'rede' || e.tipo === 'tempo') {
        aoProgresso('A resposta não chegou. Conferindo se o pedido foi gravado…');
        const c = await consultarPorChave(pendente);
        if (c.tipo === 'pedido') return c;
        if (c.tipo === 'nao_gravado' && reenviosAutomaticos < 2) { reenviosAutomaticos += 1; continue; }
        if (c.tipo === 'erro') return { tipo: 'erro', erro: c.erro, podeTentar: true };
        return { tipo: 'sem_conexao' };
      }
      if (e.status === 401) return { tipo: 'sessao' };
      if (e.status === 409 && (e.codigo === 'OPERACAO_EM_ANDAMENTO' || e.codigo === 'VENDA_EM_ANDAMENTO')) {
        if (conflitos < 3) {
          conflitos += 1;
          const seg = e.retryAfter || 3;
          aoProgresso(e.message, seg);
          await esperar(seg * 1000);
          continue;
        }
        return { tipo: 'erro', erro: e, podeTentar: true };
      }
      if (e.codigo === 'REVISAO_ALTERADA') return { tipo: 'revisao_alterada', erro: e };
      if (e.codigo === 'CHAVE_REUTILIZADA') {
        const c = await consultarPorChave(pendente);
        if (c.tipo === 'pedido') return c;
        return { tipo: 'chave_reutilizada', erro: e };
      }
      if (e.codigo === 'REVISAO_BLOQUEADA') {
        apagarPendente(); // pedido não gravado
        return { tipo: 'bloqueada', erro: e, pendencias: Array.isArray(e.campos?.pendencias) ? e.campos.pendencias : [] };
      }
      if (e.status === 503) {
        const seg = e.retryAfter || 30;
        aoProgresso(e.message, seg);
        await esperar(seg * 1000);
        const c = await consultarPorChave(pendente);
        if (c.tipo === 'pedido') return c;
        if (c.tipo === 'nao_gravado' && reenviosAutomaticos < 2) { reenviosAutomaticos += 1; continue; }
        return { tipo: 'erro', erro: e, podeTentar: true };
      }
      if (e.status === 429) return { tipo: 'erro', erro: e, podeTentar: true };
      // Demais recusas são definitivas: o pedido não foi gravado.
      apagarPendente();
      return { tipo: 'erro', erro: e, podeTentar: false };
    }
  }
}
