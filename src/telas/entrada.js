/* Entrada: login do comprador (Etapa 5), com os caminhos de primeiro acesso
   e "esqueci minha senha" (Etapa 4). */
import { consultarComprador } from '../api/g360.js';
import { mostrarMensagemErro } from '../ui/mensagem.js';
import { esc } from '../ui/util.js';
import { entrar } from '../estado/sessao.js';

// Botão provisório da Etapa 2: só aparece com ?testar-erro no endereço. Sai antes da produção.
const TESTE_ERRO = new URLSearchParams(location.search).has('testar-erro');

const AVISOS = {
  senha_definida: ['g360-ok', 'Senha definida.', 'Agora é só entrar com o seu CPF ou CNPJ e a senha nova.'],
  saiu: ['g360-ok', 'Você saiu do portal.', 'Até a próxima!'],
  entre: ['g360-msg g360-msg-corrigir', 'Entre para continuar.', 'Essa página precisa de login.'],
};

export function telaEntrada({ loja, conteudo, ir, estado, aoEntrar }) {
  const min = Number(loja.sessao_minutos);
  const trocaSenha = loja.troca_senha === true;
  let aviso = '';
  if (estado.aviso === 'sessao_encerrada') {
    aviso = `<div class="g360-msg g360-msg-corrigir" role="alert"><strong class="g360-msg-rotulo">Sessão encerrada</strong><p>${esc(estado.mensagem || 'Sua sessão terminou. Entre novamente.')}</p></div>`;
  } else if (AVISOS[estado.aviso]) {
    const [cls, t, p] = AVISOS[estado.aviso];
    aviso = `<div class="${cls}" role="status"><strong class="g360-msg-rotulo">${t}</strong><p>${p}</p></div>`;
  }
  conteudo.innerHTML = `
    ${aviso ? `<div class="g360-aviso-topo">${aviso}</div>` : ''}
    <div id="g360Estado" class="g360-estado" aria-live="polite">
      <p class="g360-info">Entre para ver o catálogo e os seus preços.</p>
      ${Number.isFinite(min) ? `<p class="g360-mini">Por segurança, a sessão encerra após ${min} minuto${min === 1 ? '' : 's'} sem uso.</p>` : ''}
    </div>
    <form class="g360-form" id="g360FormLogin" novalidate>
      <label for="g360Usuario">CPF ou CNPJ</label>
      <input id="g360Usuario" type="text" inputmode="text" maxlength="32" autocomplete="username"
        autocapitalize="characters" spellcheck="false" aria-describedby="g360LoginErro">
      <label for="g360Senha">Senha</label>
      <input id="g360Senha" type="password" maxlength="64" autocomplete="current-password" spellcheck="false" autocapitalize="off">
      <small id="g360LoginErro" class="g360-erro-campo" aria-live="polite"></small>
      <button type="submit" class="g360-btn pri" id="g360Entrar">Entrar</button>
    </form>
    <div id="g360LoginResultado" aria-live="polite"></div>
    <div class="g360-acoes">
      ${trocaSenha
        ? `<button type="button" class="g360-btn sec" data-ir="/primeiro-acesso">Primeiro acesso</button>
           <button type="button" class="g360-link" data-ir="/esqueci-senha">Esqueci minha senha</button>`
        : `<p class="g360-info g360-esquerda">A senha de acesso é definida pela Souza Ribeiro. Para receber ou trocar a sua, fale com o seu vendedor.</p>`}
      <button type="button" class="g360-link discreto" data-ir="/painel">Acesso da equipe Souza Ribeiro</button>
    </div>`;
  conteudo.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => ir(b.dataset.ir)));
  if (TESTE_ERRO) montarTesteErro(conteudo);

  const form = conteudo.querySelector('#g360FormLogin');
  const usuario = conteudo.querySelector('#g360Usuario');
  const senha = conteudo.querySelector('#g360Senha');
  const erroCampo = conteudo.querySelector('#g360LoginErro');
  const botao = conteudo.querySelector('#g360Entrar');
  const resultado = conteudo.querySelector('#g360LoginResultado');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (botao.disabled) return;
    erroCampo.textContent = '';
    resultado.innerHTML = '';
    const doc = usuario.value.trim();
    if (!doc) { erroCampo.textContent = 'Digite o CPF ou CNPJ.'; usuario.focus(); return; }
    if (!senha.value) { erroCampo.textContent = 'Digite a senha.'; senha.focus(); return; }
    botao.disabled = true;
    botao.textContent = 'Entrando…';
    try {
      await entrar(doc, senha.value);
      senha.value = '';
      aoEntrar();
    } catch (e) {
      senha.value = '';
      // Sem "tentar de novo" automático: depois de várias senhas erradas a API bloqueia por um tempo.
      mostrarMensagemErro(resultado, e);
      botao.disabled = false;
      botao.textContent = 'Entrar';
      senha.focus();
    }
  });
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
