/* Quadro de mensagem reutilizável pelas telas da integração G360.
   Recebe um erro da API, pede a interpretação ao módulo da API (um lugar só)
   e desenha a mensagem, o "Código para o suporte" e, quando cabe, o botão
   "Tentar de novo" com a espera indicada. */
import { interpretarErro } from '../api/g360.js';

const ROTULOS = {
  corrigir: 'Confira as informações',
  fornecedor: 'Precisa de ajuste da Souza Ribeiro',
  tentar: 'Aguarde um instante',
  integracao: 'Erro no portal',
  rede: 'Sem comunicação',
};

function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Mostra a mensagem de erro dentro de `alvo`.
 * @param alvo        elemento onde o quadro é desenhado
 * @param erro        erro recebido de uma chamada da API
 * @param opcoes.aoTentarDeNovo  função chamada pelo botão "Tentar de novo" (opcional)
 * @param opcoes.tentativa       nº de recusas seguidas (espera crescente no 429)
 * @returns a interpretação usada (tipo, mensagem, campos...)
 */
export function mostrarMensagemErro(alvo, erro, { aoTentarDeNovo = null, tentativa = 0 } = {}) {
  const info = interpretarErro(erro, tentativa);
  const campos = Object.entries(info.campos || {})
    .filter(([nome, lista]) => nome !== 'pendencias' && Array.isArray(lista) && lista.length)
    .map(([, lista]) => lista.map((m) => `<li>${esc(m)}</li>`).join(''))
    .join('');
  const botao = info.podeTentar && aoTentarDeNovo;
  alvo.innerHTML = `
    <div class="g360-msg g360-msg-${info.tipo}" role="alert">
      <strong class="g360-msg-rotulo">${ROTULOS[info.tipo]}</strong>
      <p>${esc(info.mensagem)}</p>
      ${campos ? `<ul class="g360-msg-campos">${campos}</ul>` : ''}
      ${info.suporte ? `<small class="g360-msg-suporte">Código para o suporte: ${esc(info.suporte)}</small>` : ''}
      ${botao ? '<button type="button" class="g360-btn sec g360-msg-botao">Tentar de novo</button>' : ''}
    </div>`;
  if (botao) {
    const b = alvo.querySelector('.g360-msg-botao');
    let resta = info.esperaSegundos;
    const atualizar = () => {
      b.disabled = resta > 0;
      b.textContent = resta > 0 ? `Tentar de novo em ${resta} s` : 'Tentar de novo';
    };
    atualizar();
    if (resta > 0) {
      const relogio = setInterval(() => {
        resta -= 1;
        if (!b.isConnected) { clearInterval(relogio); return; }
        atualizar();
        if (resta <= 0) clearInterval(relogio);
      }, 1000);
    }
    b.addEventListener('click', () => aoTentarDeNovo(), { once: true });
  }
  return info;
}
