/* App instalável (PWA): registra o service worker e oferece "Instalar app".
   - Android/Chrome: usa o pedido de instalação do próprio navegador (um toque).
   - iPhone/iPad (Safari): o navegador não deixa instalar por botão, então mostramos
     o passo a passo "Compartilhar → Adicionar à Tela de Início".
   - Já instalado (aberto como app): não mostra nada.
   A faixa pode ser dispensada; volta a aparecer depois de 14 dias. */

const CHAVE_DISPENSA = 'sr:app:instalar:dispensado-em';
const DIAS_PARA_VOLTAR = 14;

let pedidoInstalacao = null; // evento beforeinstallprompt guardado (Android/Chrome)

const ehApp = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

const ehIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const ehCelular = () => window.matchMedia('(max-width: 900px)').matches || ehIOS();

function dispensadoRecente() {
  try {
    const em = Number(localStorage.getItem(CHAVE_DISPENSA) || 0);
    return em && Date.now() - em < DIAS_PARA_VOLTAR * 864e5;
  } catch { return false; }
}
function marcarDispensado() {
  try { localStorage.setItem(CHAVE_DISPENSA, String(Date.now())); } catch { /* sem armazenamento */ }
}

const podeInstalar = () => !ehApp() && (pedidoInstalacao || ehIOS());

function atualizarBotoes() {
  const rodape = document.getElementById('btnInstalarRodape');
  if (rodape) rodape.hidden = !podeInstalar();
}

function fecharFaixa() {
  document.getElementById('srFaixaApp')?.remove();
  document.body.classList.remove('com-faixa-app');
}

function mostrarFaixa() {
  if (!podeInstalar() || !ehCelular() || dispensadoRecente() || document.getElementById('srFaixaApp')) return;
  const faixa = document.createElement('div');
  faixa.id = 'srFaixaApp';
  faixa.className = 'faixa-app';
  faixa.setAttribute('role', 'region');
  faixa.setAttribute('aria-label', 'Instalar o app');
  faixa.innerHTML = `
    <img src="/icones/icone-192.png" alt="" class="faixa-app-ic">
    <div class="faixa-app-tx"><strong>Instale o app</strong><span>Acesso direto pela tela do celular.</span></div>
    <button type="button" class="faixa-app-sim">Instalar</button>
    <button type="button" class="faixa-app-nao" aria-label="Agora não">✕</button>`;
  faixa.querySelector('.faixa-app-sim').addEventListener('click', instalar);
  faixa.querySelector('.faixa-app-nao').addEventListener('click', () => { marcarDispensado(); fecharFaixa(); });
  document.body.appendChild(faixa);
  // A Souzinha sobe enquanto a faixa estiver na tela, para uma não ficar em cima da outra.
  document.body.classList.add('com-faixa-app');
}

function mostrarPassoIOS() {
  document.getElementById('srPassoIOS')?.remove();
  const fundo = document.createElement('div');
  fundo.id = 'srPassoIOS';
  fundo.className = 'passo-ios';
  fundo.setAttribute('role', 'dialog');
  fundo.setAttribute('aria-modal', 'true');
  fundo.setAttribute('aria-labelledby', 'srPassoIOSTit');
  const compartilhar = '<svg viewBox="0 0 24 24" class="passo-ios-sym" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
  const mais = '<svg viewBox="0 0 24 24" class="passo-ios-sym" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>';
  const pontos = '<span class="passo-ios-pontos" aria-hidden="true">•••</span>';
  const menu = '<svg viewBox="0 0 24 24" class="passo-ios-sym passo-ios-menu" aria-label="menu"><path d="M4 7h16M4 12h16M4 17h10"/></svg>';
  fundo.innerHTML = `
    <div class="passo-ios-caixa">
      <h2 id="srPassoIOSTit">Instalar no iPhone</h2>
      <ol>
        <li><span class="passo-ios-n">1</span><span>Na barra de endereço do Safari, aqui embaixo, toque no ícone ${menu} ao lado do endereço e depois em <b>Compartilhar</b> ${compartilhar}. <small>Se o seu Safari mostrar direto o botão Compartilhar ${compartilhar} ou os três pontinhos ${pontos}, toque nele.</small></span></li>
        <li><span class="passo-ios-n">2</span><span>Role para baixo e toque em <b>Adicionar à Tela de Início</b> ${mais}. <small>Não apareceu? Toque em <b>Ver Mais</b>.</small></span></li>
        <li><span class="passo-ios-n">3</span><span>Toque em <b>Adicionar</b>. Pronto: o ícone da Souza Ribeiro aparece no seu celular.</span></li>
      </ol>
      <p class="passo-ios-obs">Precisa estar aberto no Safari. Se estiver no Instagram ou no WhatsApp, abra o link no Safari primeiro.</p>
      <button type="button" class="passo-ios-ok">Entendi</button>
    </div>
    <div class="passo-ios-seta" aria-hidden="true"><span>A barra do Safari fica aqui</span><svg viewBox="0 0 24 24"><path d="M12 4v15M5 12l7 7 7-7"/></svg></div>`;
  const fechar = () => { fundo.remove(); document.body.classList.remove('com-passo-ios'); };
  document.body.classList.add('com-passo-ios'); // a Souzinha some enquanto o passo a passo está aberto
  fundo.querySelector('.passo-ios-ok').addEventListener('click', fechar);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { fechar(); document.removeEventListener('keydown', esc); } });
  document.body.appendChild(fundo);
  fundo.querySelector('.passo-ios-ok').focus();
}

/** Para telas próprias (área do executivo): dá para oferecer "Instalar app" agora? */
export const podeInstalarApp = () => podeInstalar();
export const estaNoApp = () => ehApp();
export function instalarApp() { return instalar(); }
export function aoMudarInstalacao(fn) {
  window.addEventListener('beforeinstallprompt', () => setTimeout(fn, 0));
  window.addEventListener('appinstalled', () => setTimeout(fn, 0));
}

async function instalar() {
  if (pedidoInstalacao) {
    const pedido = pedidoInstalacao;
    pedidoInstalacao = null;
    pedido.prompt();
    try { await pedido.userChoice; } catch { /* ignorado */ }
    fecharFaixa();
    atualizarBotoes();
    return;
  }
  // O site não consegue abrir o "Adicionar à Tela de Início" (o menu Compartilhar aberto pelo site
  // não tem essa opção): mostra o passo a passo com a seta para a barra do Safari.
  if (ehIOS()) mostrarPassoIOS();
}

export function iniciarAppInstalavel() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* sem app instalável; o portal segue normal */ });
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    pedidoInstalacao = e;
    atualizarBotoes();
    mostrarFaixa();
  });
  window.addEventListener('appinstalled', () => { pedidoInstalacao = null; fecharFaixa(); atualizarBotoes(); });

  document.getElementById('btnInstalarRodape')?.addEventListener('click', instalar);
  atualizarBotoes();
  // No iPhone não existe o evento do navegador: mostra a faixa depois de alguns segundos.
  if (ehIOS()) setTimeout(mostrarFaixa, 4000);
}
