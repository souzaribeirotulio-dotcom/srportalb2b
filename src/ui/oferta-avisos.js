/* Convite para ativar os avisos no celular, no momento certo:
   - depois do pedido enviado (dentro da tela "Pedido enviado!");
   - depois do login no app (cartão no rodapé da tela).
   O celular só pergunta "Permitir?" depois de um toque da pessoa, por isso é um convite com botão.
   "Agora não" guarda a data e o convite só volta depois de 7 dias. Já ativado, bloqueado ou sem
   suporte (ex.: iPhone fora do app instalado): não mostra nada. */
import { situacaoAvisos, ativarAvisos } from '../estado/avisos.js';
import { esc } from './util.js';

const CHAVE = 'sr:avisos:convite-dispensado-em';
const DIAS = 7;

function dispensadoRecente() {
  try { const em = Number(localStorage.getItem(CHAVE) || 0); return em && Date.now() - em < DIAS * 864e5; } catch { return false; }
}
function dispensar() { try { localStorage.setItem(CHAVE, String(Date.now())); } catch { /* sem armazenamento */ } }

/** true quando vale convidar agora. */
export async function podeConvidar() {
  if (dispensadoRecente()) return false;
  return (await situacaoAvisos()) === 'desligado';
}

/** Monta o convite dentro de `alvo` (elemento). aoFechar() é chamado depois de ativar ou dispensar. */
export function montarConvite(alvo, { titulo, texto, aoFechar = () => {} }) {
  alvo.innerHTML = `<div class="conv-av" role="region" aria-label="Avisos no celular">
    <div class="conv-av-ic" aria-hidden="true">🔔</div>
    <div class="conv-av-tx"><strong>${esc(titulo)}</strong><span>${esc(texto)}</span></div>
    <div class="conv-av-bt"><button type="button" class="btn pri conv-av-sim">Ativar avisos</button><button type="button" class="btn sec conv-av-nao">Agora não</button></div>
    <div class="conv-av-msg" aria-live="polite"></div></div>`;
  const sim = alvo.querySelector('.conv-av-sim'); const nao = alvo.querySelector('.conv-av-nao'); const msg = alvo.querySelector('.conv-av-msg');
  nao.onclick = () => { dispensar(); alvo.innerHTML = ''; aoFechar(); };
  sim.onclick = async () => {
    sim.disabled = nao.disabled = true; sim.textContent = 'Ativando…';
    try {
      await ativarAvisos();
      alvo.innerHTML = '<div class="conv-av ok"><div class="conv-av-ic" aria-hidden="true">✅</div><div class="conv-av-tx"><strong>Avisos ativados!</strong><span>Você vai receber aqui no celular as novidades dos seus pedidos.</span></div></div>';
      setTimeout(() => { alvo.innerHTML = ''; aoFechar(); }, 3500);
    } catch (e) {
      dispensar();
      msg.textContent = e.message || 'Não foi possível ativar agora.';
      sim.hidden = true; nao.disabled = false; nao.textContent = 'Fechar';
    }
  };
}

/** Cartão no rodapé da tela (usado depois do login). */
export async function convidarNoRodape() {
  // Não disputa espaço com a faixa "Instale o app" (o app vem primeiro).
  if (document.getElementById('srConviteAvisos') || document.getElementById('srFaixaApp') || !(await podeConvidar())) return;
  const caixa = document.createElement('div');
  caixa.id = 'srConviteAvisos';
  caixa.className = 'conv-av-flutuante';
  document.body.appendChild(caixa);
  // A Souzinha sobe para ficar acima do convite (não se cobrem).
  const ajustar = () => document.body.style.setProperty('--conv-av-h', `${caixa.offsetHeight}px`);
  document.body.classList.add('com-convite-avisos');
  montarConvite(caixa, {
    titulo: 'Quer receber os avisos do seu pedido?',
    texto: 'Avisamos aqui no celular as novidades dos seus pedidos.',
    aoFechar: () => { caixa.remove(); document.body.classList.remove('com-convite-avisos'); },
  });
  ajustar();
  new ResizeObserver(ajustar).observe(caixa);
}
