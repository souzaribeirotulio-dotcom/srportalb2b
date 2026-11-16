/* Portal B2B — integração com a API do G360 (homologação por etapas).
   Rotas pelo caminho (sem #): a página de senha recebe o token depois do #.
   Públicas: entrada/login, primeiro acesso, esqueci minha senha, definir senha, painel.
   Privadas (comprador logado): catálogo, carrinho, pedidos, Minha Lista, comprar de novo, minha conta. */
import './entrada.css';
import './app.css';
import { apresentarLoja } from './api/g360.js';
import { mostrarMensagemErro } from './ui/mensagem.js';
import { esc } from './ui/util.js';
import { sessao, aoEncerrar, sair } from './estado/sessao.js';
import { aoMudarCarrinho, quantidadeLinhas, esvaziar } from './estado/carrinho.js';
import { liberarFotosDaTela, limparCacheFotos } from './ui/fotos.js';
import { descartarEnvioDeOutroComprador } from './estado/envio.js';
import { limparOcorrenciasSessao } from './estado/ocorrencias.js';
import { telaEntrada } from './telas/entrada.js';
import { telaPedirLink } from './telas/pedir-link.js';
import { telaDefinirSenha, receberTokenDoLink } from './telas/definir-senha.js';
import { telaCatalogo, limparFiltrosCatalogo } from './telas/catalogo.js';
import { telaCarrinho, limparCarrinhoTela } from './telas/carrinho.js';
import { telaPedidos, telaPedido } from './telas/pedidos.js';
import { telaMinhaLista, limparMinhaLista } from './telas/minha-lista.js';
import { telaComprarDeNovo } from './telas/comprar-de-novo.js';
import { telaMinhaConta } from './telas/minha-conta.js';
import { telaPainel } from './telas/painel.js';

const ATIVO = window.SR_ADAPTADOR !== 'mock';

// O script no topo do index.html já apagou o token do endereço; aqui ele sai do window e fica só no módulo.
if ('__srTokenSenha' in window) {
  receberTokenDoLink(window.__srTokenSenha);
  delete window.__srTokenSenha;
}

const PUBLICAS = {
  '/': telaEntrada,
  '/primeiro-acesso': (ctx) => telaPedirLink(ctx, 'primeiro'),
  '/esqueci-senha': (ctx) => telaPedirLink(ctx, 'esqueci'),
  '/definir-senha': telaDefinirSenha,
};
const PRIVADAS = [
  [/^\/catalogo$/, telaCatalogo, 'catalogo'],
  [/^\/carrinho$/, telaCarrinho, 'carrinho'],
  [/^\/pedidos$/, telaPedidos, 'pedidos'],
  [/^\/pedidos\/(\d{1,10})$/, telaPedido, 'pedidos'],
  [/^\/minha-lista$/, telaMinhaLista, 'lista'],
  [/^\/comprar-de-novo$/, telaComprarDeNovo, 'recompra'],
  [/^\/minha-conta$/, telaMinhaConta, 'conta'],
];

let raiz = null;
let lojaPromessa = null;
let numeroTela = 0;

function montarRaiz() {
  document.getElementById('srBoot')?.remove();
  document.body.classList.add('g360');
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

function cascaPublica() {
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

const NAV = [
  ['catalogo', '/catalogo', 'Catálogo'],
  ['lista', '/minha-lista', 'Minha Lista'],
  ['recompra', '/comprar-de-novo', 'Comprar de novo'],
  ['pedidos', '/pedidos', 'Meus pedidos'],
  ['carrinho', '/carrinho', 'Carrinho'],
];

function cascaPrivada(loja, ativo) {
  const logo = logoSrc();
  const c = sessao.comprador || {};
  raiz.className = 'g360-app';
  raiz.innerHTML = `
    <header class="app-topo">
      <div class="app-marca">${logo ? `<img src="${esc(logo)}" alt="" width="30" height="36">` : ''}
        <div><strong id="g360Titulo">${esc(loja.nome)}</strong><span class="app-quem">${esc(c.fantasia || c.nome || '')}</span></div></div>
      <div class="app-conta">
        <button type="button" class="app-link ${ativo === 'conta' ? 'ativo' : ''}" data-ir="/minha-conta">Minha conta</button>
        <button type="button" class="app-link" id="g360Sair">Sair</button>
      </div>
    </header>
    <nav class="app-nav" aria-label="Seções do portal">
      ${NAV.map(([id, href, nome]) => `<button type="button" data-ir="${href}" class="${ativo === id ? 'ativo' : ''}" ${ativo === id ? 'aria-current="page"' : ''}>${nome}${id === 'carrinho' ? ` <span class="app-badge" id="g360ContaCarrinho">${quantidadeLinhas() || ''}</span>` : ''}</button>`).join('')}
    </nav>
    ${c.compra_bloqueada ? `<div class="app-aviso" role="status"><strong>Compras bloqueadas.</strong> Você pode consultar o catálogo, mas não pode enviar pedidos agora. Fale com o seu vendedor da Souza Ribeiro.</div>` : ''}
    ${sessao.supabaseOk ? '' : `<div class="app-aviso suave" role="status" id="g360AvisoSupabase">A Minha Lista está indisponível no momento. O resto do portal funciona normalmente.</div>`}
    <section class="app-conteudo" id="g360Conteudo" tabindex="-1"></section>`;
  raiz.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => ir(b.dataset.ir)));
  raiz.querySelector('#g360Sair').addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true;
    await sair();
  });
  return raiz.querySelector('#g360Conteudo');
}

