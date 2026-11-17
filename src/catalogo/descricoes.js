/* =====================================================================
   Descrição e características do produto no portal (janela de detalhes).
   Ordem da descrição: a escrita pela equipe (Supabase) > a do portal antigo
   (158 produtos, descricoes-legado.json) > a "aplicação" do G360 > uma
   descrição básica gerada pelo tipo do produto (pelo nome).
   As características (medida, embalagem) saem do nome do produto.
   ===================================================================== */
import LEGADO from './descricoes-legado.json';

const sem = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* Tipo do produto (início ou trecho do nome) -> descrição básica. A primeira regra que casar vale. */
const REGRAS = [
  [/^saco (a )?vacuo/, 'Saco para embalagem a vácuo, que conserva alimentos por mais tempo e evita contaminação. Indicado para açougues, frigoríficos, cozinhas industriais e restaurantes.'],
  [/^saco.*(lixo|preto|azul|verde|vermelho|cinza|marrom)|^saco p\/ lixo|saco de lixo/, 'Saco para lixo resistente para o descarte do dia a dia em empresas, cozinhas industriais, condomínios, escritórios e áreas comuns. Prático para trocar e fácil de armazenar.'],
  [/^saco.*(kraft|papel)/, 'Saco de papel para embalar pães, lanches e produtos em padarias, lanchonetes e comércio em geral.'],
  [/^saco.*(zip|hermetico)/, 'Saco com fecho para armazenar, organizar e proteger alimentos e pequenos objetos.'],
  [/^saco/, 'Saco plástico para embalar alimentos, peças e produtos no comércio e na indústria.'],
  [/^sacola/, 'Sacola plástica resistente para embalar compras em supermercados, lojas, padarias e farmácias.'],
  [/^bobina.*(termic|pdv|cupom)|bobina termica/, 'Bobina de papel térmico para impressoras de cupom, PDVs, maquininhas e balanças.'],
  [/^bobina.*picot|^bob\b/, 'Bobina de sacos picotados para embalar unidades de forma rápida e higiênica em padarias, açougues, hortifrutis e indústrias.'],
  [/^bobina/, 'Bobina para embalagem de produtos no comércio, na indústria e na expedição.'],
  [/^filme.*(pvc|alimento)/, 'Filme PVC esticável para envolver e conservar alimentos em cozinhas industriais, restaurantes, padarias e açougues.'],
  [/^filme.*stretch|^filme/, 'Filme stretch para envolver, unitizar e proteger cargas e paletes no transporte e na armazenagem.'],
  [/^plastico bolha/, 'Plástico bolha para proteger produtos contra impactos no transporte, na armazenagem e em mudanças.'],
  [/^fita (adesiva|crepe|empacotamento|transparente|marrom)|^fita/, 'Fita adesiva para fechar caixas, embalar, fixar e organizar no escritório, no comércio e na expedição.'],
  [/^papel (higienico|hig)/, 'Papel higiênico para banheiros de empresas, condomínios, escolas e estabelecimentos comerciais.'],
  [/^papel toalha.*(interf|20x|23x)|^papel toalha interfolh/, 'Papel toalha interfolhado para dispensers de banheiros e cozinhas, que libera uma folha por vez e evita desperdício.'],
  [/^papel toalha.*bobina|^papel toalha.*rolo/, 'Papel toalha em rolo para dispensers e cozinhas, para secagem das mãos e limpeza rápida.'],
  [/^papel toalha/, 'Papel toalha para secagem das mãos e limpeza rápida em banheiros, cozinhas e copas.'],
  [/^papel.*(sulfite|a4|oficio)/, 'Papel para impressões, cópias e o uso diário do escritório.'],
  [/^papel.*(kraft|semi kraft|manilha)/, 'Papel para embrulhar, embalar e proteger produtos no comércio.'],
  [/^papel.*(aluminio)/, 'Papel alumínio para cobrir, assar e conservar alimentos em cozinhas, restaurantes e delivery.'],
  [/^papel.*(manteiga|vegetal)/, 'Papel para forrar assadeiras e embalar alimentos em padarias e confeitarias.'],
  [/^papel/, 'Papel para uso em escritório, comércio e atividades do dia a dia.'],
  [/^guardanapo/, 'Guardanapo de papel macio e absorvente para restaurantes, lanchonetes, padarias e copas.'],
  [/^lenco/, 'Lenço de papel macio para uso pessoal em recepções, escritórios e consultórios.'],
  [/^lixeira|^cesto|^contentor/, 'Lixeira para organização e descarte de resíduos em escritórios, cozinhas, banheiros e áreas comuns.'],
  [/^luva.*(nitril)/, 'Luva nitrílica descartável para manipulação de alimentos, limpeza e tarefas que exigem proteção das mãos.'],
  [/^luva.*(latex|vinil|procedimento)/, 'Luva descartável para manipulação, limpeza e tarefas que exigem proteção das mãos.'],
  [/^luva.*(plastic|descart|pebd)/, 'Luva plástica descartável para manipular alimentos com higiene em padarias, lanchonetes e cozinhas.'],
  [/^luva.*(limpeza|borracha|multiuso)/, 'Luva de borracha para limpeza, lavagem de louças e uso de produtos químicos de limpeza.'],
  [/^luva/, 'Luva de proteção para trabalhos manuais, manutenção e manuseio de materiais.'],
  [/^pano.*(multiuso|rolo|picot)|^pano.*wypall|wypall/, 'Pano multiuso resistente e absorvente para limpeza de superfícies em cozinhas, restaurantes e áreas de produção.'],
  [/^pano.*(chao|alvejado|saco)/, 'Pano de algodão para limpeza de pisos e superfícies.'],
  [/^pano.*(prato|copa)/, 'Pano de prato para secar louças e utensílios na copa e na cozinha.'],
  [/^pano/, 'Pano de limpeza para superfícies, móveis e utensílios.'],
  [/^flanela/, 'Flanela macia para tirar o pó e dar acabamento na limpeza de móveis, vidros e superfícies.'],
  [/^copo.*(isopor|termic)/, 'Copo de isopor que conserva a temperatura de bebidas quentes, como café e chá. Ideal para recepções, escritórios e eventos.'],
  [/^copo.*papel/, 'Copo de papel descartável para café, chá e bebidas em escritórios, cafeterias e eventos.'],
  [/^copo.*(vidro|acrilic|long drink)/, 'Copo para servir bebidas em bares, restaurantes, copas e eventos.'],
  [/^copo/, 'Copo descartável para água, sucos, refrigerantes e outras bebidas. Indicado para restaurantes, lanchonetes, escritórios, eventos e festas.'],
  [/^(prato).*(isopor|descart|plastic)|^prato/, 'Prato descartável para refeições e lanches em restaurantes, eventos, festas e confraternizações.'],
  [/^(garfo|faca|colher).*(descart|plastic|refeic|sobremesa|forte)/, 'Talher descartável resistente para refeições em restaurantes, lanchonetes, delivery e eventos.'],
  [/^faca|^garfo|^colher/, 'Talher para refeições e preparo de alimentos em cozinhas, restaurantes e copas.'],
  [/^canudo/, 'Canudo para servir sucos, refrigerantes e outras bebidas em lanchonetes, bares e eventos.'],
  [/^mexedor/, 'Mexedor descartável para café e chá em copas, escritórios, cafeterias e recepções.'],
  [/^(pote|cumbuca)/, 'Pote descartável para porcionar, armazenar e entregar alimentos, molhos e sobremesas.'],
  [/^(marmitex|marmita|base marmitex)/, 'Marmitex para embalar e entregar refeições, ideal para restaurantes, delivery e marmitarias.'],
  [/^(hamburgueira|embalagem.*(hamburg|lanche))/, 'Embalagem para hambúrguer e lanches, que conserva a temperatura e facilita o delivery.'],
  [/^bandeja.*aluminio|^forma.*aluminio|^forma/, 'Embalagem de alumínio para assar, congelar, transportar e vender refeições e sobremesas.'],
  [/^bandeja/, 'Bandeja para exposição e embalagem de alimentos em padarias, açougues, hortifrutis e supermercados.'],
  [/^tampa.*(pote|marmit|copo|bandeja)/, 'Tampa para fechar a embalagem e proteger o alimento no transporte e no delivery.'],
  [/^tampa/, 'Tampa de reposição compatível com o modelo indicado no nome.'],
  [/^embalagem/, 'Embalagem para acondicionar e apresentar alimentos e produtos no comércio.'],
  [/^caixa.*(papelao|arquivo|correio|ondulad)/, 'Caixa de papelão para envio, armazenagem e organização de produtos e documentos.'],
  [/^caixa.*(organizador|plastic|bin)|^organizador|^gaveta/, 'Caixa organizadora para guardar e separar materiais em estoques, escritórios e áreas de serviço.'],
  [/^caixa/, 'Caixa para armazenar, organizar e transportar produtos.'],
  [/^arquivo/, 'Arquivo para guardar e organizar documentos no escritório.'],
  [/^detergente.*(acido|alcalin|automotiv|desengordur)/, 'Detergente profissional para limpeza pesada, remoção de gordura e sujeiras difíceis.'],
  [/^detergente/, 'Detergente para lavar louças, utensílios e superfícies, que remove gordura e sujeira do dia a dia.'],
  [/^desinfetante|^lysoform/, 'Desinfetante para limpeza de pisos, banheiros e áreas comuns, que deixa o ambiente limpo e perfumado.'],
  [/^(agua sanitaria|alvejante|cloro|hipoclorito)/, 'Água sanitária para limpar, alvejar e higienizar pisos, banheiros, cozinhas e roupas brancas.'],
  [/^(limpador|limpa|multiuso)/, 'Limpador para limpeza de pisos, banheiros e superfícies laváveis.'],
  [/^(sabao|lava roupa|amaciante)/, 'Produto para lavagem de roupas, panos e uniformes.'],
  [/^sabonete/, 'Sabonete para higienização das mãos em banheiros de empresas, escolas, clínicas e estabelecimentos comerciais.'],
  [/^(alcool)/, 'Álcool para limpeza e higienização de superfícies e das mãos, conforme indicação do rótulo.'],
  [/^(cera(?! \d)|impermeabilizante)/, 'Cera para conservar e dar brilho a pisos, protegendo contra o desgaste do tráfego.'],
  [/^(removedor|disco)/, 'Produto para remoção de ceras e limpeza pesada de pisos.'],
  [/^(odorizador|desodorizador|aromatizador|bom ar|glade)/, 'Odorizador de ambientes que perfuma e neutraliza odores em banheiros, salas e recepções.'],
  [/^(lustra|polidor)/, 'Lustra-móveis para limpar e dar brilho a móveis e superfícies de madeira.'],
  [/^(inseticida|repelente)/, 'Inseticida para controle de insetos em casas, escritórios e estabelecimentos, conforme indicação do rótulo.'],
  [/^(esponja|fibra|palha de aco|la de aco)/, 'Esponja e fibra de limpeza para remoção de sujeira em louças, panelas e superfícies.'],
  [/^escova.*(unha|dente|cabelo|banho)/, 'Escova para higiene e cuidados pessoais.'],
  [/^(rodo|vassoura|escova|espanador|pa\b|mop|refil.*mop|cabo.*(madeira|aluminio|rosca|vassoura|rodo|plastific|telescop|extensor)|cabo de madeira)/, 'Utensílio de limpeza para a rotina de conservação de pisos e ambientes.'],
  [/^(balde|carro|carrinho|suporte|dispenser|porta (papel|sabonete|copo))/, 'Acessório para organizar e agilizar a limpeza e a reposição em banheiros, copas e áreas de serviço.'],
  [/^(borrifador|pulverizador)/, 'Borrifador para aplicar produtos de limpeza com economia e praticidade.'],
  [/^(touca|mascara|avental|bota|oculos|protetor|capacete|colete|uniforme|jaleco)/, 'Equipamento de proteção para o trabalho em cozinhas, indústrias, clínicas e serviços de limpeza.'],
  [/^(cafe|capsula)/, 'Café para a copa da empresa, escritórios, recepções e cafeterias.'],
  [/^(acucar|adocante)/, 'Adoçante e açúcar para copa, cozinha e preparo de alimentos e bebidas.'],
  [/^(cha)\b/, 'Chá para servir na copa, em recepções e cafeterias.'],
  [/^(achocolatado|leite|cappuccino)/, 'Bebida e ingrediente para copa, cafés da manhã e preparo de alimentos.'],
  [/^(biscoito|bolacha|torrada|bolinho|barra|wafer)/, 'Biscoito e lanche para servir com café em empresas, hotéis, coffee breaks e recepções.'],
  [/^(bala|bombom|chocolate|pirulito|chiclete|doce|pacoca|cocada|geleia|pudim|gelatina)/, 'Doce para revenda, sobremesas, festas e confraternizações.'],
  [/^(suco|nectar|refresco|refrigerante|refrig|agua)/, 'Bebida para servir em copas, refeitórios, lanchonetes e eventos.'],
  [/^(arroz|feijao|macarrao|oleo de soja|sal|farinha|extrato|molho|tempero|creme|margarina|manteiga|maionese|ketchup|mostarda|pimenta)/, 'Alimento para cozinhas industriais, restaurantes e o dia a dia da copa.'],
  [/^(caneta|lapis|lapiseira|marcador|marca texto|pincel|grafite|corretivo|borracha|apontador|reabastecedor)/, 'Material de escrita para o escritório, a escola e o dia a dia.'],
  [/^(caderno|bloco|livro|agenda|envelope|etiqueta|pasta|clips|grampo|grampeador|perfurador|tesoura|cola|regua|elastico|percevejo|alfinete|quadro|almofada|carimbo|calculadora|espiral)/, 'Material de escritório para organizar, arquivar e facilitar a rotina de trabalho.'],
  [/^(tinta (guache|acrilica|pva|para tecido)|massa para modelar)/, 'Material escolar e de artesanato para atividades, pintura e trabalhos manuais.'],
  [/^tinta para carimbo/, 'Tinta para recarregar almofadas de carimbo.'],
  [/^(tinta|refil de tinta|cartucho(?! gas)|toner|ribbon|cera \d)/, 'Suprimento de impressão compatível com o modelo indicado no nome.'],
  [/^(pilha|bateria)/, 'Pilha e bateria para controles, aparelhos e equipamentos do dia a dia.'],
  [/^(mouse|teclado|cabo|carregador|fone|pen ?drive|hd|adaptador|hub|lampada|extensao|filtro de linha)/, 'Acessório de informática e eletrônica para o escritório.'],
  [/^(balao|vela|kit festa|chapeu|lingua de sogra|confete)/, 'Artigo para festas, aniversários e decoração de eventos.'],
  [/^(fralda|absorvente|lencol)/, 'Produto de higiene e cuidado pessoal.'],
  [/^(garrafa|jarra|bule|caneca|xicara|travessa|bacia|escorredor|assadeira|panela|tabua)/, 'Utensílio para copa e cozinha de empresas, restaurantes e residências.'],
  [/^(placa)/, 'Placa de sinalização para orientar e alertar em empresas, condomínios e áreas comuns.'],
  [/^(lacre)/, 'Lacre para fechar e garantir a inviolabilidade de sacos, malotes e embalagens.'],
  [/^(fosforo|isqueiro)/, 'Fósforo e isqueiro para cozinhas e uso geral.'],
  [/^kit/, 'Kit com itens reunidos para facilitar a compra e o uso no dia a dia.'],
];

