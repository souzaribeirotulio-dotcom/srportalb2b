/* =====================================================================
   Motor de busca do portal.
   O G360 só acha quando cada palavra aparece igual no nome dele (ex.:
   "descartável" não acha "DESC."). Aqui a busca roda primeiro sobre os nomes
   do portal + nomes do G360 (memória), tolerando:
     - acento, maiúsculas, plural ("copos" → "copo");
     - abreviação do G360 ("descartavel" acha "desc", "transparente" acha "transp");
     - começo de palavra ("deterg" acha "detergente") e 1 letra errada ("detergnte");
     - sinônimos comuns ("lixo" ~ "saco para lixo", "papel toalha" ~ "toalha interfolhada").
   Depois a API confirma preço e estoque dos mais relevantes.
   ===================================================================== */

export const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/(\d),(\d)/g, '$1.$2').replace(/[^a-z0-9.]+/g, ' ').replace(/(^|\s)\.|\.(\s|$)/g, ' ').trim();

const PARADAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'para', 'p', 'c', 'em', 'a', 'o', 'as', 'os', 'un', 'und', 'unid']);

/** Singular simples do português. */
function singular(w) {
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith('oes') || w.endsWith('aes')) return `${w.slice(0, -3)}ao`;
  if (w.endsWith('ais')) return `${w.slice(0, -3)}al`;
  if (w.endsWith('eis')) return `${w.slice(0, -3)}el`;
  if (w.endsWith('res') || w.endsWith('zes') || w.endsWith('ses')) return w.slice(0, -2);
  if (w.endsWith('ns')) return `${w.slice(0, -2)}m`;
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

// Palavra que o cliente digita → formas que aparecem nos cadastros.
const SINONIMOS = {
  descartavel: ['desc', 'descart'], transparente: ['transp', 'cristal'], branco: ['bco', 'branca'], preto: ['pto', 'preta'],
  higienico: ['hig'], interfolhado: ['interf', 'interfolha'], liquido: ['liq'], reforcado: ['ref', 'reforc'],
  sabonete: ['sab', 'sabon'], detergente: ['deterg', 'det'], desinfetante: ['desinf'], alcool: ['alc'], embalagem: ['emb'],
  lixo: ['lix'], sanitaria: ['sanit', 'cloro'], agua: ['agua'], guardanapo: ['guard'], toalha: ['toalha', 'tolha'],
  litro: ['l', 'lt', 'lts'], quilo: ['kg'], kilo: ['kg'], grama: ['g', 'gr', 'grs'], metro: ['m', 'mt', 'mts'],
  pacote: ['pct', 'pc'], caixa: ['cx'], fardo: ['fd'], rolo: ['rl', 'rolao'], unidade: ['un', 'und'],
  copinho: ['copo'], garfinho: ['garfo'], colherzinha: ['colher'], vasilha: ['pote'], marmita: ['marmitex', 'marmiteiro'],
  sacola: ['sacola', 'sacolinha'], sacolinha: ['sacola'], sacolao: ['sacola'], papelao: ['papelao', 'caixa'],
  bombril: ['palha', 'la'], durex: ['fita'], maizena: ['amido'], gilete: ['lamina', 'aparelho'], cotonete: ['haste'],
};

function tokens(texto) {
  return normalizar(texto).split(' ').filter((w) => w && !PARADAS.has(w)).map(singular);
}

/** Distância de edição ≤ 1 (troca, falta ou sobra de uma letra). */
function quase(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let dif = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    dif += 1; if (dif > 1) return false;
    if (a.length > b.length) i += 1; else if (b.length > a.length) j += 1; else { i += 1; j += 1; }
  }
  return dif + (a.length - i) + (b.length - j) <= 1;
}

/** Quanto uma palavra da busca bate com as palavras do produto (0 = não bate). */
function pontoPalavra(q, palavras) {
  const formas = [q, ...(SINONIMOS[q] || [])];
  let melhor = 0;
  for (const w of palavras) {
    for (const f of formas) {
      if (w === f) return 6;
      if (f.length >= 2 && w.startsWith(f)) melhor = Math.max(melhor, f === q ? 4 : 3);           // "deterg" → "detergente"
      else if (w.length >= 3 && f.startsWith(w) && f.length > w.length) melhor = Math.max(melhor, 3); // "descartavel" → "desc"
      else if (f.length >= 5 && w.length >= 4 && quase(f, w)) melhor = Math.max(melhor, 2);           // 1 letra errada
    }
  }
  return melhor;
}

let indice = null; // [{ codigo, produto_id, palavras, nome, categoria }]

/** Monta o índice a partir dos registros do portal (nome do portal + nome do G360 + código). */
export function indexar(linhas) {
  indice = linhas.map((r) => ({
    codigo: String(r.codigo), produto_id: r.produto_id, categoria: r.categoria, nome: r.nome,
    palavras: [...new Set(tokens(`${r.nome} ${r.nome_g360 || ''}`))], cod: normalizar(r.codigo).replace(/\s/g, ''),
  }));
}

export function indexado() { return !!indice; }

/**
 * Busca local. Devolve [{ codigo, produto_id, pontos }] do mais ao menos relevante.
 * Todas as palavras precisam bater; se nada bater, aceita quem bate na maioria.
 */
export function buscarLocal(consulta, { categoria = '', max = 150 } = {}) {
  if (!indice) return [];
  const qs = tokens(consulta);
  if (!qs.length) return [];
  const cod = normalizar(consulta).replace(/\s/g, '');
  const res = []; const parciais = [];
  for (const it of indice) {
    if (categoria && it.categoria !== categoria) continue;
    if (cod && it.cod === cod) { res.push({ ...it, pontos: 1000 }); continue; }
    let soma = 0; let bateu = 0;
    qs.forEach((q, i) => { const p = pontoPalavra(q, it.palavras); if (p) { bateu += 1; soma += p + (i === 0 && it.palavras[0]?.startsWith(q) ? 3 : 0); } });
    if (bateu === qs.length) res.push({ ...it, pontos: soma + 10 });
    else if (qs.length >= 3 && bateu >= Math.ceil(qs.length * 0.66)) parciais.push({ ...it, pontos: soma });
  }
  const lista = res.length ? res : parciais;
  return lista.sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome, 'pt')).slice(0, max);
}

/** Tem estoque para vender agora (prioridade na vitrine e na busca). */
export function temEstoque(p) {
  return p?.compravel === true && p?.disponibilidade === 'disponivel';
}
