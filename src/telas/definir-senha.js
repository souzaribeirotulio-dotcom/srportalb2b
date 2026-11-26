/* Página /definir-senha (seção 7 do CLAUDE.md).
   O token chega no link depois do # (/definir-senha#token=...). O script no
   topo do index.html lê o fragmento e o apaga do endereço; aqui ele fica só
   em memória, nunca em storage, cookie, URL ou log. */
import { gravarSenhaPorLink, ErroApi } from '../api/g360.js';
import { entrar } from '../estado/sessao.js';
import { descartarEnvioDeOutroComprador } from '../estado/envio.js';
import { docCadastroGuardado, esquecerDocCadastro } from '../estado/doccadastro.js';
import { mostrarMensagemErro } from '../ui/mensagem.js';
import { esc, focarTitulo } from '../ui/util.js';
import { FORMATO_SENHA, REGRA_SENHA as REGRA, htmlRegraSenha, ligarRegraSenha } from '../ui/regra-senha.js';

let tokenDoLink = '';
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function receberTokenDoLink(token) {
  tokenDoLink = typeof token === 'string' ? token : '';
}

export function telaDefinirSenha({ loja, conteudo, ir }) {
  if (loja.troca_senha !== true) {
    conteudo.innerHTML = `
      <h2 class="g360-sub">Definir senha</h2>
      <p class="g360-info g360-esquerda">A senha de acesso é definida pela Souza Ribeiro. Para receber ou trocar a sua, fale com o seu vendedor.</p>
      <div class="g360-acoes"><button type="button" class="g360-btn sec" id="g360Voltar">Ir para a entrada</button></div>`;
    conteudo.querySelector('#g360Voltar').onclick = () => ir('/');
    focarTitulo(conteudo);
    return;
  }

  if (!FORMATO_TOKEN.test(tokenDoLink)) {
    tokenDoLink = '';
    conteudo.innerHTML = `
      <h2 class="g360-sub">Definir senha</h2>
      <div class="g360-msg g360-msg-corrigir" role="alert"><strong class="g360-msg-rotulo">Link incompleto</strong>
        <p>Abra o link direto do e-mail mais recente. Se a página foi recarregada ou o link já foi usado, peça um novo.</p></div>
      <div class="g360-acoes">
        <button type="button" class="g360-btn pri" id="g360NovoLink">Pedir outro link</button>
        <button type="button" class="g360-link" id="g360Voltar">Ir para a entrada</button>
      </div>`;
    conteudo.querySelector('#g360NovoLink').onclick = () => ir('/esqueci-senha');
    conteudo.querySelector('#g360Voltar').onclick = () => ir('/');
    focarTitulo(conteudo);
    return;
  }

  // Continuar conectado: só com continuar_conectado_dias > 0 em GET loja; a caixa começa marcada (decisão da Souza Ribeiro, 24/11/2026).
  const longa = Number(loja.continuar_conectado_dias) > 0;
  conteudo.innerHTML = `
    <h2 class="g360-sub">Definir senha</h2>
    <p class="g360-info g360-esquerda">Crie a senha que você vai usar no portal. Ao salvar, você já entra.</p>
    <form class="g360-form" id="g360FormSenha" novalidate>
      <label for="g360Doc">CPF ou CNPJ</label>
      <input id="g360Doc" name="username" maxlength="32" autocomplete="username" autocapitalize="characters" spellcheck="false"
        placeholder="Digite com ou sem pontuação" aria-describedby="g360SenhaErro">
      <label for="g360Senha1">Senha nova</label>
      <input id="g360Senha1" type="password" maxlength="8" autocomplete="new-password" spellcheck="false"
        autocapitalize="off" aria-describedby="g360Regra g360SenhaErro">
      ${htmlRegraSenha('g360Regra')}
      <label for="g360Senha2">Repita a senha nova</label>
      <input id="g360Senha2" type="password" maxlength="8" autocomplete="new-password" spellcheck="false"
        autocapitalize="off" aria-describedby="g360SenhaErro">
      <label class="g360-check"><input type="checkbox" id="g360Mostrar"> Mostrar senhas</label>
      ${longa ? `<label class="g360-check"><input type="checkbox" id="g360Cont" checked> Continuar conectado</label>
      <small class="g360-dica">Desmarque em computador compartilhado.</small>` : ''}
      <small id="g360SenhaErro" class="g360-erro-campo" aria-live="polite"></small>
      <button type="submit" class="g360-btn pri" id="g360SalvarSenha">Criar senha e entrar</button>
    </form>
    <div id="g360Resultado" aria-live="polite"></div>`;

  const form = conteudo.querySelector('#g360FormSenha');
  const docIn = conteudo.querySelector('#g360Doc');
  const s1 = conteudo.querySelector('#g360Senha1');
  const s2 = conteudo.querySelector('#g360Senha2');
  const erroCampo = conteudo.querySelector('#g360SenhaErro');
  const botao = conteudo.querySelector('#g360SalvarSenha');
  const resultado = conteudo.querySelector('#g360Resultado');
  ligarRegraSenha(conteudo.querySelector('#g360Regra'), s1, s2);
  conteudo.querySelector('#g360Mostrar').addEventListener('change', (ev) => {
    s1.type = s2.type = ev.target.checked ? 'text' : 'password';
  });
  focarTitulo(conteudo);
  // Cadastro feito há pouco neste aparelho: o CNPJ já vem preenchido e o cursor vai para a senha.
  const docCad = docCadastroGuardado();
  if (docCad) { docIn.value = docCad; setTimeout(() => s1.focus(), 60); }

  let tentativa = 0;
  const marcar = (msg, campo) => {
    erroCampo.textContent = msg;
    campo.setAttribute('aria-invalid', 'true');
    campo.focus();
  };

  const salvar = async () => {
    erroCampo.textContent = '';
    docIn.removeAttribute('aria-invalid'); s1.removeAttribute('aria-invalid'); s2.removeAttribute('aria-invalid');
    const documento = docIn.value.trim();
    const senha = s1.value;
    if (!documento) return marcar('Digite o CPF ou CNPJ do cadastro.', docIn);
    if (!FORMATO_SENHA.test(senha)) return marcar(`A senha não segue a regra: ${REGRA}`, s1);
    if (s2.value !== senha) return marcar('As duas senhas não são iguais.', s2);

    botao.disabled = true;
    botao.textContent = 'Salvando…';
    resultado.innerHTML = '';
    try {
      await gravarSenhaPorLink(tokenDoLink, senha);
      tokenDoLink = '';
      // Senha gravada: entra direto com o documento e a senha que a pessoa acabou de digitar.
      botao.textContent = 'Entrando…';
      const continuar = longa && conteudo.querySelector('#g360Cont')?.checked === true;
      try {
        await entrar(documento, senha, continuar);
        s1.value = s2.value = ''; docIn.value = ''; esquecerDocCadastro();
        descartarEnvioDeOutroComprador();
        ir('/', { aviso: 'entrou_senha_nova' });
      } catch {
        // A senha já está criada; se a entrada automática não deu (documento digitado errado, rede),
        // vai para o login com o aviso de sempre. Sem nova tentativa automática.
        s1.value = s2.value = '';
        ir('/', { aviso: 'senha_definida' });
      }
      return;
    } catch (e) {
      const codigo = e instanceof ErroApi ? e.codigo : null;
      if (codigo === 'LINK_INVALIDO') {
        tokenDoLink = '';
        s1.value = s2.value = '';
        form.remove();
        mostrarMensagemErro(resultado, e);
        const acoes = document.createElement('div');
        acoes.className = 'g360-acoes';
        acoes.innerHTML = '<button type="button" class="g360-btn pri" id="g360NovoLink">Pedir outro link</button>';
        resultado.appendChild(acoes);
        acoes.querySelector('button').onclick = () => ir('/esqueci-senha');
        return;
      }
      if (e instanceof ErroApi && e.status === 429) tentativa += 1;
      // Os demais erros seguem o tratamento central: corrigir, fornecedor, tentar de novo ou integração.
      mostrarMensagemErro(resultado, e, { aoTentarDeNovo: () => salvar(), tentativa });
      if (codigo === 'SENHA_NOVA_INVALIDA') s1.setAttribute('aria-invalid', 'true');
      botao.disabled = false;
      botao.textContent = 'Criar senha e entrar';
    }
  };

  form.addEventListener('submit', (ev) => { ev.preventDefault(); if (!botao.disabled) salvar(); });
}
