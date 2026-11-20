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
    ['DIVISOES', 'Divisões'], ['CRIST', 'Cristal'], ['DEPOSITO', 'Depósito'], ['NESTLE', 'Nestlé'], ['YPE', 'Ypê'], ['ATACADAO', 'Atacadão'], ['LIMAO', 'Limão'], ['MACA', 'Maçã'], ['PRATICO', 'Prático'], ['ECONOMICO', 'Econômico'], ['MAQUINA', 'Máquina'], ['AGUA', 'Água'], ['LAMINA', 'Lâmina'], ['ORGANICA', 'Orgânica'], ['GENERICO', 'Genérico'], ['ANTIDERRAPANTE', 'Antiderrapante'], ['ESPATULA', 'Espátula'], ['PLASTICOS', 'Plásticos'], ['PAPELAO', 'Papelão'], ['ALGODAO', 'Algodão'], ['TECNICO', 'Técnico'], ['ELETRICO', 'Elétrico'], ['HIGIENICA', 'Higiênica'], ['CERAMICA', 'Cerâmica'], ['METALICO', 'Metálico'], ['FEIJAO', 'Feijão'], ['ORGANICO', 'Orgânico'], ['ACIDO', 'Ácido'], ['ANTISSEPTICO', 'Antisséptico'],
  ].map(([w, por]) => [ab(w), `$1${por}`]),
  [/\bTAM\.?\s+/gi, 'Tam. '], [/\bMIC(?:\.\s*|\s+)(?=\S)/gi, 'Mic. '],
]
const EMBALAGENS = { CX: 'Caixa', PC: 'Pacote', PCT: 'Pacote', FD: 'Fardo', RL: 'Rolo', GL: 'Galão', FR: 'Frasco', UN: 'Unidade', DZ: 'Dúzia', CT: 'Cartela', BD: 'Balde', SC: 'Saco' };

