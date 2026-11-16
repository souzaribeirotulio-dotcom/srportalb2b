/* Portal B2B — integração com a API do G360 (homologação por etapas).
   Etapa 1: página de entrada com o nome da loja (GET loja).
   Etapa 2: tratamento de erros central + quadro de mensagem reutilizável. */
import './entrada.css';
import { apresentarLoja, consultarComprador } from './api/g360.js';
import { mostrarMensagemErro } from './ui/mensagem.js';

// Botão provisório da Etapa 2: só aparece com ?testar-erro no endereço. Sai antes da produção.
const TESTE_ERRO = new URLSearchParams(location.search).has('testar-erro');

const ATIVO = window.SR_ADAPTADOR !== 'mock';

function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function montarEntrada() {
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
      <div id="g360Estado" class="g360-estado" aria-live="polite"></div>
      <div class="g360-acoes">
        <button type="button" class="g360-btn pri" disabled>Entrar</button>
        <button type="button" class="g360-btn sec" disabled>Primeiro acesso</button>
      </div>
      <p class="g360-etapa">Homologação · login e primeiro acesso entram nas próximas etapas.</p>
    </div>`;
  document.body.appendChild(el);
  return el;
}

function mostrarCarregando() {
  document.getElementById('g360Titulo').textContent = 'Carregando…';
  document.getElementById('g360Estado').innerHTML = '<p class="g360-info">Carregando os dados da loja…</p>';
}

function mostrarLoja(loja) {
  document.getElementById('g360Titulo').textContent = loja.nome;
  document.title = `${loja.nome} | Portal B2B`;
  const min = Number(loja.sessao_minutos);
  document.getElementById('g360Estado').innerHTML =
    `<p class="g360-info">Faça login para ver o catálogo e os seus preços.</p>` +
    (Number.isFinite(min) ? `<p class="g360-mini">Por segurança, a sessão encerra após ${min} minuto${min === 1 ? '' : 's'} sem uso.</p>` : '');
}

function mostrarErro(erro) {
  document.getElementById('g360Titulo').textContent = 'Portal B2B';
  mostrarMensagemErro(document.getElementById('g360Estado'), erro, { aoTentarDeNovo: carregar });
}

function montarTesteErro(cartao) {
  const bloco = document.createElement('div');
  bloco.className = 'g360-teste';
  bloco.innerHTML = `<button type="button" class="g360-btn sec" id="g360TestarErro">Testar erro</button>
    <p class="g360-mini">Provisório (Etapa 2): pede os dados do comprador sem estar logado.</p>
    <div id="g360TesteSaida" aria-live="polite"></div>`;
  cartao.appendChild(bloco);
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

async function carregar() {
  mostrarCarregando();
  try {
    mostrarLoja(await apresentarLoja());
  } catch (e) {
    mostrarErro(e);
  }
}

if (ATIVO) {
  const entrada = montarEntrada();
  if (TESTE_ERRO) montarTesteErro(entrada.querySelector('.g360-cartao'));
  carregar();
}
