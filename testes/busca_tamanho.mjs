// node testes/busca_tamanho.mjs — tamanho na busca ("luva nitrilica p") põe esse tamanho primeiro. Nomes fictícios.
import { indexar, buscarLocal } from '../src/catalogo/busca.js';
const nomes = ['Luva Nitrílica Azul (G) Exemplo', 'Luva Nitrílica Azul (M) Exemplo', 'Luva Nitrílica Azul (P) Exemplo', 'Luva Nitrílica Preta (P) Exemplo', 'Saco p/ Lixo 100 L Exemplo', 'Açúcar Exemplo 500 g'];
indexar(nomes.map((nome, i) => ({ codigo: String(i), produto_id: i, nome, categoria: 'X' })));
const top = (q, n) => buscarLocal(q).slice(0, n).map((r) => r.nome);
const ok = (c, m) => { if (!c) { console.error('FALHOU:', m); process.exit(1); } };
ok(top('luva nitrilica p', 2).every((x) => x.includes('(P)')), 'P primeiro');
ok(buscarLocal('luva nitrilica p').length === 4, 'outros tamanhos continuam na lista');
ok(top('luva nitrilica g', 1)[0].includes('(G)'), 'G primeiro');
ok(buscarLocal('saco p lixo').length === 1, '"p" no meio continua sendo "para"');
ok(buscarLocal('acucar 500 g').length === 1, '"500 g" é medida, não tamanho');
// o que tem de dar errado: sem tamanho na busca, nenhum tamanho ganha ponto extra
const s = buscarLocal('luva nitrilica'); ok(new Set(s.map((r) => r.pontos)).size === 1, 'sem tamanho, tudo empatado');
console.log('busca por tamanho: todos os testes passaram.');
