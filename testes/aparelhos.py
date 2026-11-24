"""Computador × celular: o portal registra o tipo de aparelho no acesso e o painel (Inteligência) mostra.
Roda contra http://localhost:5173 (npm run build && npm run preview), com o simulador (dados fictícios)."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from simulador import Sim, BASE
CHROME = os.environ.get('CHROME') or None
falhas = []
def checar(c, m):
    if not c: falhas.append(m)

IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
sim = Sim()
quem = '11.111.111/0001-11'

def entrar(pg):
    pg.goto(BASE + '/'); pg.wait_for_selector('#grid .card')
    pg.eval_on_selector('#tbConta', 'b => b.click()'); pg.wait_for_selector('#lgC'); pg.fill('#lgC', quem); pg.fill('#lgS', sim.compradores[quem]['senha']); pg.click('#lgOk')
    pg.wait_for_selector('body.logged #grid .card'); pg.wait_for_timeout(1500)

with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    # 1) celular (iPhone) e 2) computador
    for ua, vp, esperado in ((IPHONE, {'width': 390, 'height': 844}, 'celular'), (None, {'width': 1280, 'height': 900}, 'computador')):
        ctx = br.new_context(viewport=vp, **({'user_agent': ua, 'is_mobile': True, 'has_touch': True} if ua else {}))
        pg = ctx.new_page(); erros = []; pg.on('pageerror', lambda e: erros.append(str(e))); pg.route('**/*', sim.rota)
        antes = len(sim.eventos)
        entrar(pg)
        novos = [e for e in sim.eventos[antes:] if e.get('tipo') == 'acesso']
        checar(len(novos) == 1 and novos[0].get('aparelho') == esperado and novos[0].get('app') is False, f'acesso {esperado}: {novos}')
        # F5 logo depois não conta outro acesso (no máximo um a cada 30 min por aba)
        pg.reload(); pg.wait_for_selector('#grid .card'); pg.wait_for_timeout(1500)
        checar(len([e for e in sim.eventos[antes:] if e.get('tipo') == 'acesso']) == 1, 'F5 contou acesso repetido')
        for e in sim.eventos[antes:]:
            checar(set(e) <= {'loja', 'comprador_codigo', 'tipo', 'aparelho', 'app', 'termo', 'resultados', 'pedido_id', 'pedido_numero', 'valor', 'itens'}, f'campo inesperado no evento: {e}')
        checar(not erros, f'erros de script ({esperado}): {erros}')
        ctx.close()
    # 3) painel › Inteligência mostra o quadro
    sim.eventos.append({'loja': 'x', 'comprador_codigo': 1165, 'tipo': 'pedido', 'aparelho': 'computador', 'app': False, 'valor': '150.00', 'itens': []})
    ctx = br.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); erros = []
    pg.on('pageerror', lambda e: erros.append(str(e))); pg.route('**/*', sim.rota)
    pg.goto(BASE + '/painel'); pg.wait_for_selector('#aUsu')
    pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk'); pg.wait_for_selector('#vAdm [data-at="ini"].on')
    pg.click('[data-at="intel"]'); pg.wait_for_selector('#intelPanel .ap-grade')
    t = ' '.join(pg.inner_text('#intelPanel .ap-grade').split())
    checar('Celular 50%' in t and 'Computador 50%' in t and 'Computador 100%' in t, f'quadro computador × celular: {t}')
    pg.locator('#intelPanel .ap-grade').screenshot(path='/tmp/vis/aparelhos.png')
    checar(not erros, f'erros de script (painel): {erros}')
    br.close()

print('FALHAS:' if falhas else 'Computador × celular: todos os testes passaram.')
for f in falhas: print(' -', f)
