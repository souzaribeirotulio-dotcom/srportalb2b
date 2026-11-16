/* Primeiro acesso e "esqueci minha senha" (seção 7 do CLAUDE.md).
   O documento vai para a função ponte-g360 (acao pedir_link). A resposta 202
   traz sempre a mesma mensagem, que não revela se o documento existe:
   ela é mostrada como veio. O documento não é guardado nem registrado. */
import { pedirLink, ErroPonte, MENSAGEM_PONTE_FALHOU } from '../api/ponte.js';
import { esc, focarTitulo } from '../ui/util.js';

const TEXTOS = {
  primeiro: { titulo: 'Primeiro acesso', intro: 'Digite o CPF ou CNPJ do seu cadastro. Vamos mandar um link para você criar a sua senha.' },
  esqueci: { titulo: 'Esqueci minha senha', intro: 'Digite o CPF ou CNPJ do seu cadastro. Vamos mandar um link para você criar uma senha nova.' },
};
const ESPERA_NOVO_PEDIDO_S = 30;

export function telaPedirLink({ loja, conteudo, ir }, tipo) {
  const t = TEXTOS[tipo];
  if (loja.troca_senha !== true) {
    conteudo.innerHTML = `
      <h2 class="g360-sub">${esc(t.titulo)}</h2>
      <p class="g360-info g360-esquerda">A senha de acesso é definida pela Souza Ribeiro. Para receber ou trocar a sua, fale com o seu vendedor.</p>
      <div class="g360-acoes"><button type="button" class="g360-btn sec" id="g360Voltar">Voltar</button></div>`;
    conteudo.querySelector('#g360Voltar').onclick = () => ir('/');
    focarTitulo(conteudo);
    return;
  }

  conteudo.innerHTML = `
    <h2 class="g360-sub">${esc(t.titulo)}</h2>
    <p class="g360-info g360-esquerda">${esc(t.intro)}</p>
    <form class="g360-form" id="g360FormLink" novalidate>
      <label for="g360Documento">CPF ou CNPJ</label>
      <input id="g360Documento" name="documento" type="text" inputmode="text" maxlength="32"
        autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="g360DocAjuda g360DocErro">
      <small id="g360DocAjuda" class="g360-ajuda">Pode digitar com ou sem pontuação. O CNPJ pode ter letras.</small>
      <small id="g360DocErro" class="g360-erro-campo" aria-live="polite"></small>
      <button type="submit" class="g360-btn pri" id="g360EnviarLink">Enviar link</button>
    </form>
    <div id="g360Resultado" aria-live="polite"></div>
    <ul class="g360-avisos">
      <li>O link chega no e-mail do seu cadastro.</li>
      <li>Ele vale 30 minutos e só pode ser usado uma vez.</li>
      <li>Um pedido novo cancela o anterior: use sempre o e-mail mais recente.</li>
      <li>São no máximo 3 pedidos a cada 15 minutos.</li>
    </ul>
    <div class="g360-acoes"><button type="button" class="g360-link" id="g360Voltar">Voltar</button></div>`;

  const form = conteudo.querySelector('#g360FormLink');
  const campo = conteudo.querySelector('#g360Documento');
  const erroCampo = conteudo.querySelector('#g360DocErro');
  const botao = conteudo.querySelector('#g360EnviarLink');
  const resultado = conteudo.querySelector('#g360Resultado');
  conteudo.querySelector('#g360Voltar').onclick = () => ir('/');
  focarTitulo(conteudo);

  let relogio = null;
  const segurarBotao = () => {
    let resta = ESPERA_NOVO_PEDIDO_S;
    const atualizar = () => {
      botao.disabled = resta > 0;
      botao.textContent = resta > 0 ? `Pedir outro link em ${resta} s` : 'Pedir outro link';
    };
    atualizar();
    relogio = setInterval(() => {
      resta -= 1;
      if (!botao.isConnected) { clearInterval(relogio); return; }
      atualizar();
      if (resta <= 0) clearInterval(relogio);
    }, 1000);
  };

  const enviar = async () => {
    const documento = campo.value.trim();
    erroCampo.textContent = '';
    campo.removeAttribute('aria-invalid');
    if (!documento) {
      erroCampo.textContent = 'Digite o CPF ou CNPJ.';
      campo.setAttribute('aria-invalid', 'true'); campo.focus(); return;
    }
    // Só o formato que a ponte aceita; quem confere o documento é a API.
    if (!/^[A-Za-z0-9./-]{1,32}$/.test(documento)) {
      erroCampo.textContent = 'Use só letras, números, ponto, barra e traço.';
      campo.setAttribute('aria-invalid', 'true'); campo.focus(); return;
    }
    botao.disabled = true;
    botao.textContent = 'Enviando…';
    resultado.innerHTML = '';
    try {
      const mensagem = await pedirLink(documento);
      resultado.innerHTML = `<div class="g360-ok" role="status"><strong>Pedido recebido</strong><p>${esc(mensagem)}</p>
        <p class="g360-mini">Não chegou? Confira o lixo eletrônico e espere alguns minutos antes de pedir de novo.</p></div>`;
      segurarBotao();
    } catch (e) {
      const rede = e instanceof ErroPonte && e.rede;
      const msg = e instanceof ErroPonte ? e.message : MENSAGEM_PONTE_FALHOU;
      resultado.innerHTML = `<div class="g360-msg g360-msg-${rede ? 'rede' : 'tentar'}" role="alert">
        <strong class="g360-msg-rotulo">${rede ? 'Sem comunicação' : 'Não foi possível enviar'}</strong><p>${esc(msg)}</p></div>`;
      botao.disabled = false;
      botao.textContent = 'Tentar de novo';
    }
  };

  form.addEventListener('submit', (ev) => { ev.preventDefault(); if (!botao.disabled) enviar(); });
}
