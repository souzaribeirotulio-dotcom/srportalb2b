-- Árvore do catálogo: departamento (a categoria do portal) → seção. Dois níveis só (a coluna pai fica para uso futuro).
-- Cada seção ou linha é uma lista de palavras: entra o produto da categoria cujo nome tem todas
-- as palavras de algum item (sem acento; palavra de 3+ letras vale pelo começo: "copo" pega "copos").
-- Leitura liberada (é o catálogo público, igual a portal_categorias); gravação só pela função
-- painel-g360, com a chave secreta. RLS ligada, sem política de escrita.
create table if not exists public.portal_secoes (
  id uuid primary key default gen_random_uuid(),
  loja text not null check (loja ~ '^[a-f0-9]{16}$'),
  categoria text not null check (char_length(categoria) between 1 and 40),
  pai uuid references public.portal_secoes (id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 40),
  termos text[] not null default '{}' check (cardinality(termos) <= 40),
  ordem integer not null default 0,
  atualizado_em timestamptz not null default now()
);
create index if not exists portal_secoes_loja on public.portal_secoes (loja, categoria, ordem);
alter table public.portal_secoes enable row level security;
revoke all on public.portal_secoes from anon, authenticated;
grant select (id, loja, categoria, pai, nome, termos, ordem) on public.portal_secoes to anon, authenticated;
drop policy if exists portal_secoes_leitura on public.portal_secoes;
create policy portal_secoes_leitura on public.portal_secoes for select to anon, authenticated using (true);

-- Árvore inicial (tirada dos nomes do catálogo). Só entra para a loja que tem a categoria e ainda não tem seções.
do $seed$
declare
  arv jsonb := $j$[
  ["Limpeza", [
    ["Sacos de lixo", ["saco lixo", "saco p lixo"]],
    ["Panos e flanelas", ["pano"], ["flanela"], ["wiper"], ["wypall"], ["perfex"]],
    ["Detergentes e sabões", ["detergente"], ["sabao"], ["lava louca"], ["lava roupa"], ["amaciante"]],
    ["Desinfetantes e limpadores", ["desinfetante"], ["limpador"], ["limpa"], ["multiuso"], ["agua sanitaria"], ["cloro"], ["removedor"], ["desengraxante"], ["alvejante"]],
    ["Rodos, vassouras e pás", ["rodo"], ["vassoura"], ["pa"], ["cabo"]],
    ["Esponjas e fibras", ["esponja"], ["fibra"], ["palha"], ["disco"]],
    ["Mops e baldes", ["mop"], ["balde"], ["refil"]],
    ["Ceras e lustra-móveis", ["cera"], ["lustra"], ["brilha"]],
    ["Odorizadores", ["odorizador"], ["desodorizador"], ["aromatizador"], ["pastilha"]],
    ["Escovas e desentupidores", ["escova"], ["desentupidor"]],
    ["Inseticidas", ["inseticida"]]
  ]],
  ["Descartáveis", [
    ["Copos", ["copo"]],
    ["Potes e tampas", ["pote"], ["tampa"]],
    ["Marmitex e bandejas", ["marmitex"], ["bandeja"], ["base"], ["hamburgueira"]],
    ["Pratos", ["prato"]],
    ["Talheres e kits", ["colher"], ["garfo"], ["faca"], ["kit talher"]],
    ["Canudos e mexedores", ["canudo"], ["mexedor"]],
    ["Guardanapos", ["guardanapo"]],
    ["Palitos e espetos", ["palito"], ["espeto"]]
  ]],
  ["Embalagens", [
    ["Sacos plásticos", ["saco plastico"], ["saco bd"], ["saco zip"], ["saco pe"], ["saco transp"]],
    ["Sacos de papel", ["saco papel"]],
    ["Sacolas", ["sacola"]],
    ["Bobinas", ["bobina"], ["bob"]],
    ["Fitas adesivas", ["fita"]],
    ["Filmes PVC e stretch", ["filme"]],
    ["Caixas e contentores", ["caixa"], ["contentor"]],
    ["Lacres", ["lacre"]]
  ]],
  ["Copa & Alimentos", [
    ["Café, chá e achocolatado", ["cafe"], ["cha"], ["capsula"], ["achocolatado"]],
    ["Açúcar e adoçante", ["acucar"], ["adocante"]],
    ["Biscoitos e doces", ["biscoito"], ["bala"], ["bombom"], ["doce"], ["chocolate"], ["pacoca"], ["cocada"], ["barra"], ["bolinho"], ["torrada"]],
    ["Bebidas", ["agua"], ["suco"], ["refresco"], ["refrigerante"], ["refrig"]],
    ["Mercearia", ["arroz"], ["feijao"], ["macarrao"], ["massa"], ["oleo"], ["sal"], ["molho"], ["caldo"], ["extrato"], ["ketchup"], ["pimenta"]],
    ["Gelatinas e sobremesas", ["gelatina"], ["pudim"]],
    ["Laticínios", ["leite"], ["iogurte"], ["margarina"], ["manteiga"]]
  ]],
  ["Higiene", [
    ["Papel higiênico", ["papel higienico"], ["papel hig"]],
    ["Papel toalha", ["papel toalha"]],
    ["Sabonetes", ["sabonete"]],
    ["Álcool", ["alcool"]],
    ["Fraldas", ["fralda"]],
    ["Lenços e lençóis", ["lenco"], ["lencol"]],
    ["Cuidados pessoais", ["escova"], ["hidratante"], ["repelente"], ["creme"], ["assento"]]
  ]],
  ["Utensílios & EPI", [
    ["Lixeiras", ["lixeira"]],
    ["Luvas", ["luva"]],
    ["Dispensers", ["dispenser"], ["dispensador"]],
    ["EPI", ["bota"], ["mascara"], ["touca"], ["avental"], ["oculos"], ["protetor"]],
    ["Borrifadores", ["borrifador"], ["pulverizador"]],
    ["Espanadores", ["espanador"]]
  ]],
  ["Papelaria", [
    ["Canetas e marcadores", ["caneta"], ["marcador"], ["pincel"], ["lapis"], ["lapiseira"], ["grafite"]],
    ["Papéis e blocos", ["papel"], ["bloco"], ["caderno"]],
    ["Pastas e arquivo", ["pasta"], ["arquivo"]],
    ["Envelopes", ["envelope"]],
    ["Etiquetas", ["etiqueta"]],
    ["Cola e corretivo", ["cola"], ["corretivo"]],
    ["Grampeadores e clips", ["grampeador"], ["grampo"], ["clips"], ["perfurador"]],
    ["Quadros e placas", ["quadro"], ["placa"]],
    ["Tesouras e estiletes", ["tesoura"], ["estilete"]],
    ["Tintas e almofadas", ["tinta"], ["almofada"], ["reabastecedor"]]
  ]],
  ["Utilidades Domésticas", [
    ["Organização", ["organizador"], ["caixa"], ["gaveta"], ["cesto"], ["suporte"], ["porta"]],
    ["Garrafas e jarras", ["garrafa"], ["jarra"]],
    ["Kits", ["kit"]],
    ["Filtros e refis", ["filtro"], ["refil"]]
  ]],
  ["Eletrônicos & Informática", [
    ["Pilhas e baterias", ["pilha"], ["bateria"]],
    ["Informática", ["mouse"], ["teclado"], ["cartucho"], ["toner"], ["tinta"]],
    ["Balanças", ["balanca"]]
  ]],
  ["Festas & Brinquedos", [
    ["Balões", ["balao"]],
    ["Brinquedos", ["jogo"], ["bola"], ["carrinho"], ["pulseira"]]
  ]]
  ]$j$;
  dep jsonb; sec jsonb; lin jsonb; l record; sid uuid; i int; j int; termos text[]; filhos jsonb;
