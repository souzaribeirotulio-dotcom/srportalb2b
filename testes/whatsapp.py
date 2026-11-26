"""WhatsApp (remarketing): caixa de aceite no Quero ser cliente e aba WhatsApp no painel (modo simulação).
Roda contra http://localhost:5173 (npm run build && npm run preview), com o simulador (dados fictícios)."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from simulador import Sim, BASE
CHROME = os.environ.get('CHROME') or None
falhas = []
def checar(c, m):
    if not c: falhas.append(m)

def preencher(pg, doc):
    for i, v in [('kDoc', doc), ('kRazao', 'Empresa Fictícia LTDA'), ('kResp', 'Pessoa Fictícia'), ('kWhats', '(34) 99999-0000'),
                 ('kEmail', 'compras@example.invalid'), ('kRua', 'Rua Exemplo'), ('kNum', '10'), ('kCidade', 'Cidade Exemplo'), ('kBairro', 'Centro')]:
        pg.fill('#' + i, v)
    pg.fill('#kCep', '38400000'); pg.select_option('#kSeg', 'Escritório')
    if pg.locator('#kOrigem').is_visible(): pg.select_option('#kOrigem', 'Instagram')

with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    for largura in (390, 1280):
        # 1) Cadastro: a caixa começa desmarcada; sem marcar, não aceita (LGPD)
        sim = Sim()
        ctx = br.new_context(viewport={'width': largura, 'height': 900}); pg = ctx.new_page(); erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        pg.route('**/*', sim.rota)
        for h in ('publica.cnpj.ws', 'open.cnpja.com', 'brasilapi.com.br', 'viacep.com.br'):
            pg.route(f'**/{h}/**', lambda r: r.fulfill(status=404, headers={'Access-Control-Allow-Origin': '*'}, body='{}'))
        pg.goto(BASE + '/'); pg.wait_for_selector('#grid .card')
        pg.click('#heroCadB'); pg.wait_for_selector('#mCad.open #kDoc')
        checar(not pg.is_checked('#kWppOk'), f'{largura}: caixa do WhatsApp veio marcada')
        preencher(pg, '529.982.247-25'); pg.click('#kEnviar'); pg.wait_for_selector('#cadBox .ok h3', timeout=40000)
        checar(sim.cadastros and sim.cadastros[-1].get('aceita_whatsapp') is False, f'{largura}: sem marcar, gravou aceite: {sim.cadastros[-1].get("aceita_whatsapp") if sim.cadastros else None}')
        ctx.close()
        # marcando: grava o aceite
        sim = Sim()
        ctx = br.new_context(viewport={'width': largura, 'height': 900}); pg = ctx.new_page()
        pg.route('**/*', sim.rota)
        for h in ('publica.cnpj.ws', 'open.cnpja.com', 'brasilapi.com.br', 'viacep.com.br'):
            pg.route(f'**/{h}/**', lambda r: r.fulfill(status=404, headers={'Access-Control-Allow-Origin': '*'}, body='{}'))
        pg.goto(BASE + '/'); pg.wait_for_selector('#grid .card')
        pg.click('#heroCadB'); pg.wait_for_selector('#mCad.open #kDoc')
        preencher(pg, '529.982.247-25'); pg.check('#kWppOk'); pg.click('#kEnviar'); pg.wait_for_selector('#cadBox .ok h3', timeout=40000)
        checar(sim.cadastros and sim.cadastros[-1].get('aceita_whatsapp') is True, f'{largura}: marcou e não gravou o aceite')
        checar(not erros, f'{largura}: erros: {erros}')
        ctx.close()

    # 2) Painel: aba WhatsApp em simulação, salvar, simular, erro de prazo, não mandar mais
    sim = Sim()
    sim.cadastros.append({'id': 'c1', 'documento': '11111111000111', 'razao_social': 'Empresa Fictícia LTDA', 'whats': '34999990000', 'aceita_whatsapp': True, 'status': 'aprovado', 'codigo_g360': 77, 'criado_em': '2026-11-25T10:00:00Z'})
    for largura in (390, 1280):
        ctx = br.new_context(viewport={'width': largura, 'height': 900}); pg = ctx.new_page(); erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        pg.route('**/*', sim.rota); pg.goto(BASE + '/painel'); pg.wait_for_selector('#aUsu')
        pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk'); pg.wait_for_selector('#vAdm [data-at="cli"].on')
        pg.click('#vAdm [data-at="wpp"]'); pg.wait_for_selector('#wppPanel .wpp-topo')
        t = pg.inner_text('#wppPanel')
        checar('Modo simulação' in t and '1 cliente aceitou' in t, f'{largura}: topo da aba: {t[:160]}')
        checar(pg.is_disabled('#wpLig'), f'{largura}: dava para ligar o envio sem a API do parceiro')
        # tem de dar erro: prazo fora do limite
        g = pg.locator('.wpp-g[data-g="cadastro_sem_senha"]')
        g.locator('[data-ativo]').check(); g.locator('[data-espera]').fill('999')
        pg.click('#wpSalvar'); pg.wait_for_selector('#wppPanel .okmsg.bad')
        checar('prazo vai de 1 a 168' in pg.inner_text('#wppPanel'), f'{largura}: erro do prazo não apareceu')
        g = pg.locator('.wpp-g[data-g="cadastro_sem_senha"]')
        g.locator('[data-ativo]').check(); g.locator('[data-espera]').fill('24'); pg.click('#wpSalvar')
        pg.wait_for_function("!document.querySelector('#wppPanel .okmsg.bad')", timeout=10000)
        checar(sim.wpp_cfg['gatilhos']['cadastro_sem_senha']['ativo'] is True and sim.wpp_cfg['gatilhos']['cadastro_sem_senha']['espera'] == 24, f'{largura}: não salvou o gatilho')
        pg.click('#wpSim'); pg.wait_for_function("document.querySelector('#wpRes')?.textContent.includes('simulado')", timeout=15000)
        checar('Empresa Fictícia LTDA' in pg.inner_text('#wppPanel') and 'final 0000' in pg.inner_text('#wppPanel'), f'{largura}: envio simulado não apareceu na lista')
        checar('34999990000' not in pg.inner_text('#wppPanel'), f'{largura}: telefone completo na tela')
        # não mandar mais: celular inválido dá erro; válido entra na lista
        pg.fill('#wpSaiTel', '123'); pg.click('#wpSaiOk'); pg.wait_for_selector('#wppPanel .okmsg.bad')
        checar('DDD' in pg.inner_text('#wppPanel'), f'{largura}: celular inválido aceito')
        pg.fill('#wpSaiTel', '(34) 98888-1234'); pg.click('#wpSaiOk'); pg.wait_for_function("document.querySelector('#wppPanel').innerText.includes('Final 1234')", timeout=10000)
        checar(pg.evaluate('document.documentElement.scrollWidth') <= largura, f'{largura}: rolagem horizontal')
        if largura == 390: pg.screenshot(path='/tmp/wpp390.png', full_page=True)
        checar(not erros, f'{largura}: erros: {erros}')
        ctx.close()
    br.close()

if falhas:
    print('FALHAS:'); [print(' -', f) for f in falhas]; sys.exit(1)
print('WhatsApp: todos os testes passaram.')
