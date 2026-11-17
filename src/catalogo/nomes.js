/* =====================================================================
   Nome no padrão de e-commerce e categoria a partir do nome do G360.
   Só apresentação: o G360 continua com o nome dele (nota, pedido, busca).
   Ex.: "SACO P/ LIXO 100L PRETO C/100 JR" → "Saco para Lixo 100L Preto (Pacote c/ 100 un) JR"
   ===================================================================== */

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'com', 'sem', 'para', 'por', 'a', 'o', 'ao', 'na', 'no', 'x']);
const SIGLAS = new Set(['PP', 'PS', 'PE', 'PET', 'PVC', 'EVA', 'PU', 'EPI', 'A4', 'A3', 'A5', 'XG', 'XXG', 'GG', 'PP', 'P', 'M', 'G', 'MDF', 'LED', 'USB', 'AA', 'AAA', 'HO', 'JR', 'BC', 'MD', 'UV', 'II', 'III', 'IV', 'TNT', 'BOPP', 'PEAD', 'PEBD', 'ABS', 'INOX', 'CPF', 'CNPJ']);
// Abreviações comuns no G360 → por extenso.
// Abreviações comuns no G360 → por extenso (consome o ponto; só palavra inteira).
const ab = (w) => new RegExp(`(^|\\s)${w}\\.?(?=\\s|$|[,)/])`, 'gi');
const ABREV = [
  [/\bP\/\s*/gi, 'para '], [/\bC\/\s*(?=[A-Za-zÀ-ú])/gi, 'com '], [/\bS\/\s*/gi, 'sem '],
  ...[['DESC', 'Descartável'], ['DESCART', 'Descartável'], ['TRANSP', 'Transparente'], ['BCO', 'Branco'], ['PTO', 'Preto'],
    ['VERM', 'Vermelho'], ['REF', 'Reforçado'], ['INST', 'Institucional'], ['LIQ', 'Líquido'], ['INTERF', 'Interfolhado'],
    ['HIG', 'Higiênico'], ['PAP', 'Papel'], ['SAB', 'Sabonete'], ['DET', 'Detergente'], ['DESINF', 'Desinfetante'],
    ['ALC', 'Álcool'], ['EMB', 'Embalagem'], ['ROLAO', 'Rolão'], ['ACUCAR', 'Açúcar'], ['CAFE', 'Café'], ['AGUA', 'Água'],
    ['SACHE', 'Sachê'], ['ALCOOL', 'Álcool'], ['HIGIENICO', 'Higiênico'], ['LIQUIDO', 'Líquido'], ['DESCARTAVEL', 'Descartável'],
    ['PLASTICO', 'Plástico'], ['PLASTICA', 'Plástica'], ['ALUMINIO', 'Alumínio'], ['SANITARIA', 'Sanitária'], ['MEDIO', 'Médio'],
    ['REFORCADO', 'Reforçado'], ['TERMICA', 'Térmica'], ['NITRILICA', 'Nitrílica'], ['SABAO', 'Sabão'], ['PO', 'Pó'],
    ['DIVISOES', 'Divisões'], ['FEIJAO', 'Feijão'], ['ORGANICO', 'Orgânico'], ['ACIDO', 'Ácido'], ['ANTISSEPTICO', 'Antisséptico'],
  ].map(([w, por]) => [ab(w), `$1${por}`]),
  [/\bTAM\.?\s+/gi, 'Tam. '], [/\bMIC\.?\s*/gi, 'Mic. '],
]
const EMBALAGENS = { CX: 'Caixa', PC: 'Pacote', PCT: 'Pacote', FD: 'Fardo', RL: 'Rolo', GL: 'Galão', FR: 'Frasco', UN: 'Unidade', DZ: 'Dúzia', CT: 'Cartela', BD: 'Balde', SC: 'Saco' };

