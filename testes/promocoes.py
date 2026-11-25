"""Promoções no catálogo, na página do produto e no carrinho (bloco promocao do contrato; dados fictícios).
Roda contra http://localhost:5173 (npm run build && npm run preview), com o simulador."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from simulador import Sim, BASE
CHROME = os.environ.get('CHROME') or None
falhas = []
def checar(c, m):
    if not c: falhas.append(m)

sim = Sim()
U1, U2 = '11.111.111/0001-11', '22.222.222/0001-22'
c1 = sim.compradores[U1]['codigo']
sim.promos = {
    106: {'nome': 'Oferta Fictícia', 'normal': '20.00', 'oferta': '15.00', 'meta': '0', 'restam': '30', 'fim': {'data': '2026-12-20', 'hora': '18:00'}, 'clientes': {c1}},
    107: {'nome': 'Leve Mais Fictícia', 'normal': '18.50', 'oferta': '14.00', 'meta': '5', 'restam': None, 'fim': {'data': '2026-12-31', 'hora': None}, 'clientes': {c1}},
    109: {'nome': 'Múltiplos Fictícia', 'normal': '12.00', 'oferta': '10.00', 'meta': '6', 'a_partir': False, 'restam': None, 'clientes': {c1}},
}

def entrar(pg, quem):
    pg.goto(BASE + '/'); pg.wait_for_selector('#grid .card')
    pg.eval_on_selector('#tbConta', 'b => b.click()'); pg.wait_for_selector('#lgC'); pg.fill('#lgC', quem); pg.fill('#lgS', sim.compradores[quem]['senha']); pg.click('#lgOk')
    pg.wait_for_selector('body.logged #grid .card'); pg.wait_for_timeout(800)
def txt(pg, sel): return ' '.join((pg.text_content(sel) or '').split())

with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    ctx = br.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); erros = []
    pg.on('pageerror', lambda e: erros.append(str(e))); pg.route('**/*', sim.rota)
    entrar(pg, U1)
    pg.wait_for_selector('.card[data-id="106"]')
    a = txt(pg, '.card[data-id="106"] .price'); b = txt(pg, '.card[data-id="107"] .price'); c = txt(pg, '.card[data-id="109"] .price')
    checar('R$ 15,00' in a and 'Oferta −25%' in a and 'R$ 20,00' in a and 'Restam 30' in a and 'Até 20/12 às 18:00' in a, f'oferta valendo no cartão: {a}')
    checar(pg.locator('.card[data-id="106"] s.promo-de').count() == 1, 'preço de antes riscado')
    checar('R$ 18,50' in b and 'Leve 5 e pague R$ 14,00 cada' in b and 'Oferta' not in b and 'Até 31/12' in b and 'às' not in b, f'leve N no cartão: {b}')
    checar('A cada 6, pague R$ 10,00 cada' in c, f'múltiplos no cartão: {c}')
    checar('Promoção' not in txt(pg, '.card[data-id="110"] .price'), 'produto sem promoção sem selo')
    # carrinho: 3 do 107 → "Leve mais 2", preço normal; depois 5 → oferta
    c107 = pg.locator('.card[data-id="107"]'); c107.locator('.qty input').fill('3'); c107.locator('.add').click(); pg.wait_for_timeout(300)
    pg.click('#cartBtn'); pg.wait_for_selector('#drawer.open'); pg.click('#dGo'); pg.wait_for_selector('#mChk.open input[name=mod]')
    pg.wait_for_function("document.querySelector('#cResumo') && !/Calculando/.test(document.querySelector('#cResumo').innerText) && document.querySelector('#cResumo').innerText.length > 5")
    r = txt(pg, '#cResumo')
    checar('Leve mais 2 un e pague R$ 14,00 cada' in r and 'R$ 18,50 por' in r and 'economia de R$ 22,50' in r, f'revisão abaixo da meta: {r[:400]}')
    checar(not any(k == 'promocao' for c_ in sim.chamadas if c_[1] == 'revisoes' for it in (c_[3] or {}).get('itens', []) for k in it), 'portal mandou promocao no corpo da revisão')
    checar(not any('preco' in k for c_ in sim.chamadas if c_[1] == 'revisoes' for it in (c_[3] or {}).get('itens', []) for k in it), 'portal mandou preço no corpo da revisão')
    erros_ok = not erros
    ctx.close()
    # a quantidade na meta: oferta aplicada pela revisão
    ctx = br.new_context(viewport={'width': 390, 'height': 900}); pg = ctx.new_page(); pg.on('pageerror', lambda e: erros.append(str(e))); pg.route('**/*', sim.rota)
    entrar(pg, U1); pg.wait_for_selector('.card[data-id="107"]')
    c107 = pg.locator('.card[data-id="107"]'); c107.locator('.qty input').fill('5'); c107.locator('.add').click(); pg.wait_for_timeout(300)
    pg.click('#cartBtn'); pg.wait_for_selector('#drawer.open'); pg.click('#dGo'); pg.wait_for_selector('#mChk.open input[name=mod]')
    pg.wait_for_function("document.querySelector('#cResumo') && !/Calculando/.test(document.querySelector('#cResumo').innerText) && document.querySelector('#cResumo').innerText.length > 5")
    r = txt(pg, '#cResumo')
    checar('R$ 14,00 por' in r and 'Oferta' in r and 'R$ 18,50' in r and 'economia de R$' in r and 'Leve mais' not in r, f'revisão na meta: {r[:400]}')
    checar(pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'rolagem horizontal no celular')
    # página do produto
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    ctx.close()
    # o que tem de dar errado: outro comprador (fora da promoção) não vê selo nenhum
    ctx = br.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); pg.on('pageerror', lambda e: erros.append(str(e))); pg.route('**/*', sim.rota)
    entrar(pg, U2); pg.wait_for_selector('.card[data-id="106"]')
    checar(pg.locator('#grid .tagof').count() == 0 and 'R$ 20,00' not in txt(pg, '.card[data-id="106"] .price'), 'comprador fora da promoção vendo o selo')
    ctx.close(); br.close()
    checar(not erros, f'erros: {erros}')

if falhas:
    print('FALHAS:'); [print(' -', f) for f in falhas]; sys.exit(1)
print('Promoções: todos os testes passaram.')
