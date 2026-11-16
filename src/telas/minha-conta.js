/* Minha conta: dados do comprador e troca de senha logado (PUT senha). */
import { mostrarMensagemErro } from '../ui/mensagem.js';
import { titulo } from '../ui/telas-comum.js';
import { esc } from '../ui/util.js';
import { sessao, trocarSenha } from '../estado/sessao.js';

const FORMATO_SENHA = /^[!-~]{6,8}$/;
const REGRA = 'De 6 a 8 caracteres, sem espaços nem acentos, diferente do seu código de cliente.';

export function telaMinhaConta({ loja, conteudo }) {
  const c = sessao.comprador || {};
  const troca = (sessao.loja?.troca_senha ?? loja.troca_senha) === true;
  conteudo.innerHTML = `${titulo('Minha conta')}
    <section class="resumo">
      <dl>
        <div><dt>Razão social</dt><dd>${esc(c.nome)}</dd></div>
        ${c.fantasia ? `<div><dt>Nome fantasia</dt><dd>${esc(c.fantasia)}</dd></div>` : ''}
        <div><dt>CPF/CNPJ</dt><dd>${esc(c.documento)}</dd></div>
        <div><dt>Código de cliente</dt><dd>${esc(c.codigo)}</dd></div>
        ${c.segmento?.descricao ? `<div><dt>Segmento</dt><dd>${esc(c.segmento.descricao)}</dd></div>` : ''}
      </dl>
      ${c.compra_bloqueada ? '<p class="cp-sem">Compras bloqueadas no momento. Fale com o seu vendedor.</p>' : ''}
    </section>
    ${troca ? `<section class="resumo"><h3>Trocar senha</h3>
      <form class="g360-form" id="g360FormTroca" novalidate>
        <label for="tAtual">Senha atual</label><input id="tAtual" type="password" maxlength="64" autocomplete="current-password">
        <label for="tNova1">Senha nova</label><input id="tNova1" type="password" maxlength="8" autocomplete="new-password" aria-describedby="tRegra">
        <small id="tRegra" class="g360-ajuda">${esc(REGRA)}</small>
        <label for="tNova2">Repita a senha nova</label><input id="tNova2" type="password" maxlength="8" autocomplete="new-password">
        <small id="tErro" class="g360-erro-campo" aria-live="polite"></small>
        <button type="submit" class="g360-btn pri">Trocar senha</button>
      </form><div id="tResultado" aria-live="polite"></div></section>`
    : '<p class="g360-info g360-esquerda">A senha de acesso é definida pela Souza Ribeiro. Para trocar a sua, fale com o seu vendedor.</p>'}`;
  const f = conteudo.querySelector('#g360FormTroca');
  if (!f) return;
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const atual = f.querySelector('#tAtual'); const n1 = f.querySelector('#tNova1'); const n2 = f.querySelector('#tNova2');
    const erro = f.querySelector('#tErro'); const res = conteudo.querySelector('#tResultado'); const b = f.querySelector('button');
    erro.textContent = ''; res.innerHTML = '';
    if (!atual.value) { erro.textContent = 'Digite a senha atual.'; atual.focus(); return; }
    if (!FORMATO_SENHA.test(n1.value)) { erro.textContent = `A senha nova não segue a regra: ${REGRA}`; n1.focus(); return; }
    if (n1.value !== n2.value) { erro.textContent = 'As duas senhas novas não são iguais.'; n2.focus(); return; }
    b.disabled = true;
    try {
      await trocarSenha(atual.value, n1.value);
      atual.value = n1.value = n2.value = '';
      res.innerHTML = '<div class="g360-ok" role="status"><strong>Senha trocada.</strong><p>Use a senha nova no próximo acesso. As outras sessões abertas foram encerradas.</p></div>';
    } catch (e) {
      mostrarMensagemErro(res, e);
    } finally {
      b.disabled = false;
    }
  });
}
