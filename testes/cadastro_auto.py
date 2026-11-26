"""Cadastro automático: o "Quero ser cliente" cria a ficha no G360 (função cadastro-g360), o cliente entra
sem ver preço ("em análise") e a equipe libera os preços no painel.
Roda contra http://localhost:5173 (npm run build && npm run preview), com o simulador (dados fictícios)."""
import os, sys, uuid
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from simulador import Sim, BASE, LOJA
CHROME = os.environ.get('CHROME') or None
falhas = []
def checar(c, m):
    if not c: falhas.append(m)

def abrir(br, sim, largura):
    ctx = br.new_context(viewport={'width': largura, 'height': 900}); pg = ctx.new_page(); erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.route('**/*', sim.rota)
    for h in ('publica.cnpj.ws', 'open.cnpja.com', 'brasilapi.com.br', 'viacep.com.br'):
        pg.route(f'**/{h}/**', lambda r: r.fulfill(status=404, headers={'Access-Control-Allow-Origin': '*'}, body='{}'))
    pg.goto(BASE + '/'); pg.wait_for_selector('#grid .card')
    return ctx, pg, erros

def preencher(pg, doc, senha='Fict12', senha2=None):
    for i, v in [('kDoc', doc), ('kRazao', 'Empresa Fictícia LTDA'), ('kResp', 'Pessoa Fictícia'), ('kWhats', '(34) 99999-0000'),
                 ('kEmail', 'compras@example.invalid'), ('kRua', 'Rua Exemplo'), ('kNum', '10'), ('kCidade', 'Cidade Exemplo'), ('kBairro', 'Centro')]:
        pg.fill('#' + i, v)
    pg.fill('#kCep', '38400000'); pg.select_option('#kSeg', 'Escritório')
    if pg.locator('#kOrigem').is_visible(): pg.select_option('#kOrigem', 'Instagram')
    if pg.locator('#kSenha').count(): pg.fill('#kSenha', senha); pg.fill('#kSenha2', senha2 if senha2 is not None else senha)

def entrar(pg, sim, doc):
    pg.eval_on_selector('#tbConta', 'b => b.click()'); pg.wait_for_selector('#lgC')
    pg.fill('#lgC', doc); pg.fill('#lgS', sim.compradores[doc]['senha']); pg.click('#lgOk')
    pg.wait_for_selector('body.logged #grid .card'); pg.wait_for_timeout(2500)

