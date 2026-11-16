/* Portal B2B — integração com a API do G360 (homologação por etapas).
   Etapa 1: página de entrada com o nome da loja (GET loja).
   Etapa 2: tratamento de erros central + quadro de mensagem reutilizável.
   Etapa 4: primeiro acesso, "esqueci minha senha" e página /definir-senha.
   Rotas pelo caminho (sem #): a página de senha recebe o token depois do #. */
import './entrada.css';
import { apresentarLoja } from './api/g360.js';
import { mostrarMensagemErro } from './ui/mensagem.js';
import { esc } from './ui/util.js';
import { telaEntrada } from './telas/entrada.js';
import { telaPedirLink } from './telas/pedir-link.js';
import { telaDefinirSenha, receberTokenDoLink } from './telas/definir-senha.js';

const ATIVO = window.SR_ADAPTADOR !== 'mock';

// O script no topo do index.html já apagou o token do endereço; aqui ele sai do window e fica só no módulo.
if ('__srTokenSenha' in window) {
  receberTokenDoLink(window.__srTokenSenha);
  delete window.__srTokenSenha;
}

const ROTAS = {
  '/': telaEntrada,
  '/primeiro-acesso': (ctx) => telaPedirLink(ctx, 'primeiro'),
  '/esqueci-senha': (ctx) => telaPedirLink(ctx, 'esqueci'),
  '/definir-senha': telaDefinirSenha,
};

let cartao = null;
let lojaPromessa = null;

function montarCasca() {
  document.getElementById('srBoot')?.remove();
  document.body.classList.add('g360');
  const logo = document.querySelector('header .logo img')?.getAttribute('src') || '';
  const el = document.createElement('div');
  el.setAttribute('role', 'main');
  el.id = 'g360Entrada';
  el.className = 'g360-entrada';
  el.innerHTML = `
    <div class="g360-cartao" role="region" aria-labelledby="g360Titulo">
      <div class="g360-marca">${logo ? `<img src="${esc(logo)}" alt="Souza Ribeiro" width="44" height="52">` : ''}
        <span class="g360-portal">Portal B2B</span></div>
      <h1 id="g360Titulo" class="g360-nome" aria-live="polite">Carregando…</h1>
      <div id="g360Conteudo"></div>
    </div>`;
  document.body.appendChild(el);
  cartao = el.querySelector('.g360-cartao');
}

/** GET loja uma vez por carregamento da página; numa falha, a próxima chamada tenta de novo. */
function carregarLoja() {
  if (!lojaPromessa) {
    lojaPromessa = apresentarLoja().then((loja) => {
      document.getElementById('g360Titulo').textContent = loja.nome;
      document.title = `${loja.nome} | Portal B2B`;
      return loja;
    }).catch((e) => { lojaPromessa = null; throw e; });
  }
  return lojaPromessa;
}

function caminhoAtual() {
  const c = location.pathname.replace(/\/+$/, '') || '/';
  return ROTAS[c] ? c : '/';
}

export function ir(caminho, estado = null) {
  history.pushState(estado, '', caminho);
  desenhar();
}

async function desenhar() {
  const conteudo = document.getElementById('g360Conteudo');
  const tela = ROTAS[caminhoAtual()];
  conteudo.innerHTML = '<div id="g360Estado" class="g360-estado" aria-live="polite"><p class="g360-info">Carregando os dados da loja…</p></div>';
  let loja;
  try {
    loja = await carregarLoja();
  } catch (e) {
    document.getElementById('g360Titulo').textContent = 'Portal B2B';
    mostrarMensagemErro(document.getElementById('g360Estado'), e, { aoTentarDeNovo: desenhar });
    return;
  }
  tela({ loja, conteudo, cartao, ir, estado: history.state || {} });
}

if (ATIVO) {
  montarCasca();
  window.addEventListener('popstate', desenhar);
  desenhar();
}
