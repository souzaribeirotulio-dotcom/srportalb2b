/* =====================================================================
   Quantidade disponível (contrato 2026.11.17, pacote da noite):
   - produto e cada embalagem trazem quantidade_disponivel (texto decimal,
     já na embalagem; "0" = acabou; null = parâmetro desligado no G360);
   - "Disponível: N" no cartão, na janela do produto e nos Clips;
   - com loja.bloqueia_sem_estoque, o botão de somar e o "Adicionar" param no
     disponível da embalagem, contando o que já está no carrinho;
   - com o número nulo, a conferência fica para a revisão.
   Nada aqui usa faixa_disponibilidade (decisão da equipe: só informativa).
   ===================================================================== */
import Decimal from 'decimal.js';
import { sessao } from '../estado/sessao.js';
import { linhasCarrinho } from '../estado/carrinho.js';
import { esc } from './comum.js';
import { quantidade as fmtQtd } from '../ui/formato.js';
import { unidadeEscolhida } from './cartao.js';

const dec = (t) => { try { return new Decimal(String(t)); } catch { return null; } };

/** Texto "Disponível: N UN" da embalagem (ou '' quando a API não mandou o número). */
export function htmlDisponivel(p, unidadeId = '') {
  const op = unidadeEscolhida(p, unidadeId);
  if (op.quantidade_disponivel === null || op.quantidade_disponivel === undefined) return '';
  const zero = dec(op.quantidade_disponivel)?.lte(0);
  return `<div class="stk disp ${zero ? 'out' : ''}">Disponível: ${esc(fmtQtd(op.quantidade_disponivel))} ${esc(String(op.nome || '').toUpperCase())}</div>`;
}

/** Quanto desta embalagem já está no carrinho. */
function noCarrinho(produtoId, unidadeId) {
  const l = linhasCarrinho().find((x) => Number(x.produto_id) === Number(produtoId) && String(x.unidade ?? '') === String(unidadeId || ''));
  return l ? dec(l.quantidade) || new Decimal(0) : new Decimal(0);
}

/** Limite que ainda cabe no carrinho (Decimal) ou null quando não há trava. */
export function limite(p, unidadeId = '') {
  if (sessao.loja?.bloqueia_sem_estoque !== true) return null;
  const op = unidadeEscolhida(p, unidadeId);
  const d = op.quantidade_disponivel === null || op.quantidade_disponivel === undefined ? null : dec(op.quantidade_disponivel);
  if (!d) return null;
  const resto = d.minus(noCarrinho(p.id, unidadeId));
  return resto.lt(0) ? new Decimal(0) : resto;
}

/** Mensagem quando a quantidade passa do disponível; null quando pode. */
export function conferir(p, unidadeId, quantidadeTexto) {
  const lim = limite(p, unidadeId);
  if (lim === null) return null;
  const q = dec(quantidadeTexto);
  if (!q || q.lte(lim)) return null;
  const op = unidadeEscolhida(p, unidadeId);
  const un = String(op.nome || '').toUpperCase();
  const ja = noCarrinho(p.id, unidadeId);
  if (lim.lte(0)) return ja.gt(0) ? `Você já tem no carrinho tudo o que está disponível (${fmtQtd(op.quantidade_disponivel)} ${un}).` : 'Sem estoque disponível nesta embalagem.';
  return `Só há ${fmtQtd(lim.toString())} ${un} disponíve${lim.eq(1) ? 'l' : 'is'}${ja.gt(0) ? ` além do que já está no carrinho` : ''}.`;
}

/** Botão "+": devolve a nova quantidade (texto) sem passar do limite, e a mensagem se travou. */
export function somar(p, unidadeId, atualTexto, novoTexto) {
  const lim = limite(p, unidadeId);
  const novo = dec(novoTexto);
  if (lim === null || !novo || novo.lte(lim)) return { valor: novoTexto, msg: null };
  const atual = dec(atualTexto);
  return { valor: lim.gt(0) && (!atual || atual.lt(lim)) ? lim.toString() : atualTexto, msg: conferir(p, unidadeId, novoTexto) };
}

