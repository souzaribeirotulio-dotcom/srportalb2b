"""Ordem por tipo com medida (28/11/2026): na seção e na busca, os do mesmo tipo e tamanho ficam juntos
(detergentes de 500ml, depois os de 5L, depois os em pó). Dados fictícios."""
import os, sys, uuid
sys.path.insert(0, os.path.dirname(__file__))
from simulador import Sim, BASE
from playwright.sync_api import sync_playwright

def checar(ok, msg):
    if not ok: raise SystemExit('FALHOU: ' + msg)

sim = Sim(); quem = next(iter(sim.compradores))
nomes = {'P-120': 'Detergente Amoniacal Fictício 5L', 'P-121': 'Detergente Fictício 500ml Neutro', 'P-122': 'Detergente em Pó Fictício 1,6kg',
         'P-123': 'Detergente Ácido Fictício 5L', 'P-124': 'Detergente Neutro Fictício 500ml', 'P-125': 'Detergente Clear Fictício 500ml'}
for c, n in nomes.items(): sim.exibicao[c] = {'codigo': c, 'produto_id': int(c[2:]), 'nome': n, 'categoria': 'Limpeza', 'origem': 'equipe'}
sim.secoes = [{'id': str(uuid.uuid4()), 'categoria': 'Limpeza', 'pai': None, 'nome': 'Detergentes', 'termos': ['detergente'], 'ordem': 0}]
esperado = ['Detergente Clear Fictício 500ml', 'Detergente Fictício 500ml Neutro', 'Detergente Neutro Fictício 500ml',
            'Detergente Ácido Fictício 5L', 'Detergente Amoniacal Fictício 5L', 'Detergente em Pó Fictício 1,6kg']

def nomes_na_tela(pg):
    pg.wait_for_selector('#grid .card'); pg.wait_for_timeout(1200)
    return [n for n in pg.eval_on_selector_all('#grid .card .name', 'es => es.map(e => e.innerText.trim())') if n.startswith('Detergente')]

with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--no-sandbox'])
    ctx = br.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); erros = []
    pg.on('pageerror', lambda e: erros.append(str(e))); pg.route('**/*', sim.rota)
    pg.goto(BASE + '/'); pg.wait_for_selector('#grid .card')
    pg.eval_on_selector('#tbConta', 'b => b.click()'); pg.wait_for_selector('#lgC'); pg.fill('#lgC', quem); pg.fill('#lgS', sim.compradores[quem]['senha']); pg.click('#lgOk')
    pg.wait_for_selector('body.logged #grid .card')
    pg.goto(BASE + '/limpeza/detergentes'); t = nomes_na_tela(pg)
    checar(t == esperado, f'seção: {t}')
    pg.goto(BASE + '/catalogo?busca=detergente'); t = nomes_na_tela(pg)
    checar(t == esperado, f'busca: {t}')
    checar(not erros, f'erros: {erros}')
    ctx.close()
print('Ordem por tipo com medida: todos os testes passaram.')
