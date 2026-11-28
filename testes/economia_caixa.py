"""Economia da caixa (28/11/2026): nos produtos com caixa, o cartão mostra quanto se economiza comprando a caixa,
comparando os dois preços que a API mandou para o comprador. Dados fictícios."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from simulador import Sim, BASE
from playwright.sync_api import sync_playwright

def checar(ok, msg):
    if not ok: raise SystemExit('FALHOU: ' + msg)
def txt(pg, sel): return ' '.join((pg.text_content(sel) or '').split())

with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--no-sandbox'])
    for largura in (390, 1280):
        sim = Sim(); quem = next(iter(sim.compradores))
        # 102: caixa mais cara que 12 unidades (não pode mostrar economia)
        next(p for p in sim.produtos if p['id'] == 102)['unidades'] = [{'id': 'CX*12.0000', 'nome': 'CX', 'descricao': 'CX com 12 UN', 'preco': '999.00', 'seu_preco': None, 'quantidade_disponivel': '3'}]
        ctx = br.new_context(viewport={'width': largura, 'height': 900}); pg = ctx.new_page(); erros = []
        pg.on('pageerror', lambda e: erros.append(str(e))); pg.route('**/*', sim.rota)
        pg.goto(BASE + '/'); pg.wait_for_selector('#grid .card')
        pg.eval_on_selector('#tbConta', 'b => b.click()'); pg.wait_for_selector('#lgC'); pg.fill('#lgC', quem); pg.fill('#lgS', sim.compradores[quem]['senha']); pg.click('#lgOk')
        pg.wait_for_selector('body.logged #grid .card'); pg.wait_for_timeout(800)
        # 101: UN R$ 11,50, CX com 12 = R$ 125,00 → 12 × 11,50 = 138,00 → economiza R$ 13,00 (9%)
        t = txt(pg, '.card[data-id="101"] .price')
        checar('Comprando CX com 12, você economiza R$ 13,00' in t and '(9%)' in t, f'{largura}: linha na unidade: {t}')
        pg.click('.card[data-id="101"] .unsel [data-un="CX12"]'); pg.wait_for_timeout(200)
        t = txt(pg, '.card[data-id="101"] .price')
        checar('Você economiza R$ 13,00 por cx' in t and 'R$ 1,08 a menos por un' in t, f'{largura}: linha na caixa: {t}')
        # Tem de dar errado: caixa que sai mais cara não mostra economia nenhuma.
        cards = pg.eval_on_selector_all('.card', 'cs => cs.map(c => [c.dataset.id, c.innerText.includes("economiza")])')
        checar(['102', False] in [list(x) for x in cards] or not any(x[0] == '102' for x in cards), f'{largura}: cartão 102: {cards[:5]}')
        checar(sum(1 for x in cards if x[1]) == 1, f'{largura}: economia em cartão sem caixa mais barata: {[x for x in cards if x[1]]}')
        checar(not erros, f'{largura}: erros: {erros}')
        if largura == 1280: pg.locator('.card[data-id="101"]').screenshot(path='/tmp/eco_card.png')
        ctx.close()
print('Economia da caixa: todos os testes passaram.')
