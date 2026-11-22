// node testes/busca_correcao.mjs — "Você quis dizer" (nomes fictícios).
import { indexar, buscarLocal, corrigirBusca } from '../src/catalogo/busca.js';
const nomes = ['Papel Sulfite A4 Exemplo', 'Detergente Spa Soft Exemplo', 'Sabonete Soft Exemplo', 'Luva Nitrílica Preta (P) Exemplo', 'Luva de Látex Exemplo', 'Lixa d Água Exemplo', 'Detergente Neutro 500ml Exemplo', 'Copo Descartável 200ml Exemplo'];
indexar(nomes.map((nome, i) => ({ codigo: String(i), produto_id: i, nome, categoria: 'X' })));
const ok = (c, m) => { if (!c) { console.error('FALHOU:', m); process.exit(1); } };
ok(buscarLocal('liva preta').length === 0, 'sem correção não acha (é o caso a corrigir)');
ok(corrigirBusca('liva preta') === 'luva preta', `liva preta → ${corrigirBusca('liva preta')}`);
ok(buscarLocal(corrigirBusca('liva preta'))[0]?.nome.includes('Preta'), 'a busca corrigida acha a luva preta');
ok(corrigirBusca('papel sofite') === 'papel sulfite', `papel sofite → ${corrigirBusca('papel sofite')}`);
ok(corrigirBusca('detergnte') === 'detergente', `detergnte → ${corrigirBusca('detergnte')}`);
// o que tem de dar errado: busca certa não é "corrigida"; palavra sem nada parecido também não
ok(corrigirBusca('luva preta') === null, 'busca certa não muda');
ok(corrigirBusca('deterg') === null, 'começo de palavra não muda');
ok(corrigirBusca('xyzqwk') === null, 'sem palavra parecida, sem sugestão');
console.log('correção da busca: todos os testes passaram.');
