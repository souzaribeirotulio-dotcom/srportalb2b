/* Portal B2B — integração com a API do G360, no layout original do portal.
   Rotas pelo caminho (sem #): a página de senha recebe o token depois do #.
   - Layout original (topo, catálogo, carrinho, Minha Lista, Meus Pedidos, modais):
     /, /catalogo, /minha-lista, /comprar-de-novo, /pedidos, /pedidos/{id}, /carrinho, /minha-conta
   - Cartão de acesso: /primeiro-acesso, /esqueci-senha, /definir-senha
   - Painel da equipe: /painel */
import './entrada.css';
import './app.css';
import './portal.css';
import { apresentarLoja } from './api/g360.js';
import { mostrarMensagemErro } from './ui/mensagem.js';
import { esc } from './ui/util.js';
import { sessao, aoEncerrar } from './estado/sessao.js';
import { esvaziar } from './estado/carrinho.js';
import { limparMinhaListaEstado } from './estado/minha-lista.js';
import { descartarEnvioDeOutroComprador } from './estado/envio.js';
import { limparOcorrenciasSessao } from './estado/ocorrencias.js';
import { liberarFotosDaTela, limparCacheFotos } from './ui/fotos.js';
import { telaPedirLink } from './telas/pedir-link.js';
import { telaDefinirSenha, receberTokenDoLink } from './telas/definir-senha.js';
import { mostrarAdmin, sairDaTelaAdmin } from './portal/admin.js';
import { mostrarLoja, limparLoja, fecharTudo, prepararCasca } from './portal/loja.js';
import { limparCheckout } from './portal/checkout.js';
import { limparListaTela } from './portal/lista.js';
import { limparPedidosTela } from './portal/pedidos.js';

const ATIVO = window.SR_ADAPTADOR !== 'mock';

// O script no topo do index.html já apagou o token do endereço; aqui ele sai do window e fica só no módulo.
if ('__srTokenSenha' in window) {
  receberTokenDoLink(window.__srTokenSenha);
  delete window.__srTokenSenha;
}

const CARTAO = {
  '/primeiro-acesso': (ctx) => telaPedirLink(ctx, 'primeiro'),
  '/esqueci-senha': (ctx) => telaPedirLink(ctx, 'esqueci'),
  '/definir-senha': telaDefinirSenha,
};
// [padrão, tela do layout original, exige login, extras]
const LOJA = [
  [/^\/$/, 'cat', false],
  [/^\/catalogo$/, 'cat', false],
  [/^\/carrinho$/, 'cat', true, { abrirCarrinho: true }],
  [/^\/minha-conta$/, 'cat', true, { abrirConta: true }],
  [/^\/minha-lista$/, 'lista', true],
  [/^\/comprar-de-novo$/, 'lista', true],
  [/^\/pedidos$/, 'ped', true],
  [/^\/pedidos\/(\d{1,10})$/, 'ped', true],
];

let raiz = null;
let lojaPromessa = null;
let numeroTela = 0;

function montarRaiz() {
  document.getElementById('srBoot')?.remove();
  raiz = document.createElement('div');
  raiz.setAttribute('role', 'main');
  raiz.id = 'g360Entrada';
  document.body.appendChild(raiz);
}

function logoSrc() { return document.querySelector('header .logo img')?.getAttribute('src') || ''; }

/** GET loja uma vez por carregamento da página; numa falha, a próxima chamada tenta de novo. */
function carregarLoja() {
  if (!lojaPromessa) {
    lojaPromessa = apresentarLoja().then((loja) => { document.title = `${loja.nome} | Portal B2B`; return loja; })
      .catch((e) => { lojaPromessa = null; throw e; });
  }
  return lojaPromessa;
}

function caminho() { return location.pathname.replace(/\/+$/, '') || '/'; }

export function ir(destino, estado = null) {
  history.pushState(estado, '', destino);
  desenhar();
}

/** Alterna entre o layout original (loja) e o cartão/painel. */
function modo(m) {
  const legado = m === 'loja';
  document.body.classList.toggle('g360', !legado);
  document.body.classList.toggle('g360-legado', legado);
  raiz.hidden = legado;
  if (!legado) fecharTudo?.();
}

function cascaCartao() {
  const logo = logoSrc();
  raiz.className = 'g360-entrada';
  raiz.innerHTML = `
    <div class="g360-cartao" role="region" aria-labelledby="g360Titulo">
      <div class="g360-marca">${logo ? `<img src="${esc(logo)}" alt="Souza Ribeiro" width="44" height="52">` : ''}
        <span class="g360-portal">Portal B2B</span></div>
      <h1 id="g360Titulo" class="g360-nome" aria-live="polite">Carregando…</h1>
      <div id="g360Conteudo"></div>
    </div>`;
  return raiz.querySelector('#g360Conteudo');
}

// Sessão encerrada (401, inatividade, saída): limpa tudo e volta ao início com a mensagem.
aoEncerrar((motivo, mensagem) => {
  esvaziar();
  limparMinhaListaEstado();
  limparLoja(); limparCheckout(); limparListaTela(); limparPedidosTela();
  limparOcorrenciasSessao();
  liberarFotosDaTela(); limparCacheFotos();
  document.body.classList.remove('logged');
  fecharTudo();
  ir('/', mensagem ? { aviso: 'sessao_encerrada', mensagem } : { aviso: motivo === 'saida' ? 'saiu' : null });
});

async function erroDaLoja(e) {
  modo('cartao');
  const c = cascaCartao();
  document.getElementById('g360Titulo').textContent = 'Portal B2B';
  c.innerHTML = '<div id="g360Estado" class="g360-estado"></div>';
  mostrarMensagemErro(document.getElementById('g360Estado'), e, { aoTentarDeNovo: desenhar });
}

async function desenhar() {
  const minhaTela = ++numeroTela;
  liberarFotosDaTela();
  const c = caminho();
  let loja;
  try { loja = await carregarLoja(); } catch (e) { if (minhaTela === numeroTela) erroDaLoja(e); return; }
  if (minhaTela !== numeroTela) return;

  if (c === '/painel') {
    modo('loja');
    prepararCasca({ loja: sessao.loja ? { ...loja, ...sessao.loja } : loja, ir, aoEntrar: () => desenhar() });
    mostrarAdmin({ loja, ir });
    return;
  }
  sairDaTelaAdmin();

  if (CARTAO[c]) {
    modo('cartao');
    const conteudo = cascaCartao();
    document.getElementById('g360Titulo').textContent = loja.nome;
    CARTAO[c]({ loja, conteudo, ir, estado: history.state || {} });
    return;
  }

  const rota = LOJA.find(([re]) => re.test(c)) || LOJA[0];
  if (rota[2] && !sessao.ativa) { history.replaceState({ aviso: 'entre' }, '', '/'); return desenhar(); }
  modo('loja');
  document.body.classList.toggle('logged', sessao.ativa);
  const params = c.match(rota[0])?.slice(1) || [];
  const estado = { ...(rota[3] || {}), ...(history.state || {}) };
  if (history.state?.aviso) history.replaceState(null, '', location.pathname); // o aviso aparece uma vez só
  mostrarLoja({
    loja: sessao.loja ? { ...loja, ...sessao.loja } : loja,
    ir,
    aoEntrar: () => { descartarEnvioDeOutroComprador(); document.body.classList.add('logged'); history.replaceState(null, '', location.pathname); desenhar(); },
  }, rota[1], params, estado);
}

if (ATIVO) {
  montarRaiz();
  window.addEventListener('popstate', desenhar);
  desenhar();
}
