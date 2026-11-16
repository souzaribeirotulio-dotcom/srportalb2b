/* Tela de entrada: nome da loja, tempo de sessão e os caminhos de acesso. */
import { consultarComprador } from '../api/g360.js';
import { mostrarMensagemErro } from '../ui/mensagem.js';

// Botão provisório da Etapa 2: só aparece com ?testar-erro no endereço. Sai antes da produção.
const TESTE_ERRO = new URLSearchParams(location.search).has('testar-erro');

export function telaEntrada({ loja, conteudo, ir, estado }) {
  const min = Number(loja.sessao_minutos);
  const trocaSenha = loja.troca_senha === true;
  conteudo.innerHTML = `
    ${estado.aviso === 'senha_definida' ? `<div class="g360-ok" role="status"><strong>Senha definida.</strong>
      <p>Agora é só entrar com o seu CPF ou CNPJ e a senha nova.</p></div>` : ''}
    <div id="g360Estado" class="g360-estado" aria-live="polite">
      <p class="g360-info">Faça login para ver o catálogo e os seus preços.</p>
      ${Number.isFinite(min) ? `<p class="g360-mini">Por segurança, a sessão encerra após ${min} minuto${min === 1 ? '' : 's'} sem uso.</p>` : ''}
    </div>
    <div class="g360-acoes">
      <button type="button" class="g360-btn pri" disabled>Entrar</button>
      ${trocaSenha
        ? `<button type="button" class="g360-btn sec" data-ir="/primeiro-acesso">Primeiro acesso</button>
           <button type="button" class="g360-link" data-ir="/esqueci-senha">Esqueci minha senha</button>`
        : `<p class="g360-info g360-esquerda">A senha de acesso é definida pela Souza Ribeiro. Para receber ou trocar a sua, fale com o seu vendedor.</p>`}
    </div>
    <p class="g360-etapa">Homologação · o botão Entrar chega na próxima etapa.</p>`;
  conteudo.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => ir(b.dataset.ir)));
  if (TESTE_ERRO) montarTesteErro(conteudo);
}

function montarTesteErro(conteudo) {
  const bloco = document.createElement('div');
  bloco.className = 'g360-teste';
  bloco.innerHTML = `<button type="button" class="g360-btn sec" id="g360TestarErro">Testar erro</button>
    <p class="g360-mini">Provisório (Etapa 2): pede os dados do comprador sem estar logado.</p>
    <div id="g360TesteSaida" aria-live="polite"></div>`;
  conteudo.appendChild(bloco);
  document.getElementById('g360TestarErro').onclick = async () => {
    const saida = document.getElementById('g360TesteSaida');
    saida.innerHTML = '<p class="g360-mini">Consultando…</p>';
    try {
      await consultarComprador(null);
      saida.innerHTML = '<p class="g360-mini">A API respondeu sem erro (inesperado).</p>';
    } catch (e) {
      mostrarMensagemErro(saida, e);
    }
  };
}
