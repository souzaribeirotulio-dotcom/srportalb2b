-- Termos a mais nas seções novas (produtos que não caíam em nenhuma) e duas seções novas em Alimentícios.
do $t$
declare
  extra jsonb := $j$[
  ["Limpeza", "Lixo e Organização", "lix"],
  ["Limpeza", "Produtos de Limpeza Geral", "deterg", "desincrustante", "descalcificante", "soda", "solucao acida", "sol acida", "acido", "tira ferrugem", "tira limo", "tira graxa", "tira grude", "espuma magica", "pedrex", "lava onibus", "percarbonato", "desengripante", "deseng", "limp", "selador", "perfect floor", "startclor"],
  ["Limpeza", "Utensílios de Limpeza", "enceradeira", "lavadora", "flotador"],
  ["Limpeza", "Odorizadores e Inseticidas", "bom ar", "difusor", "essencia", "neutraliz", "naftalina", "pedra sanitaria", "pedra sanit", "formicida", "anti acaros", "anti aedes", "tela mictorio", "tela perfumada", "bloqueador odor", "perfumante", "evita mofo"],
  ["Descartáveis e Embalagens", "Marmitex, Potes e Bandejas", "marmiteiro", "container", "potiche", "hamburguera", "frangueira"],
  ["Descartáveis e Embalagens", "Bobinas e Filmes", "plastico bolha", "plastico para", "plastico transparente", "lona", "pvc esticavel", "rolo aluminio"],
  ["Descartáveis e Embalagens", "Fitas Adesivas", "fitilho"],
  ["Descartáveis e Embalagens", "Caixas e Lacres", "fecho", "seladora"],
  ["Higiene e Cuidados Pessoais", "Papel Higiênico e Toalhas de Papel", "lenco"],
  ["Higiene e Cuidados Pessoais", "Álcool e Antissépticos", "higienizador", "asseptgel"],
  ["Higiene e Cuidados Pessoais", "Cuidados Pessoais", "atadura", "band aid", "lamina", "aparelho barb", "perfume", "talco", "mamadeira", "pinta cabelo", "haste", "hastes"],
  ["Café e Coffee Break", "Cafés", "cappuccino"],
  ["Café e Coffee Break", "Chás", "camomila"],
  ["Café e Coffee Break", "Achocolatados", "choco po"],
  ["Alimentícios", "Mercearia", "canjica", "canjiquinha", "coco ralado", "tapioca", "proteina soja", "flocao", "uva passa", "azeitona", "grao"],
  ["Alimentícios", "Temperos e Condimentos", "canela", "curry", "manjericao", "acafrao", "lemon pepper", "corante"],
  ["Snacks e Doces", "Balas e Guloseimas", "pacoquita", "chicle", "drops", "confeito", "granulado"],
  ["Snacks e Doces", "Chocolates e Bombons", "rocher"],
  ["Snacks e Doces", "Salgadinhos e Amendoim", "baconzitos"],
  ["Snacks e Doces", "Barras e Saudáveis", "barrinha"],
  ["Escritório e Papelaria", "Papéis, Blocos e Cadernos", "post it", "notas adesivas", "ficha", "folha", "couche", "eva", "recibo", "talao", "calendario", "album"],
  ["Escritório e Papelaria", "Canetas, Lápis e Marcadores", "destaca texto", "giz", "ecolapis"],
  ["Escritório e Papelaria", "Etiquetas e Identificação", "etiq"],
  ["Escritório e Papelaria", "Clips, Grampos e Grampeadores", "clipes"],
  ["Escritório e Papelaria", "Tintas e Carimbos", "colorifico", "acrilex", "acrilpen"],
  ["Escritório e Papelaria", "Calculadoras e Acessórios", "molha dedo", "massinha", "argila", "artesanato"],
  ["Utilidades e Cia", "Cozinha e Utensílios", "liquidificador", "micro ondas", "sanduicheira", "processador alimentos", "descascador", "picador", "espatula", "ebulidor", "taca"],
  ["Utilidades e Cia", "Casa e Manutenção", "abracadeira", "torneira", "ralo", "ralinho", "lixa", "corda", "rejunte", "silicone", "extensao", "tomada", "plugue", "escada", "gancho", "fechadura", "prendedor", "prendedores", "rodizio", "rodizios", "isqueiro", "acendedor", "capacho", "desumidificador"],
  ["Utilidades e Cia", "Organização de Ambientes", "mesa", "cadeira", "prateleira", "cesta", "moldura", "display"],
  ["Informática e Tecnologia", "Periféricos e Acessórios", "cd", "dvd", "hd", "hub", "adaptador", "conversor", "controle universal", "impressora", "disquete"],
  ["Informática e Tecnologia", "Pilhas e Baterias", "relogio", "cronometro"],
  ["Festas e Brinquedos", "Brinquedos", "quebra cabeca", "baralho", "dado", "piscina", "micanga", "amoeba", "areia magica"]
  ]$j$;
  novas jsonb := $j$[
  ["Alimentícios", "Carnes e Frios", "frango", "bacon", "apresuntado", "presunto", "coxa", "cupim", "fraldinha", "bovina", "salsicha", "linguica", "mortadela"],
  ["Alimentícios", "Pães e Bolos", "pao", "bisnaguinha", "torta", "bolo"]
  ]$j$;
  e jsonb;
begin
  for e in select * from jsonb_array_elements(extra) loop
    update public.portal_secoes s set termos = s.termos || array(select x from jsonb_array_elements_text(e) with ordinality y(x, n) where n > 2 and not x = any(s.termos))
     where s.categoria = e->>0 and s.nome = e->>1;
  end loop;
  for e in select * from jsonb_array_elements(novas) loop
    insert into public.portal_secoes (loja, categoria, nome, termos, ordem)
    select c.loja, e->>0, e->>1, array(select x from jsonb_array_elements_text(e) with ordinality y(x, n) where n > 2),
           (select coalesce(max(s.ordem), -1) + 1 from public.portal_secoes s where s.loja = c.loja and s.categoria = e->>0)
      from public.portal_categorias c where c.nome = e->>0
       and not exists (select 1 from public.portal_secoes s where s.loja = c.loja and s.categoria = e->>0 and s.nome = e->>1);
  end loop;
end $t$;
