-- Departamentos novos (no estilo dos atacados online, adaptados ao catálogo da Souza Ribeiro) e redistribuição
-- dos produtos pelas palavras do nome. Regra de comparação igual à do portal: sem acento; palavra de 5+ letras
-- vale pelo começo ("vassoura" pega "vassouras"); mais curta só inteira ou no plural ("copo"/"copos", "bala"/"balas",
-- mas "bala" não pega "balança").
-- Cada produto vai para o departamento da seção cujo item bate com MAIS palavras (o mais específico:
-- "papel toalha" ganha de "papel"); empate = ordem dos departamentos. Sem nenhum: o equivalente ao antigo.

create or replace function public.portal_tokens(t text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(x), '{}') from regexp_split_to_table(
    lower(translate(coalesce(t, ''), 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
    '[^a-z0-9]+') x where x <> '';
$$;
create or replace function public.portal_termo_bate(tok text[], termo text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(bool_and(exists (select 1 from unnest(tok) t where (length(w) >= 5 and t like w || '%') or t in (w, w || 's', w || 'es'))), false)
    from unnest(public.portal_tokens(termo)) w;
$$;
revoke all on function public.portal_tokens(text), public.portal_termo_bate(text[], text) from public, anon, authenticated;

-- Cópia das categorias de antes (para conferir ou desfazer). RLS ligada e sem política: o navegador não lê.
create table if not exists public.portal_categoria_antes_20261124 as
  select loja, codigo, categoria, now() as copiado_em from public.portal_produtos_exibicao;
alter table public.portal_categoria_antes_20261124 enable row level security;
revoke all on public.portal_categoria_antes_20261124 from anon, authenticated;

do $dep$
declare
  arv jsonb := $j$[
  ["Limpeza", [
    ["Lixo e Organização", "saco lixo", "saco p lixo", "saco para lixo", "lixeira", "contentor", "cesto lixo", "coletor"],
    ["Produtos de Limpeza Geral", "detergente", "desinfetante", "limpador", "limpa", "multiuso", "multi uso", "desengordurante", "desengraxante", "removedor", "saponaceo", "sapolio", "lustra", "cera", "brilha", "lava loucas", "lava louca"],
    ["Lavanderia", "sabao", "lava roupa", "lava roupas", "amaciante", "alvejante", "tira mancha", "tira manchas"],
    ["Sanitização", "agua sanitaria", "cloro", "hipoclorito", "sanitizante", "bactericida", "quaternario"],
    ["Panos e Flanelas", "pano", "flanela", "wiper", "wypall", "perfex"],
    ["Utensílios de Limpeza", "rodo", "vassoura", "pa", "mop", "balde", "esponja", "fibra", "palha", "escova", "desentupidor", "cabo", "espanador", "borrifador", "pulverizador", "refil", "suporte mop", "carro funcional", "disco"],
    ["Odorizadores e Inseticidas", "odorizador", "desodorizador", "aromatizador", "pastilha", "bloco sanitario", "inseticida", "raticida", "neutralizador"]
  ]],
  ["Descartáveis e Embalagens", [
    ["Copos e Tampas", "copo", "tampa copo"],
    ["Pratos e Talheres", "prato", "colher", "garfo", "faca descartavel", "faca forte", "faca refeicao", "kit talher", "talher"],
    ["Marmitex, Potes e Bandejas", "marmitex", "pote", "bandeja", "base", "hamburgueira", "tampa", "embalagem", "garrafa suco", "garrafa p suco", "garrafa pet", "forma"],
    ["Canudos e Palitos", "canudo", "palito", "espeto"],
    ["Guardanapos", "guardanapo"],
    ["Sacos e Sacolas", "saco", "sacola", "saco papel", "saco plastico", "saco zip"],
    ["Bobinas e Filmes", "bobina", "bob", "filme", "stretch"],
    ["Fitas Adesivas", "fita"],
    ["Caixas e Lacres", "caixa", "lacre", "caixa papelao"],
    ["Artigos para Festas", "vela", "toalha mesa", "forminha", "chapeu"]
  ]],
  ["Higiene e Cuidados Pessoais", [
    ["Papel Higiênico e Toalhas de Papel", "papel higienico", "papel hig", "papel toalha", "toalha papel", "toalha interf", "lenco papel", "lencos papel"],
    ["Sabonetes", "sabonete"],
    ["Álcool e Antissépticos", "alcool", "antisseptico"],
    ["Dispensers e Secadores", "dispenser", "dispensador", "saboneteira", "papeleira", "secador"],
    ["Fraldas e Higiene Íntima", "fralda", "absorvente", "lenco umedecido", "lencos umedecidos", "lencol"],
    ["Cuidados Pessoais", "escova dental", "creme dental", "hidratante", "repelente", "desodorante", "shampoo", "condicionador", "creme", "assento", "protetor solar", "termometro", "curativo", "algodao", "cotonete", "aparelho barbear"]
  ]],
  ["Café e Coffee Break", [
    ["Cafés", "cafe", "capsula"],
    ["Chás", "cha"],
    ["Açúcar e Adoçantes", "acucar", "adocante"],
    ["Achocolatados", "achocolatado", "chocolate po"],
    ["Filtros e Coadores", "filtro papel", "filtro cafe", "coador"],
    ["Mexedores e Pazinhas", "mexedor", "pazinha"],
    ["Garrafas Térmicas e Cafeteiras", "garrafa termica", "cafeteira", "chaleira", "bule"]
  ]],
  ["Alimentícios", [
    ["Mercearia", "arroz", "feijao", "oleo", "azeite", "vinagre", "farinha", "fuba", "sal", "cesta basica"],
    ["Massas e Molhos", "macarrao", "massa", "molho", "extrato", "ketchup", "maionese", "mostarda"],
    ["Temperos e Condimentos", "tempero", "caldo", "pimenta", "oregano", "sazon", "colorau"],
    ["Sobremesas e Confeitaria", "gelatina", "pudim", "mistura bolo", "fermento", "creme leite", "leite condensado", "geleia", "forma pudim"],
    ["Laticínios", "margarina", "manteiga", "queijo", "requeijao"],
    ["Enlatados e Conservas", "atum", "sardinha", "milho", "ervilha", "enlatado", "conserva", "palmito"]
  ]],
  ["Snacks e Doces", [
    ["Biscoitos e Bolachas", "biscoito", "bolacha", "torrada", "wafer", "cookie", "rosquinha"],
    ["Chocolates e Bombons", "chocolate", "bombom", "chocottone", "panetone", "panettone"],
    ["Balas e Guloseimas", "bala", "doce", "pacoca", "cocada", "pirulito", "chiclete", "goma", "marshmallow", "pe moleque"],
    ["Salgadinhos e Amendoim", "salgadinho", "batata", "amendoim", "pipoca"],
    ["Barras e Saudáveis", "barra", "cereal", "granola", "aveia", "bolinho"]
  ]],
  ["Bebidas", [
    ["Águas", "agua"],
    ["Sucos e Refrescos", "suco", "refresco", "nectar"],
    ["Refrigerantes", "refrigerante", "refrig"],
    ["Leites e Bebidas Lácteas", "leite", "iogurte", "bebida lactea", "mucilon"],
    ["Energéticos e Isotônicos", "energetico", "isotonico"]
  ]],
  ["EPIs e Segurança", [
    ["Luvas", "luva"],
    ["Calçados de Proteção", "bota", "sapato", "galocha"],
    ["Proteção Respiratória e Visual", "mascara", "respirador", "oculos"],
    ["Toucas, Aventais e Vestimentas", "touca", "avental", "jaleco", "macacao", "capa chuva", "propé", "prope"],
    ["Proteção Auditiva", "protetor auricular", "abafador"],
    ["Sinalização", "placa sinalizacao", "cone", "fita zebrada", "corrente plastica"]
  ]],
  ["Escritório e Papelaria", [
    ["Papéis, Blocos e Cadernos", "papel", "sulfite", "bloco", "caderno", "agenda", "bobina termica", "bobina pdv"],
    ["Canetas, Lápis e Marcadores", "caneta", "lapis", "lapiseira", "grafite", "marcador", "pincel", "marca texto"],
    ["Pastas e Arquivo", "pasta", "arquivo", "fichario", "classificador"],
    ["Envelopes", "envelope"],
    ["Etiquetas e Identificação", "etiqueta", "cracha"],
    ["Clips, Grampos e Grampeadores", "clips", "grampo", "grampeador", "perfurador", "elastico"],
    ["Colas e Corretivos", "cola", "corretivo"],
    ["Tesouras e Estiletes", "tesoura", "estilete"],
    ["Quadros e Apagadores", "quadro", "placa", "apagador"],
    ["Tintas e Carimbos", "tinta", "almofada", "carimbo", "reabastecedor"],
    ["Calculadoras e Acessórios", "calculadora", "regua", "apontador", "borracha", "estojo", "prancheta", "livro"]
  ]],
  ["Utilidades e Cia", [
    ["Organização de Ambientes", "organizador", "caixa organizadora", "gaveta", "cesto", "suporte", "porta", "cabide", "estrado"],
    ["Garrafas, Jarras e Copos", "garrafa", "jarra", "copo vidro", "caneca", "xicara"],
    ["Cozinha e Utensílios", "faca", "tabua", "panela", "escorredor", "bacia", "pote vidro", "kit", "filtro"],
    ["Casa e Manutenção", "cadeado", "fosforo", "mangueira", "tapete", "lampada", "pilha recarregavel"],
    ["Balanças", "balanca"]
  ]],
  ["Informática e Tecnologia", [
    ["Pilhas e Baterias", "pilha", "bateria"],
    ["Periféricos e Acessórios", "mouse", "teclado", "fone", "headset", "pen drive", "cabo usb", "cabo hdmi", "carregador"],
    ["Cartuchos e Toners", "cartucho", "toner", "tinta impressora"]
  ]],
  ["Festas e Brinquedos", [
    ["Balões e Decoração", "balao", "baloes", "bexiga", "decoracao"],
    ["Brinquedos", "jogo", "bola", "carrinho", "pulseira", "boneca", "brinquedo"]
  ]],
  ["Outros", []]
  ]$j$;
  l record; dep jsonb; sec jsonb; i int; j int;
begin
  for l in select distinct loja from public.portal_categorias loop
    -- 1) Árvore nova (departamentos e seções)
    delete from public.portal_secoes where loja = l.loja;
    delete from public.portal_categorias where loja = l.loja;
    i := 0;
    for dep in select * from jsonb_array_elements(arv) loop
      insert into public.portal_categorias (loja, nome, ordem) values (l.loja, dep->>0, i);
      j := 0;
      for sec in select * from jsonb_array_elements(dep->1) loop
        insert into public.portal_secoes (loja, categoria, nome, termos, ordem)
        values (l.loja, dep->>0, sec->>0, array(select jsonb_array_elements_text(sec) offset 1), j);
        j := j + 1;
      end loop;
      i := i + 1;
    end loop;
    -- 2) Cada produto vai para o departamento do item que bate com mais palavras (empate: ordem do departamento).
  end loop;
end $dep$;

-- Classificação dos produtos (em lotes, por ordem de código): o item que bate com mais palavras decide o departamento;
-- empate = ordem do departamento e da seção. Sem nenhum: o equivalente ao departamento antigo (pela cópia), senão Outros.
-- Uso: select public.portal_classificar('<loja>', 0, 800); depois 800, 1600, ... até devolver 0.
create or replace function public.portal_classificar(p_loja text, p_de int, p_qtd int) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
  antigos jsonb := '{"Limpeza":"Limpeza","Descartáveis":"Descartáveis e Embalagens","Embalagens":"Descartáveis e Embalagens","Copa & Alimentos":"Alimentícios","Higiene":"Higiene e Cuidados Pessoais","Utensílios & EPI":"EPIs e Segurança","Papelaria":"Escritório e Papelaria","Utilidades Domésticas":"Utilidades e Cia","Eletrônicos & Informática":"Informática e Tecnologia","Festas & Brinquedos":"Festas e Brinquedos","Outros":"Outros"}';
begin
  with regras as (
    select c.nome dep, c.ordem dord, s.ordem sord, public.portal_tokens(t) ws
      from public.portal_secoes s join public.portal_categorias c on c.loja = s.loja and c.nome = s.categoria, unnest(s.termos) t
     where s.loja = p_loja and s.pai is null),
  prods as (
    select e.codigo, public.portal_tokens(coalesce(e.nome, '') || ' ' || coalesce(e.nome_g360, '')) tok, e.categoria
      from public.portal_produtos_exibicao e where e.loja = p_loja order by e.codigo offset p_de limit p_qtd),
  melhor as (
    select p.codigo, p.categoria, (select r.dep from regras r
       where cardinality(r.ws) > 0 and not exists (select 1 from unnest(r.ws) w
         where not exists (select 1 from unnest(p.tok) t where (length(w) >= 5 and t like w || '%') or t in (w, w || 's', w || 'es')))
       order by cardinality(r.ws) desc, r.dord, r.sord limit 1) dep
      from prods p)
  update public.portal_produtos_exibicao e set categoria = coalesce(m.dep,
      antigos->>(select b.categoria from public.portal_categoria_antes_20261124 b where b.loja = p_loja and b.codigo = e.codigo limit 1),
      (select c.nome from public.portal_categorias c where c.loja = p_loja and c.nome = m.categoria), 'Outros')
    from melhor m where e.loja = p_loja and e.codigo = m.codigo;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.portal_classificar(text, int, int) from public, anon, authenticated;
