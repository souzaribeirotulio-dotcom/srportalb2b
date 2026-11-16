/* Ocorrências do fornecedor (seção 10 e Etapa 11).
   Só grava com a sessão do comprador vinculada pela ponte e ainda válida.
   Cada linha: loja, comprador_codigo, codigo, request_id e operacao (método e
   caminho do contrato, sem valores). Insert sem .select(): o comprador grava
   mas não lê. Mensagem, documento, senha, token e corpo ficam de fora. */
import { definirGancho } from '../api/g360.js';
import { sessao, garantirVinculo } from './sessao.js';
import { supabaseComprador, LOJA } from '../api/supabase.js';

const OPERACAO = /^(GET|POST|PUT|DELETE) [a-z][a-z0-9/{_}-]{0,79}$/;
const CODIGO = /^[A-Z][A-Z0-9_]{1,79}$/;
const REQUEST_ID = /^[a-f0-9]{16}$/;
const jaGravadas = new Set();

export function limparOcorrenciasSessao() { jaGravadas.clear(); }

/**
 * Registra uma ocorrência. `dedupe` evita repetir a mesma pendência a cada revisão.
 * Nunca derruba a tela: falhas ficam em silêncio.
 */
export async function registrarOcorrencia({ codigo, requestId, operacao, dedupe = null }) {
  try {
    if (!sessao.ativa || !sessao.comprador) return false;
    if (!CODIGO.test(codigo || '') || !REQUEST_ID.test(requestId || '') || !OPERACAO.test(operacao || '')) return false;
    const marca = dedupe || `${operacao}|${codigo}|${requestId}`;
    if (jaGravadas.has(marca)) return false;
    jaGravadas.add(marca);
    if (!(await garantirVinculo())) { jaGravadas.delete(marca); return false; }
    const { error } = await supabaseComprador().from('ocorrencias_g360').insert({
      loja: LOJA, comprador_codigo: sessao.comprador.codigo, codigo, request_id: requestId, operacao,
    });
    if (error) { jaGravadas.delete(marca); return false; }
    return true;
  } catch {
    return false;
  }
}

/** Pendências (revisão ou erro.campos.pendencias do envio): uma linha por pendência do fornecedor. */
export function registrarPendenciasFornecedor(pendencias, requestId, operacao, porSessao = false) {
  (pendencias || []).filter((p) => p && p.responsavel === 'fornecedor').forEach((p) => {
    registrarOcorrencia({ codigo: p.codigo, requestId, operacao, dedupe: porSessao ? `${operacao}|${p.codigo}` : null });
  });
}

// Erros com responsavel = fornecedor em qualquer chamada do comprador.
definirGancho('aoErroFornecedor', (erro) => {
  registrarOcorrencia({ codigo: erro.codigo, requestId: erro.requestId, operacao: erro.operacao });
});