begin
  for l in select distinct loja from public.portal_categorias loop
    if exists (select 1 from public.portal_secoes s where s.loja = l.loja) then continue; end if;
    for dep in select * from jsonb_array_elements(arv) loop
      if not exists (select 1 from public.portal_categorias c where c.loja = l.loja and c.nome = dep->>0) then continue; end if;
      i := 0;
      for sec in select * from jsonb_array_elements(dep->1) loop
        -- [nome, [termo...], [termo...], ..., [[linha...], ...]?]: o último item é a lista de linhas quando é lista de listas
        termos := '{}'; filhos := null;
        for j in 1 .. jsonb_array_length(sec) - 1 loop
          if jsonb_typeof(sec->j->0) = 'array' then filhos := sec->j;
          else termos := termos || array(select jsonb_array_elements_text(sec->j)); end if;
        end loop;
        insert into public.portal_secoes (loja, categoria, nome, termos, ordem) values (l.loja, dep->>0, sec->>0, termos, i) returning id into sid;
        i := i + 1;
        if filhos is not null then
          j := 0;
          for lin in select * from jsonb_array_elements(filhos) loop
            insert into public.portal_secoes (loja, categoria, pai, nome, termos, ordem)
            values (l.loja, dep->>0, sid, lin->>0, array(select jsonb_array_elements_text(x) from jsonb_array_elements(lin) with ordinality t(x, n) where n > 1), j);
            j := j + 1;
          end loop;
        end if;
      end loop;
    end loop;
  end loop;
end $seed$;
