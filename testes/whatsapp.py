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
        # 1) Cadastro: todo cadastro entra no remarketing
        erros = []
        sim = Sim()
        ctx = br.new_context(viewport={'width': largura, 'height': 900}); pg = ctx.new_page()
        pg.on('pageerror', lambda e: erros.append(str(e)))
        pg.route('**/*', sim.rota)
        for h in ('publica.cnpj.ws', 'open.cnpja.com', 'brasilapi.com.br', 'viacep.com.br'):
            pg.route(f'**/{h}/**', lambda r: r.fulfill(status=404, headers={'Access-Control-Allow-Origin': '*'}, body='{}'))
        pg.goto(BASE + '/'); pg.wait_for_selector('#grid .card')
        pg.click('#heroCadB'); pg.wait_for_selector('#mCad.open #kDoc')
        preencher(pg, '529.982.247-25'); pg.click('#kEnviar'); pg.wait_for_selector('#cadBox .ok h3', timeout=40000)
        checar(sim.cadastros and sim.cadastros[-1].get('aceita_whatsapp') is True, f'{largura}: não gravou o aceite')
        checar(not erros, f'{largura}: erros: {erros}')
        ctx.close()

    # 2) Painel: aba WhatsApp em simulação, salvar, simular, erro de prazo, não mandar mais
    sim = Sim()
    sim.cadastros.append({'id': 'c1', 'documento': '11111111000111', 'razao_social': 'Empresa Fictícia LTDA', 'whats': '34999990000', 'email': 'compras@example.invalid', 'aceita_whatsapp': True, 'status': 'aprovado', 'codigo_g360': 77, 'criado_em': '2026-11-25T10:00:00Z'})
    for largura in (390, 1280):
        ctx = br.new_context(viewport={'width': largura, 'height': 900}); pg = ctx.new_page(); erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        pg.route('**/*', sim.rota); pg.goto(BASE + '/painel'); pg.wait_for_selector('#aUsu')
        pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk'); pg.wait_for_selector('#vAdm [data-at="cli"].on')
        pg.click('#vAdm [data-at="wpp"]'); pg.wait_for_selector('#wppPanel .wpp-topo')
        t = pg.inner_text('#wppPanel')
        checar('Remarketing' in t and 'WhatsApp: 🧪 simulação' in t and '1 cliente cadastrado' in t, f'{largura}: topo da aba: {t[:200]}')
        checar(pg.is_disabled('#wpLig') and not pg.is_disabled('#wpLigEmail'), f'{largura}: chaves de ligar WhatsApp/e-mail erradas')
        # tem de dar erro: prazo fora do limite
        g = pg.locator('.wpp-g[data-g="cadastro_sem_senha"]')
        g.locator('[data-ativo]').check(); g.locator('[data-espera]').fill('999')
        pg.click('#wpSalvar'); pg.wait_for_selector('#wppPanel .okmsg.bad')
        checar('prazo vai de 1 a 168' in pg.inner_text('#wppPanel'), f'{largura}: erro do prazo não apareceu')
        g = pg.locator('.wpp-g[data-g="cadastro_sem_senha"]')
        g.locator('[data-ativo]').check(); g.locator('[data-espera]').fill('24'); pg.click('#wpSalvar')
        pg.wait_for_function("!document.querySelector('#wppPanel .okmsg.bad')", timeout=10000)
        checar(sim.wpp_cfg['gatilhos']['cadastro_sem_senha']['ativo'] is True and sim.wpp_cfg['gatilhos']['cadastro_sem_senha']['espera'] == 24, f'{largura}: não salvou o gatilho')
        # tem de dar erro: gatilho ligado sem canal
        g = pg.locator('.wpp-g[data-g="cadastro_sem_senha"]')
        g.locator('[data-canal="whatsapp"]').uncheck(); g.locator('[data-canal="email"]').uncheck(); pg.click('#wpSalvar'); pg.wait_for_selector('#wppPanel .okmsg.bad')
        checar('escolha WhatsApp, e-mail' in pg.inner_text('#wppPanel'), f'{largura}: salvou gatilho sem canal')
        g = pg.locator('.wpp-g[data-g="cadastro_sem_senha"]')
        g.locator('[data-canal="whatsapp"]').check(); g.locator('[data-canal="email"]').check()
        checar(g.locator('[data-assunto]').is_visible(), f'{largura}: campos do e-mail não aparecem')
        pg.click('#wpSalvar'); pg.wait_for_function("!document.querySelector('#wppPanel .okmsg.bad')", timeout=10000)
        pg.click('#wpSim'); pg.wait_for_function("document.querySelector('#wpRes')?.textContent.includes('simulada')", timeout=15000)
        tp = pg.inner_text('#wppPanel')
        checar('Empresa Fictícia LTDA' in tp and 'final 0000' in tp and 'co***@example.invalid' in tp, f'{largura}: envios simulados (WhatsApp e e-mail) não apareceram')
        checar('compras@example.invalid' not in tp, f'{largura}: e-mail completo na tela')
        checar('34999990000' not in pg.inner_text('#wppPanel'), f'{largura}: telefone completo na tela')
        # não mandar mais: celular inválido dá erro; válido entra na lista
        pg.fill('#wpSaiTel', '123'); pg.click('#wpSaiOk'); pg.wait_for_selector('#wppPanel .okmsg.bad')
        checar('DDD ou o e-mail' in pg.inner_text('#wppPanel'), f'{largura}: contato inválido aceito')
        pg.fill('#wpSaiTel', 'sai@example.invalid'); pg.click('#wpSaiOk'); pg.wait_for_function("document.querySelector('#wppPanel').innerText.includes('sa***@example.invalid')", timeout=10000)
        pg.fill('#wpSaiTel', '(34) 98888-1234'); pg.click('#wpSaiOk'); pg.wait_for_function("document.querySelector('#wppPanel').innerText.includes('Final 1234')", timeout=10000)
        checar(pg.evaluate('document.documentElement.scrollWidth') <= largura, f'{largura}: rolagem horizontal')
        if largura == 390: pg.screenshot(path='/tmp/wpp390.png', full_page=True)
        checar(not erros, f'{largura}: erros: {erros}')
        ctx.close()

    # 3) Página "Não quero mais receber": link válido sai; link quebrado dá erro
    for largura in (390, 1280):
        sim = Sim()
        ctx = br.new_context(viewport={'width': largura, 'height': 900}); pg = ctx.new_page(); erros = []
        pg.on('pageerror', lambda e: erros.append(str(e))); pg.route('**/*', sim.rota)
        pg.goto(BASE + '/sair-emails#t=' + 'a' * 64 + '.' + 'b' * 32); pg.wait_for_selector('#g360Sair')
        checar('#t=' not in pg.url, f'{largura}: token ficou no endereço')
        checar(not any(c[1] == 'sair_email' for c in sim.chamadas if c[0] == 'WPP'), f'{largura}: saiu sem tocar no botão')
        pg.click('#g360Sair'); pg.wait_for_selector('#g360SairRes .g360-msg')
        checar('não vai mais receber' in pg.inner_text('#g360SairRes') and sim.wpp_saidas, f'{largura}: não saiu pelo link')
        ctx.close()
        sim = Sim()
        ctx = br.new_context(viewport={'width': largura, 'height': 900}); pg = ctx.new_page(); pg.route('**/*', sim.rota)
        pg.goto(BASE + '/sair-emails#t=quebrado'); pg.wait_for_selector('#g360Sair')
        pg.click('#g360Sair'); pg.wait_for_selector('#g360SairRes .g360-msg-corrigir')
        checar('não é válido' in pg.inner_text('#g360SairRes'), f'{largura}: link quebrado não deu erro')
        checar(not erros, f'{largura}: erros: {erros}')
        ctx.close()
    br.close()

if falhas:
    print('FALHAS:'); [print(' -', f) for f in falhas]; sys.exit(1)
print('WhatsApp: todos os testes passaram.')
