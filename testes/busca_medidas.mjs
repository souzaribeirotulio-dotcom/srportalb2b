// node testes/busca_medidas.mjs — medidas escritas de jeitos diferentes acham os mesmos produtos (nomes fictícios).
import { indexar, buscarLocal, nomeBate, variacoesMedida } from '../src/catalogo/busca.js';
const nomes = ['Água Sanitária 5L Exemplo Sol', 'Água Sanitária 5 Litros Exemplo Tuff', 'Água Sanitária 2L Exemplo', 'Água Sanitária 1 Litro Exemplo',
  'Removedor Mágico 5L Exemplo', 'Detergente 500ml Exemplo', 'Açúcar 1kg Exemplo', 'Açúcar 5 Kg Exemplo', 'Fita 50 metros Exemplo'];
indexar(nomes.map((nome, i) => ({ codigo: String(i), produto_id: i, nome, categoria: 'X' })));
const ok = (c, m) => { if (!c) { console.error('FALHOU:', m); process.exit(1); } };
const ach = (q) => buscarLocal(q).map((r) => r.nome);
for (const q of ['agua sanitaria 5lt', 'agua sanitaria 5 litros', 'agua sanitaria 5l', 'agua sanitaria 5 lts', 'agua sanitaria 5 litro']) {
  const r = ach(q);
  ok(r.length === 2 && r.every((x) => /5( litros|l) /i.test(x)), `${q} → ${r.join(' | ')}`);
}
ok(ach('detergente 500 ml').length === 1, 'detergente 500 ml');
ok(ach('acucar 5kg')[0]?.includes('5 Kg') && ach('acucar 5kg').length === 1, `acucar 5kg → ${ach('acucar 5kg')}`);
ok(ach('fita 50m').length === 1, 'fita 50m');
// filtro do que vem da busca do G360: o Removedor 5L não tem "água sanitária"
ok(!nomeBate('agua sanitaria 5 litros', 'Removedor Mágico 5L Exemplo'), 'removedor não bate (teste que tem de dar errado se bater)');
ok(nomeBate('agua sanitaria 5 litros', 'AGUA SANITARIA 5LT SOL'), 'nome do G360 abreviado bate');
// produto que ainda não tem nome no portal: a busca do G360 recebe a medida escrita dos outros jeitos
ok(variacoesMedida('agua sanitaria 5 litros').includes('agua sanitaria 5l') && variacoesMedida('agua sanitaria 5lt').includes('agua sanitaria 5 litros'), 'grafias da medida para o G360');
ok(variacoesMedida('agua sanitaria').length === 0, 'sem medida, sem variação');
console.log('medidas na busca: todos os testes passaram.');
