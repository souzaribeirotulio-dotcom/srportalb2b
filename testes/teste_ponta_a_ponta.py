"""Teste ponta a ponta do Portal B2B em modo demonstração, com rede externa BLOQUEADA.
Executa no computador (1366x850) e no celular (390x844, toque)."""
import sys, json, re
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8123/'
OUT = 'testes/capturas'
import os; os.makedirs(OUT, exist_ok=True)
bloqueadas, erros = [], []

def card(page, cod):
    return page.locator('#grid .card', has=page.locator('.meta', has_text=f'Cód. {cod} '))

def roda(nome, device):
    with sync_playwright() as pw:
        br = pw.chromium.launch(args=['--no-sandbox'])
        ctx = br.new_context(**device)
        def rota(route):
            h = urlparse(route.request.url).hostname
            if route.request.url.startswith('data:') or h in ('127.0.0.1', 'localhost'):
                return route.continue_()
            bloqueadas.append(f'{nome}: {route.request.url[:90]}'); route.abort()
        ctx.route('**/*', rota)
        page = ctx.new_page()
        page.on('pageerror', lambda e: erros.append(f'{nome} pageerror: {e}'))
        page.on('console', lambda m: m.type == 'error' and erros.append(f'{nome} console: {m.text[:200]}'))
        page.goto(BASE)
        page.wait_for_selector('#grid .card')
        n = page.locator('#grid .card').count()
        assert n == 36, f'esperava 36 produtos visíveis (1 sem estoque oculto), veio {n}'
        assert page.locator('#grid .price').count() == 0, 'preço visível sem login'
        page.wait_for_selector('.demo-faixa')
        page.screenshot(path=f'{OUT}/{nome}_1_catalogo_sem_login.png')

        # LOGIN
        page.locator('#grid [data-lock]').first.click()
        page.fill('#lgC', '12345678000190'); page.fill('#lgS', 'demo123'); page.click('#lgOk')
        try: page.wait_for_selector('#grid .price', timeout=10000)
        except Exception:
            page.screenshot(path=f'{OUT}/{nome}_FALHA_login.png')
            print('DIAG', page.evaluate("({lgC:document.getElementById('lgC').value,e:document.getElementById('lgE').textContent,open:document.getElementById('mLogin').className,CLI:typeof CLI!=='undefined'&&!!CLI,cards:document.querySelectorAll('#grid .card').length})"), erros)
            raise
        expect(card(page, 'C5001').locator('.tagcg')).to_have_text('Preço especial')
        page.screenshot(path=f'{OUT}/{nome}_2_catalogo_logado.png')

        # CARRINHO: caixa do copo + canudo acima do estoque fictício (8)
        c = card(page, 'D1001'); c.scroll_into_view_if_needed(); c.locator('.unsel button[data-un="CX"]').click()
        c.locator('.qty input').fill('2'); c.locator('.add').click()
        c = card(page, 'D1006'); c.scroll_into_view_if_needed(); c.locator('.qty input').fill('20'); c.locator('.add').click()
        c = card(page, 'C5001'); c.scroll_into_view_if_needed(); c.locator('.add').click()
        expect(page.locator('#cartN')).to_have_text('3')
        page.click('#cartBtn'); page.wait_for_selector('#drawer.open')
        page.screenshot(path=f'{OUT}/{nome}_3_carrinho.png')
        page.click('#dGo')

        # REVISÃO com bloqueio de estoque vindo do serviço
        page.wait_for_selector('#chkBox .rvl')
        txt = page.inner_text('#chkBox').replace('\xa0',' ')
        assert '1 caixa = 25 pacotes' in txt, 'conversão da caixa não exibida'
        assert 'Estoque fictício disponível: 8' in txt
        assert page.locator('#cOk').is_disabled(), 'deveria bloquear envio acima do estoque (retorno do serviço)'
        page.screenshot(path=f'{OUT}/{nome}_4_revisao_bloqueada.png', full_page=False)
        page.click('#cX')
        page.click('#cartBtn'); page.wait_for_selector('#drawer.open')
        row = page.locator('#dBody .ci', has_text='Canudo'); row.locator('input').fill('5'); row.locator('input').dispatch_event('change')
        page.click('#dGo'); page.wait_for_selector('#chkBox .rvl')
        assert page.locator('#cOk').is_enabled()
        txt = page.inner_text('#chkBox').replace('\xa0',' ')
        assert 'R$ 248,00' in txt and 'R$ 39,50' in txt and 'R$ 19,90' in txt, 'valores do serviço ausentes'
        assert 'Total' in txt and 'R$ 307,40' in txt, 'total do serviço ausente'
        # troca endereço → nova revisão
        page.locator('#cEnd input[name=en][value=e1]').check(); page.wait_for_selector('#chkBox .rvl')
        assert 'Filial Bairro Novo' in page.inner_text('#chkBox')
        page.locator('input[name=pg][value=pix]').check()
        page.select_option('#cCen', 'falha_uma_vez')
        page.screenshot(path=f'{OUT}/{nome}_5_revisao.png')

        # ENVIO: falha simulada → mantém carrinho e permite tentar de novo
        page.click('#cOk'); page.wait_for_selector('.rv-falha')
        expect(page.locator('#cOk')).to_have_text('Tentar novamente')
        expect(page.locator('#cartN')).to_have_text('3')
        page.locator('.rv-falha').scroll_into_view_if_needed()
        page.screenshot(path=f'{OUT}/{nome}_6_falha.png')
        page.click('#cOk'); page.wait_for_selector('#chkBox .ok')
        expect(page.locator('#chkBox .ok h3')).to_have_text('Pedido simulado com sucesso')
        assert 'nenhum pedido real' in page.inner_text('#chkBox')
        expect(page.locator('#cartN')).to_have_text('')
        page.screenshot(path=f'{OUT}/{nome}_7_confirmacao.png')

        # HISTÓRICO
        page.click('#okP'); page.wait_for_selector('#pPanel .ped')
        t = page.inner_text('#pPanel').replace('\xa0',' ')
        assert 'DEMO-00001' in t and 'Histórico de demonstração' in t and 'Simulado' in t
        page.screenshot(path=f'{OUT}/{nome}_8_historico.png')

        # Recarregar: sessão e histórico vêm do serviço simulado
        page.reload(); page.wait_for_selector('#grid .price')

        # SAIR e ADMIN
        page.evaluate('sairConta()'); page.wait_for_selector('#grid [data-lock]')
        page.evaluate("openLogin(null,'adm')")
        page.fill('#lgC', 'demo'); page.fill('#lgS', 'demo123'); page.click('#lgOk')
        page.wait_for_selector('#aPanel .arow[data-c]', timeout=8000)
        page.screenshot(path=f'{OUT}/{nome}_9_admin.png')
        ctx.close(); br.close()

roda('computador', dict(viewport={'width': 1366, 'height': 850}))
roda('celular', dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2))
print('BLOQUEADAS (rede externa):', json.dumps(sorted(set(re.sub(r'^\w+: ', '', b) for b in bloqueadas)), indent=1, ensure_ascii=False))
print('ERROS:', json.dumps(erros, indent=1, ensure_ascii=False))
print('OK — todos os passos passaram')
