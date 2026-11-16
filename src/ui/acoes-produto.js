/* Liga os botões dos cartões de produto: adicionar ao carrinho e Minha Lista. */
import { adicionar } from '../estado/carrinho.js';
import { incluirNaLista, removerDaLista, idsCarregados } from '../estado/minha-lista.js';
import { normalizarQuantidade } from './formato.js';
import { ligarUnidade, linhaDoCartao } from './produto.js';

export function ligarCartoes(raiz, produtos, { aoMudarLista } = {}) {
  raiz.querySelectorAll('.cartao-produto').forEach((cartao) => {
    const p = produtos.get(Number(cartao.dataset.id));
    if (!p) return;
    ligarUnidade(cartao, p);
    const retorno = cartao.querySelector('.cp-retorno');
    const add = cartao.querySelector('.cp-add');
    if (add) {
      const campo = cartao.querySelector('.cp-qtd');
      const fazer = () => {
        const q = normalizarQuantidade(campo.value);
        if (!q) {
          retorno.className = 'cp-retorno erro';
          retorno.textContent = 'Quantidade inválida: use um número maior que zero, com até 4 casas depois da vírgula.';
          campo.setAttribute('aria-invalid', 'true'); campo.focus();
          return;
        }
        campo.removeAttribute('aria-invalid');
        const r = adicionar(linhaDoCartao(cartao, p, q));
        retorno.className = r === 'limite' ? 'cp-retorno erro' : 'cp-retorno ok';
        retorno.textContent = r === 'limite' ? 'O carrinho aceita até 100 linhas. Envie este pedido ou remova itens.'
          : r === 'somado' ? 'Quantidade somada ao item que já estava no carrinho.' : 'Adicionado ao carrinho.';
      };
      add.addEventListener('click', fazer);
      campo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); fazer(); } });
    }
    const lista = cartao.querySelector('.cp-lista');
    if (lista) {
      lista.addEventListener('click', async () => {
        const naLista = lista.getAttribute('aria-pressed') === 'true';
        lista.disabled = true;
        try {
          if (naLista) await removerDaLista(p.id); else await incluirNaLista(p.id);
          const agora = !naLista;
          lista.setAttribute('aria-pressed', String(agora));
          lista.textContent = agora ? '♥ Na Minha Lista' : '♡ Salvar na Minha Lista';
          retorno.className = 'cp-retorno ok';
          retorno.textContent = agora ? 'Salvo na Minha Lista.' : 'Removido da Minha Lista.';
          if (aoMudarLista) aoMudarLista(p.id, agora);
        } catch (e) {
          retorno.className = 'cp-retorno erro';
          retorno.textContent = e.message;
        } finally {
          lista.disabled = false;
        }
      });
    }
  });
}

export function naLista(id) {
  const s = idsCarregados();
  return s ? s.has(Number(id)) : null;
}
