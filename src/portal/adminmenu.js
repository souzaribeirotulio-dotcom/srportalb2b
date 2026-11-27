/* Painel da equipe: menu lateral agrupado (no computador), inspirado no menu do Mercado Livre.
   Só reorganiza os botões de aba que o admin.js já criou (data-at): a navegação, as permissões
   (atributo hidden) e o destaque da aba atual (.on) continuam sendo feitos pelo admin.js.
   No celular, a barra de baixo (eqBar) continua igual; entre 761 e 1023 px as abas ficam em cima. */

const GRUPOS = [
  ['', ['ini']],
  ['Clientes', ['cli', 'acessos', 'visita', 'exe']],
  ['Produtos e preços', ['prod', 'cong', 'mrg', 'neg', 'estoque']],
  ['Vendas e marketing', ['vendas', 'intel', 'ban', 'wpp', 'souzinha']],
  ['Sistema', ['cfg', 'ocor', 'perm']],
];

// Ícone para as abas que não têm emoji no nome.
const ICONES = { ini: '🏠', cli: '👥', acessos: '🔑', prod: '📦', cong: '❄️', mrg: '📉', intel: '💡', neg: '💬', cfg: '⚙️', ocor: '🛎️' };

/** Agrupa os botões de .atabs em seções com título. Pode ser chamada de novo (só move o que faltar). */
export function montarMenuLateral(abas) {
  if (!abas) return;
  abas.classList.add('amenu');
  abas.setAttribute('role', 'navigation');
  abas.setAttribute('aria-label', 'Áreas do painel');
  const botoes = new Map([...abas.querySelectorAll('[data-at]')].map((b) => [b.dataset.at, b]));
  botoes.forEach((b, k) => {
    if (b.querySelector('.amic')) return;
    // Nome que já começa com emoji ("📊 Vendas"): o emoji vai para a coluna do ícone, para alinhar com os outros.
    const t = b.firstChild;
    const m = t && t.nodeType === 3 ? /^\s*(\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}]*|[➕⚠]\uFE0F?)\s*/u.exec(t.textContent) : null;
    if (m) { t.textContent = t.textContent.slice(m[0].length); b.insertAdjacentHTML('afterbegin', `<span class="amic" aria-hidden="true">${m[1]}</span>`); }
    else if (ICONES[k]) b.insertAdjacentHTML('afterbegin', `<span class="amic" aria-hidden="true">${ICONES[k]}</span>`);
  });
  const usados = new Set();
  GRUPOS.forEach(([titulo, ids], i) => {
    let g = abas.querySelector(`.amg[data-g="${i}"]`);
    if (!g) {
      g = document.createElement('div');
      g.className = 'amg'; g.dataset.g = String(i);
      if (titulo) g.innerHTML = `<span class="amt">${titulo}</span>`;
      abas.appendChild(g);
    }
    ids.forEach((k) => { const b = botoes.get(k); if (b) { g.appendChild(b); usados.add(k); } });
  });
  // Aba nova que ainda não está num grupo: vai para o fim, para nunca sumir do menu.
  const resto = [...botoes.keys()].filter((k) => !usados.has(k));
  if (resto.length) {
    let g = abas.querySelector('.amg[data-g="outros"]');
    if (!g) { g = document.createElement('div'); g.className = 'amg'; g.dataset.g = 'outros'; g.innerHTML = '<span class="amt">Outros</span>'; abas.appendChild(g); }
    resto.forEach((k) => g.appendChild(botoes.get(k)));
  }
}
