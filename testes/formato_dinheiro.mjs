// node testes/formato_dinheiro.mjs — preço com muitas casas aparece com 2 (ou 4 abaixo de R$ 1).
import { dinheiro } from '../src/ui/formato.js';
const casos = [['118.999025', 'R$ 119,00'], ['4.759961', 'R$ 4,76'], ['12.5', 'R$ 12,50'], ['1234.5', 'R$ 1.234,50'], ['0.0345', 'R$ 0,0345'], ['0.5', 'R$ 0,50'], ['', '—']];
for (const [e, s] of casos) if (dinheiro(e) !== s) { console.error('FALHOU:', e, dinheiro(e), '≠', s); process.exit(1); }
// o que tem de dar errado: não pode sobrar a casa a mais
if (dinheiro('118.999025').includes('999025')) { console.error('FALHOU: casas a mais'); process.exit(1); }
console.log('formato de dinheiro: todos os testes passaram.');
