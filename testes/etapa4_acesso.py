"""Etapa 4 — primeiro acesso, "esqueci minha senha" e /definir-senha.
Roda contra http://localhost:5173 (npm run build && npm run preview).
API do G360 e função ponte-g360 SIMULADAS, só com dados fictícios."""
import os, json
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:5173'
OUT = 'testes/capturas'; os.makedirs(OUT, exist_ok=True)
CHROME = os.environ.get('CHROME') or None
TOKEN = 'exemplo_sem_validade_0000000000000000000000'   # 43 caracteres, fictício
DOC = '12.ABC.345/01DE-35'                              # CNPJ fictício do contrato
MSG_LINK = 'Se o cadastro permitir, o link será enviado para o e-mail cadastrado.'
def loja(troca=True): return {'dados': {'nome': 'Loja Exemplo Fictícia', 'troca_senha': troca, 'sessao_minutos': 8}, 'request_id': '0011223344556677'}
def env(c, m, r, rid='aabbccddeeff0011'): return {'erro': {'codigo': c, 'mensagem': m, 'responsavel': r, 'campos': {}}, 'request_id': rid}
falhas = []
def checar(c, m):
    if not c: falhas.append(m)

def abrir(pw, caminho, troca=True, ponte=None, senha=None, largura=390):
    br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    pg = br.new_page(viewport={'width': largura, 'height': 900})
    reg = {'erros': [], 'console': [], 'ponte': [], 'senha': []}
    pg.on('pageerror', lambda e: reg['erros'].append(str(e)))
    pg.on('console', lambda m: reg['console'].append(m.text))
    def r(route):
        req = route.request; u = req.url
        if u.startswith(BASE) or u.startswith('data:'): return route.continue_()
        if 'fonts.g' in u: return route.abort()
        if u.endswith('/functions/v1/ponte-g360'):
            if req.method == 'OPTIONS': return route.fulfill(status=204, headers={'Access-Control-Allow-Origin': BASE, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS'})
            reg['ponte'].append({'corpo': req.post_data, 'cab': {k.lower() for k in req.headers}})
            return (ponte or (lambda rt: rt.fulfill(status=202, json={'mensagem': MSG_LINK})))(route)
        if u.endswith('/loja'): return route.fulfill(status=200, json=loja(troca))
        if u.endswith('/acessos/senha'):
            reg['senha'].append({'corpo': req.post_data, 'cab': {k.lower() for k in req.headers}})
            return (senha or (lambda rt: rt.fulfill(status=204, body='')))(route)
        return route.abort()
    pg.route('**/*', r)
    pg.goto(BASE + caminho)
    if caminho == '/':
        pg.wait_for_selector('#grid .g360-convite', timeout=40000)
    else:
        pg.wait_for_function("document.getElementById('g360Conteudo') && !/Carregando os dados/.test(document.getElementById('g360Conteudo').innerText)", timeout=40000)
    return br, pg, reg

def sem_rolagem(pg, nome):
    for w in (360, 390, 768, 1280, 1920):
        pg.set_viewport_size({'width': w, 'height': 900})
        checar(pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'rolagem horizontal em {w}px ({nome})')

with sync_playwright() as pw:
    # 1) Entrada com os dois caminhos; Primeiro acesso abre pelo caminho (sem #)
    br, pg, reg = abrir(pw, '/')
    checar(pg.locator('#gPrimeiro').count() == 0, 'sem botão Primeiro acesso (cliente novo usa Quero ser cliente)')
    pg.click('#tbConta'); checar(pg.locator('#lgEsqL').is_visible() and pg.locator('#lgEsqL').text_content().strip() == 'Esqueci minha senha', 'link Esqueci minha senha'); pg.click('#lgX')
    pg.goto(BASE + '/primeiro-acesso')  # a rota antiga continua abrindo (links já enviados)
    pg.wait_for_selector('#g360Documento')
    checar(pg.evaluate('location.pathname') == '/primeiro-acesso', 'rota /primeiro-acesso não abriu')
    checar('30 minutos' in pg.inner_text('#g360Conteudo') and '3 pedidos' in pg.inner_text('#g360Conteudo'), 'avisos do link ausentes')
    # campo vazio e caractere inválido: erro no campo, sem chamar a ponte
    pg.click('#g360EnviarLink')
    checar('Digite o CPF ou CNPJ.' in pg.inner_text('#g360DocErro'), 'erro de campo vazio ausente')
    pg.fill('#g360Documento', '123 456')
    pg.click('#g360EnviarLink')
    checar('Use só letras' in pg.inner_text('#g360DocErro'), 'erro de formato ausente')
    checar(not reg['ponte'], 'chamou a ponte com documento inválido')
    # documento fictício válido
    pg.fill('#g360Documento', DOC)
    pg.click('#g360EnviarLink')
    pg.wait_for_selector('#g360Resultado .g360-ok')
    checar(MSG_LINK in pg.inner_text('#g360Resultado'), 'mensagem da ponte não apareceu como veio')
    corpo = json.loads(reg['ponte'][0]['corpo'])
    checar(corpo == {'acao': 'pedir_link', 'documento': DOC}, f'corpo da ponte diferente: {corpo}')
    extras = reg['ponte'][0]['cab'] - {'content-type', 'accept', 'user-agent', 'referer', 'origin', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'accept-language', 'content-length'}
    checar(not extras, f'cabeçalhos a mais na ponte: {extras}')
    checar(pg.locator('#g360EnviarLink').is_disabled() and 'em 30 s' in pg.inner_text('#g360EnviarLink') or 'em 29 s' in pg.inner_text('#g360EnviarLink'), 'botão não segurou 30 s')
    pg.screenshot(path=f'{OUT}/etapa4_pedido_link_390.png', full_page=True)
    sem_rolagem(pg, 'pedir link')
    checar(not any(DOC in c for c in reg['console']), 'documento apareceu no console')
    checar(not reg['erros'], f'erros de script: {reg["erros"]}')
    br.close()

    # 2) Mesmo documento inexistente: mesma mensagem (a ponte responde igual)
    br, pg, reg = abrir(pw, '/esqueci-senha')
    checar('Esqueci minha senha' in pg.inner_text('#g360Conteudo h2'), 'título Esqueci minha senha')
    pg.fill('#g360Documento', '00.000.000/0000-00'); pg.click('#g360EnviarLink')
    pg.wait_for_selector('#g360Resultado .g360-ok')
    checar(MSG_LINK in pg.inner_text('#g360Resultado'), 'mensagem diferente para documento inexistente')
    br.close()

    # 3) Ponte fora do ar: "Sem comunicação" e botão de tentar de novo
    br, pg, reg = abrir(pw, '/primeiro-acesso', ponte=lambda rt: rt.abort())
    pg.fill('#g360Documento', DOC); pg.click('#g360EnviarLink')
    pg.wait_for_selector('#g360Resultado .g360-msg')
    checar('Não foi possível falar com o servidor' in pg.inner_text('#g360Resultado'), 'mensagem de rede ausente')
    checar(pg.inner_text('#g360EnviarLink') == 'Tentar de novo' and not pg.locator('#g360EnviarLink').is_disabled(), 'sem tentar de novo')
    br.close()

    # 4) troca_senha falso: sem os botões, com a explicação
    br, pg, reg = abrir(pw, '/', troca=False)
    checar(not pg.locator('#gPrimeiro').is_visible(), 'Primeiro acesso visível com troca_senha falso')
    pg.goto(BASE + '/primeiro-acesso'); pg.wait_for_selector('#g360Conteudo h2')
    checar('definida pela Souza Ribeiro' in pg.inner_text('#g360Conteudo'), 'explicação de troca_senha falso ausente')
    pg.goto(BASE + '/definir-senha#token=' + TOKEN); pg.wait_for_selector('#g360Conteudo h2')
    checar(pg.locator('#g360FormSenha').count() == 0, 'formulário de senha com troca_senha falso')
    br.close()

    # 5) Link válido: fragmento apagado, regra junto ao campo, validações, 204 -> entrada
    br, pg, reg = abrir(pw, '/definir-senha#token=' + TOKEN)
    checar(pg.evaluate('location.hash') == '' and TOKEN not in pg.evaluate('location.href'), 'token ficou no endereço')
    checar(pg.evaluate("'__srTokenSenha' in window") is False, 'token ficou no window')
    checar('De 6 a 8 caracteres' in pg.inner_text('#g360Regra') and 'sem espaço' in pg.inner_text('#g360Regra'), 'regra da senha ausente')
    # Regra conferida enquanto digita: contador e marcações
    pg.fill('#g360Senha1', 'ab3')
    checar('3 de 8' in pg.inner_text('#g360Regra .rs-cont') and 'faltam 3' in pg.inner_text('#g360Regra .rs-cont'), 'contador da senha')
    checar(pg.get_attribute('[data-r="tam"]', 'data-st') == 'pend', 'tamanho curto não ficou pendente')
    pg.fill('#g360Senha1', 'ab 3')
    checar(pg.get_attribute('[data-r="car"]', 'data-st') == 'bad', 'espaço não marcado como erro')
    pg.fill('#g360Senha1', 'abc12345'); pg.fill('#g360Senha2', 'abc12345')
    checar(pg.get_attribute('[data-r="tam"]', 'data-st') == 'ok' and pg.get_attribute('[data-r="igu"]', 'data-st') == 'ok', 'senha válida não ficou verde')
    checar('máximo' in pg.inner_text('#g360Regra .rs-cont'), 'aviso de máximo')
    pg.fill('#g360Senha2', 'xyz')
    checar(pg.get_attribute('[data-r="igu"]', 'data-st') == 'bad', 'senhas diferentes não marcadas')
    pg.screenshot(path=f'{OUT}/regra_senha.png', full_page=True)
    pg.click('#g360SalvarSenha')
    checar('Digite o CPF ou CNPJ' in pg.inner_text('#g360SenhaErro'), 'documento vazio não acusado (teste que tem de dar erro)')
    checar(pg.locator('#g360Cont').count() == 0, 'Continuar conectado sem continuar_conectado_dias')
    pg.fill('#g360Doc', DOC)
    pg.fill('#g360Senha1', 'abc'); pg.fill('#g360Senha2', 'abc'); pg.click('#g360SalvarSenha')
    checar('não segue a regra' in pg.inner_text('#g360SenhaErro'), 'regra não conferida')
    pg.fill('#g360Senha1', 'Teste12'); pg.fill('#g360Senha2', 'Teste13'); pg.click('#g360SalvarSenha')
    checar('não são iguais' in pg.inner_text('#g360SenhaErro'), 'senhas diferentes não acusadas')
    checar(not reg['senha'], 'chamou a API com senha inválida')
    pg.screenshot(path=f'{OUT}/etapa4_definir_senha_390.png', full_page=True)
    sem_rolagem(pg, 'definir senha')
    pg.fill('#g360Senha2', 'Teste12'); pg.click('#g360SalvarSenha')
    pg.wait_for_selector('#mLogin.open #lgRes .rv-aviso')
    checar(pg.evaluate('location.pathname') == '/', 'não voltou à entrada depois do 204')
    # A entrada automática falhou (sem API de sessão neste teste): a senha ficou criada e vai para o login.
    checar('Senha definida' in pg.text_content('#lgRes'), 'aviso de senha definida ausente')
    corpo = json.loads(reg['senha'][0]['corpo'])
    checar(corpo == {'token': TOKEN, 'senha_nova': 'Teste12'}, f'corpo de acessos/senha diferente: {corpo}')
    checar('authorization' not in reg['senha'][0]['cab'] and 'idempotency-key' not in reg['senha'][0]['cab'], 'cabeçalho indevido em acessos/senha')
    armaz = pg.evaluate('JSON.stringify(localStorage)+JSON.stringify(sessionStorage)+document.cookie')
    checar(TOKEN not in armaz and 'Teste12' not in armaz, 'token ou senha em storage/cookie')
    checar(not any(TOKEN in c or 'Teste12' in c for c in reg['console']), 'token ou senha no console')
    pg.screenshot(path=f'{OUT}/etapa4_senha_definida_390.png', full_page=True)
    # voltar no navegador não reaproveita o token
    pg.go_back(); pg.wait_for_selector('#g360Conteudo h2')
    checar('Link incompleto' in pg.inner_text('#g360Conteudo'), 'voltar reabriu o formulário com o token')
    checar(not reg['erros'], f'erros de script: {reg["erros"]}')
    br.close()

    # 6) Link usado ou vencido: mensagem como veio + pedir outro link
    usado = lambda rt: rt.fulfill(status=422, json=env('LINK_INVALIDO', 'O link é inválido ou expirou. Solicite um novo link.', 'usuario', '9988776655443322'))
    br, pg, reg = abrir(pw, '/definir-senha#token=' + TOKEN, senha=usado)
    pg.fill('#g360Doc', DOC); pg.fill('#g360Senha1', 'Outra12'); pg.fill('#g360Senha2', 'Outra12'); pg.click('#g360SalvarSenha')
    pg.wait_for_selector('#g360Resultado .g360-msg')
    t = pg.inner_text('#g360Resultado')
    checar('O link é inválido ou expirou. Solicite um novo link.' in t, 'LINK_INVALIDO não apareceu como veio')
    checar('LINK_INVALIDO · 9988776655443322' in t, 'código para o suporte ausente')
    checar(pg.locator('#g360FormSenha').count() == 0, 'formulário continuou depois de LINK_INVALIDO')
    pg.screenshot(path=f'{OUT}/etapa4_link_invalido_390.png', full_page=True)
    pg.click('#g360NovoLink')
    checar(pg.evaluate('location.pathname') == '/esqueci-senha', 'Pedir outro link não levou ao esqueci-senha')
    br.close()

    # 7) Senha recusada pela API (ex.: igual ao código de cliente): mensagem como veio, formulário continua
    recusa = lambda rt: rt.fulfill(status=422, json=env('SENHA_NOVA_INVALIDA', 'A senha deve ser diferente do código do cliente.', 'usuario'))
    br, pg, reg = abrir(pw, '/definir-senha#token=' + TOKEN, senha=recusa)
    pg.fill('#g360Doc', DOC); pg.fill('#g360Senha1', '123456'); pg.fill('#g360Senha2', '123456'); pg.click('#g360SalvarSenha')
    pg.wait_for_selector('#g360Resultado .g360-msg')
    checar('A senha deve ser diferente do código do cliente.' in pg.inner_text('#g360Resultado'), 'SENHA_NOVA_INVALIDA não apareceu')
    checar(pg.locator('#g360FormSenha').count() == 1 and not pg.locator('#g360SalvarSenha').is_disabled(), 'formulário não ficou disponível')
    br.close()

    # 8) Sem token (página recarregada): pede outro link
    br, pg, reg = abrir(pw, '/definir-senha')
    checar('Link incompleto' in pg.inner_text('#g360Conteudo'), 'sem token não avisou')
    checar(not reg['senha'], 'chamou a API sem token')
    br.close()

print('FALHAS:' if falhas else 'Etapa 4: todos os testes passaram.')
for f in falhas: print(' -', f)