function palavra(w, primeira) {
  if (!w) return w;
  const limpa = w.replace(/[^A-Za-zÀ-ú0-9]/g, '');
  const up = limpa.toUpperCase();
  // Medidas: 500ML → 500ml, 5L → 5L, 1KG → 1kg, 30M → 30m, 10X20CM → 10x20cm
  if (/^\d/.test(limpa)) {
    return w.replace(/(\d)\s*X\s*(?=\d)/gi, '$1x').replace(/ML\b/gi, 'ml').replace(/KG\b/gi, 'kg').replace(/(\d)G\b/gi, '$1g')
      .replace(/MM\b/gi, 'mm').replace(/CM\b/gi, 'cm').replace(/(\d)M\b/gi, '$1m').replace(/(\d)L\b/gi, '$1L').replace(/(\d)UN\b/gi, '$1 un');
  }
  if (SIGLAS.has(up) && limpa.length <= 4 && !primeira) return w.toUpperCase();
  const lower = w.toLowerCase();
  if (!primeira && MINUSCULAS.has(lower)) return lower;
  return lower.replace(/(^|[-/(])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase());
}

/** Nome do G360 (geralmente em MAIÚSCULAS) → nome de e-commerce. */
export function nomeEcommerce(nomeG360, marca = '') {
  let s = String(nomeG360 || '').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  // Já está em caixa mista: só arruma espaços.
  const temMinuscula = /[a-zà-ú]/.test(s);
  // Quantidade da embalagem: "C/100", "CX C/ 12", "PCT 50UN", "C/ 1000 FLS"
  let emb = '';
  s = s.replace(/\b(CX|PC|PCT|FD|RL|GL|FR|DZ|CT|BD|SC)?\s*C\/\s*(\d[\d.]*)\s*(UN|UND|UNID|FLS|FOLHAS|ROLOS|RL|PCT|PC)?\b\.?/i, (m, tipo, n, und) => {
    const t = EMBALAGENS[(tipo || '').toUpperCase()] || 'Pacote';
    const u = /^F/i.test(und || '') ? 'folhas' : /^R/i.test(und || '') ? 'rolos' : /^P/i.test(und || '') ? 'pacotes' : 'un';
    emb = `(${t} c/ ${Number(n.replace(/\./g, '')).toLocaleString('pt-BR')} ${u})`;
    return ' ';
  });
  if (!temMinuscula) for (const [re, por] of ABREV) s = s.replace(re, por);
  s = s.replace(/\s+/g, ' ').trim();
  // Marca no fim (sem repetir).
  const m = temMinuscula ? '' : String(marca || '').trim(); // nome em caixa mista já foi revisado: não mexe
  const marcaFmt = !m ? '' : /[a-zà-ú]/.test(m) ? m : m.split(/\s+/).map((w) => (w.length <= 3 ? w.toUpperCase() : palavra(w, true))).join(' ');
  if (m) s = s.replace(new RegExp(`\\b${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), ' ').replace(/\s+/g, ' ').trim();
  const corpo = temMinuscula ? s : s.split(' ').map((w, i) => palavra(w, i === 0)).join(' ');
  return [corpo, emb, marcaFmt].filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(/\s+([,)])/g, '$1').trim().slice(0, 160);
}

// Palavras → categoria (a primeira regra que bater vence). Sem acento e em minúsculas.
const REGRAS = [
  ['Utensílios & EPI', /\b(luva|mascara|oculos|avental|touca|bota|protetor|capacete|lixeira|carro funcional|balde|rodo|vassoura|pa de lixo|mop|esfregao|dispenser|suporte|saboneteira|toalheiro|escova|espanador|pulverizador|borrifador|otoscopio|especulo)\b/],
  ['Higiene', /\b(papel higienico|papel toalha|toalha interfolhad|sabonete|alcool|fralda|lenco|absorvente|creme dental|escova dental|shampoo|hidratante|guardanapo facial)\b/],
  ['Limpeza', /\b(detergente|desinfetante|agua sanitaria|sanitaria|multiuso|limpador|cera|removedor|tira.?graxa|sabao|amaciante|alvejante|esponja|fibra|pano|flanela|saco para lixo|saco de lixo|lixo|odorizador|aromatizador|desengordurante|limpa|lustra|cloro|disco removedor|wypall)\b/],
  ['Copa & Alimentos', /\b(acucar|cafe|cha|biscoito|bolacha|leite|achocolatado|adocante|margarina|manteiga|cocada|feijao|arroz|oleo|sal|extrato|molho|suco|agua de coco|agua mineral|refrigerante|bala|chocolate|tempero|farinha|macarrao|filtro de papel|capsula)\b/],
  ['Descartáveis', /\b(copo|prato|talher|garfo|faca|colher|bandeja|marmitex|pote|tampa|canudo|mexedor|guardanapo|toalha de mesa|hamburgueira|embalagem para hamburguer|isopor|aluminio|forma|cumbuca|tigela)\b/],
  ['Papelaria', /\b(papel sulfite|sulfite|caneta|lapis|borracha|grampo|grampeador|clips|pasta|caderno|bloco|post.?it|bobina termica|toner|cartucho|envelope|cola|tesoura|regua|marcador)\b/],
  ['Embalagens', /\b(saco|sacola|bobina|filme|plastico bolha|papel ondulado|papel kraft|fita|fecho|caixa de papelao|envelope|etiqueta|stretch|lacre|sacos? plastico)\b/],
];

/** Categoria pelo nome (sem acentos); "Outros" quando nada bate. */
export function categoriaPeloNome(nome) {
  const s = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  for (const [cat, re] of REGRAS) if (re.test(s)) return cat;
  return 'Outros';
}
