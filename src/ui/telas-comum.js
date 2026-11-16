/* Estados comuns das telas: carregando, vazia, erro (com o tratamento central). */
import { mostrarMensagemErro } from './mensagem.js';
import { esc } from './util.js';

export function carregando(alvo, texto = 'Carregando…') {
  alvo.innerHTML = `<div class="estado-tela carregando" role="status"><span class="girando" aria-hidden="true"></span>${esc(texto)}</div>`;
}

export function vazia(alvo, titulo, texto, acaoHtml = '') {
  alvo.innerHTML = `<div class="estado-tela vazia"><strong>${esc(titulo)}</strong><p>${esc(texto)}</p>${acaoHtml}</div>`;
}

export function erroTela(alvo, erro, aoTentarDeNovo) {
  alvo.innerHTML = '<div class="estado-tela erro"></div>';
  mostrarMensagemErro(alvo.firstElementChild, erro, { aoTentarDeNovo });
}

export function titulo(texto, sub = '') {
  return `<div class="app-titulo"><h2 tabindex="-1">${esc(texto)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>`;
}