function palavra(w, primeira) {
  if (!w) return w;
  const limpa = w.replace(/[^A-Za-zÀ-ú0-9]/g, '');
  const up = limpa.toUpperCase();
  // Medidas: 500ML → 500ml, 5L → 5L, 1KG → 1kg, 30M → 30m, 10X20CM → 10x20cm
  // Código/modelo com letras e números (GO918, PS103, X50, T-200): mantém em maiúsculas.
  if (/[A-Za-z]/.test(limpa) && /\d/.test(limpa) && !/^\d+(ML|L|LT|LTS|KG|G|GR|GRS|MM|CM|M|MTS|UN|X\d+.*)$/i.test(limpa)) return w.toUpperCase();
  if (/^\d/.test(limpa)) {
    return w.replace(/(\d)\s*GRS?\b/gi, '$1g').replace(/(\d)\s*LTS?\b/gi, '$1L').replace(/(\d)\s*MTS\b/gi, '$1m').replace(/(\d)\s*X\s*(?=\d)/gi, '$1x').replace(/ML\b/gi, 'ml').replace(/KG\b/gi, 'kg').replace(/(\d)G\b/gi, '$1g')
      .replace(/MM\b/gi, 'mm').replace(/CM\b/gi, 'cm').replace(/(\d)M\b/gi, '$1m').replace(/(\d)L\b/gi, '$1L').replace(/(\d)UN\b/gi, '$1 un');
  }
  if (SIGLAS.has(up) && limpa.length <= 4 && !primeira) return w.toUpperCase();
  const lower = w.toLowerCase();
  if (!primeira && MINUSCULAS.has(lower)) return lower;
  return lower.replace(/(^|[-/(])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase());
}

/** Nome do G360 (geralmente em MAIÚSCULAS) → nome de e-commerce. */
const SEM_MARCA = /^(nao ?informad[oa]|sem marca|diversos?|generic[oa]|n\/?a|-+)$/i;

export function nomeEcommerce(nomeG360, marca = '') {
  let s = String(nomeG360 || '').replace(/\s+/g, ' ').trim()
    .replace(/^\*+\s*/, '').replace(/^INATIVO\b\s*[-:]?\s*/i, '')            // marcas internas do cadastro
    .replace(/AC\*CAR/gi, 'AÇÚCAR').replace(/\*/g, '')                         // caractere perdido no G360
    .replace(/(\d)\s+(KG|GRS?|ML|LTS?|MM|CM)\b/gi, '$1$2');                      // "2 KG" → "2KG" (vira 2kg)
  if (!s) return s;
  // Já está em caixa mista: só arruma espaços.
  const temMinuscula = /[a-zà-ú]/.test(s);
  // Quantidade da embalagem: "C/100", "CX C/ 12", "PCT 50UN", "C/ 1000 FLS"
  let emb = '';
  s = s.replace(/\b(CX|PC|PCT|FD|RL|GL|FR|DZ|CT|BD|SC)?\s*C\/\s*(\d[\d.]*)\s*(UN|UND|UNID|FLS|FOLHAS|ROLOS|RL|PCT|PC|CJ|[A-Z]{1,3})?\b\.?/i, (m, tipo, n, und) => {
    const t = EMBALAGENS[(tipo || '').toUpperCase()] || 'Pacote';
    const U = (und || '').toUpperCase();
    const u = /^F/.test(U) ? 'folhas' : /^R/.test(U) ? 'rolos' : /^P/.test(U) ? 'pacotes' : U === 'CJ' ? 'conjuntos' : 'un';
    emb = `(${t} c/ ${Number(n.replace(/\./g, '')).toLocaleString('pt-BR')} ${u})`;
    return ' ';
  });
  // Marca: sai do meio do nome e vai para o fim (antes de trocar abreviações e acentos).
  let m = temMinuscula ? '' : String(marca || '').trim(); // nome em caixa mista já foi revisado: não mexe
  if (SEM_MARCA.test(m.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) m = '';
  s = s.replace(/\bN[AÃ]O\s?INFORMAD[OA]\b/gi, ' ');
  if (m) s = s.replace(new RegExp(`(^|\\s)${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i'), ' ');
  let marcaFmt = '';
  if (m && !/[a-zà-ú]/.test(m)) { let t = ` ${m} `; for (const [re, por] of ABREV) t = t.replace(re, por); marcaFmt = t.trim().split(/\s+/).map((w) => (/^[A-Z]{1,3}$/.test(w) ? w : palavra(w, true))).join(' '); }
  else marcaFmt = m;
  if (!temMinuscula) for (const [re, por] of ABREV) s = s.replace(re, por);
  s = s.replace(/\s+/g, ' ').trim();
  const corpo = temMinuscula ? s : s.split(' ').map((w, i) => palavra(w, i === 0)).join(' ');
  return [corpo, emb, marcaFmt].filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(/\s+([,)])/g, '$1').trim().slice(0, 160);
}

// Palavras → categoria. Cada entrada é um começo de palavra (sem acento, minúsculas); "a b" exige as duas em sequência.
// A primeira palavra do nome decide primeiro (é o tipo do produto); se ela não decidir, vale qualquer palavra, na ordem das regras.
export const REGRAS_CATEGORIA = [
  ['Higiene', ['papel hig', 'lenco', 'lencol hospitalar', 'escova p unhas', 'escova para unhas', 'escova de unhas', 'papel higienico', 'pap hig', 'papel toalha', 'toalha interf', 'toalha bobina', 'sabonete', 'sabon', 'alcool', 'alc gel', 'fralda', 'lenco umedecido', 'lenco de papel', 'absorvente', 'creme dental', 'escova dental', 'shampoo', 'condicionador', 'hidratante', 'desodorante', 'cotonete', 'hastes flexiveis', 'algodao', 'protetor solar', 'bloqueador solar', 'repelente', 'aparelho de barbear', 'lamina de barbear', 'preservativo', 'curativo', 'band aid', 'atadura', 'esparadrapo', 'gaze', 'termometro', 'mascara cirurgica', 'higienizador', 'antisseptico', 'assento sanitario', 'protetor de assento', 'cosmetic', 'perfume', 'colonia', 'talco', 'mamadeira', 'chupeta']],
  ['Limpeza', ['pa', 'kit pano', 'puro ar', 'pneu pretinho', 'pneu preto', 'pedrex', 'npf', 'alcalino', 'escova', 'aplicador de cera', 'cabo vassoura', 'cabo de vassoura', 'cabo p vassoura', 'cabo para vassoura', 'cabo rodo', 'cabo de rodo', 'cabo mop', 'cabo para mop', 'cabo de mop', 'cabo madeira', 'cabo aluminio', 'cabo aluminio', 'kit limpeza', 'kit de limpeza', 'refil mop', 'detergente', 'deterg', 'desinfetante', 'desinf', 'agua sanitaria', 'sanitaria', 'hipoclorito', 'cloro', 'multiuso', 'multi uso', 'limpador', 'limpa', 'limp', 'cera', 'removedor', 'remov', 'tira graxa', 'desengraxante', 'desengordurante', 'desincrustante', 'descalcificante', 'sabao', 'lava roupa', 'lava louca', 'amaciante', 'alvejante', 'esponja', 'fibra', 'pano', 'panos', 'flanela', 'saco para lixo', 'saco p lixo', 'saco lixo', 'saco de lixo', 'lix', 'odorizador', 'aromatizador', 'desodorizador', 'neutralizador', 'neutraliz', 'difusor', 'essencia', 'bom ar', 'lustra', 'brilha', 'polidor', 'disco', 'wypall', 'inseticida', 'inset', 'raticida', 'formicida', 'cupim', 'naftalina', 'desentupidor', 'soda caustica', 'acido', 'rodo', 'rodinho', 'vassoura', 'mop', 'esfregao', 'pa de lixo', 'pa lixo', 'balde', 'pedra sanitaria', 'pastilha sanitaria', 'pastilha adesiva', 'refil mop', 'escova sanitaria', 'limpa vidro', 'saponaceo', 'palha de aco', 'la de aco', 'enceradeira', 'lavadora']],
  ['Copa & Alimentos', ['mistura lactea', 'leite condensado', 'condensado', 'frango', 'carne', 'linguica', 'salsicha', 'peixe', 'hamburguer', 'coracao frango', 'acucar', 'cafe', 'cha', 'mate', 'camomila', 'cappuccino', 'achocolatado', 'chocolate', 'choco', 'leite', 'creme de leite', 'iogurte', 'iorgute', 'adocante', 'margarina', 'manteiga', 'requeijao', 'queijo', 'presunto', 'apresuntado', 'bacon', 'nugget', 'biscoito', 'bolacha', 'rosquinha', 'wafer', 'torrada', 'pao', 'bisnaguinha', 'bolinho', 'panetone', 'cocada', 'pacoca', 'pacoquita', 'doce', 'bombom', 'bomb', 'bala', 'drops', 'pirulito', 'chiclete', 'chicle', 'goma', 'barra de cereal', 'barrinha', 'granola', 'gelatina', 'pudim', 'refresco', 'suco', 'nectar', 'refrigerante', 'refrig', 'agua mineral', 'agua de coco', 'agua com gas', 'agua sem gas', 'agua', 'acqua', 'energetico', 'bebida', 'beb', 'feijao', 'arroz', 'macarrao', 'massa', 'oleo', 'azeite', 'azeitona', 'vinagre', 'sal', 'extrato', 'molho', 'ketchup', 'maionese', 'mostarda', 'tempero', 'caldo', 'canela', 'pimenta', 'curry', 'chimichurri', 'manjericao', 'oregano', 'farinha', 'far ', 'fuba', 'amido', 'fermento', 'milho', 'canjica', 'canjiquinha', 'flocao', 'aveia', 'mucilon', 'ervilha', 'batata', 'salgadinho', 'baconzitos', 'pipoca', 'amendoim', 'castanha', 'frutas', 'coco', 'geleia', 'mel', 'cacau', 'proteina', 'filtro de papel', 'filtro para cafe', 'capsula', 'racao', 'gelo', 'coxinha', 'salgado', 'cereal']],
  ['Descartáveis', ['kit sobremesa', 'kit de garfo', 'kit talher', 'kit refeicao', 'kit descartavel', 'copo', 'prato', 'talher', 'garfo', 'garfos', 'faca descartavel', 'faca desc', 'colher descartavel', 'colher desc', 'colher', 'bandeja', 'marmitex', 'marmita', 'marmiteiro', 'pote', 'potes', 'potiche', 'tampa', 'canudo', 'canudinho', 'mexedor', 'palito', 'espeto', 'guardanapo', 'toalha de mesa', 'hamburgueira', 'hamburguera', 'embalagem para hamburguer', 'isopor', 'forma de aluminio', 'forminha', 'cumbuca', 'tigela', 'oriental', 'luva plastica', 'touca descartavel', 'avental descartavel', 'pazinhas', 'cone', 'molheira', 'frangueira', 'embalagem descartavel', 'emb descartavel']],
  ['Embalagens', ['embalagem', 'emb', 'embalagens', 'saco', 'sacos', 'sacola', 'bobina', 'bob', 'filme', 'plastico bolha', 'papel ondulado', 'papel kraft', 'papel pardo', 'fita adesiva', 'fita', 'fitilho', 'fecho', 'caixa de papelao', 'caixa papelao', 'caixa', 'caixas', 'stretch', 'lacre', 'barbante', 'liga', 'container', 'contentor', 'plastico', 'lona', 'papel manteiga', 'papel aluminio', 'papel filme', 'papel seda']],
  ['Papelaria', ['marca texto', 'envelope', 'etiqueta', 'etiquetas', 'etiq', 'elastico', 'caixa para corresp', 'caixa correspondencia', 'caixa de correspondencia', 'porta clips', 'papel sulfite', 'sulfite', 'papel a4', 'papel couche', 'couche', 'papel', 'caneta', 'lapis', 'ecolapis', 'lapiseira', 'grafite', 'borracha', 'apontador', 'grampo', 'grampeador', 'clips', 'clipes', 'pasta', 'arquivo', 'fichario', 'ficha', 'caderno', 'bloco', 'post it', 'notas', 'agenda', 'calendario', 'livro', 'album', 'cola', 'tesoura', 'regua', 'marcador', 'pincel', 'corretivo', 'estilete', 'lamina', 'prancheta', 'perfurador', 'furador', 'extrator', 'alfinete', 'alfinetes', 'percevejo', 'carimbo', 'almofada', 'tinta', 'toner', 'cartucho', 'bobina termica', 'calculadora', 'quadro', 'apagador', 'giz', 'placa', 'recibo', 'impresso', 'formulario', 'livro caixa', 'plastificadora', 'organizador de mesa', 'porta lapis', 'porta canetas', 'estojo', 'mochila', 'gizao', 'massinha', 'massa de modelar', 'eva', 'artesanato', 'colorifico', 'tinta guache', 'cartolina', 'papel cartao', 'cartao', 'crachá', 'cracha', 'prendedor de papel']],
  ['Eletrônicos & Informática', ['refil de tinta', 'refil tinta', 'tinta epson', 'tinta hp', 'cabo usb', 'cabo hdmi', 'cabo audio', 'cabo de rede', 'cabo rede', 'cabo p2', 'cabo de forca', 'cabo forca', 'cabo energia', 'cabo vga', 'cabo celular', 'cabo de dados', 'pilha', 'bateria', 'carregador', 'adaptador', 'extensao', 'filtro de linha', 'estabilizador', 'mouse', 'teclado', 'fone', 'headset', 'pen drive', 'pen', 'hd', 'cd', 'dvd', 'disquete', 'impressora', 'webcam', 'caixa de som', 'lampada', 'lanterna', 'plugue', 'tomada', 'interruptor', 'controle', 'relogio', 'cronometro', 'balanca', 'conversor', 'infrared', 'contator', 'eletrodo', 'calculadora cientifica']],
  ['Utilidades Domésticas', ['caixa organizadora', 'caixa organizador', 'caixa conserv', 'caixa termica', 'caixa de ferramentas', 'picador', 'cortador', 'espremedor', 'jogo americano', 'jogo de panela', 'jogo de copos', 'jogo de talheres', 'jogo de facas', 'jogo de xicaras', 'garrafa', 'garrafao', 'garrafa termica', 'jarra', 'caneca', 'canecao', 'xicara', 'copo de vidro', 'taca', 'bule', 'chaleira', 'cafeteira', 'ebulidor', 'liquidificador', 'processador', 'microondas', 'panela', 'frigideira', 'assadeira', 'escorredor', 'descascador', 'abridor', 'ralador', 'concha', 'espatula', 'peneira', 'tabua', 'organizador', 'gaveta', 'cesto', 'cesta', 'bacia', 'porta', 'prateleira', 'estrado', 'cabide', 'prendedor', 'prendedores', 'varal', 'lencol', 'toalha de banho', 'toalha de rosto', 'cortina', 'tapete', 'capacho', 'almofada decorativa', 'vaso', 'moldura', 'mesa', 'cadeira', 'banco', 'escada', 'mangueira', 'regador', 'isqueiro', 'fosforo', 'acendedor', 'vela', 'ventilador', 'aquecedor', 'desumidificador', 'purificador', 'filtro de agua', 'filtro', 'refil', 'reservatorio', 'cadeado', 'fechadura', 'dobradica', 'gancho', 'suporte', 'kit', 'jogo de', 'conjunto', 'pote hermetico', 'marmita termica', 'bolsa termica', 'lancheira']],
  ['Festas & Brinquedos', ['balao', 'bexiga', 'vela de aniversario', 'chapeu', 'lingua de sogra', 'apito', 'serpentina', 'confete', 'brinquedo', 'boneco', 'boneca', 'bola', 'quebra cabeca', 'domino', 'baralho', 'dado', 'jogo', 'pula pula', 'piscina', 'girafas', 'carrinho', 'pelucia', 'amiguinho', 'brastoy', 'micanga', 'pulseira', 'artigo de festa', 'decoracao']],
  ['Utensílios & EPI', ['carrinho portatil', 'carrinho carga', 'carrinho de carga', 'carrinho servico', 'carrinho de servico', 'carrinho de compras', 'reservatorio para sabonete', 'reservatorio para saboneteira', 'placa sinalizacao', 'placa de sinalizacao', 'placa piso', 'placa cuidado', 'porta papel', 'porta sabonete', 'porta copo', 'porta copos', 'porta toalha', 'luva', 'mascara', 'oculos', 'avental', 'touca', 'bota', 'botina', 'protetor auricular', 'capacete', 'colete', 'cinto', 'lixeira', 'coletor', 'carro funcional', 'carro de limpeza', 'carrinho de limpeza', 'balde espremedor', 'dispenser', 'saboneteira', 'toalheiro', 'papeleira', 'espanador', 'pulverizador', 'borrifador', 'pisseta', 'otoscopio', 'especulo', 'placa de sinalizacao', 'cavalete', 'cone de sinalizacao', 'fita zebrada', 'extintor', 'abracadeira', 'cabo para', 'cabo de', 'cabo extensor', 'extensor', 'haste', 'hastes', 'mola', 'roda', 'rodizios', 'eixo', 'pneu', 'lixa', 'corda', 'lona plastica', 'ferramenta', 'chave', 'alicate', 'martelo', 'trena', 'parafuso', 'prego', 'silicone', 'rejunte', 'massa corrida', 'tinta parede', 'rolo de pintura', 'trincha', 'pincel para pintura', 'pinta', 'defletor', 'exaustor', 'ralo', 'pia', 'flotador', 'engate', 'anilha', 'tubo', 'conexao', 'registro', 'torneira']],
];

const _norm = (t) => ` ${String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const _bate = (texto, chave) => texto.includes(` ${chave}`) && new RegExp(` ${chave.replace(/ /g, ' ')}`).test(texto);

/** Categoria pelo nome; "Outros" quando nada bate. Usa o nome do G360 e o do portal. */
export function categoriaPeloNome(...nomes) {
  const t = _norm(nomes.filter(Boolean).join(' | '));
  const primeira = t.trim().split(' ')[0] || '';
  // 1) Tipo do produto = primeira palavra (ex.: "PAPEL TOALHA ..." → Higiene; "CABO VASSOURA" → regra de duas palavras).
  for (const [cat, chaves] of REGRAS_CATEGORIA) {
    for (const c of chaves) if (c.includes(' ') && t.startsWith(` ${c} `)) return cat;
  }
  for (const [cat, chaves] of REGRAS_CATEGORIA) {
    for (const c of chaves) if (!c.includes(' ') && primeira === c) return cat;
  }
  for (const [cat, chaves] of REGRAS_CATEGORIA) {
    for (const c of chaves) if (!c.includes(' ') && c.length >= 4 && primeira.startsWith(c)) return cat;
  }
  // 2) Qualquer trecho do nome, na ordem das regras.
  for (const [cat, chaves] of REGRAS_CATEGORIA) {
    for (const c of chaves) if (c.length >= 3 && _bate(t, c)) return cat;
  }
  return 'Outros';
}
