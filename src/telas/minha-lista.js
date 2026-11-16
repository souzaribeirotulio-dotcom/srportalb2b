/* Minha Lista (Etapa 9): os produto_id ficam no Supabase; preço e
   disponibilidade são consultados na hora pelo filtro ids, percorrendo todas
   as páginas. Preço guardado nunca vai para a tela. */
import { produtosPorIds } from '../api/g360.js';
import { sessao } from '../estado/sessao.js';
import { carregarIds, removerDaLista, limparMinhaListaEstado, ErroLista } from '../estado/minha-lista.js';
import { htmlCartao } from '../ui/produto.js';
import { ligarCartoes } from '../ui/acoes-produto.js';
import { ligarFotos } from '../ui/fotos.js';
import { carregando, vazia, erroTela, titulo } from '../ui/telas-comum.js';
import { esc } from '../ui/util.js';

export function limparMinhaLista() { limparMinhaListaEstado(); }

export function telaMinhaLista({ conteudo, ir, eAtual }) {
  conteudo.innerHTML = `${titulo('Minha Lista', 'Os produtos que você salvou, com o preço e a disponibilidade de agora.')}<div id="g360MinhaLista"></div>`;
  const alvo = conteudo.querySelector('#g360MinhaLista');

  async function carregar() {
    carregando(alvo, 'Carregando a sua lista…');
    try {
      const ids = [...(await carregarIds())];
      if (!eAtual()) return;
      if (!ids.length) {
        vazia(alvo, 'Sua lista está vazia.', 'No catálogo, toque em "Salvar na Minha Lista" nos produtos que você compra sempre.',
          '<button type="button" class="g360-btn pri" id="g360IrCatalogo">Ir para o catálogo</button>');
        alvo.querySelector('#g360IrCatalogo').addEventListener('click', () => ir('/catalogo'));
        return;
      }
      const achados = await produtosPorIds(sessao.token, ids);
      if (!eAtual()) return;
      alvo.innerHTML = `<p class="contagem">${ids.length} produto${ids.length === 1 ? '' : 's'} na lista</p>
        <div class="grade-produtos">${ids.map((id) => achados.has(id) ? htmlCartao(achados.get(id), { naLista: true })
          : `<article class="cartao-produto fora-catalogo" data-fora="${id}"><div class="foto vazia"><span>Sem foto</span></div><div class="cp-corpo">
              <h3 class="cp-nome">Produto ${esc(id)}</h3><p class="cp-sem">Indisponível no momento.</p>
              <button type="button" class="app-link cp-remover-fora">Remover da lista</button><p class="cp-retorno" aria-live="polite"></p></div></article>`).join('')}</div>`;
      ligarCartoes(alvo, achados, { aoMudarLista: (id, agora) => { if (!agora) alvo.querySelector(`.cartao-produto[data-id="${id}"]`)?.remove(); } });
      ligarFotos(alvo);
      alvo.querySelectorAll('.cp-remover-fora').forEach((b) => b.addEventListener('click', async () => {
        const cartao = b.closest('.cartao-produto');
        b.disabled = true;
        try { await removerDaLista(cartao.dataset.fora); cartao.remove(); } catch (e) { cartao.querySelector('.cp-retorno').textContent = e.message; b.disabled = false; }
      }));
    } catch (e) {
      if (!eAtual()) return;
      if (e instanceof ErroLista) {
        alvo.innerHTML = `<div class="g360-msg g360-msg-tentar" role="alert"><strong class="g360-msg-rotulo">Minha Lista indisponível</strong><p>${esc(e.message)}</p>
          <button type="button" class="g360-btn sec g360-msg-botao" id="g360TentarLista">Tentar de novo</button></div>`;
        alvo.querySelector('#g360TentarLista').addEventListener('click', carregar);
      } else erroTela(alvo, e, carregar);
    }
  }
  carregar();
}
