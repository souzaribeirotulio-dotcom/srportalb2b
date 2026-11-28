// node testes/busca_precisao.mjs — Busca sem falsos parecidos (28/11/2026). Nomes fictícios.
import { indexar, buscarLocal, nomeBate } from '../src/catalogo/busca.js';
const nomes = ['Papel Toalha Interfolhado 20x20 Exemplo', 'Papel Higiênico Folha Dupla Exemplo', 'Papel A4 500 Folhas Exemplo',
  'Caneta Esferográfica Azul Exemplo', 'Canela em Pó 50g Exemplo', 'Touca Descartável Exemplo', 'Detergente Lava Louças Exemplo',
  'Saco para Lixo 100L Exemplo', 'Sacola Plástica 30x40 Exemplo', 'Caneta Detectora de Cédulas Exemplo', 'Detergente Neutro 500ml Exemplo',
  'Pilha Alcalina AA Exemplo', 'Batata Palha 1kg Exemplo', 'Tampa Plástica Exemplo', 'Tampa para Pote Exemplo', 'Tampa T-100 Exemplo', 'Lixeira com Tamp Click Exemplo', 'Prato Raso 21cm Exemplo', 'Faca Pra Festa Exemplo'];
indexar(nomes.map((nome, i) => ({ codigo: String(i), produto_id: i, nome, categoria: 'X' })));
const ok = (c, m) => { if (!c) { console.error('FALHOU:', m); process.exit(1); } };
const n = (q) => buscarLocal(q).map((x) => x.nome);
ok(n('papel toalha').join() === 'Papel Toalha Interfolhado 20x20 Exemplo', `papel toalha: ${n('papel toalha')}`);
ok(n('caneta').every((x) => x.startsWith('Caneta')), `caneta: ${n('caneta')}`);
ok(n('touca').length === 1, `touca: ${n('touca')}`);
ok(n('sacola').every((x) => x.startsWith('Sacola')), `sacola: ${n('sacola')}`);
ok(n('detergente').every((x) => x.startsWith('Detergente')), `detergente: ${n('detergente')}`);
ok(n('pilha').every((x) => x.startsWith('Pilha')), `pilha: ${n('pilha')}`);
ok(n('prato').every((x) => x.startsWith('Prato')), `prato: ${n('prato')}`);
ok(n('tampa').length === 4, `abreviação de verdade continua: ${n('tampa')}`);
// Tem de continuar achando: erro de digitação de palavra que não existe ("detergnte") e começo de palavra ("deterg").
ok(n('detergnte').length >= 1, 'erro de digitação');
ok(n('deterg').length === 2, `começo de palavra: ${n('deterg')}`);
ok(!nomeBate('papel toalha', 'Papel Higiênico Folha Dupla'), 'filtro da busca do G360');
console.log('Precisão da busca: todos os testes passaram.');