const POR_CATEGORIA = {
  'Limpeza': 'Produto de limpeza para a conservação de ambientes em empresas, condomínios e estabelecimentos comerciais.',
  'Copa & Alimentos': 'Item de copa e alimentação para empresas, restaurantes e estabelecimentos comerciais.',
  'Descartáveis': 'Descartável prático para servir, embalar e entregar em restaurantes, lanchonetes, delivery e eventos.',
  'Embalagens': 'Embalagem para acondicionar, proteger e transportar produtos no comércio e na indústria.',
  'Papelaria': 'Material de papelaria e escritório para a rotina de trabalho.',
  'Higiene': 'Produto de higiene para banheiros e cuidados pessoais em empresas e estabelecimentos.',
  'Utensílios & EPI': 'Utensílio e equipamento de proteção para o trabalho do dia a dia.',
  'Utilidades Domésticas': 'Utilidade doméstica para organização e uso diário em casas, empresas e cozinhas.',
  'Eletrônicos & Informática': 'Acessório de eletrônica e informática para o escritório.',
  'Festas & Brinquedos': 'Artigo para festas, eventos e decoração.',
};

/** Descrição básica pelo tipo do produto (nome do portal ou do G360) e pela categoria. */
export function descricaoBasica(nome, categoria, nomeG360) {
  for (const n of [nome, nomeG360]) {
    const t = sem(n);
    if (!t) continue;
    const r = REGRAS.find(([re]) => re.test(t));
    if (r) return r[1];
  }
  return POR_CATEGORIA[categoria] || 'Produto do catálogo da Souza Ribeiro. Para dúvidas sobre aplicação e especificações, fale com o seu vendedor.';
}

