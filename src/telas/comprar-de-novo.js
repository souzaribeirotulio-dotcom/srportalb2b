/* Comprar de novo (Etapa 9): GET historico-compras traz os produtos já
   comprados; preço e disponibilidade vêm do catálogo na hora (filtro ids). */
import { consultarHistoricoCompras, produtosPorIds } from '../api/g360.js';
import { sessao } from '../estado/sessao.js';
import { idsCarregados } from '../estado/minha-lista.js';
import { htmlCartao } from '../ui/produto.js';
import { ligarCartoes } from '../ui/acoes-produto.js';
import { ligarFotos } from '../ui/fotos.js';
import { quantidade, dataBr } from '../ui/formato.js';
import { carregando, vazia, erroTela, titulo } from '../ui/telas-comum.js';
import { esc } from '../ui/util.js';

let meses = 6;

export function telaComprarDeNovo({ conteudo, ir, eAtual }) {
  conteudo.innerHTML = `${titulo('Comprar de novo', 'O que você já comprou da Souza Ribeiro, pelo portal ou com o vendedor.')}
    <div class="filtros"><div><label for="g360Meses">Período</label>
      <select id="g360Meses">${[3, 6, 12, 24].map((m) => `<option value="${m}" ${m === meses ? 'selected' : ''}>Últimos ${m} meses</option>`).join('')}</select></div></div>
    <div id="g360Recompra"></div>`;
  const alvo = conteudo.querySelector('#g360Recompra');
  conteudo.querySelector('#g360Meses').addEventListener('change', (ev) => { meses = Number(ev.target.value); carregar(); });

  async function carregar() {
    carregando(alvo, 'Carregando o seu histórico…');
    try {
      const h = await consultarHistoricoCompras(sessao.token, meses);
      if (!eAtual()) return;
      const produtos = [...(h.produtos || [])].sort((a, b) => String(b.ultima_compra?.data).localeCompare(String(a.ultima_compra?.data)));
      if (!produtos.length) {
        vazia(alvo, 'Nenhuma compra no período.', 'Escolha um período maior ou vá ao catálogo.',
          '<button type="button" class="g360-btn pri" id="g360IrCatalogo">Ir para o catálogo</button>');
        alvo.querySelector('#g360IrCatalogo').addEventListener('click', () => ir('/catalogo'));
        return;
      }
      const achados = await produtosPorIds(sessao.token, produtos.map((p) => p.produto_id));
      if (!eAtual()) return;
      const lista = idsCarregados();
      alvo.innerHTML = `<p class="contagem">${produtos.length} produto${produtos.length === 1 ? '' : 's'} comprado${produtos.length === 1 ? '' : 's'} de ${esc(dataBr(h.inicio))} a ${esc(dataBr(h.fim))}</p>
        <div class="grade-produtos">${produtos.map((h1) => {
          const u = h1.ultima_compra || {};
          const info = `<p class="cp-historico">Última compra: ${esc(quantidade(u.quantidade))} ${esc(u.unidade_vendida || u.unidade_base || '')} em ${esc(dataBr(u.data))} · ${Number(h1.pedidos)} pedido${h1.pedidos === 1 ? '' : 's'} no período</p>`;
          const p = achados.get(Number(h1.produto_id));
          if (!p) {
            return `<article class="cartao-produto fora-catalogo"><div class="foto vazia"><span>Sem foto</span></div><div class="cp-corpo">
              <h3 class="cp-nome">Produto ${esc(h1.produto_id)}</h3>${info}<p class="cp-sem">Indisponível no momento.</p></div></article>`;
          }
          return htmlCartao(p, { naLista: lista ? lista.has(p.id) : null, rodape: info });
        }).join('')}</div>`;
      ligarCartoes(alvo, achados);
      ligarFotos(alvo);
    } catch (e) {
      if (eAtual()) erroTela(alvo, e, carregar);
    }
  }
  carregar();
}
