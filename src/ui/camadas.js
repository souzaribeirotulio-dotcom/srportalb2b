/* Telas por cima (janelas, carrinho, caça-capa):
   - ESC fecha a tela de cima, pelo mesmo botão de fechar/cancelar dela (cada tela faz a sua limpeza);
   - tela com dados digitados pede confirmação antes de fechar (ESC, ×, Cancelar), no centro da tela;
   - enquanto uma tela está aberta, o fundo não rola: a rodinha do mouse fora da janela rola a janela. */
const CAMADAS = '.mod, #drawer, .ifimp';
// Telas em que o que foi digitado se perde ao fechar.
const COM_DADOS = new Set(['mCad', 'mChk', 'mAdm']); // cadastro e negociação, fechamento do pedido, fichas do painel
const BOTAO_FECHAR = '.fxx, #dX, #cX, #lgX, #dClose, #ccX, [data-fechar]';
const TEXTOS_FECHAR = new Set(['×', 'Cancelar', 'Fechar', 'Voltar']);

let confirmando = false;

function abertas() {
  return [...document.querySelectorAll(CAMADAS)].filter((el) => el.classList.contains('open') && el.id !== 'mConf');
}
function zIndex(el) { return Number(getComputedStyle(el).zIndex) || 0; }
function deCima() {
  const lista = abertas();
  // A de maior z-index; empate: a que vem depois no documento.
  return lista.reduce((a, b) => (!a || zIndex(b) >= zIndex(a) ? b : a), null);
}
function visivel(el) { return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)) && !el.disabled; }

function botaoFechar(camada) {
  const porSeletor = [...camada.querySelectorAll(BOTAO_FECHAR)].find(visivel);
  if (porSeletor) return porSeletor;
  return [...camada.querySelectorAll('button')].find((b) => visivel(b) && TEXTOS_FECHAR.has(b.textContent.trim())) || null;
}
function ehBotaoFechar(el, camada) {
  // Só o botão que fecha a janela (o mesmo que o ESC usa); "Cancelar" de um formulário de dentro não conta.
  const b = el.closest('button, [data-fechar]');
  if (!b || !camada.contains(b)) return false;
  return b.matches(BOTAO_FECHAR) || b === botaoFechar(camada);
}
function sujaPorDigitar(camada) { return COM_DADOS.has(camada.id) && camada.dataset.sujo === '1'; }

/* ---------- confirmação no centro da tela ---------- */
function perguntar() {
  return new Promise((resolver) => {
    let m = document.getElementById('mConf');
    if (!m) {
      document.body.insertAdjacentHTML('beforeend', `<div class="mod" id="mConf" role="alertdialog" aria-modal="true" aria-labelledby="mConfT" aria-describedby="mConfD">
        <div class="box conf"><h3 id="mConfT">Sair sem salvar?</h3><p id="mConfD" class="sub">As informações preenchidas nesta tela vão se perder.</p>
        <div class="act"><button type="button" class="btn sec" id="mConfSair">Sair sem salvar</button><button type="button" class="btn pri" id="mConfFicar">Continuar preenchendo</button></div></div></div>`);
      m = document.getElementById('mConf');
    }
    confirmando = true;
    const fim = (sair) => { m.classList.remove('open'); confirmando = false; m.onkeydown = null; resolver(sair); };
    m.querySelector('#mConfSair').onclick = () => fim(true);
    m.querySelector('#mConfFicar').onclick = () => fim(false);
    m.onclick = (e) => { if (e.target === m) fim(false); };
    m._fim = fim;
    m.classList.add('open');
    m.querySelector('#mConfFicar').focus();
  });
}

async function fechar(camada) {
  if (sujaPorDigitar(camada) && !(await perguntar())) return;
  camada.dataset.sujo = '';
  const b = botaoFechar(camada);
  if (b) { camada.dataset.liberado = '1'; b.click(); delete camada.dataset.liberado; } else camada.classList.remove('open');
}

/* ---------- fundo parado enquanto há tela aberta ---------- */
function atualizarTrava() { document.documentElement.classList.toggle('g360-travado', abertas().length > 0 || confirmando); }

function rolavelDentro(camada) {
  const cands = [camada, ...camada.querySelectorAll('.box, .db, .impbox, .dinfo, #ccCorpo, [data-rolar]')];
  return cands.reverse().find((el) => el.scrollHeight > el.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) || null;
}

export function ligarCamadas() {
  // ESC: depois dos atalhos de cada tela (ex.: caça-capa tira a foto com ESC).
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const conf = document.getElementById('mConf');
    if (confirmando && conf) { e.preventDefault(); conf._fim?.(false); return; }
    const c = deCima(); if (!c) return;
    e.preventDefault();
    fechar(c);
  });
  // × / Cancelar de uma tela com dados digitados: pergunta antes.
  document.addEventListener('click', (e) => {
    if (confirmando) return;
    const c = deCima();
    // Usou o que digitou (Salvar, Enviar, Gerar…): deixa de perguntar até digitar de novo.
    const pri = e.target.closest?.('.btn.pri, .g360-btn.pri');
    if (c && pri && c.contains(pri)) { c.dataset.sujo = ''; return; }
    if (!c || c.dataset.liberado === '1' || !sujaPorDigitar(c) || !ehBotaoFechar(e.target, c)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    fechar(c);
  }, true);
  // Digitou algo numa tela com dados → passa a pedir confirmação. Busca e quantidade não contam.
  const marcar = (e) => {
    if (!e.isTrusted) return;
    const t = e.target;
    if (!t.matches?.('input, textarea, select') || t.type === 'search' || t.readOnly || t.closest('.qty, [data-nao-sujo]')) return;
    const c = t.closest(CAMADAS);
    if (c && COM_DADOS.has(c.id)) c.dataset.sujo = '1';
  };
  document.addEventListener('input', marcar, true);
  document.addEventListener('change', marcar, true);
  // Abriu, fechou ou trocou de conteúdo → começa sem dados digitados; e trava/destrava o fundo.
  const obs = new MutationObserver((ms) => {
    for (const m of ms) {
      const alvo = m.target;
      if (m.type === 'attributes' && alvo.matches?.(CAMADAS)) {
        if (!alvo.classList.contains('open')) alvo.dataset.sujo = '';
        else if (!m.oldValue?.split(' ').includes('open')) alvo.dataset.sujo = '';
      }
      if (m.type === 'childList') { const c = alvo.closest?.(CAMADAS); if (c && alvo.matches?.('.box')) c.dataset.sujo = ''; }
    }
    atualizarTrava();
  });
  const observar = () => document.querySelectorAll(CAMADAS).forEach((el) => {
    if (el._observado) return; el._observado = true;
    obs.observe(el, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    el.querySelectorAll(':scope > .box').forEach((b) => obs.observe(b, { childList: true }));
  });
  observar();
  // Telas criadas depois (caça-capa, importar fotos): passam a ser observadas quando entram no documento.
  new MutationObserver(observar).observe(document.body, { childList: true });
  // Rodinha do mouse fora da janela: rola a janela aberta, não o fundo.
  document.addEventListener('wheel', (e) => {
    const c = deCima(); if (!c) return;
    const sombra = document.getElementById('shade');
    const fora = e.target === c || (sombra && e.target === sombra) || !c.contains(e.target);
    if (!fora) return;
    const r = rolavelDentro(c);
    e.preventDefault();
    if (r) r.scrollTop += e.deltaY;
  }, { passive: false });
}