const UNIDADES = { UN: 'Unidade', UND: 'Unidade', PC: 'Pacote', PCT: 'Pacote', CX: 'Caixa', FD: 'Fardo', RL: 'Rolo', KG: 'Quilo', GL: 'Galão', PR: 'Par', BB: 'Bobina', LT: 'Litro', DZ: 'Dúzia', RS: 'Resma', CT: 'Cartela', FR: 'Frasco', SC: 'Saco', MT: 'Metro', M: 'Metro', BD: 'Balde', KIT: 'Kit', JG: 'Jogo', TB: 'Tubo', BL: 'Bloco', ML: 'Milheiro' };
export function nomeUnidade(u) {
  const s = String(u || '').trim();
  return UNIDADES[s.toUpperCase()] || (s.length > 3 ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);
}

/** Medida e embalagem lidas do nome ("500ml", "15x25cm", "Pacote c/ 100 un"). */
export function caracteristicasDoNome(nome) {
  const s = String(nome || '');
  const emb = (s.match(/\(([^)]*(?:\bc\/|\d+\s*(?:un|fls|folhas|rolos|panos)\b)[^)]*)\)/i) || [])[1];
  const semEmb = emb ? s.replace(`(${emb})`, ' ') : s;
  const medidas = [];
  const re = /\b(\d+(?:[.,]\d+)?\s?x\s?\d+(?:[.,]\d+)?(?:\s?x\s?\d+(?:[.,]\d+)?)?\s?(?:cm|mm|m)?|\d+(?:[.,]\d+)?\s?(?:ml|l|kg|g|mg|cm|mm|mt|m|w|v)\b)/gi;
  for (const m of semEmb.matchAll(re)) {
    const v = m[1].replace(/\s+/g, '');
    if (!/[a-z]/i.test(v) && !/x/i.test(v)) continue;
    if (!medidas.includes(v)) medidas.push(v);
    if (medidas.length >= 3) break;
  }
  return { medida: medidas.join(' · ') || null, embalagem: emb ? emb.trim() : null };
}