aoMudarCarrinho(() => {
  const b = document.getElementById('g360ContaCarrinho');
  if (b) b.textContent = quantidadeLinhas() || '';
});

// Sessão encerrada (401, inatividade, saída): limpa os dados da tela e volta ao login com a mensagem.
aoEncerrar((motivo, mensagem) => {
  esvaziar();
  limparCarrinhoTela();
  limparFiltrosCatalogo();
  limparOcorrenciasSessao();
  limparMinhaLista();
  liberarFotosDaTela();
  limparCacheFotos();
  ir('/', mensagem ? { aviso: 'sessao_encerrada', mensagem } : { aviso: motivo === 'saida' ? 'saiu' : null });
});

async function desenhar() {
  const minhaTela = ++numeroTela;
  liberarFotosDaTela();
  const c = caminho();

  if (c === '/painel') { // painel do operador tem sessões próprias
    raiz.className = 'g360-app painel';
    let loja;
    try { loja = await carregarLoja(); } catch (e) {
      raiz.innerHTML = '<section class="app-conteudo"><div id="g360Estado"></div></section>';
      mostrarMensagemErro(raiz.querySelector('#g360Estado'), e, { aoTentarDeNovo: desenhar });
      return;
    }
    telaPainel({ loja, raiz, ir, logo: logoSrc() });
    return;
  }

  const privada = PRIVADAS.find(([re]) => re.test(c));
  if (privada && !sessao.ativa) { history.replaceState({ aviso: 'entre' }, '', '/'); return desenhar(); }
  if (!privada && sessao.ativa && (c === '/' || !PUBLICAS[c])) { history.replaceState(null, '', '/catalogo'); return desenhar(); }

  let conteudo;
  if (privada) {
    let loja;
    try { loja = await carregarLoja(); } catch { loja = { nome: 'Portal B2B', ...(sessao.loja || {}) }; }
    if (minhaTela !== numeroTela) return;
    conteudo = cascaPrivada(sessao.loja ? { ...loja, ...sessao.loja } : loja, privada[2]);
    const params = c.match(privada[0]).slice(1);
    privada[1]({ loja, conteudo, ir, estado: history.state || {}, params, eAtual: () => minhaTela === numeroTela });
    return;
  }

  conteudo = cascaPublica();
  const tela = PUBLICAS[c] || PUBLICAS['/'];
  conteudo.innerHTML = '<div id="g360Estado" class="g360-estado" aria-live="polite"><p class="g360-info">Carregando os dados da loja…</p></div>';
  let loja;
  try {
    loja = await carregarLoja();
  } catch (e) {
    if (minhaTela !== numeroTela) return;
    document.getElementById('g360Titulo').textContent = 'Portal B2B';
    mostrarMensagemErro(document.getElementById('g360Estado'), e, { aoTentarDeNovo: desenhar });
    return;
  }
  if (minhaTela !== numeroTela) return;
  document.getElementById('g360Titulo').textContent = loja.nome;
  tela({ loja, conteudo, ir, estado: history.state || {}, aoEntrar: () => { descartarEnvioDeOutroComprador(); ir('/catalogo'); } });
}

if (ATIVO) {
  montarRaiz();
  window.addEventListener('popstate', desenhar);
  desenhar();
}
