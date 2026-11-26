/* Portal B2B — integração com a API do G360, no layout original do portal.
   Rotas pelo caminho (sem #): a página de senha recebe o token depois do #.
   - Layout original (topo, catálogo, carrinho, Minha Lista, Meus Pedidos, modais):
     /, /catalogo, /minha-lista, /comprar-de-novo, /pedidos, /pedidos/{id}, /carrinho, /minha-conta
   - Cartão de acesso: /primeiro-acesso, /esqueci-senha, /definir-senha
   - Painel da equipe: /painel */
import './entrada.css';
import './app.css';
import './portal.css';
import './tema-claro.css';
import { apresentarLoja } from './api/g360.js';
import { mostrarMensagemErro } from './ui/mensagem.js';
import { esc } from './ui/util.js';
import { sessao, aoEncerrar, restaurarSessao } from './estado/sessao.js';
import { esvaziar } from './estado/carrinho.js';
import { limparMinhaListaEstado } from './estado/minha-lista.js';
import { descartarEnvioDeOutroComprador } from './estado/envio.js';
import { limparOcorrenciasSessao } from './estado/ocorrencias.js';
import { liberarFotosDaTela, limparCacheFotos } from './ui/fotos.js';
import { telaPedirLink } from './telas/pedir-link.js';
import { telaDefinirSenha, receberTokenDoLink } from './telas/definir-senha.js';
import { telaSairEmails } from './telas/sair-emails.js';
import { mostrarLoja, limparLoja, fecharTudo, prepararCasca } from './portal/loja.js';
import { limparCheckout } from './portal/checkout.js';
import { ligarCamadas } from './ui/camadas.js';
import { carregarExibicao, codigosAtivosPublicos } from './catalogo/exibicao.js';
import { limparListaTela } from './portal/lista.js';

// Versão publicada no rodapé (para conferir se o navegador está com a versão nova).
try { document.getElementById('versao').textContent = `· versão ${__VERSAO__}`; } catch { /* sem rodapé */ }
import { limparPedidosTela } from './portal/pedidos.js';
import { iniciarAppInstalavel } from './ui/instalar.js';
import { capturarCodigoExecutivo } from './estado/executivo.js';


// App instalável: registra o service worker e oferece "Instalar app".
try { iniciarAppInstalavel(); } catch { /* o portal segue normal sem isso */ }

const ATIVO = window.SR_ADAPTADOR !== 'mock';

// O script no topo do index.html já apagou o token do endereço; aqui ele sai do window e fica só no módulo.
capturarCodigoExecutivo();
if ('__srTokenSenha' in window) {
  receberTokenDoLink(window.__srTokenSenha);
  delete window.__srTokenSenha;
}

const CARTAO = {
  '/primeiro-acesso': (ctx) => telaPedirLink(ctx, 'primeiro'),
  '/esqueci-senha': (ctx) => telaPedirLink(ctx, 'esqueci'),
  '/definir-senha': telaDefinirSenha,
  '/sair-emails': telaSairEmails,
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
  [/^\/clips$/, 'clips', false],
  [/^\/pedidos\/(\d{1,10})$/, 'ped', true],
  // Departamento › seção do catálogo (ex.: /limpeza/sacos-de-lixo). Endereço que não for da árvore volta ao início.
  [/^\/[a-z0-9-]{1,60}(?:\/[a-z0-9-]{1,60})?$/, 'cat', false, { arvore: true }],
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

/** GET loja uma vez por carregamento da página; numa falha, a próxima chamada tenta de novo.
 *  A última resposta (nome e configurações públicas da loja) fica guardada no aparelho: da segunda visita
 *  em diante a tela abre na hora com ela, e a resposta nova chega por trás. Internet lenta não deixa
 *  a página parada esperando. */
const CHAVE_LOJA = `g360:${String(import.meta.env.VITE_G360_LOJA || '').trim()}:loja`;
function lojaGuardada() { try { const t = localStorage.getItem(CHAVE_LOJA); return t ? JSON.parse(t) : null; } catch { return null; } }
function carregarLoja() {
  if (!lojaPromessa) {
    const rede = apresentarLoja().then((loja) => {
      document.title = `${loja.nome} | Portal B2B`;
      try { localStorage.setItem(CHAVE_LOJA, JSON.stringify(loja)); } catch { /* sem espaço: segue sem cópia */ }
      return loja;
    });
    const guardada = lojaGuardada();
    if (guardada?.nome) {
      document.title = `${guardada.nome} | Portal B2B`;
      lojaPromessa = Promise.resolve(guardada);
      rede.then((loja) => { lojaPromessa = Promise.resolve(loja); }, () => { lojaPromessa = null; });
    } else {
      lojaPromessa = rede.catch((e) => { lojaPromessa = null; throw e; });
    }
  }
  return lojaPromessa;
}

/* O painel da equipe é baixado só quando alguém abre /painel: o cliente não carrega esse código. */
let painelCarregado = null;
function carregarPainel() { return import('./portal/admin.js').then((m) => { painelCarregado = m; return m; }); }

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
    const adm = await carregarPainel();
    if (minhaTela !== numeroTela) return;
    adm.mostrarAdmin({ loja, ir });
    return;
  }
  painelCarregado?.sairDaTelaAdmin();

  // Área do executivo de contas: tela própria, baixada só quando alguém abre /executivo.
  if (c === '/executivo') {
    modo('cartao');
    const conteudo = cascaCartao();
    const { telaExecutivo } = await import('./telas/executivo.js');
    if (minhaTela !== numeroTela) return;
    telaExecutivo({ conteudo, titulo: document.getElementById('g360Titulo') });
    return;
  }

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
  ligarCamadas();
  window.addEventListener('popstate', desenhar);
  // A lista de nomes do catálogo e a da vitrine já começam a baixar junto com a conferência da sessão.
  if (caminho() !== '/painel') { carregarExibicao(); codigosAtivosPublicos(); }
  // F5 com sessão guardada na aba: confere com GET me antes de mostrar telas privadas.
  restaurarSessao().catch(() => false).then(() => desenhar());
}
