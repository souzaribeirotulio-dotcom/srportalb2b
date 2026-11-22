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

// Sinônimos cadastrados pela equipe (painel → Configurações). Palavra → formas; frase → frases.
let EXTRA = new Map();
let FRASES = [];
/** linhas: [{ termo, equivalentes: [] }]. Vale nos dois sentidos. */
export function definirSinonimos(linhas) {
  EXTRA = new Map(); FRASES = [];
  const liga = (a, b) => {
    if (!a || !b || a === b) return;
    if (a.includes(' ') || b.includes(' ')) FRASES.push([a, b]);
    else EXTRA.set(a, [...new Set([...(EXTRA.get(a) || []), b])]);
  };
  for (const l of linhas || []) {
    const t = normalizar(l.termo).split(' ').map(singular).join(' ');
    for (const e of l.equivalentes || []) {
      const q = normalizar(e).split(' ').map(singular).join(' ');
      liga(t, q); liga(q, t);
    }
  }
}

/** A busca e as variações dela pelos sinônimos de frase ("papel de mao" → "papel toalha"). */
export function variacoes(consulta) {
  const base = normalizar(consulta).split(' ').map(singular).join(' ');
  const out = new Set([base]);
  for (const [de, para] of FRASES) if (` ${base} `.includes(` ${de} `)) out.add(` ${base} `.replace(` ${de} `, ` ${para} `).trim());
  return [...out].slice(0, 6);
}

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
  const formas = [q, ...(SINONIMOS[q] || []), ...(EXTRA.get(q) || [])];
  let melhor = 0;
  for (const w of palavras) {
    for (const f of formas) {
      if (w === f) return 6;
      if (f.length >= 2 && w.startsWith(f)) melhor = Math.max(melhor, f === q ? 4 : 3);           // "deterg" → "detergente"
      else if (w.length >= 3 && f.startsWith(w) && f.length > w.length) {
        // "descartavel" → "desc" é abreviação (3). Mas se o resto também é palavra ("superlimpo" → "super" + "limpo"),
        // a busca era de duas palavras juntas, e bater só a primeira vale pouco (1).
        melhor = Math.max(melhor, composta(f) ? 1 : 3);
      }
      else if (f.length >= 5 && w.length >= 4 && quase(f, w)) melhor = Math.max(melhor, 2);           // 1 letra errada
    }
  }
  return melhor;
}

let indice = null; // [{ codigo, produto_id, palavras, nome, categoria }]
let VOCABULARIO = new Set(); // palavras de 3+ letras que existem nos nomes
let FREQ = new Map();         // palavra → em quantos produtos aparece (para escolher a correção mais comum)
const COMPOSTAS = new Map();
/** A busca é duas palavras do catálogo coladas? ("superlimpo" = "super" + "limpo"; "descartavel" não é.) */
function composta(f) {
  if (!COMPOSTAS.has(f)) {
    let sim = false;
    for (let i = 3; i <= f.length - 3 && !sim; i += 1) sim = VOCABULARIO.has(f.slice(0, i)) && VOCABULARIO.has(f.slice(i));
    COMPOSTAS.set(f, sim);
  }
  return COMPOSTAS.get(f);
}

// Tamanhos de luva, avental, roupa etc. "(P)", "Tam. G", "GG". Número antes ("500 g", "10 m") é medida, não tamanho.
const TAMANHOS = new Set(['pp', 'p', 'm', 'g', 'gg', 'xg', 'xgg', 'eg', 'egg', 'xp', 'xxg']);
function tamanhosDe(texto) {
  const w = normalizar(texto).split(' '); const out = new Set();
  w.forEach((x, i) => { if (TAMANHOS.has(x) && !/\d$/.test(w[i - 1] || '')) out.add(x); });
  return out;
}
/** Tamanho pedido na busca. O "p" só conta no fim ("luva p"), porque no meio costuma ser "para" ("saco p lixo"). */
function tamanhoDaBusca(consulta) {
  const w = normalizar(consulta).split(' ').filter(Boolean);
  return w.filter((x, i) => TAMANHOS.has(x) && (x !== 'p' || i === w.length - 1) && i > 0 && !/\d$/.test(w[i - 1]));
}

/** Monta o índice a partir dos registros do portal (nome do portal + nome do G360 + código). */
export function indexar(linhas) {
  indice = linhas.map((r) => ({
    codigo: String(r.codigo), produto_id: r.produto_id, categoria: r.categoria, nome: r.nome,
    palavras: [...new Set(tokens(`${r.nome} ${r.nome_g360 || ''}`))], tam: new Set([...tamanhosDe(r.nome), ...tamanhosDe(r.nome_g360)]), cod: normalizar(r.codigo).replace(/\s/g, ''),
    // Nome "colado" (sem espaços), para achar "superlimpo" em "Super Limpo" e "papel toalha" em "PAPELTOALHA".
    junto: `${normalizar(r.nome).replace(/\s/g, '')}|${normalizar(r.nome_g360 || '').replace(/\s/g, '')}`,
  }));
  VOCABULARIO = new Set(indice.flatMap((it) => it.palavras).filter((w) => w.length >= 3 && /^[a-z]+$/.test(w))); COMPOSTAS.clear();
  FREQ = new Map(); indice.forEach((it) => it.palavras.forEach((w) => { if (VOCABULARIO.has(w)) FREQ.set(w, (FREQ.get(w) || 0) + 1); }));
}

export function indexado() { return !!indice; }

