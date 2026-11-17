/* =====================================================================
   Quantidade disponível (contrato 2026.11.17, pacote da noite):
   - produto e cada embalagem trazem quantidade_disponivel (texto decimal,
     já na embalagem; "0" = acabou; null = parâmetro desligado no G360);
   - selo "Disponível" / "Estoque baixo" (sem o número) no cartão, na janela e nos Clips;
   - com loja.bloqueia_sem_estoque, o botão de somar e o "Adicionar" param no
     disponível da embalagem, contando o que já está no carrinho;
   - com o número nulo, a conferência fica para a revisão.
   Nada aqui usa faixa_disponibilidade (decisão da equipe: só informativa).
   ===================================================================== */
import Decimal from 'decimal.js';
import { sessao } from '../estado/sessao.js';
import { linhasCarrinho } from '../estado/carrinho.js';
import { unidadeEscolhida } from './cartao.js';

const dec = (t) => { try { return new Decimal(String(t)); } catch { return null; } };

/* Decisão da equipe (17/11): o cliente NÃO vê o número do estoque.
   Mostra só "Disponível" ou, abaixo de ESTOQUE_BAIXO unidades (na unidade base), "Estoque baixo". */
export const ESTOQUE_BAIXO = 15;

/** Selo de estoque pelo número da API (sem mostrar o número); '' quando a API não mandou. */
export function htmlDisponivel(p) {
  const q = p?.quantidade_disponivel;
  if (q === null || q === undefined) return '';
  const n = dec(q);
  if (!n || n.lte(0)) return '';
  return n.lt(ESTOQUE_BAIXO) ? '<div class="stk disp baixo">Estoque baixo</div>' : '<div class="stk disp">Disponível</div>';
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
  const ja = noCarrinho(p.id, unidadeId);
  if (lim.lte(0)) return ja.gt(0) ? 'Você já tem no carrinho todo o estoque disponível deste produto.' : 'Sem estoque disponível nesta embalagem.';
  return `Quantidade acima do estoque disponível${ja.gt(0) ? ', contando o que já está no carrinho' : ''}.`;
}

/** Botão "+": devolve a nova quantidade (texto) sem passar do limite, e a mensagem se travou. */
export function somar(p, unidadeId, atualTexto, novoTexto) {
  const lim = limite(p, unidadeId);
  const novo = dec(novoTexto);
  if (lim === null || !novo || novo.lte(lim)) return { valor: novoTexto, msg: null };
  const atual = dec(atualTexto);
  return { valor: lim.gt(0) && (!atual || atual.lt(lim)) ? lim.toString() : atualTexto, msg: conferir(p, unidadeId, novoTexto) };
}

