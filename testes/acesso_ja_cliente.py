"""'Já é cliente e ainda não tem senha': mesmo formulário do Quero ser cliente, pedido marcado para a equipe.
Roda contra http://localhost:5173 (npm run build && npm run preview), com o simulador (dados fictícios)."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from simulador import Sim, BASE
CHROME = os.environ.get('CHROME') or None
falhas = []
def checar(c, m):
    if not c: falhas.append(m)

def abrir(pw, sim, largura=390):
    br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    pg = br.new_page(viewport={'width': largura, 'height': 900}); erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.route('**/*', sim.rota)
    for h in ('publica.cnpj.ws', 'open.cnpja.com', 'brasilapi.com.br', 'viacep.com.br'):
        pg.route(f'**/{h}/**', lambda r: r.fulfill(status=404, headers={'Access-Control-Allow-Origin': '*'}, body='{}'))
    pg.goto(BASE + '/'); pg.wait_for_selector('#grid .card')
    return br, pg, erros

def preencher(pg):
    for i, v in [('kDoc', '12.ABC.345/01DE-35'), ('kRazao', 'Empresa Fictícia LTDA'), ('kResp', 'Pessoa Fictícia'), ('kWhats', '(34) 99999-0000'),
                 ('kEmail', 'compras@example.invalid'), ('kRua', 'Rua Exemplo'), ('kNum', '10'), ('kCidade', 'Cidade Exemplo'), ('kBairro', 'Centro')]:
        pg.fill('#' + i, v)
    pg.fill('#kCep', '38400000'); pg.select_option('#kSeg', 'Escritório')

with sync_playwright() as pw:
    # 1) Pela capa: mesmo formulário, título próprio, sem "como conheceu", pedido marcado
    sim = Sim(); br, pg, erros = abrir(pw, sim)
    checar(pg.locator('#heroAcesso').is_visible(), 'link "Já é cliente" ausente na capa')
    pg.click('#heroAcesso'); pg.wait_for_selector('#mCad.open #kDoc')
    checar('Pedir acesso ao portal' in pg.text_content('#cadBox'), 'título do pedido de acesso')
    for c in ('kWhats', 'kEmail', 'kResp', 'kRazao', 'kCep', 'kSeg'):
        checar(pg.locator('#' + c).is_visible(), f'campo {c} ausente no pedido de acesso (formulário tem de ser igual)')
    checar(not pg.locator('#kOrigem').is_visible(), '"Como conheceu" não faz sentido para quem já é cliente')
    pg.click('#kEnviar')
    checar('WhatsApp' in pg.text_content('#kWhatsErr'), 'teste que tem de dar erro: formulário vazio enviado')
    preencher(pg); pg.click('#kEnviar'); pg.wait_for_selector('#cadBox .ok')
    checar('Pedido de acesso em análise' in pg.text_content('#cadBox'), 'tela depois de enviar o pedido de acesso')
    checar(len(sim.cadastros) == 1 and sim.cadastros[0].get('origem') == 'Já é cliente (pedir acesso)', f'pedido não marcado como "já é cliente": {sim.cadastros}')
    pg.keyboard.press('Escape'); pg.wait_for_selector('#mCad:not(.open)', state='attached')
    checar(not pg.locator('#heroAcesso').is_visible(), 'link continua depois de pedir (deveria mostrar "em análise")')
    checar(not erros, f'erros de script: {erros}')
    br.close()

    # 2) Pelo login: "Ainda não tenho senha"
    sim = Sim(); br, pg, erros = abrir(pw, sim)
    pg.click('#tbConta'); pg.wait_for_selector('#mLogin.open')
    checar(pg.locator('#lgSemSenha').is_visible(), 'link "Ainda não tenho senha" ausente no login')
    pg.click('#lgSemSenha'); pg.wait_for_selector('#mCad.open #kDoc')
    checar('Pedir acesso ao portal' in pg.text_content('#cadBox') and pg.locator('#mLogin.open').count() == 0, 'login não levou ao pedido de acesso')
    br.close()

    # 3) Quero ser cliente continua igual (com "Como conheceu" e origem escolhida)
    sim = Sim(); br, pg, erros = abrir(pw, sim)
    pg.click('#heroCadB'); pg.wait_for_selector('#mCad.open #kDoc')
    checar('Quero ser cliente' in pg.text_content('#cadBox h3') and pg.locator('#kOrigem').is_visible(), 'Quero ser cliente mudou')
    preencher(pg); pg.select_option('#kOrigem', 'Instagram'); pg.click('#kEnviar'); pg.wait_for_selector('#cadBox .ok')
    checar(sim.cadastros[0].get('origem') == 'Instagram', 'origem do Quero ser cliente')
    br.close()

    # 4) Sem troca de senha pelo portal: não oferece "ainda não tenho senha"
    sim = Sim(troca_senha=False); br, pg, erros = abrir(pw, sim)
    checar(not pg.locator('#heroAcesso').is_visible(), 'link aparece com troca_senha falso')
    pg.click('#tbConta'); pg.wait_for_selector('#mLogin.open')
    checar(not pg.locator('#lgSemSenha').is_visible(), '"Ainda não tenho senha" aparece com troca_senha falso')
    br.close()

    # 5) Telas: sem rolagem horizontal
    sim = Sim(); br, pg, erros = abrir(pw, sim)
    for w in (360, 390, 768, 1280, 1920):
        pg.set_viewport_size({'width': w, 'height': 900}); pg.wait_for_timeout(150)
        checar(pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'rolagem horizontal em {w}px')
        if w in (390, 1280): pg.screenshot(path=f'/tmp/vis/acesso{w}.png')
    br.close()

print('FALHAS:' if falhas else 'Já é cliente / pedir acesso: todos os testes passaram.')
for f in falhas: print(' -', f)
