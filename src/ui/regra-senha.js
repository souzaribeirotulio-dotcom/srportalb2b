/* Regra da senha mostrada embaixo do campo, conferida enquanto a pessoa digita.
   A regra vem do contrato da API do G360 (POST acessos/senha e troca de senha):
   de 6 a 8 caracteres ASCII visíveis (sem espaços nem acentos), diferente do código de cliente.
   Nada aqui guarda ou registra a senha: só lê os campos para pintar a lista. */
import { esc } from './util.js';

export const SENHA_MIN = 6;
export const SENHA_MAX = 8;
export const FORMATO_SENHA = /^[!-~]{6,8}$/;
export const REGRA_SENHA = 'De 6 a 8 caracteres, sem espaços nem acentos, diferente do seu código de cliente.';

/** HTML da lista. Coloque logo depois do campo "Senha nova". */
export function htmlRegraSenha(id) {
  const item = (chave, texto) =>
    `<li class="rs-item" data-r="${chave}" data-st="pend"><span class="rs-ic" aria-hidden="true"></span><span class="rs-tx">${texto}</span></li>`;
  return `<ul class="rs-lista" id="${esc(id)}" aria-label="Regras da senha">
    ${item('tam', `De ${SENHA_MIN} a ${SENHA_MAX} caracteres <b class="rs-cont">0 de ${SENHA_MAX}</b>`)}
    ${item('car', 'Só letras sem acento, números e símbolos, sem espaço')}
    ${item('cod', 'Diferente do seu código de cliente')}
    ${item('igu', 'As duas senhas iguais')}
  </ul>`;
}

/** Liga a lista aos campos. Devolve uma função que diz se tudo está certo.
    codigo: código de cliente, quando a tela conhece (Minha conta); sem ele, o item fica só como aviso. */
export function ligarRegraSenha(lista, s1, s2, codigo = null) {
  const marcar = (chave, st) => { const li = lista.querySelector(`[data-r="${chave}"]`); if (li) li.dataset.st = st; };
  const cont = lista.querySelector('.rs-cont');
  const cod = codigo === null || codigo === undefined || codigo === '' ? null : String(codigo);

  const atualizar = () => {
    const a = s1.value; const b = s2.value; const n = [...a].length;
    if (n === 0) cont.textContent = `0 de ${SENHA_MAX}`;
    else if (n < SENHA_MIN) cont.textContent = `${n} de ${SENHA_MAX} · falta${SENHA_MIN - n > 1 ? 'm' : ''} ${SENHA_MIN - n}`;
    else if (n >= SENHA_MAX) cont.textContent = `${n} de ${SENHA_MAX} · máximo`;
    else cont.textContent = `${n} de ${SENHA_MAX}`;
    marcar('tam', n === 0 ? 'pend' : n >= SENHA_MIN && n <= SENHA_MAX ? 'ok' : n < SENHA_MIN ? 'pend' : 'bad');
    marcar('car', n === 0 ? 'pend' : /^[!-~]*$/.test(a) ? 'ok' : 'bad');
    if (cod === null) marcar('cod', 'info');
    else marcar('cod', n === 0 ? 'pend' : a === cod ? 'bad' : 'ok');
    if (!b) marcar('igu', 'pend');
    else if (a === b) marcar('igu', 'ok');
    else marcar('igu', a.startsWith(b) ? 'pend' : 'bad');
  };
  s1.addEventListener('input', atualizar);
  s2.addEventListener('input', atualizar);
  atualizar();
  return () => FORMATO_SENHA.test(s1.value) && s1.value === s2.value && (cod === null || s1.value !== cod);
}