with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    for largura in (390, 1280):
        # 1) Quero ser cliente com CNPJ e senha no cadastro: ficha criada e já entra logado (sem e-mail)
        sim = Sim(); sim.cenario['auto'] = 'criado'
        ctx, pg, erros = abrir(br, sim, largura)
        pg.click('#heroCadB'); pg.wait_for_selector('#mCad.open #kDoc')
        preencher(pg, '12.ABC.345/01DE-35'); pg.click('#kEnviar')
        pg.wait_for_selector('body.logged', timeout=40000)
        cha = [c for c in sim.chamadas if c[0] == 'CADASTRO_AUTO']
        checar(len(cha) == 1 and cha[0][1] == 'cadastrar' and cha[0][2] == ['acao', 'documento', 'senha'], f'{largura}: chamada da função: {cha}')
        checar(sim.cadastros[0].get('status') == 'aprovado' and not sim.cadastros[0].get('em_analise'), f'{largura}: pedido não ficou aprovado')
        checar('senha' not in sim.cadastros[0] and 'Fict12' not in __import__('json').dumps(sim.cadastros), f'{largura}: senha foi para o Supabase')
        checar(not pg.locator('#mCad.open').count(), f'{largura}: cadastro continuou aberto')
        checar(sim.ultimo_login.get('continuar_conectado') in (None, True), f'{largura}: login: {sim.ultimo_login}')
        checar(not erros, f'{largura}: erros: {erros}')
        ctx.close()

        # 1a) Senha não gravou no G360: cai no link por e-mail de sempre
        sim = Sim(); sim.cenario['auto'] = 'criado'; sim.cenario['senha_auto'] = 'email'
        ctx, pg, erros = abrir(br, sim, largura)
        pg.click('#heroCadB'); pg.wait_for_selector('#mCad.open #kDoc')
        preencher(pg, '12.ABC.345/01DE-35'); pg.click('#kEnviar')
        pg.wait_for_function("document.querySelector('#cadBox h3')?.textContent.includes('Pronto')", timeout=40000)
        t = ' '.join(pg.inner_text('#cadBox').split())
        checar('compras@example.invalid' in t and 'Crie a sua senha' in t, f'{largura}: mensagem do link por e-mail: {t[:200]}')
        ctx.close()

        # 1c) Tem de dar erro: senhas diferentes não enviam nada
        sim = Sim(); sim.cenario['auto'] = 'criado'
        ctx, pg, erros = abrir(br, sim, largura)
        pg.click('#heroCadB'); pg.wait_for_selector('#mCad.open #kDoc')
        preencher(pg, '12.ABC.345/01DE-35', 'Fict12', 'Fict13'); pg.click('#kEnviar'); pg.wait_for_timeout(700)
        checar('iguais' in pg.inner_text('#kSenhaErr') and not sim.cadastros and not [c for c in sim.chamadas if c[0] == 'CADASTRO_AUTO'], f'{largura}: senhas diferentes passaram')
        ctx.close()

        # 1b) Tem de dar erro: o e-mail da Receita não entra no campo; sem e-mail digitado, o cadastro não sai
        sim = Sim(); sim.cenario['auto'] = 'criado'
        ctx, pg, erros = abrir(br, sim, largura)
        receita = {'razao_social': 'Empresa Fictícia LTDA', 'estabelecimento': {'email': 'contador@example.invalid', 'cep': '38400000', 'logradouro': 'Rua Exemplo',
                   'numero': '10', 'bairro': 'Centro', 'cidade': {'nome': 'Cidade Exemplo'}, 'estado': {'sigla': 'MG'}, 'situacao_cadastral': 'Ativa'}}
        pg.route('**/publica.cnpj.ws/**', lambda r: r.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*'}, content_type='application/json', body=__import__('json').dumps(receita)))
        pg.click('#heroCadB'); pg.wait_for_selector('#mCad.open #kDoc')
        pg.fill('#kDoc', '12.ABC.345/01DE-35'); pg.fill('#kDoc', '12345678000195')
        pg.wait_for_function("(document.querySelector('#kRazao')?.value||'').includes('Fictícia')", timeout=10000)
        checar(pg.input_value('#kEmail') == '', f'{largura}: e-mail da Receita entrou no campo: {pg.input_value("#kEmail")}')
        for i, v in [('kResp', 'Pessoa Fictícia'), ('kWhats', '(34) 99999-0000')]: pg.fill('#' + i, v)
        pg.select_option('#kSeg', 'Escritório')
        if pg.locator('#kOrigem').is_visible(): pg.select_option('#kOrigem', 'Instagram')
        pg.click('#kEnviar'); pg.wait_for_timeout(600)
        checar('e-mail' in pg.inner_text('#kEmailErr').lower() and not sim.cadastros, f'{largura}: cadastro saiu sem e-mail')
        ctx.close()

        # 2) CPF novo também passa direto: a função cria a ficha, grava a senha e já entra
        sim = Sim(); sim.cenario['auto'] = 'criado'
        ctx, pg, erros = abrir(br, sim, largura)
        pg.click('#heroCadB'); pg.wait_for_selector('#mCad.open #kDoc')
        preencher(pg, '529.982.247-25'); pg.click('#kEnviar')
        pg.wait_for_selector('body.logged', timeout=40000)
        checar([c for c in sim.chamadas if c[0] == 'CADASTRO_AUTO'], f'{largura}: CPF não chamou o cadastro automático')
        ctx.close()

        # 2b) Tem de dar erro: CPF que o G360 recusa (já tem cadastro) fica para a equipe, mensagem de análise com "CPF"
        sim = Sim(); sim.cenario['auto'] = 'analise'
        ctx, pg, erros = abrir(br, sim, largura)
        pg.click('#heroCadB'); pg.wait_for_selector('#mCad.open #kDoc')
        preencher(pg, '529.982.247-25'); pg.click('#kEnviar'); pg.wait_for_selector('#cadBox .ok h3', timeout=40000); pg.wait_for_timeout(800)
        h3 = pg.inner_text('#cadBox h3'); t = pg.inner_text('#cadBox')
        checar('Pronto' not in h3 and 'análise' in h3 and 'Se esse CPF' in t, f'{largura}: CPF recusado: {h3} / {t[:160]}')
        ctx.close()

        # 3) Cliente em análise entra: catálogo sem preço e sem compra
        sim = Sim(); doc = '11.111.111/0001-11'; cod = sim.compradores[doc]['codigo']
        sim.cadastros.append({'id': str(uuid.uuid4()), 'loja': LOJA, 'documento': '11111111000111', 'razao_social': 'Comprador Fictício', 'status': 'pendente',
                              'codigo_g360': cod, 'em_analise': True, 'auto_status': 'criado', 'auto_obs': 'Ficha criada pelo portal.', 'criado_em': '2026-11-25T12:00:00Z'})
        ctx, pg, erros = abrir(br, sim, largura)
        entrar(pg, sim, doc)
        pg.wait_for_selector('#avisoAnalise', timeout=8000)
        checar('Cadastro em análise' in pg.inner_text('#avisoAnalise'), f'{largura}: aviso')
        checar(pg.evaluate("document.body.classList.contains('cliente-analise')"), f'{largura}: classe em análise')
        checar(not pg.locator('#grid .card .price').first.is_visible() and not pg.locator('#grid .card .add').first.is_visible(), f'{largura}: preço ou botão visíveis')
        checar(not pg.locator('#cartBtn').is_visible(), f'{largura}: carrinho visível')
        checar('R$' not in pg.inner_text('#grid'), f'{largura}: valor em reais na tela')
        # tem de dar erro: forçar o clique em Adicionar não põe nada no carrinho
        pg.evaluate("document.querySelector('#grid .card .add').click()"); pg.wait_for_timeout(400)
        checar(pg.evaluate("JSON.stringify(Object.keys(sessionStorage).filter(k=>k.includes('carrinho')).map(k=>sessionStorage.getItem(k)))").count('produto_id') == 0, f'{largura}: carrinho recebeu item em análise')
        checar('em análise' in (pg.locator('.toast').inner_text() if pg.locator('.toast').count() else ''), f'{largura}: aviso ao tentar adicionar')
        if largura == 1280: pg.screenshot(path='/tmp/analise.png')
        ctx.close()

        # 4) Painel: aprovar e liberar preços → o cliente passa a ver os preços
        if largura == 1280:
            ctx, pg, erros = abrir(br, sim, largura)
            pg.goto(BASE + '/painel'); pg.wait_for_selector('#aUsu')
            pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk'); pg.wait_for_timeout(1500)
            pg.wait_for_selector('.crow2[data-id] [data-liberar]', timeout=8000)
            linha = ' '.join(pg.inner_text(f'.crow2[data-id="{sim.cadastros[0]["id"]}"]').split())
            checar('Criado no G360 pelo portal' in linha and 'em análise' in linha, f'painel: {linha[:200]}')
            b = pg.locator('[data-liberar]'); b.click(); pg.wait_for_timeout(200)
            checar('Confirmar' in b.inner_text(), 'pediu confirmação')
            checar(not [c for c in sim.chamadas if c[0] == 'LIBERAR_PRECOS'], 'liberou com um clique só')
            b.click(); pg.wait_for_timeout(1200)
            checar([c for c in sim.chamadas if c[0] == 'LIBERAR_PRECOS'], 'não liberou')
            checar(sim.cadastros[0]['em_analise'] is False and sim.cadastros[0]['status'] == 'aprovado', f'painel: {sim.cadastros[0]}')
            ctx.close()
            ctx, pg, erros = abrir(br, sim, largura)
            entrar(pg, sim, doc)
            checar(pg.locator('#avisoAnalise').count() == 0 and pg.locator('#grid .card .price').first.is_visible() and 'R$' in pg.inner_text('#grid'), 'depois de aprovado continua sem preço')
            ctx.close()
    br.close()

if falhas:
    print('FALHAS:'); [print(' -', f) for f in falhas]; sys.exit(1)
print('Cadastro automático: todos os testes passaram.')
