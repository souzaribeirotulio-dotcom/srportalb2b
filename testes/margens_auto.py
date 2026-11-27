"""Margens automáticas (27/11/2026): a aba Margens mostra o que a conferência das 18h guardou
(só produtos com estoque positivo) e deixa conferir agora. Dados fictícios."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from simulador import Sim, BASE
from playwright.sync_api import sync_playwright

def checar(ok, msg):
    if not ok: raise SystemExit('FALHOU: ' + msg)

def produto(i, nome, margem, disp, custo=1.0):
    return {'produto_id': i, 'codigo': f'P-{i}', 'nome': nome, 'preco': '10.00', 'custo': custo, 'margem': margem, 'origem_preco': 'tabela', 'disponivel': disp, 'custo_visivel': True, 'verificado_em': '2026-11-27T21:00:00Z'}

with sync_playwright() as pw:
    br = pw.chromium.launch(args=['--no-sandbox'])
    for largura in (390, 1280):
        sim = Sim(); sim.perms_painel = ['cli', 'mrg', 'prod', 'cong']
        sim.mrg_g360 = [produto(1, 'Produto Baixa Margem', 12.5, 30), produto(2, 'Produto Zerado Baixa Margem', 5.0, 0), produto(3, 'Produto Margem Boa', 40.0, 8)]
        ctx = br.new_context(viewport={'width': largura, 'height': 900}); pg = ctx.new_page(); erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        pg.route('**/*', sim.rota)
        pg.goto(BASE + '/painel'); pg.wait_for_selector('#aUsu')
        pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk')
        # Espera as permissões chegarem (a aba que ele não tem some).
        pg.wait_for_selector('#vAdm .atabs [data-at="souzinha"][hidden]', state='attached', timeout=15000)
        pg.eval_on_selector('#vAdm .atabs [data-at="mrg"]', 'b => b.click()')
        pg.wait_for_selector('#mgPanel .mg-auto', timeout=15000)
        t = pg.inner_text('#mgPanel')
        checar('Ainda não houve conferência' in t and 'a partir das 18h' in t, f'{largura}: faixa sem conferência: {t[:200]}')
        pg.click('#mgAgora'); pg.wait_for_function("document.querySelector('#mgPanel').innerText.includes('Última conferência')", timeout=15000)
        t = pg.inner_text('#mgPanel')
        checar('Produto Baixa Margem' in t, f'{largura}: produto com estoque e margem baixa não apareceu')
        # Tem de dar errado: produto com estoque zerado não entra, mesmo com margem baixa; margem boa também não.
        checar('Produto Zerado' not in t and 'Produto Margem Boa' not in t, f'{largura}: entrou produto que não devia: {t[:300]}')
        stats = pg.eval_on_selector_all('#mgPanel .mgsum .stat b', 'bs => bs.map(b => b.textContent)')
        checar(stats[:2] == ['1', '2'], f'{largura}: contagem (abaixo, com estoque): {stats}')
        checar(not erros, f'{largura}: erros: {erros}')
        ctx.close()
    # Sem a permissão de Margens: a função recusa e a aba não aparece.
    sim = Sim(); sim.perms_painel = ['cli']
    ctx = br.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); pg.route('**/*', sim.rota)
    pg.goto(BASE + '/painel'); pg.wait_for_selector('#aUsu'); pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk'); pg.wait_for_timeout(1500)
    checar(pg.locator('#vAdm .atabs [data-at="mrg"]').is_hidden(), 'aba Margens apareceu sem permissão')
    ctx.close()
print('Margens automáticas: todos os testes passaram.')