/** { texto, caracteristicas: [[rótulo, valor]], ean } para a janela de detalhes. */
export function fichaDoProduto(p, reg) {
  const leg = LEGADO[String(p.codigo ?? '')] || null;
  const aplic = typeof p.aplicacao === 'string' && p.aplicacao.trim().length >= 15 ? p.aplicacao.trim() : null;
  const texto = reg?.descricao || leg?.d || aplic || descricaoBasica(p.nome, p.categoria, p.nome_g360);
  const ean = reg?.ean || leg?.e || null;
  const marca = typeof p.marca === 'object' ? p.marca?.nome : p.marca;
  const base = leg?.f?.length ? leg.f.filter(([k]) => k !== 'Marca' && k !== 'Vendido por') : (() => {
    const c = caracteristicasDoNome(p.nome);
    return [c.medida ? ['Medida', c.medida] : null, c.embalagem ? ['Embalagem', c.embalagem] : null].filter(Boolean);
  })();
  const caracteristicas = [
    marca ? ['Marca', marca] : null,
    ...base,
    p.unidade ? ['Vendido por', nomeUnidade(p.unidade)] : null,
    p.categoria ? ['Categoria', p.categoria] : null,
    ['Código', p.codigo],
    ean ? ['Código de barras', ean] : null,
    p.kit ? ['Kit', 'Sim'] : null,
  ].filter((x) => x && x[1]);
  return { texto, caracteristicas, ean };
}
