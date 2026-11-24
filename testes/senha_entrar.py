"""Link de senha nova: cria a senha e já entra no portal (com e sem Continuar conectado).
Roda contra http://localhost:5173 (npm run build && npm run preview), com o simulador (dados fictícios)."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from simulador import Sim, BASE, LOJA
CHROME = os.environ.get('CHROME') or None
TOKEN = 'exemplo_sem_validade_1111111111111111111111'
DOC = '11.111.111/0001-11'
falhas = []
def checar(c, m):
    if not c: falhas.append(m)

def abrir(pw, sim):
    br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    pg = br.new_page(viewport={'width': 390, 'height': 900}); erros = []
    pg.on('pageerror', lambda e: erros.append(str(e))); console = []
    pg.on('console', lambda m: console.append(m.text))
    pg.route('**/*', sim.rota); pg.goto(BASE + '/definir-senha#token=' + TOKEN); pg.wait_for_selector('#g360Doc')
    return br, pg, erros, console

with sync_playwright() as pw:
    # 1) Sessão normal: cria a senha e cai logado no catálogo, token só na aba
    sim = Sim(); sim.links = {TOKEN: DOC}
    br, pg, erros, console = abrir(pw, sim)
    checar(pg.locator('#g360Cont').count() == 0, 'caixa Continuar conectado sem o recurso ligado')
    pg.fill('#g360Doc', DOC); pg.fill('#g360Senha1', 'Nova123'); pg.fill('#g360Senha2', 'Nova123'); pg.click('#g360SalvarSenha')
    pg.wait_for_selector('body.logged #grid .card', timeout=30000)
    checar(pg.evaluate('location.pathname') == '/', 'não voltou ao catálogo')
    checar(sim.compradores[DOC]['senha'] == 'Nova123' and sim.ultimo_login.get('senha') == 'Nova123', 'não entrou com a senha nova')
    checar('continuar_conectado' not in sim.ultimo_login, 'mandou continuar_conectado sem o recurso ligado')
    checar('Senha criada' in (pg.text_content('#toast') or ''), 'aviso de boas-vindas ausente')
    arm = pg.evaluate('JSON.stringify(localStorage)+"|"+JSON.stringify(sessionStorage)')
    checar('Nova123' not in arm and TOKEN not in arm, 'senha ou token do link guardado')
    checar(f'g360:{LOJA}:comprador:sessao' in arm and f'g360:{LOJA}:comprador:persistente' not in arm, 'token fora da chave da aba')
    checar(not any('Nova123' in c or TOKEN in c for c in console), 'senha ou token no console')
    checar(not erros, f'erros de script: {erros}')
    br.close()

    # 2) Continuar conectado marcado: entra com a sessão longa (localStorage)
    sim = Sim(); sim.links = {TOKEN: DOC}; sim.loja['continuar_conectado_dias'] = 30
    br, pg, erros, console = abrir(pw, sim)
    checar(pg.locator('#g360Cont').count() == 1 and not pg.locator('#g360Cont').is_checked(), 'caixa Continuar conectado deveria vir desmarcada')
    checar('computador compartilhado' in pg.inner_text('#g360FormSenha'), 'aviso de computador compartilhado ausente')
    pg.check('#g360Cont')
    pg.fill('#g360Doc', DOC); pg.fill('#g360Senha1', 'Nova456'); pg.fill('#g360Senha2', 'Nova456'); pg.click('#g360SalvarSenha')
    pg.wait_for_selector('body.logged #grid .card', timeout=30000)
    checar(sim.ultimo_login.get('continuar_conectado') is True, 'não pediu Continuar conectado')
    arm = pg.evaluate('JSON.stringify(localStorage)+"|"+JSON.stringify(sessionStorage)')
    checar(f'g360:{LOJA}:comprador:persistente' in pg.evaluate('JSON.stringify(Object.keys(localStorage))'), 'token da sessão longa fora do localStorage')
    checar('Nova456' not in arm, 'senha guardada')
    br.close()

    # 3) Teste que tem de dar erro: documento digitado errado. A senha fica criada, mas vai para o login.
    sim = Sim(); sim.links = {TOKEN: DOC}
    br, pg, erros, console = abrir(pw, sim)
    pg.fill('#g360Doc', '99.999.999/0001-99'); pg.fill('#g360Senha1', 'Nova789'); pg.fill('#g360Senha2', 'Nova789'); pg.click('#g360SalvarSenha')
    pg.wait_for_selector('#mLogin.open #lgRes .rv-aviso', timeout=30000)
    checar('Senha definida' in pg.text_content('#lgRes') and not pg.evaluate("document.body.classList.contains('logged')"), 'documento errado entrou ou não mandou para o login')
    checar(sim.compradores[DOC]['senha'] == 'Nova789', 'senha não ficou criada')
    br.close()

    # 4) Link já usado: LINK_INVALIDO, sem entrar
    sim = Sim(); sim.links = {}
    br, pg, erros, console = abrir(pw, sim)
    pg.fill('#g360Doc', DOC); pg.fill('#g360Senha1', 'Nova321'); pg.fill('#g360Senha2', 'Nova321'); pg.click('#g360SalvarSenha')
    pg.wait_for_selector('#g360Resultado .g360-msg')
    checar('inválido ou expirou' in pg.inner_text('#g360Resultado') and not getattr(sim, 'ultimo_login', None), 'link usado deixou entrar')
    br.close()

print('FALHAS:' if falhas else 'Senha nova + entrada automática: todos os testes passaram.')
for f in falhas: print(' -', f)
