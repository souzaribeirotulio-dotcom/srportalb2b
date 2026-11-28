// node testes/busca_sinonimo_abaixo.mjs — A palavra digitada vem antes do sinônimo (nomes fictícios).
import { indexar, buscarLocal, definirSinonimos } from '../src/catalogo/busca.js';
const nomes = ['Esponja Azul (Pacote 3 un) Scotch Brite', 'Fibra Verde Limpeza Pesada Exemplo', 'Esponja (Pacote 1 un) Scotch Brite', 'Fibra Branca Limpeza Leve Exemplo', 'Detergente Neutro Exemplo'];
indexar(nomes.map((nome, i) => ({ codigo: String(i), produto_id: i, nome, categoria: 'X' })));
definirSinonimos([{ termo: 'scotch brite', equivalentes: ['fibra'] }]);
const ok = (c, m) => { if (!c) { console.error('FALHOU:', m); process.exit(1); } };
const r = buscarLocal('fibra');
ok(r.length === 4, `acha fibras e Scotch-Brite: ${r.map((x) => x.nome)}`);
ok(r[0].nome.startsWith('Fibra') && r[1].nome.startsWith('Fibra'), `fibras primeiro: ${r.map((x) => x.nome)}`);
ok(r[0].pontos > r[2].pontos, 'sinônimo com menos pontos');
// Tem de continuar achando: buscar "scotch brite" traz as Scotch-Brite na frente.
const s = buscarLocal('scotch brite');
ok(s[0].nome.includes('Scotch'), `scotch brite: ${s.map((x) => x.nome)}`);
console.log('Busca com sinônimo: todos os testes passaram.');
// Marca "Mares" (→ "mar") não pode bater com "marmitex" como se fosse abreviação.
indexar(['Plástico para Plastificacao Polaseal A4 (Pacote c/ 100 un) Mares', 'Base Marmitex Isopor Pt 102 (750ml) Exemplo', 'Alcool Liquido 70 Exemplo', 'Alc. Gel 500ml Exemplo'].map((nome, i) => ({ codigo: String(i), produto_id: i, nome, categoria: 'X' })));
const m = buscarLocal('marmitex').map((x) => x.nome);
ok(m.length === 1 && m[0].includes('Marmitex'), `marmitex: ${m}`);
ok(buscarLocal('alcool').length === 2, 'abreviação curta perto do tamanho continua valendo (alc → alcool)');
console.log('Abreviação curta: todos os testes passaram.');