/** Distância de edição (Levenshtein) com limite: para de contar acima de max. */
function distancia(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i]; let menor = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(ant[j] + 1, cur[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < menor) menor = cur[j];
    }
    if (menor > max) return max + 1;
    ant = cur;
  }
  return ant[b.length];
}

/**
 * "Você quis dizer": troca cada palavra que não existe no catálogo pela mais parecida que existe
 * ("liva preta" → "luva preta", "papel sofite" → "papel sulfite"). Devolve a busca corrigida ou null.
 * Até 1 letra de diferença em palavras de 3 a 5 letras, até 2 nas maiores. Entre as parecidas, vale primeiro
 * a de tamanho mais próximo e a mais comum, mas só fica a correção que, junto com as outras palavras, acha produto
 * ("sofite" também fica a 2 letras de "soft", só que "papel soft" não acha nada).
 */
export function corrigirBusca(consulta) {
  if (!indice) return null;
  const palavras = normalizar(consulta).split(' ').filter(Boolean);
  const opcoes = palavras.map((w) => {
    const s = singular(w);
    if (w.length < 3 || /\d/.test(w) || PARADAS.has(w) || VOCABULARIO.has(s) || VOCABULARIO.has(w)
      || SINONIMOS[s] || EXTRA.has(s) || [...VOCABULARIO].some((v) => v.startsWith(s))) return [w];
    const max = s.length <= 5 ? 1 : 2;
    const achadas = [];
    for (const v of VOCABULARIO) {
      const d = distancia(s, v, max);
      if (d <= max) achadas.push({ v, d, t: Math.abs(v.length - s.length), f: FREQ.get(v) || 0 });
    }
    achadas.sort((x, y) => x.d - y.d || x.t - y.t || y.f - x.f);
    return achadas.length ? achadas.slice(0, 6).map((x) => x.v) : [w];
  });
  if (opcoes.every((o, i) => o.length === 1 && o[0] === palavras[i])) return null;
  // Combinações na ordem de preferência (no máximo 40); a primeira que acha produto é a sugestão.
  let combos = [[]];
  for (const o of opcoes) { combos = combos.flatMap((c) => o.map((x) => [...c, x])).slice(0, 40); }
  for (const c of combos) {
    const q = c.join(' ');
    if (q !== palavras.join(' ') && buscarUma(q).length) return q;
  }
  return null;
}

/**
 * Busca local. Devolve [{ codigo, produto_id, pontos }] do mais ao menos relevante.
 * Todas as palavras precisam bater; se nada bater, aceita quem bate na maioria.
 */
export function buscarLocal(consulta, opcoes = {}) {
  const melhor = new Map();
  for (const v of variacoes(consulta)) for (const r of buscarUma(v, opcoes)) if (!melhor.has(r.codigo) || melhor.get(r.codigo).pontos < r.pontos) melhor.set(r.codigo, r);
  return [...melhor.values()].sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome, 'pt')).slice(0, opcoes.max || 150);
}

function buscarUma(consulta, { categoria = '', max = 150 } = {}) {
  if (!indice) return [];
  // "alcool70" → "alcool 70": letra colada em número vira duas palavras (códigos como "P-110" não passam por aqui).
  // O tamanho ("luva nitrilica p") não é exigido: ele sobe quem é do tamanho, e os outros tamanhos vêm logo depois.
  const tams = tamanhoDaBusca(consulta);
  const qs = tokens(consulta).filter((q) => !tams.includes(q)).flatMap((q) => (/^[a-z]{3,}\d+$/.test(q) ? q.match(/^([a-z]+)(\d+)$/).slice(1) : [q]));
  if (!qs.length) return [];
  const cod = normalizar(consulta).replace(/\s/g, '');
  const colado = qs.join('');
  const res = []; const parciais = [];
  for (const it of indice) {
    if (categoria && it.categoria !== categoria) continue;
    if (cod && it.cod === cod) { res.push({ ...it, pontos: 1000 }); continue; }
    let soma = 0; let bateu = 0;
    qs.forEach((q, i) => { const p = pontoPalavra(q, it.palavras); if (p) { bateu += 1; soma += p + (i === 0 && it.palavras[0]?.startsWith(q) ? 3 : 0); } });
    // A busca inteira aparece no nome, junta ou separada ("superlimpo" ↔ "Super Limpo"): é o que a pessoa procurava.
    // Vale o mesmo que a palavra exata: "Multi Uso" e "Multiuso" ficam empatados para "multiuso".
    if (colado.length >= 5 && it.junto.includes(colado) && !it.palavras.some((w) => w.includes(colado))) {
      bateu = qs.length; soma = Math.max(soma, qs.length * 6 + (it.junto.startsWith(colado) ? 3 : 0));
    }
    if (tams.length && tams.some((t) => it.tam.has(t))) soma += 12;
    if (bateu === qs.length) res.push({ ...it, pontos: soma + 10 });
    else if (qs.length >= 3 && bateu >= Math.ceil(qs.length * 0.66)) parciais.push({ ...it, pontos: soma });
  }
  const lista = res.length ? res : parciais;
  return lista.sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome, 'pt')).slice(0, max);
}

/** Tem estoque para vender agora (prioridade na vitrine e na busca). */
export function temEstoque(p) {
  if (p?.compravel !== true || p?.disponibilidade !== 'disponivel') return false;
  // Com a quantidade ligada no G360, "0" = acabou.
  return p.quantidade_disponivel === null || p.quantidade_disponivel === undefined || Number(p.quantidade_disponivel) > 0;
}
