"""Busca no endereço (28/11/2026): /catalogo?busca=fibra abre o catálogo já pesquisado, a pesquisa digitada
vai para o endereço (dá para salvar e mandar o link) e o F5 mantém. Dados fictícios."""
import os, sys
from urllib.parse import urlparse, parse_qs
sys.path.insert(0, os.path.dirname(__file__))
from simulador import Sim, BASE
from playwright.sync_api import sync_playwright

def checar(ok, msg):
    if not ok: raise SystemExit('FALHOU: ' + msg)
def busca(pg): return parse_qs(urlparse(pg.url).query).get('busca', [None])[0]
def ids(pg): return pg.eval_on_selector_all('#grid .card', 'cs => cs.map(c => c.dataset.id)')

with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--no-sandbox'])
    sim = Sim(); quem = next(iter(sim.compradores))
    ctx = br.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); erros = []
    pg.on('pageerror', lambda e: erros.append(str(e))); pg.route('**/*', sim.rota)
    # Visitante com link no padrão ?search=: abre pesquisado e o endereço passa para ?busca=
    pg.goto(BASE + '/catalogo?search=Fict%C3%ADcio%20103'); pg.wait_for_selector('#grid .card'); pg.wait_for_timeout(900)
    checar(pg.input_value('#q') == 'Fictício 103', f'visitante: campo {pg.input_value("#q")!r}')
    checar(busca(pg) == 'Fictício 103' and 'search=' not in pg.url, f'visitante: endereço {pg.url}')
    # Entra: a pesquisa continua no endereço
    pg.eval_on_selector('#tbConta', 'b => b.click()'); pg.wait_for_selector('#lgC'); pg.fill('#lgC', quem); pg.fill('#lgS', sim.compradores[quem]['senha']); pg.click('#lgOk')
    pg.wait_for_selector('body.logged #grid .card'); pg.wait_for_timeout(900)
    checar(busca(pg) == 'Fictício 103', f'depois do login: {pg.url}')
    checar(ids(pg) == ['103'], f'depois do login, cartões: {ids(pg)}')
    # Digita outra pesquisa: o endereço acompanha
    pg.fill('#q', 'Fictício 105'); pg.wait_for_timeout(900)
    checar(busca(pg) == 'Fictício 105', f'digitando: {pg.url}')
    # F5 mantém a pesquisa
    pg.reload(); pg.wait_for_selector('body.logged #grid .card'); pg.wait_for_timeout(900)
    checar(pg.input_value('#q') == 'Fictício 105' and ids(pg) == ['105'], f'F5: {pg.input_value("#q")!r} {ids(pg)}')
    # Tem de sumir: limpar a pesquisa tira o ?busca= do endereço
    pg.fill('#q', ''); pg.wait_for_timeout(900)
    checar(busca(pg) is None and '?' not in pg.url, f'limpar: {pg.url}')
    checar(len(ids(pg)) > 1, f'limpar, cartões: {ids(pg)}')
    checar(not erros, f'erros: {erros}')
    ctx.close()
print('Busca no endereço: todos os testes passaram.')
