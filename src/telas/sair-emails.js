/* Página /sair-emails#t=... (link "Não quero mais receber" dos e-mails do remarketing).
   Pede confirmação com um toque (prévias de link e antivírus abrem a página, mas não tocam no botão). */
import { sairDosEmails } from '../api/whatsapp.js';
import { focarTitulo, esc } from '../ui/util.js';

export function telaSairEmails({ conteudo, ir }) {
  const t = new URLSearchParams(location.hash.slice(1)).get('t') || '';
  if (location.hash) history.replaceState(null, '', location.pathname);
  conteudo.innerHTML = `
    <h2 class="g360-sub">Não quero mais receber</h2>
    <p class="g360-info g360-esquerda">Toque no botão para parar de receber os e-mails de avisos e ofertas da Souza Ribeiro. Os e-mails do seu acesso (como o link de senha) continuam chegando quando você pedir.</p>
    <div class="g360-acoes"><button type="button" class="g360-btn pri" id="g360Sair" ${t ? '' : 'disabled'}>Parar de receber</button>
      <button type="button" class="g360-link" id="g360Voltar">Ir para o portal</button></div>
    <div id="g360SairRes" aria-live="polite">${t ? '' : '<p class="g360-info g360-esquerda">Abra o link direto do e-mail.</p>'}</div>`;
  focarTitulo(conteudo);
  conteudo.querySelector('#g360Voltar').onclick = () => ir('/');
  const b = conteudo.querySelector('#g360Sair');
  b.onclick = async () => {
    b.disabled = true; b.textContent = 'Saindo…';
    const res = conteudo.querySelector('#g360SairRes');
    try { res.innerHTML = `<div class="g360-msg" role="status"><strong class="g360-msg-rotulo">Pronto</strong><p>${esc(await sairDosEmails(t))}</p></div>`; b.remove(); }
    catch (e) { res.innerHTML = `<div class="g360-msg g360-msg-corrigir" role="alert"><p>${esc(e.message)}</p></div>`; b.disabled = false; b.textContent = 'Parar de receber'; }
  };
}
