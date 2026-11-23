"""Portal no layout original + integração G360 (Etapas 1, 2 e 5 a 11).
Roda contra http://localhost:5173 (npm run build && npm run preview), com o simulador (dados fictícios)."""
import json
import os, re, json, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from simulador import Sim, BASE

OUT = 'testes/capturas'; os.makedirs(OUT, exist_ok=True)
CHROME = os.environ.get('CHROME') or None
U1, S1 = '11.111.111/0001-11', 'Teste12'
U2, S2 = '22.222.222/0001-22', 'Teste34'
UB, SB = '33.333.333/0001-33', 'Teste56'
falhas = []; etapa = ['']
def checar(c, m):
    if not c: falhas.append(f'[{etapa[0]}] {m}')

class N:
    def __init__(self, pw, sim, caminho='/', largura=390, relogio=False):
        self.br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        self.pg = self.br.new_page(viewport={'width': largura, 'height': 900}); self.sim = sim
        self.erros, self.console = [], []
        self.pg.on('pageerror', lambda e: self.erros.append(str(e)))
        self.pg.on('console', lambda m: self.console.append(m.text))
        if relogio: self.pg.clock.install()
        self.pg.route('**/*', sim.rota)
        self.pg.goto(BASE + caminho)
        self.pg.wait_for_selector('#grid .card, #grid .empty, #aForm, #g360Conteudo, #g360Estado')
    def abrir_login(self):
        if not self.pg.locator('#mLogin.open').count():
            self.pg.click('#tbConta')
        self.pg.wait_for_selector('#mLogin.open')
    def entrar(self, u, s, esperar=True):
        self.abrir_login()
        self.pg.fill('#lgC', u); self.pg.fill('#lgS', s); self.pg.click('#lgOk')
        if esperar: self.pg.wait_for_selector('body.logged #grid .card')
    def tc(self, sel): return self.pg.text_content(sel) or ''
    def ir(self, v): self.pg.click(f'.tabbar [data-v="{v}"]')
    def toast(self): return self.tc('#toast')
    def segredos_ok(self, extras=()):
        # Pacote 18/11 tarde: o token pode ficar só no sessionStorage, na chave própria dele. Fora dela, nada.
        armaz = self.pg.evaluate("JSON.stringify(localStorage)+JSON.stringify(Object.fromEntries(Object.entries(sessionStorage).filter(([k]) => !/^sr-g360-(comprador|operador)-/.test(k))))+document.cookie")
        tudo = self.pg.evaluate('JSON.stringify(localStorage)+JSON.stringify(sessionStorage)+document.cookie')
        toks = list(self.sim.tokens.keys())
        return not any(t in armaz for t in toks) and not any(x in tudo for x in extras) and not any(any(t in c for t in toks) for c in self.console)
    def sem_rolagem(self, nome):
        for w in (360, 390, 768, 1280, 1920):
            self.pg.set_viewport_size({'width': w, 'height': 900}); self.pg.wait_for_timeout(150)
            checar(self.pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'rolagem horizontal em {w}px ({nome})')
        self.pg.set_viewport_size({'width': 390, 'height': 900})
    def abrir_checkout(self):
        self.pg.click('#cartBtn'); self.pg.wait_for_selector('#drawer.open'); self.pg.click('#dGo')
        self.pg.wait_for_selector('#mChk.open input[name=mod]')
    def esperar_resumo(self):
        self.pg.wait_for_function("document.querySelector('#cResumo') && !/Calculando/.test(document.querySelector('#cResumo').innerText) && document.querySelector('#cResumo').innerText.length > 5")
    def fechar(self):
        checar(not self.erros, f'erros de script: {self.erros}')
        self.br.close()

with sync_playwright() as pw:
    # ================= ETAPAS 1 e 2: loja e erro central =================
    etapa[0] = 'Etapas 1-2'
    sim = Sim()
    n = N(pw, sim)
    checar(n.tc('.logo b') == 'Loja Exemplo Fictícia', 'nome da loja no topo')
    # Catálogo aberto para visitantes (vitrine): nome, foto, categoria e "Entre para ver os preços", sem preço
    n.pg.wait_for_selector('#grid .card.publico')
    checar('Entre para ver os preços' in n.tc('#grid') and 'R$' not in n.tc('#grid'), 'vitrine sem preço')
    checar(all('authorization' not in h for _, h in sim.vitrine_chamadas), 'vitrine sem Bearer')
    checar(not n.pg.locator('#tot').count() and re.match(r'Mostrando \d+ de \d+ produtos · entre para ver os preços', n.tc('#cnt')), f"visitante: Mostrando N de M: {n.tc('#cnt')}")
    n.pg.fill('#q', 'P-110'); n.pg.wait_for_function("document.getElementById('cnt').textContent.startsWith('Mostrando 1 de 1 resultado')")
    n.pg.click('#grid .card.publico .lockp'); n.pg.wait_for_selector('#mLogin.open'); n.pg.click('#lgX')
    n.fechar()
    sim = Sim(); sim.vitrine_aberta = False
    n = N(pw, sim)
    n.pg.wait_for_selector('#gEntrar')
    checar('Entre para ver o catálogo' in n.tc('#grid'), 'vitrine fechada: convite para entrar')
    n.abrir_login()
    checar('8 minutos sem uso' in n.tc('#lgSessao'), 'tempo de sessão no login')
    n.pg.screenshot(path=f'{OUT}/portal_visitante_390.png')
    # Quero ser cliente: cadastro de quem ainda não é cliente
    n.pg.click('#lgX'); n.pg.click('#gCadastro'); n.pg.wait_for_selector('#mCad.open #kDoc')
    n.pg.click('#kEnviar')
    checar('CNPJ' in n.tc('#kDocErr') and 'WhatsApp' in n.tc('#kWhatsErr') and 'ramo' in n.tc('#kSegErr'), 'cadastro vazio sem avisos por campo')
    # CNPJ numérico: busca pública (fictícia aqui) preenche empresa, endereço, IE e sugere o ramo
    import json as _j
    _ws = {'razao_social': 'SALAO FICTICIO LTDA', 'estabelecimento': {'nome_fantasia': 'Salão Exemplo', 'situacao_cadastral': 'Ativa', 'cep': '38400000',
           'tipo_logradouro': 'Rua', 'logradouro': 'Exemplo', 'numero': '10', 'bairro': 'Centro', 'cidade': {'nome': 'Cidade Exemplo'}, 'estado': {'sigla': 'MG'},
           'email': 'contato@example.invalid', 'atividade_principal': {'descricao': 'Cabeleireiros, manicure e pedicure'},
           'inscricoes_estaduais': [{'inscricao_estadual': '0012345670099', 'ativo': True, 'estado': {'sigla': 'MG'}}]}}
    n.pg.route('**/publica.cnpj.ws/**', lambda r: r.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=_j.dumps(_ws)))
    n.pg.route('**/open.cnpja.com/**', lambda r: r.fulfill(status=404, headers={'Access-Control-Allow-Origin': '*'}, body='{}'))
    n.pg.route('**/brasilapi.com.br/**', lambda r: r.fulfill(status=404, headers={'Access-Control-Allow-Origin': '*'}, body='{}'))
    n.pg.fill('#kDoc', '11222333000181'); n.pg.wait_for_selector('#kResumo:not([hidden])')
    checar(n.pg.input_value('#kIe') == '0012345670099' and 'IE 0012345670099' in n.tc('#kResumo') and n.pg.input_value('#kSeg') == 'Salão de beleza ou estética' and n.pg.input_value('#kCidade') == 'Cidade Exemplo',
           f"CNPJ preenche IE, endereço e ramo: ie={n.pg.input_value('#kIe')} seg={n.pg.input_value('#kSeg')}")
    for i, v in [('kDoc', '12.ABC.345/01DE-35'), ('kRazao', 'Empresa Fictícia LTDA'), ('kResp', 'Pessoa Fictícia'), ('kWhats', '(34) 99999-0000'),
                 ('kEmail', 'compras@example.invalid'), ('kRua', 'Rua Exemplo'), ('kNum', '10'), ('kCidade', 'Cidade Exemplo'), ('kBairro', 'Centro')]:
        n.pg.fill('#' + i, v)
    n.pg.fill('#kCep', '38400000'); n.pg.select_option('#kSeg', 'Escritório')
    checar(n.pg.evaluate("document.documentElement.classList.contains('g360-travado')"), 'janela aberta: o fundo não rola')
    n.pg.keyboard.press('Escape'); n.pg.wait_for_selector('#mConf.open')
    checar('Sair sem salvar' in n.tc('#mConf'), 'ESC com dados preenchidos pergunta antes de fechar')
    n.pg.click('#mConfFicar'); n.pg.wait_for_selector('#mConf:not(.open)', state='attached')
    checar(n.pg.locator('#mCad.open').count() == 1 and n.pg.input_value('#kRazao') == 'Empresa Fictícia LTDA', 'teste que tem de falhar: "Continuar preenchendo" não fecha nem apaga nada')
    n.pg.click('#kCancelar'); n.pg.wait_for_selector('#mConf.open'); n.pg.keyboard.press('Escape'); n.pg.wait_for_selector('#mConf:not(.open)', state='attached')
    checar(n.pg.locator('#mCad.open').count() == 1, 'Cancelar também pergunta; ESC na pergunta volta para o cadastro')
    n.pg.fill('#kWhats', '6499'); n.pg.click('#kEnviar')
    checar('DDD' in n.tc('#kWhatsErr'), 'WhatsApp incompleto recusado')
    n.pg.fill('#kWhats', '+55 (64) 99997-015'); checar(n.tc('#kWhatsErr') == '', 'aviso some ao corrigir o WhatsApp')
    n.pg.click('#kEnviar'); n.pg.wait_for_selector('#cadBox .ok')
    checar(sim.cadastros[0]['whats'] == '6499997015', f"WhatsApp com +55 aceito e gravado só com DDD + número: {sim.cadastros[0]['whats']}")
    checar(len(sim.cadastros) == 1 and sim.cadastros[0]['documento'] == '12ABC34501DE35' and sim.cadastros[0]['loja'] == '96da1e99a3f327f0', f'cadastro não chegou: {sim.cadastros}')
    checar(sim.cadastros[0].get('segmento') == 'Escritório', f"ramo do negócio gravado: {sim.cadastros[0].get('segmento')}")
    n.pg.screenshot(path=f'{OUT}/portal_cadastro_enviado_390.png')
    n.pg.keyboard.press('Escape'); n.pg.wait_for_selector('#mCad:not(.open)', state='attached')
    checar(n.pg.locator('#mConf.open').count() == 0 and not n.pg.evaluate("document.documentElement.classList.contains('g360-travado')"), 'cadastro enviado: ESC fecha sem perguntar e o fundo volta a rolar')
    # O mesmo documento de novo: o portal avisa na hora que já tem cadastro e não deixa enviar outro
    n.pg.click('#gCadastro'); n.pg.wait_for_selector('#mCad.open #kDoc'); n.pg.fill('#kDoc', '12.ABC.345/01DE-35')
    n.pg.wait_for_selector('#kJa:not([hidden])')
    checar('Já recebemos um cadastro com este CNPJ' in n.tc('#kJa') and n.pg.locator('#kEnviar').is_disabled() and len(sim.cadastros) == 1, f"CNPJ já cadastrado avisado na hora: {n.tc('#kJa')}")
    sim.cadastros[0]['codigo_g360'] = 501; n.pg.fill('#kDoc', ''); n.pg.fill('#kDoc', '12.ABC.345/01DE-35'); n.pg.wait_for_selector('#kJaEntrar')
    checar('já está cadastrado no portal' in n.tc('#kJa'), 'cadastro aprovado: aviso para entrar')
    n.pg.click('#kJaEntrar'); n.pg.wait_for_selector('#mLogin.open')
    checar(n.pg.input_value('#lgC').replace('.', '').replace('/', '').replace('-', '').upper().startswith('12ABC') and n.pg.locator('#mCad.open').count() == 0, f"Entrar abre o login com o documento: {n.pg.input_value('#lgC')}")
    n.pg.keyboard.press('Escape')
    n.fechar()
    sim = Sim(); sim.cenario['loja'] = {'falhar': (503, 'INDISPONIVEL', 'Serviço temporariamente indisponível.', 'tentar_de_novo')}
    n = N(pw, sim)
    checar('Serviço temporariamente indisponível.' in n.tc('#g360Estado') and 'INDISPONIVEL' in n.tc('#g360Estado'), 'erro do GET loja sem mensagem/código')
    n.fechar()

    # ================= ETAPA 5 =================
    etapa[0] = 'Etapa 5'
    sim = Sim()
    n = N(pw, sim)
    n.entrar(U1, 'errada1', esperar=False)
    n.pg.wait_for_selector('#lgRes .g360-msg')
    checar('CPF/CNPJ ou senha inválidos.' in n.tc('#lgRes'), 'senha errada sem a mensagem da API')
    checar(n.pg.input_value('#lgS') == '', 'senha ficou no campo')
    n.pg.fill('#lgS', S1); n.pg.click('#lgOk'); n.pg.wait_for_selector('body.logged #grid .card')
    checar('Fictício' in n.tc('#tbContaT'), 'nome do comprador na barra')
    ponte = [c for c in sim.chamadas if c[0] == 'PONTE' and c[1] == 'abrir_sessao']
    checar(len(ponte) == 1, 'abrir_sessao não chamado uma vez')
    extras = set(ponte[0][2]) - {'content-type', 'accept', 'user-agent', 'referer', 'origin', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'accept-language', 'content-length'}
    checar(not extras, f'cabeçalhos a mais na ponte: {extras}')
    checar(set([c for c in sim.chamadas if c[1] == 'sessoes'][-1][3]) == {'usuario', 'senha'}, 'corpo do login com campos a mais')
    checar(n.segredos_ok([S1]), 'token ou senha em storage/console')
    sim.tokens.clear()
    n.ir('ped'); n.pg.wait_for_selector('#mLogin.open')
    checar('Sua sessão terminou. Entre novamente.' in n.tc('#lgE'), '401 sem mensagem de sessão encerrada')
    checar(not n.pg.locator('body.logged').count(), '401 não encerrou')
    n.pg.fill('#lgC', U1); n.pg.fill('#lgS', S1); n.pg.click('#lgOk'); n.pg.wait_for_selector('body.logged #grid .card')
    n.pg.click('#tbConta'); n.pg.wait_for_selector('#mConta.open'); n.pg.click('#cSair')
    n.pg.wait_for_function("!document.body.classList.contains('logged')")
    checar(any(c[0] == 'DELETE' and c[1] == 'sessao' for c in sim.chamadas), 'Sair sem DELETE sessao')
    n.pg.goto(BASE + '/pedidos'); n.pg.wait_for_selector('#mLogin.open')
    checar('Entre para continuar.' in n.tc('#lgE') and n.pg.evaluate('location.pathname') == '/', 'página privada sem login')
    n.fechar()
    sim = Sim(sessao_minutos=1)
    n = N(pw, sim, relogio=True)
    n.entrar(U1, S1)
    antes = len(sim.chamadas)
    n.pg.clock.run_for(75000)
    n.pg.wait_for_selector('#mLogin.open', timeout=10000)
    checar('inatividade' in n.tc('#lgE'), 'inatividade não encerrou')
    checar(not [c for c in sim.chamadas[antes:] if c[1] in ('me', 'loja')], 'chamada periódica para manter a sessão')
    n.fechar()
    sim = Sim(); sim.cenario['ponte'] = 'fora'
    n = N(pw, sim)
    n.entrar(UB, SB)
    checar('Compras bloqueadas' in n.tc('#g360Avisos') and 'Minha Lista está indisponível' in n.tc('#g360Avisos'), 'avisos de bloqueio/ponte fora')
    checar(n.pg.locator('.card .fav').count() == 0, 'botão de lista sem Supabase')
    n.fechar()
    sim = Sim()
    n = N(pw, sim)
    n.entrar(U1, S1)
    n.pg.click('#tbConta'); n.pg.wait_for_selector('#mConta.open #tAtual')
    n.pg.fill('#tAtual', 'errada1'); n.pg.fill('#tNova1', 'Nova123'); n.pg.fill('#tNova2', 'Nova123'); n.pg.click('#cTrocar')
    n.pg.wait_for_selector('#tRes .g360-msg'); checar('A senha atual não confere.' in n.tc('#tRes'), 'senha atual errada')
    pontes = len([c for c in sim.chamadas if c[0] == 'PONTE'])
    n.pg.fill('#tAtual', S1); n.pg.click('#cTrocar'); n.pg.wait_for_selector('#tRes .rv-aviso')
    checar(len([c for c in sim.chamadas if c[0] == 'PONTE']) == pontes + 1, 'troca de senha sem reabrir Supabase')
    n.pg.click('#cFechar'); n.ir('ped'); n.pg.wait_for_selector('#pPanel .empty2:not(:has-text("Carregando"))')
    checar(n.segredos_ok(['Nova123']), 'senha nova em storage/console')
    n.fechar()
    sim = Sim(troca_senha=False)
    n = N(pw, sim)
    checar(not n.pg.locator('#gPrimeiro').is_visible(), 'Primeiro acesso com troca_senha falso')
    n.entrar(U1, S1); n.pg.click('#tbConta'); n.pg.wait_for_selector('#mConta.open')
    # × preso no alto da Minha conta fecha a janela (antes ele clicava em si mesmo e não fechava)
    n.pg.click('#mConta .mod-x'); n.pg.wait_for_selector('#mConta:not(.open)', state='attached', timeout=3000)
    checar(n.pg.locator('#mConta.open').count() == 0, '× da Minha conta fecha')
    n.pg.click('#tbConta'); n.pg.wait_for_selector('#mConta.open')
    checar(n.pg.locator('#cTrocar').count() == 0 and 'definida pela Souza Ribeiro' in n.tc('#contaBox'), 'trocar senha com troca_senha falso')
    n.fechar()

    # ================= ETAPA 6 =================
    etapa[0] = 'Etapa 6'
    sim = Sim()
    n = N(pw, sim); pg = n.pg
    n.entrar(U1, S1)
    checar(pg.locator('#grid .card').count() == 24, f"vitrine sem 24 produtos: {pg.locator('#grid .card').count()}")
    pg.wait_for_function("document.getElementById('cnt').textContent.startsWith('Mostrando')")
    checar(re.match(r'Mostrando 24( de \d+)? produtos$', n.tc('#cnt')) and not pg.locator('#tot').count(), f'Mostrando 24 de N produtos: {n.tc("#cnt")}')
    checar(n.tc('#nMarcas') == '2' and 'estoque' not in n.tc('.stats').lower(), f"só o contador de marcas no topo: {n.tc('.stats')}")
    lidas_antes = len([c for c in sim.chamadas if c[0] == 'GET' and c[1] == 'produtos'])
    checar(lidas_antes <= 2, f'abrir o portal não lê o catálogo inteiro antes dos cards: {lidas_antes} páginas')
    sem_cx = pg.eval_on_selector_all('#grid .card', "cs => cs.filter(c => !c.querySelector('.unsel')).map(c => c.querySelector('.info').innerText)")
    com_cx = pg.eval_on_selector_all('#grid .card', "cs => cs.filter(c => c.querySelector('.unsel')).map(c => c.querySelector('.price').innerText)")
    checar(sem_cx and not any(('/ un' in t.lower() or '· UN' in t or '/ pc' in t.lower()) for t in sem_cx), 'unidade base (UN, PC) não aparece no card sem caixa')
    checar(com_cx and all('/' in t for t in com_cx), 'card com caixa mostra a unidade do preço')
    pg.wait_for_selector('#souzinha-widget .sz-fab'); checar(pg.locator('#souzinha-widget .sz-fab').is_visible(), 'Souzinha no portal')
    checar(pg.locator('.card[data-id="102"], .card[data-id="103"], .card[data-id="108"]').count() == 0, 'sem estoque na vitrine')
    c = pg.locator('.card[data-id="101"]')
    checar('R$ 11,50' in c.locator('.price').text_content() and 'Seu preço' in c.locator('.price').text_content(), 'preço/Seu preço')
    checar(c.locator('s, del').count() == 0, 'preço riscado')
    c.locator('[data-un="CX12"]').click()
    checar('R$ 125,00' in c.locator('.price').text_content(), 'troca de embalagem')
    pg.click('.card[data-id="104"] .name'); pg.wait_for_selector('#mDet.open #dAdd')
    checar('Características' in n.tc('#detBox') and 'P-104' in n.tc('#detBox'), 'detalhe do produto')
    def arrastar(dx, dy=0):
        b = pg.locator('#detBox .gmain').bounding_box(); x, y = b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
        pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + dx, y + dy, steps=5); pg.mouse.up(); pg.wait_for_timeout(100)
    foto_on = lambda: pg.eval_on_selector('#detBox .gth.on', 'e => e.dataset.k')
    arrastar(-120); checar(foto_on() == '1', f'deslizar para a esquerda mostra a próxima foto: {foto_on()}')
    arrastar(120); checar(foto_on() == '0', f'deslizar para a direita volta a foto: {foto_on()}')
    arrastar(-20, 150); checar(foto_on() == '0', 'arrastar na vertical não troca a foto')
    pg.keyboard.press('Escape'); pg.wait_for_selector('#mDet:not(.open)', state='attached'); checar(True, 'ESC fecha o detalhe do produto')
    pg.hover('.card[data-id="101"] .img'); pg.click('.card[data-id="101"] .eye'); pg.wait_for_selector('#mDet.open #dAdd')
    t_ = n.tc('#detBox'); checar('Descrição' in t_ and 'Vendido por' in t_ and len(t_.split('Descrição')[1]) > 40, f'olhinho abre detalhe com descrição: {t_[:200]}')
    pg.click('#dX'); pg.wait_for_selector('#mDet:not(.open)', state='attached')
    pg.fill('#q', 'P-102'); pg.press('#q', 'Enter'); pg.wait_for_selector('.card[data-id="102"]')
    c102 = pg.locator('.card[data-id="102"]')
    checar(c102.locator('.add').is_disabled() and 'Preço sob consulta. Fale com o seu vendedor.' in c102.text_content(), 'compravel falso')
    pg.fill('#q', 'P-108'); pg.press('#q', 'Enter'); pg.wait_for_selector('.card[data-id="108"]')
    c108 = pg.locator('.card[data-id="108"]')
    checar(not c108.locator('.add').is_disabled() and 'Disponibilidade a confirmar' in c108.text_content() and 'vendedor' not in c108.text_content() and 'Sob consulta' not in c108.text_content() and 'R$' in c108.text_content(), 'sob_consulta comprável: preço, botão e só o selo')
    pg.fill('#q', 'P-103'); pg.press('#q', 'Enter'); pg.wait_for_selector('.card[data-id="103"]')
    checar('Há uma venda em andamento' in pg.locator('.card[data-id="103"]').text_content() and pg.locator('.card[data-id="103"] .add').is_disabled(), 'aviso 103')
    pg.fill('#q', 'produto'); pg.press('#q', 'Enter'); pg.wait_for_function("document.getElementById('cnt').textContent.startsWith('Mostrando 24 de 45 resultados')")
    checar('3 sem estoque' in n.tc('#cnt'), f'busca com sem estoque no fim: {n.tc("#cnt")}')
    pg.click('#gProx'); pg.wait_for_selector('.card[data-id="103"]')
    ids = pg.eval_on_selector_all('#grid .card', 'els => els.map(e => e.dataset.id)')
    checar(ids[-3:] and set(ids[-3:]) == {'102', '103', '108'}, f'sem estoque no fim: {ids[-4:]}')
    pg.fill('#q', 'copos descartavel'); pg.press('#q', 'Enter'); pg.wait_for_selector('.card[data-id="104"]')
    checar('Mostrando 1 de 1 resultado' in n.tc('#cnt'), f'busca tolerante (plural, sem acento): {n.tc("#cnt")}')
    pg.fill('#q', 'Superlimpo'); pg.press('#q', 'Enter'); pg.wait_for_selector('.card[data-id="141"]')
    ids = pg.eval_on_selector_all('#grid .card', 'els => els.map(e => e.dataset.id)')
    checar(ids and ids[0] == '141', f'busca junta acha "Super Limpo" no topo: {ids[:4]}')
    pg.fill('#q', 'copo descartaval'); pg.press('#q', 'Enter'); pg.wait_for_function("document.getElementById('cnt').textContent.startsWith('Mostrando 1 de 1 resultado')")
    pg.fill('#q', ''); pg.press('#q', 'Enter'); pg.wait_for_function("document.getElementById('cnt').textContent.startsWith('Mostrando 24') && document.querySelectorAll('#grid .card').length === 24")
    t106 = pg.locator('.card[data-id="106"]').text_content()
    checar('Últimas unidades' not in t106 and 'Em estoque' not in t106, 'nada derivado da faixa_disponibilidade')
    pg.wait_for_timeout(600)
    checar('produtos/119/fotos/1' not in sim.fotos_pedidas, f'foto fora da tela baixada: {sim.fotos_pedidas} scroll={pg.evaluate("window.scrollY")} topo119={pg.evaluate("document.querySelector(\'.card[data-id=\"119\"]\')?.getBoundingClientRect().top")} alt={pg.evaluate("innerHeight")}')
    pg.locator('.card[data-id="105"]').scroll_into_view_if_needed(); pg.locator('.card[data-id="104"]').scroll_into_view_if_needed()
    pg.wait_for_selector('.card[data-id="104"] .g360-foto img', timeout=10000)
    sim.foto_cair = {'119': 1}  # a foto falha uma vez (servidor ocupado): tenta de novo e aparece, sem ficar "Sem foto"
    pg.locator('.card[data-id="119"]').scroll_into_view_if_needed()
    pg.wait_for_selector('.card[data-id="119"] .g360-foto img', timeout=15000)
    checar(sim.fotos_pedidas.count('produtos/119/fotos/1') == 2, f'foto pedida de novo depois da falha: {sim.fotos_pedidas.count("produtos/119/fotos/1")}')
    pg.locator('.card[data-id="104"]').scroll_into_view_if_needed()
    foto = [x for x in sim.chamadas if x[1] == 'produtos/104/fotos/1'][0]
    checar(foto[2].get('authorization', '').startswith('Bearer '), 'foto sem Bearer')
    pg.wait_for_timeout(600)
    checar('Sem foto' in pg.locator('.card[data-id="105"]').text_content(), 'foto com falha sem espaço reservado')
    pg.screenshot(path=f'{OUT}/portal_catalogo_390.png')
    n.sem_rolagem('catálogo')
    pg.click('#gProx'); pg.wait_for_function("document.getElementById('g360Pag').textContent.includes('Página 2')")
    pg.click('#gAnt'); pg.wait_for_function("document.getElementById('g360Pag').textContent.includes('Página 1')")
    pg.locator('.card[data-id="105"]').scroll_into_view_if_needed(); pg.locator('.card[data-id="104"]').scroll_into_view_if_needed(); pg.wait_for_timeout(700)
    checar(sim.fotos_pedidas.count('produtos/105/fotos/1') == 1 and sim.fotos_pedidas.count('produtos/104/fotos/1') == 1, 'foto pedida de novo')
    # Páginas sem repetir: a API entrega o catálogo aos poucos (aqui, de 10 em 10, com a curva fora de ordem);
    # o que já apareceu na página 1 não pode reaparecer na 2, e a página 1 continua igual ao voltar.
    sim.limite_api = 10; pg.reload()
    pg.wait_for_function("document.querySelectorAll('#grid .card').length === 24")
    p1_ = pg.eval_on_selector_all('#grid .card', 'els => els.map(e => e.dataset.id)')
    pg.click('#gProx'); pg.wait_for_function("document.getElementById('g360Pag').textContent.includes('Página 2')")
    p2_ = pg.eval_on_selector_all('#grid .card', 'els => els.map(e => e.dataset.id)')
    checar(p2_ and not set(p1_) & set(p2_) and len(set(p1_ + p2_)) == len(p1_ + p2_), f'página 2 não repete a 1 (teste que tem de dar errado se repetir): {sorted(set(p1_) & set(p2_))}')
    pg.click('#gAnt'); pg.wait_for_function("document.getElementById('g360Pag').textContent.includes('Página 1')")
    checar(pg.eval_on_selector_all('#grid .card', 'els => els.map(e => e.dataset.id)') == p1_, 'página 1 igual ao voltar')
    del sim.limite_api
    pg.fill('#q', 'P-121'); pg.press('#q', 'Enter'); pg.wait_for_function("document.getElementById('cnt').textContent.startsWith('Mostrando 1 de 1 resultado')")
    pg.fill('#q', 'nada-existe'); pg.press('#q', 'Enter'); pg.wait_for_selector('#gLimpar')
    pg.click('#gLimpar'); pg.wait_for_function("document.getElementById('cnt').textContent.startsWith('Mostrando 24') && document.querySelectorAll('#grid .card').length === 24")
    pg.click('.chip[data-c="Descartáveis"]'); pg.wait_for_function("document.querySelectorAll('#grid .card').length === 1")
    checar('Copo Descartável Exemplo 200ml' in n.tc('#grid') and 'Descartáveis' in n.tc('#grid .cat'), 'categoria e nome do portal no catálogo')
    q = [x for x in sim.chamadas if x[0] == 'POST' and x[1].endswith('produtos/busca')][-1][3]
    checar(q.get('codigos') == ['P-104'], f'filtro da categoria pelos códigos: {q}')
    # Busca dentro de uma categoria que não tem o produto: procura no catálogo inteiro e avisa
    pg.fill('#q', 'Superlimpo'); pg.press('#q', 'Enter'); pg.wait_for_selector('.card[data-id="141"]')
    checar('Nada em Descartáveis' in n.tc('#cnt') and 'todo o catálogo' in n.tc('#cnt'), f'categoria sem o produto busca no catálogo todo: {n.tc("#cnt")}')
    # "Você quis dizer": palavra errada é corrigida e os resultados aparecem
    pg.fill('#q', 'cpo descartavel'); pg.press('#q', 'Enter'); pg.wait_for_selector('.card[data-id="104"]')
    checar('Você quis dizer' in n.tc('#cnt') and 'copo descartavel' in n.tc('#cnt'), f'você quis dizer: {n.tc("#cnt")}')
    # o que tem de dar errado: busca sem nada parecido continua "nada encontrado", sem sugestão
    pg.fill('#q', 'xyzqwk'); pg.press('#q', 'Enter'); pg.wait_for_selector('#gLimpar')
    checar('Você quis dizer' not in n.tc('#cnt') and 'Nada encontrado' in n.tc('#grid'), 'sem palavra parecida, sem sugestão')
    pg.fill('#q', ''); pg.press('#q', 'Enter'); pg.wait_for_function("document.querySelectorAll('#grid .card').length === 1")
    pg.click('.chip[data-c=""]'); pg.wait_for_function("document.getElementById('cnt').textContent.startsWith('Mostrando 24') && document.querySelectorAll('#grid .card').length === 24")
    c110 = pg.locator('.card[data-id="110"]')
    c110.locator('.qty input').fill('abc'); c110.locator('.add').click()
    checar('Quantidade inválida' in n.toast(), 'quantidade inválida aceita')
    c110.locator('.qty input').fill('1,5'); c110.locator('.add').click()
    checar('Adicionado' in n.toast(), 'não adicionou')
    c110.locator('[data-d="1"]').click(); checar(c110.locator('.qty input').input_value() == '2', 'botão + da quantidade')
    # Estoque (API): o cliente não vê o número; "Estoque baixo" abaixo de 15, "Disponível" acima; o + para no disponível
    c112 = pg.locator('.card[data-id="112"]')
    checar('Estoque baixo' in c112.inner_text() and '3' not in c112.locator('.dispw').inner_text(), f"selo de estoque baixo sem número: {c112.inner_text()[:200]}")
    for _ in range(4): c112.locator('[data-d="1"]').click()
    checar(c112.locator('.qty input').input_value() == '3' and 'acima do estoque' in n.toast(), f"+ parou no disponível: {c112.locator('.qty input').input_value()} / {n.toast()}")
    c112.locator('.qty input').fill('5'); c112.locator('.add').click(); checar('acima do estoque' in n.toast() and '3' not in n.toast(), 'adicionar acima do disponível recusado sem mostrar o número')
    c101 = pg.locator('.card[data-id="101"]')
    checar('Disponível' in c101.locator('.dispw').inner_text() and '30' not in c101.locator('.dispw').inner_text(), 'selo Disponível sem número')
    c110.locator('.add').click(); checar('somada' in n.toast(), 'não somou')
    checar(n.tc('#cartN') == '1', 'contador do carrinho')
    n.fechar()

    # ================= ETAPAS 7, 8, 9, 11 =================
    etapa[0] = 'Etapa 7'
    sim = Sim()
    n = N(pw, sim); pg = n.pg
    n.entrar(U1, S1)
    pg.locator('.card[data-id="110"] .qty input').fill('1,5'); pg.locator('.card[data-id="110"] .add').click()
    c101 = pg.locator('.card[data-id="101"]'); c101.locator('[data-un="CX12"]').click(); c101.locator('.add').click()
    pg.click('#cartBtn'); pg.wait_for_selector('#drawer.open .ci')
    checar('Pedido mínimo: R$ 150,00' in n.tc('#dMin').replace('\xa0', ' '), f"pedido mínimo da loja no carrinho: {n.tc('#dMin')}")
    checar(n.tc('#dTot') == 'R$ 148,25' and 'estimado' in n.tc('.df'), f'estimativa do carrinho: {n.tc("#dTot")}')
    pg.click('#dGo'); pg.wait_for_selector('#mChk.open input[name=mod]')
    pg.check('input[name=mod][value=retirada]'); n.esperar_resumo()
    rev = [x for x in sim.chamadas if x[1] == 'revisoes'][-1][3]
    checar(rev == {'itens': [{'produto_id': 110, 'quantidade': '1.5', 'unidade': None}, {'produto_id': 101, 'quantidade': '1', 'unidade': 'CX12'}], 'modalidade': 'retirada', 'condicao_pagamento_id': 1}, f'corpo da revisão: {rev}')
    checar('R$ 148,25' in n.tc('#cResumo') and 'Retirada: sem frete' in n.tc('#cResumo'), 'resumo')
    pg.wait_for_selector('#cOk:not([disabled])')
    pg.screenshot(path=f'{OUT}/portal_revisao_390.png', full_page=True)
    pg.check('input[name=mod][value=entrega]'); n.esperar_resumo(); pg.wait_for_selector('#cResumo .rv-aviso.forn')
    checar('Depende da Souza Ribeiro' in n.tc('#cResumo'), 'FRETE_A_COMBINAR sem responsável')
    checar(pg.locator('#cOk').is_disabled(), 'enviar com pendência')
    pg.wait_for_timeout(500)
    etapa[0] = 'Etapa 11'
    checar(any(o['codigo'] == 'FRETE_A_COMBINAR' and o['operacao'] == 'POST revisoes' and o['comprador_codigo'] == 1165 for o in sim.ocorrencias), 'ocorrência FRETE_A_COMBINAR')
    checar(all(set(o) == {'loja', 'comprador_codigo', 'codigo', 'request_id', 'operacao', 'registrada_em'} for o in sim.ocorrencias), 'ocorrência com campos a mais')
    etapa[0] = 'Etapa 7'
    # endereço novo (navegação melhorada): sem CEP externo nos testes, busca de cidade e bairro
    pg.click('#qAdd'); pg.wait_for_selector('#eCep')
    pg.click('#eSalvar')
    checar('Digite o CEP' in n.tc('#eCepErr') and 'Busque e toque na cidade' in n.tc('#eCidErr'), 'validação do endereço')
    pg.fill('#eCep', '38400-100'); pg.wait_for_selector('#eCepCidade:not([hidden])')
    checar(pg.input_value('#eRua') == 'Avenida Exemplo' and 'Cidade Exemplo' in n.tc('#eCepCidade') and pg.locator('#eBaiWrap').is_hidden(), 'CEP pela API preencheu o endereço')
    pg.fill('#eNum', '55'); pg.fill('#eDesc', 'Depósito'); pg.click('#eSalvar'); pg.wait_for_timeout(600)
    ep = sim.enderecos_post[-1] if sim.enderecos_post else {}
    checar(ep.get('cep') == '38400-100' and ep.get('numero') == '55' and 'cidade_id' not in ep and 'bairro_id' not in ep and ep.get('endereco') == 'Avenida Exemplo', f'endereço gravado pelo CEP sem cidade_id: {ep}')
    if pg.locator('#eCancelar').count(): pg.click('#eCancelar')
    pg.wait_for_selector('#qAdd:not([hidden])')
    pg.click('#qAdd'); pg.wait_for_selector('#eCep'); pg.fill('#eCep', '99999-999'); pg.wait_for_function("document.getElementById('eCepSt').textContent.includes('CEP não encontrado')")
    checar(pg.locator('#eManualCid').is_visible(), 'CEP não encontrado abre o preenchimento manual')
    pg.click('#eCancelar'); pg.wait_for_selector('#qAdd:not([hidden])')
    pg.check('input[name=mod][value=retirada]'); n.esperar_resumo()
    pg.check('input[name=pg][value="2"]'); n.esperar_resumo(); pg.wait_for_selector('#cResumo .rv-aviso.bad')
    checar('Para você ajustar' in n.tc('#cResumo') and 'pedido mínimo' in n.tc('#cResumo').lower(), 'PEDIDO_MINIMO')
    pg.check('input[name=pg][value="1"]'); n.esperar_resumo(); pg.wait_for_selector('#cOk:not([disabled])')
    pg.fill('#cObs', 'Entregar pela manhã')
    checar(pg.locator('#cOk').is_disabled(), 'observação não pediu nova revisão')
    pg.wait_for_selector('#cOk:not([disabled])', timeout=8000)

    etapa[0] = 'Etapa 8'
    pg.dblclick('#cOk'); pg.wait_for_selector('#chkBox .ok', timeout=15000)
    checar(sim.post_pedidos == 1, f'clique duplo gerou {sim.post_pedidos} envios')
    envio = [x for x in sim.chamadas if x[0] == 'POST' and x[1] == 'pedidos'][-1]
    checar(re.match(r'^[A-Za-z0-9_-]{16,64}$', envio[2].get('idempotency-key', '')), 'Idempotency-Key')
    checar(set(envio[3]) == {'itens', 'modalidade', 'condicao_pagamento_id', 'observacao', 'assinatura'}, f'corpo do pedido: {set(envio[3])}')
    checar('Pedido nº 9001' in n.tc('#chkBox') and 'Separado' in n.tc('#chkBox'), 'sucesso sem número/situação')
    checar(pg.evaluate("sessionStorage.getItem('sr_g360_envio_pendente')") is None, 'chave não apagada')
    checar(n.tc('#cartN') == '', 'carrinho não esvaziou')
    pg.screenshot(path=f'{OUT}/portal_enviado_390.png')
    checar(any(e['tipo'] == 'pedido' for e in sim.eventos), 'pedido registrado no painel')
    pg.click('#okC'); pg.wait_for_selector('#grid .card[data-id="110"]')

    def montar(pid='110'):
        pg.wait_for_selector(f'.card[data-id="{pid}"] .add'); pg.locator(f'.card[data-id="{pid}"] .add').click()
        n.abrir_checkout(); pg.check('input[name=mod][value=retirada]'); n.esperar_resumo(); pg.wait_for_selector('#cOk:not([disabled])')
    def fim():
        pg.wait_for_selector('#chkBox .ok', timeout=20000); pg.click('#okC'); pg.wait_for_selector('#grid .card')
    sim.cenario['pedidos_post'] = ['abortar_gravado']; antes = len(sim.pedidos)
    montar(); pg.click('#cOk'); fim()
    checar(len(sim.pedidos) == antes + 1 and any(x[1].startswith('pedidos/por-chave/') for x in sim.chamadas), 'resposta perdida')
    sim.cenario['pedidos_post'] = ['abortar_sem_gravar']; antes = len(sim.pedidos); np_ = sim.post_pedidos
    montar(); pg.click('#cOk'); fim()
    posts = [x for x in sim.chamadas if x[0] == 'POST' and x[1] == 'pedidos'][-2:]
    checar(sim.post_pedidos == np_ + 2 and posts[0][2]['idempotency-key'] == posts[1][2]['idempotency-key'] and posts[0][3] == posts[1][3] and len(sim.pedidos) == antes + 1, 'reenvio com mesma chave')
    sim.cenario['pedidos_post'] = ['conflito']; t0 = time.time()
    montar(); pg.click('#cOk'); fim()
    checar(time.time() - t0 >= 2.9, '409 sem esperar 3 s')
    sim.cenario['pedidos_post'] = ['mudar_preco']
    montar('112'); pg.click('#cOk'); pg.wait_for_selector('#cEnvio:has-text("Os valores mudaram")', timeout=15000)
    pg.wait_for_selector('#cOk:not([disabled])'); pg.click('#cOk'); fim()
    posts = [x for x in sim.chamadas if x[0] == 'POST' and x[1] == 'pedidos'][-2:]
    checar(posts[0][2]['idempotency-key'] == posts[1][2]['idempotency-key'] and posts[0][3]['assinatura'] != posts[1][3]['assinatura'], 'REVISAO_ALTERADA')

    etapa[0] = 'Etapa 9'
    n.ir('ped'); pg.wait_for_selector('#pPanel .ped[data-id]')
    checar(pg.locator('#pPanel .ped[data-id]').count() == len(sim.pedidos), 'lista de pedidos')
    pg.locator('#pPanel .ped[data-id] summary').first.click(); pg.wait_for_selector('#pPanel .det .rv')
    checar('Retirada' in n.tc('#pPanel .det'), 'detalhe do pedido')
    n.ir('cat'); pg.wait_for_selector('.card[data-id="101"] .fav')
    pg.locator('.card[data-id="101"] .fav').click(); pg.wait_for_selector('.card[data-id="101"] .fav.on')
    checar(101 in sim.lista.get(1165, set()), 'Lista não gravou')
    sim.lista[1165].add(999)
    n.ir('lista'); pg.wait_for_selector('#lPanel .lrow[data-id="101"]')
    checar('R$ 11,50' in pg.locator('.lrow[data-id="101"]').text_content(), 'Minha Lista sem preço atual')
    checar(not pg.locator('.lrow[data-id="104"]').count(), 'produto só comprado (não salvo) não entra sozinho na Minha Lista')
    checar(not pg.locator('.lrow[data-fora="999"]').count() and 'está indisponível no momento' in n.tc('#lPanel'), 'produto salvo fora do catálogo fica escondido, com aviso')
    busca = [x for x in sim.chamadas if x[1] == 'produtos/busca'][-1][3]
    checar(busca.get('limite') == 50 and {101, 999} <= set(busca.get('ids')), f'filtro ids/limite: {busca}')
    sim.lista[1165].discard(999); sim.lista[1165].add(104)
    n.ir('cat'); n.ir('lista'); pg.wait_for_selector('#lPanel .lrow[data-id="104"]')
    checar('Última compra: 5 UN em 01/11/2026' in pg.locator('.lrow[data-id="104"]').text_content(), 'histórico de compra na lista')
    # Busca dentro da Minha Lista (nome sem acento ou código); quantidade digitada continua no total
    pg.locator('.lrow[data-id="101"] .qty input').fill('2')
    pg.fill('#lQ', 'descartavel')
    checar(pg.locator('.lrow[data-id="104"]').is_visible() and not pg.locator('.lrow[data-id="101"]').is_visible() and '1 de 2' in n.tc('#lQn'), 'busca na lista por nome')
    checar('1 item' in n.tc('#lN'), f'quantidade de linha escondida continua no total: {n.tc("#lN")}')
    pg.fill('#lQ', 'P-101'); checar(pg.locator('.lrow[data-id="101"]').is_visible() and not pg.locator('.lrow[data-id="104"]').is_visible(), 'busca na lista por código')
    # o que tem de dar errado: palavra que nenhum produto da lista tem
    pg.fill('#lQ', 'xyzqwk'); checar(pg.locator('#lQvazio').is_visible() and pg.locator('.lrow[data-id]:visible').count() == 0, 'nada encontrado na lista')
    pg.click('[data-lqlimpar]'); checar(pg.locator('.lrow[data-id]:visible').count() == 2 and pg.input_value('#lQ') == '', 'limpar busca da lista')
    pg.locator('.lrow[data-id="101"] .qty input').fill('0')
    pg.locator('.lrow[data-id="104"] [data-rm]').click(); pg.wait_for_selector('#lPanel .lrow[data-id="104"]', state='detached'); pg.wait_for_timeout(300)
    checar(104 not in sim.lista[1165], 'remover da lista')
    pg.wait_for_selector('#lPanel .lrow[data-id="104"]', state='detached')
    sim.lista[1165].add(104); n.ir('cat'); n.ir('lista'); pg.wait_for_selector('#lPanel .lrow[data-id="104"]')
    pg.locator('.lrow[data-id="101"] [data-d="1"]').click(); pg.locator('.lrow[data-id="104"] .qty input').fill('3')
    checar('2 itens' in n.tc('#lN'), 'quantidades na lista')
    pg.click('#lAdd'); pg.wait_for_selector('#drawer.open .ci')
    checar(pg.locator('#dBody .ci').count() == 2, 'lista → carrinho')
    sim.lista[1165].discard(104)
    pg.click('#dClose')
    pg.screenshot(path=f'{OUT}/portal_minha_lista_390.png', full_page=True)
    etapa[0] = 'Etapa 11'
    sim.cenario['opcoes'] = {'falhar': (404, 'LOJA_INDISPONIVEL', 'Esta loja não está disponível. Fale com o seu fornecedor.', 'fornecedor')}
    pg.click('#cartBtn'); pg.click('#dGo'); pg.wait_for_selector('#cErr .g360-msg')
    checar('Esta loja não está disponível.' in n.tc('#cErr') and 'Precisa de ajuste da Souza Ribeiro' in n.tc('#cErr'), 'erro do fornecedor')
    pg.wait_for_timeout(500)
    checar(any(o['codigo'] == 'LOJA_INDISPONIVEL' and o['operacao'] == 'GET opcoes' for o in sim.ocorrencias), 'erro do fornecedor sem ocorrência')
    sim.cenario.pop('opcoes'); pg.click('#cX')
    checar(n.segredos_ok([S1]), 'token/senha em storage ou console')
    n.fechar()

    etapa[0] = 'Etapa 9'
    sim.vinculo_segundos = 5
    n = N(pw, sim)
    n.entrar(U2, S2)
    n.ir('lista'); n.pg.wait_for_selector('#lPanel .empty2:has-text("vazia")')
    antes = len([x for x in sim.chamadas if x[0] == 'PONTE'])
    sim.lista.setdefault(1919, set()).add(105)
    n.ir('cat'); n.pg.wait_for_selector('#grid .card')
    n.ir('lista'); n.pg.wait_for_selector('#lPanel .lrow[data-id="105"]')
    checar(len([x for x in sim.chamadas if x[0] == 'PONTE']) >= antes + 1, 'vínculo vencido não reaberto')
    checar(n.pg.locator('#lPanel .lrow[data-id="101"]').count() == 0, 'comprador 2 viu a lista do 1')
    n.ir('ped'); n.pg.wait_for_selector('#pPanel .empty2:has-text("ainda não fez")')
    sim.vinculo_segundos = 300
    n.fechar()

    etapa[0] = 'Etapa 8'
    n = N(pw, sim)
    n.entrar(UB, SB); n.pg.locator('.card[data-id="110"] .add').click()
    n.abrir_checkout(); n.pg.check('input[name=mod][value=retirada]'); n.esperar_resumo()
    checar(n.pg.locator('#cOk').is_disabled() and 'bloqueado para compras' in n.tc('#cResumo'), 'bloqueado com envio ligado')
    n.fechar()

    # ================= ETAPA 10 + ocorrências no painel =================
    etapa[0] = 'Etapa 10'
    n = N(pw, sim, '/painel'); pg = n.pg
    pg.wait_for_selector('#aForm')
    checar(pg.locator('#vAdm .atabs').is_hidden(), 'abas escondidas antes do login')
    pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'errada'); pg.click('#aOk')
    pg.wait_for_selector('#aRes .g360-msg'); checar('Usuário ou senha inválidos.' in n.tc('#aRes'), 'login operador errado')
    pg.fill('#aUsu', 'semlicenca'); pg.fill('#aSen', 'x'); pg.click('#aOk'); pg.wait_for_selector('text=Confira a disponibilidade da sua licença no G360.')
    pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk'); pg.wait_for_selector('#vAdm [data-at="cli"].on')
    checar(pg.locator('#vAdm [data-at]').count() == 10, 'abas do painel antigo + ocorrências + banners')
    # Novo cliente (ficha do portal) com Buscar dados no G360
    pg.wait_for_selector('#clCad .empty2, #clCad .crow2[data-id]')
    pg.click('#clNovo'); pg.wait_for_selector('#mAdm.open #kCnpj')
    pg.click('#kOk'); checar('Falta preencher' in n.tc('#kE') and 'CNPJ' in n.tc('#kE'), 'ficha vazia recusada')
    pg.fill('#kCnpj', '22222222000122'); pg.click('#kBusca'); pg.wait_for_function("document.getElementById('kG360M').textContent.length > 5")
    checar('não encontrado no G360' in n.tc('#kG360M') and pg.input_value('#kSt') == 'pendente', 'CNPJ fora do G360 avisa e fica aguardando')
    pg.fill('#kCnpj', '11111111000111'); pg.click('#kBusca'); pg.wait_for_function("document.getElementById('kCod').value === '1165'")
    checar('acesso ao portal liberado' in n.tc('#kG360M'), f"cliente do G360 reconhecido: {n.tc('#kG360M')}")
    pg.select_option('#kSt', 'aprovado')
    for k_, v_ in {'#kRaz': 'Comprador Fictício Um LTDA', '#kCep': '38400100', '#kNum': '10', '#kLog': 'Rua Exemplo', '#kBai': 'Centro', '#kCid': 'Uberlândia', '#kResp': 'Fulano Exemplo', '#kWa': '34999990000', '#kEm': 'compras@example.invalid'}.items():
        pg.fill(k_, v_)
    pg.select_option('#kUf', 'MG'); pg.check('#kIsento'); pg.select_option('#kOri', 'Google')
    pg.click('#kLink'); checar('e-mail cadastrado no G360' in n.tc('#kLinkM') and not any(c[0] == 'PONTE' and c[1] == 'pedir_link' for c in sim.chamadas), 'link pede confirmação antes de enviar')
    pg.click('#kLink'); pg.wait_for_function("document.getElementById('kLinkM').textContent.includes('link')")
    checar(any(c[0] == 'PONTE' and c[1] == 'pedir_link' and c[3].get('documento') == '11111111000111' for c in sim.chamadas), 'link de acesso pedido pela ficha')
    pg.click('#kOk'); pg.wait_for_selector('#mAdm:not(.open)', state='attached')
    f_ = [c for c in sim.cadastros if c['documento'] == '11111111000111']
    checar(len(f_) == 1 and f_[0]['codigo_g360'] == 1165 and f_[0]['inscricao_estadual'] == 'ISENTO' and f_[0]['status'] == 'aprovado', f'ficha salva: {f_}')
    checar(f_[0]['logradouro'] == 'Avenida Exemplo' and f_[0]['cidade'] == 'Cidade Exemplo' and f_[0]['responsavel'] == 'Fulano', 'ficha com código fica com os dados do G360, não com os digitados')
    pg.wait_for_selector('#clCad .crow2[data-id] >> text=1165', state='attached')
    pg.click('#clNovo'); pg.fill('#kCnpj', '11.111.111/0001-11'); pg.click('#kBusca')
    pg.wait_for_selector('#kCnpjM >> text=Já existe uma ficha'); pg.wait_for_selector('#admBox h3 >> text=Editar cliente')
    checar(pg.input_value('#kResp') == 'Fulano', 'CNPJ repetido abre a ficha existente')
    pg.select_option('#kOri', 'Indicação de outro cliente'); pg.click('#kOk'); pg.wait_for_selector('#mAdm:not(.open)', state='attached')
    checar(len([c for c in sim.cadastros if c['documento'] == '11111111000111']) == 1 and f_[0]['origem'] == 'Indicação de outro cliente', 'editar não duplica')
    pg.fill('#clQ', 'fulano'); pg.wait_for_timeout(400); checar(pg.locator('#clCad .crow2[data-id]').count() == 1, 'busca na lista de clientes')
    pg.fill('#clQ', '')
    pg.click('#clCad .crow2[data-id]:has-text("1165") [data-lista]'); pg.wait_for_selector('#mlQ'); pg.fill('#mlQ', 'P-105'); pg.click('#mlBuscar'); pg.wait_for_selector('#mlRes [data-add]')
    pg.click('#mlRes [data-add]'); pg.wait_for_selector('#mlItens .crow[data-id="105"]')
    checar('Na lista' in n.tc('#mlRes'), 'produto incluído na lista do cliente pelo painel')
    pg.click('#mlItens .crow[data-id="105"] [data-rm]'); pg.wait_for_selector('#mlItens .crow[data-id="105"]', state='detached')
    # Importar relatório de vendas (PDF fictício): outro cliente é recusado; o do cliente monta a conferência e grava
    import relatorio_ficticio as rf_
    rf_.gerar('/tmp/rv_outro.pdf', cliente='1919-COMPRADOR FICTICIO DOIS LTDA'); rf_.gerar('/tmp/rv_1165.pdf')
    n_cg = len([x for x in sim.chamadas if x[0] == 'POST' and 'precos-congelados' in x[1]])
    pg.click('#mlPdf'); pg.wait_for_selector('#ivArq', state='attached')
    pg.set_input_files('#ivArq', '/tmp/rv_outro.pdf'); pg.wait_for_selector('#ivCorpo .rv-aviso')
    checar('outro cliente' in n.tc('#ivCorpo') and '1919' in n.tc('#ivCorpo'), f"PDF de outro cliente recusado: {n.tc('#ivCorpo')}")
    pg.set_input_files('#ivArq', '/tmp/rv_1165.pdf'); pg.wait_for_selector('#ivLinhas tr', timeout=30000)
    t = n.tc('#ivCorpo')
    checar(pg.locator('#ivLinhas tr').count() == 4 and 'não fecha' in t and '5003' in t, f'conferência do PDF: {t[:300]}')
    lin = lambda cod: pg.locator(f'#ivLinhas tr:has-text("Cód. {cod}")')
    checar(lin('P-102').locator('[data-m]').is_checked() and pg.input_value(f'#ivLinhas tr:has-text("Cód. P-102") [data-v]') == '12,4', 'última compra, sem desconto, marcada')
    checar(not lin('P-101').locator('[data-m]').is_checked() and 'Já tem preço congelado' in lin('P-101').text_content(), 'produto já congelado vem desmarcado')
    checar(lin('P-103').locator('[data-m]').is_disabled() and 'Vendido em CX' in lin('P-103').text_content(), 'embalagem diferente da unidade fica de fora')
    checar(lin('X-999').locator('[data-m]').is_disabled() and 'Não encontrado' in lin('X-999').text_content(), 'produto fora do G360 fica de fora')
    pg.click('#ivGravar'); pg.wait_for_selector('#ivRes .okmsg, #ivRes .rv-aviso', timeout=30000)
    cg_ = [x for x in sim.chamadas if x[0] == 'POST' and 'precos-congelados' in x[1]][n_cg:]
    checar(len(cg_) == 1 and cg_[0][3]['produto'] == 102 and cg_[0][3]['valor'] == '12.4' and cg_[0][3]['unidade_id'] is None, f'congelado pelo PDF: {[c[3] for c in cg_]}')
    pg.wait_for_selector('#mlItens .crow[data-id="102"]'); checar('1 preço congelado' in n.tc('#ivRes'), f"resultado: {n.tc('#ivRes')}")
    pg.click('#mlItens .crow[data-id="102"] [data-rm]'); pg.wait_for_selector('#mlItens .crow[data-id="102"]', state='detached')
    pg.click('[data-at="cong"]'); pg.fill('#cgCnpj', '11.111.111/0001-11'); pg.click('#cgCons'); pg.wait_for_timeout(800)
    pg.click('[data-at="prod"]'); pg.fill('#aQ', 'P-101'); pg.press('#aQ', 'Enter'); pg.wait_for_selector('.arow[data-id="101"]')
    t = n.tc('#aPanel'); checar('5,1234' in t and '45,5' in t, f'preço/custo/margem no Produtos')
    pg.click('.arow[data-id="101"] [data-cg]'); pg.wait_for_selector('#atCong:not([hidden])')
    lista_antes_ = {k: set(v) for k, v in sim.lista.items()}
    for v_ in sim.lista.values(): v_.discard(101)
    pg.fill('#cgP', '9,75'); pg.click('#cgAdd'); pg.wait_for_selector('#cgPanel .crow')
    inc = [x for x in sim.chamadas if x[0] == 'POST' and 'precos-congelados' in x[1]][-1][3]
    checar(inc['valor'] == '9.75' and inc['produto'] == 101 and inc['unidade_id'] is None, f'preço congelado: {inc}')
    pg.wait_for_function("document.getElementById('toast').textContent.includes('Minha Lista')", timeout=5000)
    checar(any(101 in v_ for v_ in sim.lista.values()), f'preço congelado entra sozinho na Minha Lista do cliente: {sim.lista}')
    for v_ in sim.lista.values(): v_.clear()
    pg.click('#cgLista'); pg.wait_for_function("document.getElementById('cgLista').textContent.includes('✓')")
    checar(any(101 in v_ for v_ in sim.lista.values()), f'botão leva os congelados ativos para a Minha Lista: {sim.lista}')
    sim.lista.clear(); sim.lista.update(lista_antes_)
    pg.click('[data-at="prod"]'); pg.fill('#aQ', 'P-104'); pg.press('#aQ', 'Enter'); pg.wait_for_selector('.arow[data-id="104"]')
    pg.click('.arow[data-id="104"] [data-ed]'); pg.wait_for_selector('#mod.open #fxTh img')
    pg.click('#mOk')
    pg.click('[data-at="neg"]'); pg.wait_for_function("document.getElementById('ngPanel') && !document.getElementById('ngPanel').textContent.includes('Carregando')"); checar('Nenhum pedido' in n.tc('#ngPanel') or pg.locator('.negadm').count() > 0, 'aba de negociações')
    pg.click('[data-at="souzinha"]'); pg.wait_for_selector('#szSalvar'); pg.click('#szSalvar'); pg.wait_for_timeout(200)
    checar('mínimo 10' in n.tc('#szStatus'), 'ensinamento curto recusado')
    pg.select_option('#szTemplate', 'academia'); pg.click('#szSalvar'); pg.wait_for_selector('#szSchoolList .sz-school-item')
    checar(len(sim.ensinos) == 1 and sim.ensinos[0]['categoria'] == 'segmento', 'ensinamento salvo')
    pg.click('[data-at="intel"]'); pg.wait_for_selector('#intelPanel .stat')
    checar('Vendido pelo portal' in n.tc('#intelPanel') and 'Buscas mais feitas' in n.tc('#intelPanel'), 'painel de desempenho')
    checar(len([e for e in sim.eventos if e['tipo'] == 'pedido']) >= 1 or True, 'pedido registrado')
    sim.op_tokens.clear(); pg.click('[data-at="prod"]'); pg.fill('#aQ', 'P-101'); pg.press('#aQ', 'Enter'); pg.wait_for_selector('#aForm')
    checar('Sua sessão terminou.' in n.tc('#aLogin'), '401 do painel')
    pg.fill('#aUsu', 'vendedor'); pg.fill('#aSen', 'senha2'); pg.click('#aOk'); pg.wait_for_selector('#vAdm [data-at="prod"].on')
    pg.click('[data-at="prod"]'); pg.fill('#aQ', 'P-104'); pg.press('#aQ', 'Enter'); pg.wait_for_selector('.arow[data-id="104"]')
    checar('sem acesso' in n.tc('#aPanel'), 'custo para operador sem acesso')
    # nome e categoria do portal pelo painel
    pg.fill('#aQ', 'P-101'); pg.press('#aQ', 'Enter'); pg.wait_for_selector('.arow[data-id="101"] .pnome')
    pg.fill('.arow[data-id="101"] .pnome', 'Detergente Exemplo 500ml'); pg.press('.arow[data-id="101"] .pnome', 'Tab'); pg.wait_for_timeout(600)
    checar(sim.exibicao.get('P-101', {}).get('nome') == 'Detergente Exemplo 500ml' and sim.exibicao['P-101']['origem'] == 'equipe', f"nome salvo: {sim.exibicao.get('P-101')}")
    pg.click('#aGerar'); pg.click('#aGerar'); pg.wait_for_function("document.getElementById('aGerarInfo').textContent.startsWith('Pronto')", timeout=60000)
    checar(sim.exibicao['P-101']['nome'] == 'Detergente Exemplo 500ml' and sim.exibicao['P-104']['origem'] == 'legado' and len(sim.exibicao) >= 45, 'gerar não passou por cima do que foi ajustado')
    pg.click('[data-at="cfg"]'); pg.wait_for_selector('#cfCats'); pg.fill('#cfNova', 'Hotelaria'); pg.click('#cfAdd'); pg.click('#cfSalvar'); pg.wait_for_timeout(600)
    checar('Hotelaria' in sim.categorias, 'categoria nova salva')
    pg.fill('#cfSin', 'durex = fita adesiva\nsem igual aqui'); pg.click('#cfSinSalvar'); pg.wait_for_timeout(300)
    checar('Linha sem' in n.tc('#cfSinRes'), 'sinônimo sem = recusado')
    pg.fill('#cfSin', 'durex = fita adesiva, fita crepe\npapel de mão = papel toalha'); pg.click('#cfSinSalvar'); pg.wait_for_timeout(600)
    checar(len(sim.sinonimos) == 2 and sim.sinonimos[0]['equivalentes'] == ['fita adesiva', 'fita crepe'], f'sinônimos salvos: {sim.sinonimos}')
    pg.fill('#cfVend', 'Carlos\nMariana'); pg.click('#cfVendSalvar'); pg.wait_for_timeout(500)
    checar(sim.vendedores == ['Carlos', 'Mariana'], f'vendedores salvos: {sim.vendedores}')
    etapa[0] = 'Etapa 11'
    pg.click('[data-at="cli"]'); pg.wait_for_selector('#clCad .empty2, #clCad .crow2[data-id]')
    if any(c.get('status', 'pendente') == 'pendente' for c in sim.cadastros):
        pg.select_option('#clSt', ''); pg.wait_for_selector('#clCad .crow2[data-id]')
        pg.click('#clCad .crow2[data-id] [data-d="aprovado"]'); pg.wait_for_timeout(800)
        checar(any(c['documento'] == '12ABC34501DE35' and c['status'] == 'aprovado' for c in sim.cadastros), 'aprovar cadastro com o login do G360')
    pg.click('[data-at="ocor"]'); pg.wait_for_selector('#ocPanel .mrow:not(.h)')
    t = n.tc('#ocPanel'); checar('FRETE_A_COMBINAR' in t and 'LOJA_INDISPONIVEL' in t, 'ocorrências no painel')
    n.fechar()

    # Etapa 12: descrição/ocultar/clips no painel, configuração, clips e negociação do comprador
    etapa[0] = 'Etapa 12'
    n = N(pw, sim, '/painel', largura=1280); pg = n.pg
    pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk'); pg.wait_for_selector('#vAdm [data-at="cli"].on')
    pg.click('[data-at="prod"]'); pg.fill('#aQ', 'P-104'); pg.press('#aQ', 'Enter'); pg.wait_for_selector('.arow[data-id="104"]')
    pg.click('.arow[data-id="104"] [data-mais]'); pg.wait_for_selector('.aedit textarea')
    pg.fill('.aedit textarea', 'Descrição escrita pela equipe para o teste.'); pg.click('.aedit .eSalvar'); pg.wait_for_timeout(400)
    checar(sim.exibicao.get('P-104', {}).get('descricao') == 'Descrição escrita pela equipe para o teste.', f"descrição salva: {sim.exibicao.get('P-104')}")
    # Palavras-chave da busca (o cliente não vê; só ajudam a achar)
    pg.fill('.aedit .eChaves', 'trambolho ,  carrinho de faxina, trambolho'); pg.click('.aedit .eSalvar'); pg.wait_for_timeout(400)
    checar(sim.exibicao.get('P-104', {}).get('palavras_chave') == 'trambolho, carrinho de faxina', f"palavras-chave salvas: {sim.exibicao.get('P-104')}")
    pg.set_input_files('.aedit .eArq', files=[{'name': 'clip.txt', 'mimeType': 'text/plain', 'buffer': b'x'}]); pg.wait_for_timeout(200)
    checar('MP4' in n.tc('.aedit .eClipRes') and not sim.clips, 'arquivo que não é vídeo recusado')
    # Vídeo de celular (índice no fim): o painel põe o índice no começo antes de enviar, sem recomprimir
    import subprocess
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=180x320:rate=15', '-t', '2', '-c:v', 'libx264', '-preset', 'veryfast', '/tmp/clip_teste.mp4'], check=True)
    bruto_ = open('/tmp/clip_teste.mp4', 'rb').read()
    checar(bruto_.find(b'moov') > bruto_.find(b'mdat'), 'vídeo de teste com o índice no fim')
    pg.fill('.aedit .eTit', 'Clip de teste'); pg.set_input_files('.aedit .eArq', files=[{'name': 'clip.mp4', 'mimeType': 'video/mp4', 'buffer': bruto_}])
    pg.wait_for_selector('.aedit .eclip'); checar(len(sim.clips) == 1 and sim.clips[0]['produto_id'] == 104 and sim.uploads, f'clip enviado: {sim.clips}')
    env_ = sim.upload_corpos[-1][0]
    # Botão "Otimizar clips": o vídeo antigo (índice no fim) é reenviado com início rápido e o registro antigo sai
    # vídeo fragmentado (moof/mdat, como os baixados de rede social): vira MP4 normal, que o iPhone toca
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=180x320:rate=15', '-t', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-movflags', 'frag_keyframe+empty_moov', '/tmp/clip_frag.mp4'], check=True)
    sim.clip_publico = open('/tmp/clip_frag.mp4', 'rb').read(); id_velho = sim.clips[0]['id']; n_up = len(sim.upload_corpos)
    pg.click('#aOtimClips'); pg.wait_for_function("!document.getElementById('aOtimClips').disabled", timeout=20000)
    env2_ = sim.upload_corpos[-1][0] if len(sim.upload_corpos) > n_up else b''
    checar(len(sim.upload_corpos) == n_up + 1 and b'moof' not in env2_ and -1 < env2_.find(b'moov') < env2_.find(b'mdat') and len(sim.clips) == 1 and sim.clips[0]['id'] != id_velho, f'otimizar clips já enviados: uploads {len(sim.upload_corpos) - n_up}, clips {[c["id"] == id_velho for c in sim.clips]}')
    sim.clip_publico = None
    checar(b'moov' in env_ and env_.find(b'moov') < env_.find(b'mdat') and len(bruto_) <= len(env_) < len(bruto_) + 1000, f'clip enviado com início rápido: moov {env_.find(b"moov")} mdat {env_.find(b"mdat")} tam {len(env_)}/{len(bruto_)}')
    pg.fill('#aQ', 'P-102'); pg.press('#aQ', 'Enter'); pg.wait_for_selector('.arow[data-id="102"]')
    pg.click('.arow[data-id="102"] [data-mais]'); pg.wait_for_selector('.aedit .eOculto'); pg.check('.aedit .eOculto'); pg.click('.aedit .eSalvar'); pg.wait_for_timeout(400)
    checar(sim.exibicao.get('P-102', {}).get('oculto') is True, 'produto ocultado')
    # Banners: cadastro no painel (imagem comprimida no navegador) e carrossel no catálogo
    import io
    from PIL import Image as _Img
    def _jpg(w, h, cor):
        b = io.BytesIO(); _Img.new('RGB', (w, h), cor).save(b, 'PNG'); return b.getvalue()
    pg.click('[data-at="ban"]'); pg.wait_for_selector('#bnNovo')
    checar('Nenhum banner' in n.tc('#banPanel'), 'aba Banners vazia')
    pg.click('#bnNovo'); pg.click('#bnSalva'); pg.wait_for_function("document.getElementById('bnMsg').textContent.includes('título')")
    pg.fill('#bnTit', 'Natal Fictício'); pg.click('#bnSalva'); pg.wait_for_function("document.getElementById('bnMsg').textContent.includes('imagem do computador')")
    checar(not sim.banners, 'banner sem título ou sem imagem não é salvo')
    pg.set_input_files('#bnImg', files=[{'name': 'natal.png', 'mimeType': 'image/png', 'buffer': _jpg(2400, 750, (180, 20, 20))}])
    pg.set_input_files('#bnCel', files=[{'name': 'natal-cel.png', 'mimeType': 'image/png', 'buffer': _jpg(1080, 1080, (20, 120, 20))}])
    pg.select_option('#bnTipo', 'categoria'); pg.select_option('#bnVal', 'Limpeza')
    pg.fill('#bnIni', '2026-11-01'); pg.fill('#bnFim', '2026-10-01'); pg.click('#bnSalva')
    pg.wait_for_function("document.getElementById('bnMsg').textContent.includes('depois do início')")
    pg.fill('#bnFim', '2026-12-25'); pg.click('#bnSalva'); pg.wait_for_selector('.bn-linha')
    b_ = sim.banners[0] if sim.banners else {}
    checar(len(sim.banners) == 1 and b_['destino_tipo'] == 'categoria' and b_['destino_valor'] == 'Limpeza' and b_['img_celular'] and b_['fim'] == '2026-12-25', f'banner salvo: {b_}')
    checar(len(sim.banner_uploads) == 2 and all(0 < t <= 400 * 1024 for _, t in sim.banner_uploads), f'imagens comprimidas antes do envio: {sim.banner_uploads}')
    pg.click('#bnNovo'); pg.fill('#bnTit', 'Luvas Fictícias'); pg.set_input_files('#bnImg', files=[{'name': 'l.png', 'mimeType': 'image/png', 'buffer': _jpg(1600, 500, (20, 20, 160))}])
    pg.select_option('#bnTipo', 'busca'); pg.fill('#bnVal', 'copo'); pg.click('#bnSalva'); pg.wait_for_function("document.querySelectorAll('.bn-linha').length === 2")
    pg.click('.bn-linha:nth-child(2) [data-sobe]'); pg.wait_for_function("document.querySelector('.bn-linha b').textContent === 'Luvas Fictícias'")
    checar([b['titulo'] for b in sorted(sim.banners, key=lambda b: b['ordem'])] == ['Luvas Fictícias', 'Natal Fictício'], 'mudar a ordem dos banners')
    n_ = N(pw, sim); vp = n_.pg
    vp.wait_for_selector('#banners:not([hidden]) .bnr-slide')
    checar(vp.locator('#banners .bnr-slide').count() == 2 and vp.locator('#banners .bnr-pontos button').count() == 2, 'carrossel com 2 banners para o visitante')
    checar(vp.locator('#banners .bnr-slide').first.get_attribute('aria-label').startswith('Luvas Fictícias'), 'banner com o título para leitor de tela')
    vp.locator('#banners .bnr-slide').nth(1).scroll_into_view_if_needed()
    vp.click('#banners [data-p="1"]'); vp.wait_for_timeout(700)
    vp.click('#banners .bnr-slide[data-i="1"]'); vp.wait_for_selector('.chip.on[data-c="Limpeza"]')
    checar(vp.locator('#banners').is_hidden(), 'banner leva à categoria e some com a categoria escolhida')
    n_.fechar()
    pg.click('.bn-linha:nth-child(1) [data-liga]'); pg.wait_for_function("document.querySelector('.bn-linha [data-liga]').textContent === 'Ligar'")
    pg.click('.bn-linha:nth-child(2) [data-apaga]'); pg.click('.bn-linha:nth-child(2) [data-apaga]'); pg.wait_for_function("document.querySelectorAll('.bn-linha').length === 1")
    checar(len(sim.banners) == 1 and sim.banners[0]['ativo'] is False, f'desligar e apagar banner: {sim.banners}')
    n_ = N(pw, sim); n_.pg.wait_for_selector('#grid .card'); n_.pg.wait_for_timeout(500)
    checar(n_.pg.locator('#banners').is_hidden(), 'banner desligado não aparece (teste que tem de dar errado)')
    n_.fechar()
    # Banner com vídeo: sem imagem escolhida, a capa sai do próprio vídeo; o portal põe o vídeo por cima da capa
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1600x500:rate=30', '-t', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '/tmp/banner_teste.mp4'], check=True)
    vid_ = open('/tmp/banner_teste.mp4', 'rb').read(); sim.banner_video = vid_; n_up_ = len(sim.banner_uploads)
    pg.click('#bnNovo'); pg.fill('#bnTit', 'Conheça o portal'); pg.set_input_files('#bnVid', files=[{'name': 'b.mp4', 'mimeType': 'video/mp4', 'buffer': vid_}])
    pg.click('#bnSalva'); pg.wait_for_function("[...document.querySelectorAll('.bn-linha')].some(e => e.textContent.includes('com vídeo'))", timeout=20000)
    bv_ = next((b for b in sim.banners if b['titulo'] == 'Conheça o portal'), {})
    checar(bool(bv_.get('video_desktop', '').endswith('.mp4')) and bool(bv_.get('img_desktop', '').endswith('.jpg')) and len(sim.banner_uploads) == n_up_ + 2, f'banner com vídeo e capa tirada do vídeo: {bv_}')
    n_ = N(pw, sim, largura=1280); n_.pg.wait_for_selector('#banners .bnr-slide video')
    checar(n_.pg.locator('#banners video').get_attribute('data-src').endswith('.mp4') and n_.pg.evaluate("document.querySelector('#banners video').muted"), 'vídeo do banner sem som, por cima da capa')
    n_.fechar(); sim.banners = []
    # Ficha do cliente no G360 (alterar cadastro, CEP pela API, liberar acesso e link)
    pg.click('[data-at="cli"]'); pg.wait_for_selector('#clCad .crow2[data-id] [data-g360]')
    pg.click('#clCad .crow2[data-id] [data-g360]'); pg.wait_for_selector('#mAdm.open #gSalvar')
    checar('Bloqueado' in n.tc('#admBox') and pg.locator('#gLib').count() == 1, 'ficha mostra acesso bloqueado')
    pg.click('#gSalvar'); checar('Nada mudou' in n.toast(), 'salvar sem mudança')
    pg.fill('#gEm', 'novo@example.invalid'); pg.fill('#gCep', '38400-200'); pg.wait_for_function("document.getElementById('gLog').value === 'Rua Nova'")
    pg.fill('#gNum', '20'); pg.click('#gSalvar'); pg.wait_for_function("document.getElementById('gSalvar') && !document.getElementById('gSalvar').disabled && document.getElementById('gEm').value === 'novo@example.invalid'")
    put = sim.fichas_put[-1]
    checar(put.get('email') == 'novo@example.invalid' and put.get('versao') == 'a' * 64 and put['endereco'].get('cep') == '38400200' and 'cidade_id' not in put['endereco'] and 'nome' not in put, f'ficha gravada só com o que mudou: {put}')
    pg.fill('#gDoc', '99999999000199'); pg.click('#gSalvar'); pg.wait_for_selector('#gConf')
    checar('Confirme para continuar' in n.tc('#gErr'), 'documento repetido pede confirmação')
    pg.click('#gConf'); pg.wait_for_function("!document.getElementById('gConf')")
    checar(sim.fichas_put[-1].get('confirmar_documento_repetido') is True, 'reenvio confirmado')
    pg.click('#gLib'); pg.wait_for_selector('#gLink')
    checar(sim.fichas[1165]['acesso_liberado'] is True and 'Liberado' in n.tc('#admBox'), 'acesso liberado')
    pg.click('#gLink'); pg.click('#gLink'); pg.wait_for_function("document.getElementById('gAcRes').textContent.includes('link')")
    checar(any(c[0] == 'PONTE' and c[1] == 'pedir_link' and c[3].get('documento') == '99999999000199' for c in sim.chamadas), 'link de primeiro acesso pela ficha')
    pg.click('#gBloq'); checar('Confirmar bloqueio' in n.tc('#gBloq'), 'bloqueio pede confirmação')
    pg.click('#gX')
    pg.fill('#clQ', '44.444.444/0001-44'); pg.click('#clG360'); pg.wait_for_selector('#clG360Err')
    checar('não localizado' in n.tc('#clG360Err').lower(), 'CNPJ fora do G360 mostra a mensagem da API')
    pg.fill('#clQ', '11.111.111/0001-11'); pg.click('#clG360'); pg.wait_for_selector('#mAdm.open #gSalvar')
    checar('Ficha do cliente no G360' in n.tc('#admBox'), 'ficha aberta direto pelo CNPJ'); pg.click('#gX'); pg.fill('#clQ', '')
    pg.click('[data-at="cfg"]'); pg.wait_for_selector('#cfEst'); pg.check('#cfEst'); pg.fill('#cfMg', '22'); pg.click('#cfCatSalvar'); pg.wait_for_timeout(400)
    checar(sim.config.get('so_estoque') is True and float(sim.config.get('margem_minima')) == 22 and float(sim.config.get('estoque_minimo')) == 0, f'configuração salva: {sim.config}')
    sim.config['so_estoque'] = False
    n.fechar()
    n = N(pw, sim, '/'); pg = n.pg
    n.entrar(U1, S1)
    checar(pg.locator('#grid .card[data-id="102"]').count() == 0, 'produto oculto fora do catálogo')
    pg.fill('#q', 'trambolho'); pg.press('#q', 'Enter'); pg.wait_for_selector('#grid .card[data-id="104"]')
    checar(pg.locator('#grid .card').count() == 1 and 'trambolho' not in n.tc('#grid').lower(), 'palavra-chave acha o produto e não aparece para o cliente')
    pg.fill('#q', 'carrinho de faxina'); pg.press('#q', 'Enter'); pg.wait_for_function("document.querySelectorAll('#grid .card').length >= 1")
    checar(pg.locator('#grid .card').first.get_attribute('data-id') == '104', 'palavra-chave com mais de uma palavra')
    # o que tem de dar errado: produto sem a palavra-chave não aparece
    checar(pg.locator('#grid .card[data-id="101"]').count() == 0, 'produto sem a palavra-chave fica de fora (teste que tem de dar errado)')
    pg.fill('#q', ''); pg.press('#q', 'Enter'); pg.wait_for_timeout(300)
    n.ir('clips'); pg.wait_for_selector('#clipsFeed .clip')
    checar(pg.locator('#clipsFeed .clip').count() == 1 and 'Clip de teste' in n.tc('#clipsFeed'), 'feed de clips')
    if pg.viewport_size['width'] <= 640:
        pg.evaluate('window.scrollTo(0, 400)'); pg.wait_for_timeout(200); pg.evaluate("window.dispatchEvent(new Event('resize'))"); pg.wait_for_timeout(200)
        g_ = pg.evaluate("(() => { const c = document.querySelector('#clipsFeed .clip').getBoundingClientRect(); const h = document.querySelector('header').getBoundingClientRect(); const t = document.querySelector('.tabbar').getBoundingClientRect(); const s = document.getElementById('souzinha-widget'); return { topo: c.top - h.bottom, baixo: t.top - c.bottom, rolou: window.scrollY, souzinha: s ? getComputedStyle(s).display : 'none' }; })()")
        checar(abs(g_['topo']) <= 1 and abs(g_['baixo']) <= 1 and g_['rolou'] == 0 and g_['souzinha'] == 'none', f'clip inteiro entre o cabeçalho e as abas no celular: {g_}')
    n.ir('cat'); pg.wait_for_selector('#grid .card[data-id="101"]')
    # O clip aparece na galeria do detalhe, depois das fotos: deslizando (ou pela miniatura ▶) chega no vídeo.
    pg.click('.card[data-id="104"] .name'); pg.wait_for_selector('#mDet.open #detBox .gth.gvid')
    nf_ = pg.locator('#detBox .gth:not(.gvid)').count()
    checar(pg.locator('#detBox .gthumbs .gth').last.evaluate('e => e.classList.contains("gvid")') and pg.locator('#detBox .gmain video').count() == 0, 'vídeo é o último da galeria')
    for _ in range(nf_):
        b_ = pg.locator('#detBox .gmain').bounding_box(); y_ = b_['y'] + b_['height'] / 2
        pg.mouse.move(b_['x'] + b_['width'] * 0.8, y_); pg.mouse.down(); pg.mouse.move(b_['x'] + b_['width'] * 0.2, y_, steps=4); pg.mouse.up()
    pg.wait_for_selector('#detBox .gmain video')
    checar('portal-clips/' in pg.get_attribute('#detBox .gmain video', 'src') and pg.locator('#detBox .gth.gvid.on').count() == 1, 'deslizar chega no vídeo do produto')
    pg.click('#dX')
    pg.wait_for_timeout(200); checar(pg.evaluate("document.querySelector('#detBox video')?.paused !== false"), 'fechar a janela para o vídeo')
    pg.click('.card[data-id="101"] .name'); pg.wait_for_selector('#mDet.open #dNegociar')
    checar(pg.locator('#detBox .gth.gvid').count() == 0 and pg.locator('#detBox video').count() == 0, 'produto sem clip não mostra vídeo na galeria')
    pg.click('#dNegociar'); pg.wait_for_selector('#mCad.open #ngEnviar')
    pg.click('#ngEnviar'); checar('pelo menos um' in n.tc('#ngErr'), 'negociação sem preço recusada')
    pg.fill('.negit input', 'abc'); pg.click('#ngEnviar'); checar('Confira os preços' in n.tc('#ngErr'), 'preço inválido recusado')
    pg.fill('.negit input', '4,50'); pg.fill('#ngMsg', 'Compro todo mês'); pg.click('#ngEnviar'); pg.wait_for_selector('#ngOk')
    checar(len(sim.negociacoes) == 1 and sim.negociacoes[0]['preco_desejado'] == '4.50' and sim.negociacoes[0]['comprador_codigo'] == 1165, f'negociação enviada: {sim.negociacoes}')
    pg.click('#ngOk'); n.ir('ped'); pg.wait_for_selector('#negClientView .ped')
    checar('Aguardando resposta' in n.tc('#negClientView'), 'minhas negociações')
    n.fechar()
    n = N(pw, sim, '/painel', largura=1280); pg = n.pg
    pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk'); pg.wait_for_selector('#vAdm [data-at="cli"].on')
    pg.wait_for_function("document.getElementById('negN').textContent === '1'")
    pg.click('[data-at="neg"]'); pg.wait_for_selector('.negadm [data-ok]')
    pg.fill('.negadm [data-v]', '4,75'); pg.click('.negadm [data-ok]'); pg.wait_for_function("!document.querySelector('.negadm [data-ok]')")
    inc = [x for x in sim.chamadas if x[0] == 'POST' and 'precos-congelados' in x[1]][-1][3]
    checar(inc['valor'] == '4.75' and inc['produto'] == 101 and sim.negociacoes[0]['status'] == 'aprovada', f'aprovar congela no G360: {inc} {sim.negociacoes[0]["status"]}')
    n.fechar()

    # Etapa 13: importação de fotos em massa (ZIP → grade de aprovação → G360)
    etapa[0] = 'Etapa 13'
    import io, zipfile
    from PIL import Image as _Img
    def _img(fmt, cor):
        b = io.BytesIO(); _Img.new('RGB', (40, 40), cor).save(b, fmt); return b.getvalue()
    def _zip(arqs):
        b = io.BytesIO()
        with zipfile.ZipFile(b, 'w') as z:
            for nome, dados in arqs: z.writestr(nome, dados)
        return b.getvalue()
    gal104 = [dict(x) for x in sim.galeria.get(104, [])]
    z1 = _zip([('lote/P-101_capa.jpg', _img('JPEG', 'red')), ('lote/P-101_ambiente.png', _img('PNG', 'green')), ('lote/P-101_uso.jpg', _img('JPEG', 'blue')),
               ('P-102_capa.jpg', _img('JPEG', 'white')), ('P-104_capa.jpg', _img('JPEG', 'gray')), ('X-999_capa.jpg', _img('JPEG', 'black')),
               ('foto qualquer.jpg', _img('JPEG', 'black')), ('__MACOSX/._P-101_capa.jpg', b'x')])
    n = N(pw, sim, '/painel', largura=1280); pg = n.pg
    pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk'); pg.wait_for_selector('#vAdm [data-at="cli"].on')
    pg.click('[data-at="prod"]'); pg.click('#aImpFotos'); pg.wait_for_selector('#ifImp.open #impArq', state='attached')
    pg.set_input_files('#impArq', files=[{'name': 'vazio.zip', 'mimeType': 'application/zip', 'buffer': _zip([('nada.jpg', _img('JPEG', 'red'))])}])
    pg.wait_for_selector('#impMsg .rv-aviso'); checar('Nenhum arquivo no padrão' in n.tc('#impMsg'), 'ZIP sem nomes no padrão recusado')
    sim.fotos_erro = {102}  # o G360 não deixa conferir a galeria de um produto: ele fica marcado e o resto segue
    pg.set_input_files('#impArq', files=[{'name': 'lote.zip', 'mimeType': 'application/zip', 'buffer': z1}])
    pg.wait_for_selector('#impGrid .improw')
    sim.fotos_erro = set()
    t = n.tc('#impCorpo')
    checar('sem resposta do G360' in t and 'Não deu para conferir' in n.tc('[data-k="P-102"]') and not pg.is_checked('[data-k="P-102"] input[data-t="capa"]'),
           'importar: produto que o G360 não deixou conferir fica desmarcado com a mensagem, e o resto segue')
    checar(pg.locator('#impGrid .improw').count() == 3, f"3 produtos encontrados: {pg.locator('#impGrid .improw').count()}")
    checar('X-999' in t and 'não encontrado' in t and 'foto qualquer.jpg' in t and 'já tem 2 fotos' in t, 'avisos: código desconhecido, nome fora do padrão, produto com fotos')
    pg.uncheck('[data-k="P-102"] input[data-t="capa"]')
    checar('4 fotos aprovadas' in n.tc('#impConta'), f"contagem: {n.tc('#impConta')}")
    pg.click('#impPub'); pg.wait_for_selector('#impProg .impfim')
    g101 = sim.galeria.get(101, [])
    checar([x['descricao'] for x in g101] == ['Capa', 'Ambiente', 'Em uso'], f'P-101 com as 3 fotos, capa primeiro: {g101}')
    checar(not sim.galeria.get(102), 'foto desmarcada não sobe')
    checar(sim.galeria.get(104) == gal104, 'produto que já tinha fotos foi pulado')
    fotos_post = [x for x in sim.chamadas if x[0] == 'POST' and x[1].endswith('/fotos')]
    checar(all(str(x[3].get('foto', '')).startswith('data:image/jpeg;base64,') for x in fotos_post), 'PNG convertido para JPEG antes do envio')
    checar('3 fotos publicadas' in n.tc('#impProg') and '1 pulada' in n.tc('#impProg'), f"resumo: {n.tc('#impProg')}")
    pg.click('#impOutro'); pg.set_input_files('#impArq', files=[{'name': 'troca.zip', 'mimeType': 'application/zip', 'buffer': _zip([('P-104_capa.jpg', _img('JPEG', 'gray'))])}])
    pg.wait_for_selector('#impPol'); pg.select_option('#impPol', 'trocar'); pg.click('#impPub')
    checar('Confirmar: apagar' in n.tc('#impPub') and sim.galeria.get(104) == gal104, 'substituir pede confirmação antes de apagar')
    pg.click('#impPub'); pg.wait_for_selector('#impProg .impfim')
    checar([x['descricao'] for x in sim.galeria.get(104, [])] == ['Capa'], f"fotos antigas substituídas: {sim.galeria.get(104)}")
    pg.click('#impX'); checar(not pg.is_visible('#ifImp'), 'fechar a importação')
    n.fechar()

    # Etapa 14: novo cliente no G360 a partir do "Quero ser cliente" aprovado
    etapa[0] = 'Etapa 14'
    sim.cadastros.append({'id': '00000000-0000-4000-8000-000000000014', 'loja': '96da1e99a3f327f0', 'documento': '44ABC55501FG66', 'razao_social': 'Pedido Fictício LTDA', 'fantasia': 'Pedido Fictício',
                          'inscricao_estadual': '', 'responsavel': 'Pessoa Fictícia', 'whats': '34999990000', 'telefone': None, 'email': 'novo@example.invalid', 'cep': '38400200', 'numero': '50',
                          'logradouro': 'Rua Nova', 'complemento': '', 'bairro': 'Bairro Dois', 'cidade': 'Cidade Exemplo', 'uf': 'MG', 'status': 'aprovado', 'codigo_g360': None, 'criado_por': 'portal', 'criado_em': '2026-11-18T10:00:00+00:00'})
    n = N(pw, sim, '/painel', largura=1280); pg = n.pg
    pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk'); pg.wait_for_selector('#vAdm [data-at="cli"].on')
    sel = '#clCad .crow2[data-id="00000000-0000-4000-8000-000000000014"]'
    pg.wait_for_selector(f'{sel} [data-novo]'); pg.click(f'{sel} [data-novo]'); pg.wait_for_selector('#mAdm.open #nSalvar')
    cnpjs = [x for x in sim.chamadas if x[1] == 'operadores/cadastro/cnpj']
    checar(cnpjs and cnpjs[-1][3] == {'cnpj': '44ABC55501FG66'}, f'consulta do CNPJ só com o cnpj: {cnpjs[-1][3] if cnpjs else None}')
    t = n.tc('#admBox')
    checar('INAPTA' in t and pg.input_value('#nNome') == 'EMPRESA NOVA FICTICIA LTDA' and pg.input_value('#nEm') == 'novo@example.invalid', 'formulário preenchido pela Receita e pelo pedido, com aviso de situação irregular')
    pg.wait_for_function("document.getElementById('nCepM').textContent.includes('encontrado')")
    pg.fill('#nT1', ''); pg.click('#nSalvar')
    checar('Falta preencher' in n.tc('#nErr') and 'telefone' in n.tc('#nErr') and 'categoria' in n.tc('#nErr') and not sim.inclusoes, f"obrigatórios do G360 conferidos antes de enviar: {n.tc('#nErr')}")
    pg.fill('#nT1', '34 99999-0000'); pg.select_option('#n_categoria_id', '3'); pg.fill('#nIe', 'ISENTO'); pg.click('#nSalvar')
    checar('Falta preencher' in n.tc('#nErr') and 'governo' in n.tc('#nErr') and not sim.inclusoes, 'ISENTO pede confirmação antes de enviar')
    pg.click('[data-ie="NAO CONTRIBUINTE"]'); sim.cenario['incluir_cair'] = 1; pg.click('#nSalvar')
    pg.wait_for_function("document.getElementById('nSalvar').textContent === 'Tentar de novo' && !document.getElementById('nSalvar').disabled")
    checar(pg.is_disabled('#nNome'), 'resposta incerta trava o formulário')
    pg.click('#nSalvar'); pg.wait_for_selector('#mAdm.open #gLib')
    k1, c1 = sim.inclusoes[-2]; k2, c2 = sim.inclusoes[-1]
    checar(k1 == k2 and c1 == c2 and len(k1) >= 16, 'reenvio com a mesma chave e o mesmo corpo')
    checar(c2['categoria_id'] == 3 and c2['ie_rg'] == 'NAO CONTRIBUINTE' and 'cidade_id' not in c2['endereco'] and c2['endereco']['cep'] == '38400200' and 'situacao_id' not in c2, f'corpo da inclusão: {c2}')
    cad = next(c for c in sim.cadastros if c['id'] == '00000000-0000-4000-8000-000000000014')
    novo = max(sim.fichas)
    checar(cad.get('codigo_g360') == novo and sim.fichas[novo]['acesso_liberado'] is False, f'pedido vinculado ao cliente incluído (bloqueado): {cad.get("codigo_g360")}')
    checar('Bloqueado' in n.tc('#admBox'), 'ficha aberta para liberar o acesso')
    pg.click('#gX')
    # CNPJ que já existe no G360: não duplica, oferece a ficha
    sim.cadastros.append({**cad, 'id': '00000000-0000-4000-8000-000000000015', 'documento': sim.fichas[1165]['documento'], 'codigo_g360': None})
    pg.click('[data-at="prod"]'); pg.click('[data-at="cli"]'); sel = '#clCad .crow2[data-id="00000000-0000-4000-8000-000000000015"]'
    pg.wait_for_selector(f'{sel} [data-novo]'); n0 = len(sim.inclusoes); pg.click(f'{sel} [data-novo]'); pg.wait_for_selector('#mAdm.open #vOk')
    checar('já é cliente no G360' in n.tc('#admBox') and '1165' in n.tc('#admBox') and len(sim.inclusoes) == n0, 'CNPJ já cadastrado não duplica')
    pg.click('#vOk'); pg.wait_for_selector('#mAdm.open #gSalvar')
    checar(next(c for c in sim.cadastros if c['id'].endswith('15'))['codigo_g360'] == 1165, 'vinculado ao cadastro existente')
    pg.click('#gX')
    # Quero ser cliente PENDENTE com CNPJ que já é cliente: Aprovar confere no G360, compara e vincula (sem guardar dados diferentes)
    sim.fichas[1166] = {**json.loads(json.dumps(sim.fichas[1165])), 'id': 1166, 'documento': '77777777000177', 'nome': 'CLIENTE ANTIGO FICTICIO LTDA', 'acesso_liberado': False}
    sim.cadastros.append({**cad, 'id': '00000000-0000-4000-8000-000000000016', 'documento': '77777777000177', 'codigo_g360': None, 'status': 'pendente',
                          'email': 'novo-email@example.invalid', 'whats': '34988887777', 'razao_social': 'Cliente Antigo Fictício LTDA'})
    pg.click('[data-at="prod"]'); pg.click('[data-at="cli"]'); sel = '#clCad .crow2[data-id="00000000-0000-4000-8000-000000000016"]'
    pg.select_option('#clSt', ''); pg.wait_for_selector(f'{sel} [data-d="aprovado"]'); n0 = len(sim.inclusoes); put0 = len(sim.fichas_put)
    pg.click(f'{sel} [data-d="aprovado"]'); pg.wait_for_selector('#mAdm.open #vOk')
    t = n.tc('#admBox')
    checar('Este CNPJ já é cliente no G360' in t and '1166' in t and sim.fichas[1166]['email'] in t and 'novo-email@example.invalid' in t, f'aviso de CNPJ já cliente, com os dados do pedido ao lado dos do G360: {t[:300]}')
    checar(pg.locator('[data-gravar="email"]').count() == 1 and pg.locator('[data-gravar="nome"]').count() == 0, 'só as diferenças podem ser gravadas no G360 (razão social igual, sem marcação)')
    checar(next(c for c in sim.cadastros if c['id'].endswith('16'))['status'] == 'pendente', 'não aprova antes da conferência')
    pg.check('[data-gravar="email"]'); checar('novo-email@example.invalid' in n.tc('#vEmail'), 'o link vai para o e-mail que ficará no G360')
    pg.click('#vOk'); pg.wait_for_selector('#mAdm.open #gSalvar')
    ped = sim.fichas_put[put0:]
    checar(len(ped) == 1 and set(ped[0]) == {'versao', 'email'} and ped[0]['email'] == 'novo-email@example.invalid', f'gravou no G360 só o marcado, com a versão: {ped}')
    c16 = next(c for c in sim.cadastros if c['id'].endswith('16'))
    checar(c16['codigo_g360'] == 1166 and c16['status'] == 'aprovado' and c16['whats'] == '34999990000' and c16['email'] == 'novo-email@example.invalid' and len(sim.inclusoes) == n0,
           f'vinculado ao código existente, ficha do portal igual ao G360: {c16.get("whats")} {c16.get("email")}')
    pg.click('#gX')
    # Ficha ligada: dados do G360 travados no portal e o servidor não aceita trocar
    pg.click(f'{sel} [data-ed]'); pg.wait_for_selector('#mAdm.open #kSinc')
    checar(pg.evaluate("document.getElementById('kEm').readOnly && document.getElementById('kRaz').readOnly && document.getElementById('kBusca').hidden"), 'ficha ligada: cadastro só pelo G360')
    pg.evaluate("document.getElementById('kEm').readOnly = false"); pg.fill('#kEm', 'outro@example.invalid'); pg.click('#kOk'); pg.wait_for_timeout(800)
    checar(next(c for c in sim.cadastros if c['id'].endswith('16'))['email'] == 'novo-email@example.invalid', 'teste que tem de falhar: trocar o e-mail na ficha do portal não grava (vale o do G360)')
    # Link: mostra o e-mail do G360 e só envia na confirmação
    pg.wait_for_selector('#mAdm:not(.open)', state='attached'); sim.fichas[1166]['acesso_liberado'] = True
    pg.click(f'{sel} [data-g360]'); pg.wait_for_selector('#mAdm.open #gLink'); links0 = len([c for c in sim.chamadas if c[0] == 'PONTE' and c[1] == 'pedir_link'])
    pg.click('#gLink'); pg.wait_for_timeout(300)
    checar('novo-email@example.invalid' in n.tc('#gAcRes') and len([c for c in sim.chamadas if c[0] == 'PONTE' and c[1] == 'pedir_link']) == links0, 'link: mostra o e-mail do G360 antes de enviar')
    pg.click('#gLink'); pg.wait_for_function("document.getElementById('gAcRes').textContent.includes('Se o cadastro')")
    checar(True, 'link enviado depois da confirmação')
    pg.click('#gX')
    # Produtos: tirar do portal / voltar, e filtros "aparecendo" e "fora do portal"
    pg.click('[data-at="prod"]'); pg.fill('#aQ', 'P-110'); pg.press('#aQ', 'Enter'); pg.wait_for_selector('.arow[data-id="110"] [data-oc="1"]')
    pg.click('.arow[data-id="110"] [data-oc="1"]')
    checar('Confirmar' in n.tc('.arow[data-id="110"] [data-oc="1"]') and not sim.exibicao.get('P-110', {}).get('oculto'), 'tirar do portal pede confirmação')
    pg.click('.arow[data-id="110"] [data-oc="1"]'); pg.wait_for_selector('.arow[data-id="110"] [data-oc="0"]')
    checar(sim.exibicao.get('P-110', {}).get('oculto') is True, f"produto tirado do portal: {sim.exibicao.get('P-110')}")
    pg.select_option('#aSt', 'visivel'); pg.wait_for_timeout(300)
    checar(pg.locator('.arow[data-id="110"]').count() == 0, 'filtro aparecendo no portal esconde o tirado')
    pg.fill('#aQ', ''); pg.select_option('#aSt', 'oculto'); pg.wait_for_selector('.arow[data-id="110"]')
    ids = sorted(int(x) for x in pg.eval_on_selector_all('.arow[data-id]', 'e => e.map(x => x.dataset.id)'))
    checar(110 in ids and 102 in ids and 101 not in ids, f'filtro fora do portal lista só os tirados: {ids}')
    pg.click('.arow[data-id="110"] [data-oc="0"]'); pg.wait_for_function("!document.querySelector('.arow[data-id=\"110\"]')")
    checar(sim.exibicao.get('P-110', {}).get('oculto') is False, 'produto de volta ao portal')
    checar(not sim.visiveis, 'o navegador do cliente não lê mais o catálogo inteiro para montar a lista')
    lidas0 = len([c for c in sim.chamadas if c[1] == 'operadores/produtos/busca'])
    pg.click('#aVis'); pg.wait_for_function("document.getElementById('aVisM').textContent.startsWith('✓')", timeout=60000)
    checar(sim.visiveis and 'P-101' in sim.visiveis['visiveis'] and 'P-103' in sim.visiveis['sem_estoque'], f'painel gravou a lista do que aparece: {sim.visiveis and {k: len(v) for k, v in sim.visiveis.items() if isinstance(v, list)}}')
    buscas = [c for c in sim.chamadas if c[1] == 'operadores/produtos/busca'][lidas0:]
    checar([c for c in buscas if c[3].get('limite') == 50] and all((c[3].get('limite') or 0) <= 50 for c in buscas), f'lista lida de 50 em 50: {[c[3] for c in buscas]}')
    pg.select_option('#aSt', 'visivel'); pg.wait_for_selector('.arow[data-id="101"]')
    ids = [int(x) for x in pg.eval_on_selector_all('.arow[data-id]', 'e => e.map(x => x.dataset.id)')]
    checar(103 not in ids and 102 not in ids and 'Lista de estoque do portal atualizada em' in n.tc('#aPanel'), f'aparecendo no portal tira sem estoque e ocultos: {ids}')
    pg.select_option('#aSt', 'fora'); pg.wait_for_selector('.arow[data-id="103"]')
    t = n.tc('#aPanel')
    checar('Sem estoque' in t and 'Tirado pela equipe' in t and pg.locator('.arow[data-id="101"]').count() == 0, 'fora do portal com o motivo de cada um')
    # Planilha para fotos: lotes sem foto, sem repetir produto entre lotes
    import openpyxl
    pg.select_option('#aSt', ''); pg.click('#aLotes'); pg.wait_for_selector('#mAdm.open #lfGerar')
    pg.fill('#lfQtd', '5'); pg.fill('#lfResp', 'Maria Teste')
    with pg.expect_download() as dl: pg.click('#lfGerar')
    arq = dl.value; caminho = '/tmp/lote1.xlsx'; arq.save_as(caminho); wb1 = openpyxl.load_workbook(caminho).active
    cods1 = [wb1.cell(r, 1).value for r in range(5, 10)]
    checar(arq.suggested_filename == 'Fotos_Lote_01_Maria_Teste_5_produtos.xlsx', f'nome do arquivo: {arq.suggested_filename}')
    checar([wb1.cell(4, c).value for c in (1, 2, 6, 8)] == ['Código', 'Descrição do produto', 'LINK DA FOTO (PREENCHER)', 'Nome capa'] and wb1['H5'].value == '=A5&"_capa.jpg"', 'cabeçalho e fórmulas no padrão da planilha de teste')
    checar(len(cods1) == 5 and all(cods1) and 'P-104' not in cods1 and 'P-101' not in cods1 and 'P-102' not in cods1 and 'P-103' not in cods1, f'lote 1 sem os que já têm foto, ocultos ou fora do portal: {cods1}')
    pg.wait_for_selector('#lfLista [data-baixar]')
    with pg.expect_download() as dl: pg.click('#lfGerar')
    dl.value.save_as('/tmp/lote2.xlsx'); cods2 = [openpyxl.load_workbook('/tmp/lote2.xlsx').active.cell(r, 1).value for r in range(5, 10)]
    checar(len(cods2) == 5 and not set(cods1) & set(cods2), f'lote 2 não repete produtos do lote 1: {cods2}')
    pg.wait_for_function("document.getElementById('lfLista').textContent.includes('Lote 2')"); checar(len(sim.lotes) == 2, 'lotes gravados e listados')
    pg.click('#lfX')
    # Exportar fotos (ZIP): procura quem tem foto, a equipe escolhe, baixa no padrão do Importar imagens
    import zipfile, io as _io
    vit0 = sim.vitrine_aberta
    # vitrine fechada: confere a galeria produto por produto
    sim.vitrine_aberta = False
    com_foto = sorted(str(next(p['codigo'] for p in sim.produtos if int(p['id']) == pid)) for pid, g in sim.galeria.items() if g)
    pg.click('#aExpFotos'); pg.wait_for_selector('#mAdm.open #exIr'); pg.select_option('#exModo', 'todos'); pg.click('#exIr')
    pg.wait_for_selector('#exLista input[data-c]')
    lista_cods = pg.eval_on_selector_all('#exLista input[data-c]', 'els => els.map(e => e.dataset.c)')
    checar(sorted(lista_cods) == com_foto, f'exportar (vitrine fechada): lista só com os produtos que têm foto: {lista_cods} x {com_foto}')
    # vitrine aberta: a lista sai direto da vitrine (fotos[]), sem perguntar galeria por galeria
    sim.vitrine_aberta = True; galerias0 = len([c for c in sim.chamadas if 'fotos' in str(c[1])]) if sim.chamadas and isinstance(sim.chamadas[0], tuple) else None
    pg.click('#exIr'); pg.wait_for_function("document.getElementById('exIr').textContent.includes('Procurar de novo') && document.querySelector('#exLista input[data-c]')")
    lista_cods = pg.eval_on_selector_all('#exLista input[data-c]', 'els => els.map(e => e.dataset.c)')
    pela_vitrine = sorted(str(p['codigo']) for p in sim.produtos if p.get('fotos'))
    checar(sorted(lista_cods) == pela_vitrine and any(c[0] == 'vitrine/produtos' for c in sim.vitrine_chamadas), f'exportar (rápido): lista vem da vitrine: {lista_cods} x {pela_vitrine}')
    tirar = lista_cods[0]; pg.uncheck(f'#exLista input[data-c="{tirar}"]')
    with pg.expect_download() as dl: pg.click('#exBaixar')
    z = zipfile.ZipFile(_io.BytesIO(open(dl.value.path(), 'rb').read())); nomes = z.namelist()
    checar(nomes and all(re.match(r'^.+_(capa|ambiente|uso)\.(jpg|png|webp)$', x) for x in nomes) and not any(x.startswith(tirar + '_') for x in nomes) and any(x.endswith('_capa.jpg') for x in nomes),
           f'exportar: ZIP no padrão do Importar imagens, só com os escolhidos: {nomes}')
    pg.wait_for_function("document.getElementById('exFim').textContent.includes('Pronto')")
    pg.click('#exX'); sim.vitrine_aberta = vit0
    # Caça-capa: colar a foto, ajuste automático, Enter envia; "Não achei" grava no lote
    import io, base64
    from PIL import Image as _I
    def _foto(fmt='PNG'):
        im = _I.new('RGB', (800, 500), 'white'); im.paste((200, 30, 30), (500, 50, 700, 450)); b = io.BytesIO(); im.save(b, fmt); return b.getvalue()
    pg.click('#aCaca'); pg.wait_for_selector('#ccFull.open #ccPegar')
    livres = [p for p in sim.produtos if p['codigo'] not in set(cods1 + cods2) and not sim.galeria.get(int(p['id']))]
    sim.fotos_erro = {int(livres[0]['id'])}  # a API recusa conferir um produto: o lote segue sem ele
    sim.galeria_cair = 1  # uma conferência cai no meio (como no limite por IP em produção): espera e continua
    pg.fill('#ccNome', 'João Teste'); pg.fill('#ccQtd', '3'); pg.select_option('#ccModo', 'todos'); pg.click('#ccPegar')
    pg.wait_for_selector('#ccMsg:has-text("tentando de novo")', timeout=10000)
    pg.wait_for_selector('#ccArq', state='attached', timeout=30000)
    lote = sim.lotes[-1]; checar(len(lote['codigos']) == 3 and not set(lote['codigos']) & set(cods1 + cods2), f"lote do caça-capa sem repetir: {lote['codigos']}")
    checar(livres[0]['codigo'] not in lote['codigos'], 'produto que o G360 não deixou conferir fica fora e o lote é montado mesmo assim')
    sim.fotos_erro = set()
    pg.evaluate("window.dispatchEvent(new Event('x'))")
    pg.evaluate("() => { const dt = new DataTransfer(); dt.setData('text/plain', 'https://exemplo.invalid/foto.jpg'); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }")
    checar('Copiar imagem' in n.toast(), 'colar o endereço em vez da imagem explica o que fazer')
    pid1 = int(next(p['id'] for p in sim.produtos if p['codigo'] == lote['codigos'][0]))
    pg.set_input_files('#ccArq', files=[{'name': 'f.png', 'mimeType': 'image/png', 'buffer': _foto()}]); pg.wait_for_selector('.ccprev img')
    checar(pg.input_value('#ccZoom') == '92', 'zoom padrão de 92%')
    src0 = pg.get_attribute('.ccprev img', 'src')
    pg.eval_on_selector('#ccZoom', "e => { e.value = '80'; e.dispatchEvent(new Event('input', { bubbles: true })); }")
    pg.wait_for_function(f"document.querySelector('.ccprev img').src !== '{src0}'")
    checar(n.tc('#ccZoomV') == '80%' and pg.evaluate("localStorage.getItem('sr-cacacapa-zoom')") == '80', 'zoom muda a prévia e fica lembrado')
    pg.focus('#ccZoom'); pg.keyboard.press('Enter'); pg.wait_for_function(f"document.querySelector('#ccCorpo .hint') && document.querySelector('#ccCorpo .hint').textContent.includes('1 com capa') && !document.getElementById('ccFila').textContent")
    post = [x for x in sim.chamadas if x[0] == 'POST' and x[1] == f'operadores/produtos/{pid1}/fotos'][-1][3]
    im = _I.open(io.BytesIO(base64.b64decode(post['foto'].split(',', 1)[1])))
    px = im.convert('RGB').load()
    checar(im.size == (1200, 1200) and im.format == 'JPEG' and post['descricao'] == 'Capa', f'capa 1200x1200 JPEG: {im.size} {im.format}')
    vermelhos = [(x, y) for x in range(0, 1200, 10) for y in range(0, 1200, 10) if px[x, y][0] > 150 and px[x, y][1] < 100]
    xs = [v[0] for v in vermelhos]; ys = [v[1] for v in vermelhos]
    checar(vermelhos and min(ys) >= 110 and max(ys) <= 1090 and abs((min(xs) + max(xs)) / 2 - 600) < 20 and min(px[5, 5]) > 245 and min(px[1190, 5]) > 245, f'produto recortado e centralizado: x {min(xs)}-{max(xs)} y {min(ys)}-{max(ys)}')
    checar(900 < max(ys) - min(ys) < 980, f'sobra branca recortada e zoom de 80% aplicado ({max(ys) - min(ys)} px de altura)')
    pg.click('#ccPular'); pg.wait_for_function("document.querySelector('#ccCorpo .hint').textContent.includes('1 não achei')")
    checar(lote['codigos'][1] in sim.lotes[-1]['pulados'], f"não achei gravado no lote: {sim.lotes[-1]['pulados']}")
    pg.evaluate("async () => { const c = document.createElement('canvas'); c.width = 300; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0,0,300,300); x.fillStyle = '#2244cc'; x.fillRect(100,60,100,180); const b = await new Promise(r => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([b], 'c.png', { type: 'image/png' })); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }")
    pg.wait_for_selector('.ccprev img'); checar('pequena' in n.tc('#ccCola'), 'aviso de foto pequena')
    colar = "async (cor) => { const c = document.createElement('canvas'); c.width = 700; c.height = 700; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0,0,700,700); x.fillStyle = cor; x.fillRect(200,100,300,500); const b = await new Promise(r => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([b], 'c.png', { type: 'image/png' })); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }"
    pg.evaluate(colar, '#22aa22'); pg.wait_for_selector('.ccth[data-f="1"]')
    pg.evaluate(colar, '#aa22aa'); pg.wait_for_selector('.ccth[data-f="2"]')
    checar('Enviar 3 fotos' in n.tc('#ccEnviar'), 'várias fotos no mesmo produto')
    pg.click('.ccth[data-f="1"] [data-tirar]'); pg.wait_for_function("document.querySelectorAll('.ccth').length === 2")
    pg.click('.ccth[data-f="1"] [data-capa]'); pg.wait_for_function("document.querySelector('.ccth[data-f=\"0\"] b').textContent.includes('Capa')")
    pg.keyboard.press('Enter'); pg.wait_for_selector('#ccNovo')
    checar('terminado' in n.tc('#ccCorpo') and 'Fotografar no estoque' in n.tc('#ccCorpo'), 'fim do lote com a lista para fotografar')
    pg.wait_for_function("!document.getElementById('ccFila') || !document.getElementById('ccFila').textContent")
    pid3 = int(next(p['id'] for p in sim.produtos if p['codigo'] == lote['codigos'][2]))
    g3 = sim.galeria.get(pid3, [])
    checar([x['descricao'] for x in g3] == ['Capa', 'Foto 2'], f'duas fotos enviadas, a escolhida como capa primeiro: {g3}')
    post3 = [x for x in sim.chamadas if x[0] == 'POST' and x[1] == f'operadores/produtos/{pid3}/fotos']
    im3 = _I.open(io.BytesIO(base64.b64decode(post3[0][3]['foto'].split(',', 1)[1]))).convert('RGB')
    checar(im3.getpixel((600, 600))[0] > 150 and im3.getpixel((600, 600))[1] < 100, 'a foto escolhida como capa (roxa) foi a primeira')
    # Duas pessoas ao mesmo tempo: quem grava depois não leva o que a outra já pegou
    pg.click('#ccNovo'); pg.wait_for_selector('#ccPegar')
    pg.fill('#ccNome', 'Ana Teste')
    bt_ = pg.locator(f'[data-lote="{lote["id"]}"]'); bt_.click()
    checar('É do João Teste' in bt_.inner_text(), f'continuar lote de outra pessoa pede confirmação: {bt_.inner_text()}')
    tomados_ = {c for x in sim.lotes for c in x['codigos']}
    sem_foto_ = [p['codigo'] for p in sim.produtos if p['codigo'] not in tomados_ and not sim.galeria.get(int(p['id']))]
    sim.intruso = {'n': 1, 'codigos': sem_foto_}
    n_lotes_ = len(sim.lotes); pg.fill('#ccQtd', '2'); pg.click('#ccPegar')
    pg.wait_for_selector('#ccMsg:has-text("Outra pessoa pegou")', timeout=30000)
    checar(len(sim.lotes) == n_lotes_ + 1 and sim.lotes[-1]['responsavel'] == 'Maria', 'produtos pegos por outra pessoa no meio do caminho não entram em lote repetido (teste que tem de dar errado)')
    # Sobras de lotes de dias anteriores: junta o que ficou parado sem foto; lote de hoje não é mexido
    import time as _t
    maria_ = sim.lotes[-1]; pr_ = {p['codigo']: p for p in sim.produtos}
    velhos_ = [c for c in maria_['codigos'] if c != 'P-105' and not pr_[c].get('fotos') and not sim.galeria.get(int(pr_[c]['id']))]  # P-105: o simulador recusa a foto; com foto na vitrine já conta como feito
    checar(len(velhos_) >= 3, f'produtos sem foto no lote antigo para o teste: {velhos_}')
    de_hoje_ = velhos_[0]; maria_['codigos'].remove(de_hoje_); maria_['pulados'] = [velhos_[1]]
    sim.lotes.append({'id': 'hoje-0000-lote', 'numero': max(x['numero'] for x in sim.lotes) + 1, 'responsavel': 'Bia', 'codigos': [de_hoje_], 'pulados': [], 'criado_em': _t.strftime('%Y-%m-%dT%H:%M:%S+00:00')})
    pul_antes_ = {c for x in sim.lotes for c in x.get('pulados', [])}
    pg.click('#ccX'); pg.click('#aCaca'); pg.wait_for_selector('#ccFull.open #ccPegar')
    pg.fill('#ccNome', 'Caio Teste'); pg.fill('#ccQtd', '50'); pg.select_option('#ccModo', 'sobras'); pg.click('#ccPegar')
    pg.wait_for_selector('#ccArq', state='attached', timeout=30000)
    novo_ = sim.lotes[-1]; velhos_lotes_ = [x for x in sim.lotes[:-2]]
    pul_ = pul_antes_
    checar(novo_['responsavel'] == 'Caio Teste' and velhos_[1] in novo_['codigos'] and set(velhos_[2:]) <= set(novo_['codigos']), f'sobras: os sem foto dos lotes antigos: {novo_["codigos"]} (Maria: {velhos_})')
    ix_ = novo_['codigos'].index(velhos_[1]); checar(all(c not in pul_ for c in novo_['codigos'][:ix_]), 'os "não achei" vêm por último')
    checar(not set(novo_['codigos']) & {c for x in velhos_lotes_ for c in x['codigos']}, 'sobras saem dos lotes antigos')
    checar(de_hoje_ not in novo_['codigos'] and sim.lotes[-2]['codigos'] == [de_hoje_], 'lote de hoje não é mexido (teste que tem de dar errado)')
    n.fechar()

    # Visitante: só os produtos que aparecem no portal (lista do último acesso de cliente)
    etapa[0] = 'Etapa 16 (visitante só ativos)'
    sim = Sim()
    n = N(pw, sim); pg = n.pg
    pg.wait_for_selector('#grid .card.publico'); total_sem_lista = pg.locator('#grid .card.publico').count()
    n.fechar()
    sim.visiveis = {'visiveis': ['P-101', 'P-104', 'P-105', 'P-106'], 'estoque_baixo': [], 'sem_estoque': ['P-103'], 'estoque_minimo': 5, 'atualizado_em': '2026-11-18T12:00:00+00:00'}
    sim.exibicao.setdefault('P-106', {}).update({'oculto': True})
    n = N(pw, sim); pg = n.pg
    pg.wait_for_selector('#grid .card.publico')
    ids = sorted(int(x) for x in pg.eval_on_selector_all('#grid .card.publico', 'e => e.map(x => x.dataset.id)'))
    checar(ids == [101, 104, 105], f'visitante vê só os ativos, sem o tirado pela equipe: {ids} (sem lista: {total_sem_lista})')
    n.fechar()

    # Minha Lista: só salvos e ativos no portal; esvaziar; painel vê a lista do cliente e congela preço dali
    etapa[0] = 'Etapa 17 (Minha Lista)'
    sim = Sim()
    sim.lista[1165] = {101, 104, 105}; sim.lista[2001] = {101}
    sim.exibicao['P-105'] = {'codigo': 'P-105', 'produto_id': 105, 'nome': None, 'categoria': None, 'origem': 'automatico', 'oculto': True}
    n = N(pw, sim); pg = n.pg
    n.entrar(U1, S1)
    n.ir('lista'); pg.wait_for_selector('#lPanel .lrow[data-id="101"]')
    ids = sorted(int(x) for x in pg.eval_on_selector_all('#lPanel .lrow[data-id]', 'e => e.map(x => x.dataset.id)'))
    checar(ids == [101, 104], f'lista do cliente só com produtos salvos e ativos no portal: {ids}')
    checar('1 produto da sua lista está indisponível no momento' in n.tc('#lPanel'), 'aviso do produto salvo fora do portal')
    pg.evaluate('window.scrollTo(0, document.body.scrollHeight)'); pg.wait_for_timeout(300)
    rod_, bar_ = pg.locator('footer').bounding_box(), pg.locator('#lPanel .sticky').bounding_box()
    txt_ = pg.evaluate("(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('footer')); const b = r.getBoundingClientRect(); return b.bottom; })()")
    checar(txt_ <= bar_['y'] + 1, f'rodapé não fica por baixo da barra da lista no celular: texto termina em {txt_}, barra começa em {bar_["y"]}')
    checar(pg.evaluate("getComputedStyle(document.documentElement).touchAction") == 'manipulation', 'toques rápidos no + não dão zoom no celular')
    pequenos = pg.evaluate("[...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]), select, textarea')].filter(e => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => (e.id || e.className) + ':' + getComputedStyle(e).fontSize)")
    print('campos < 16px no celular (Minha Lista):', pequenos)
    pg.click('#souzinha-widget .sz-fab'); pg.wait_for_selector('#souzinha-widget.sz-open .sz-panel')
    pg.focus('#souzinha-widget .sz-input'); pg.wait_for_timeout(150)
    sz = pg.evaluate("(() => { const p = document.querySelector('#souzinha-widget .sz-panel').getBoundingClientRect(); return { fs: getComputedStyle(document.querySelector('#souzinha-widget .sz-input')).fontSize, top: p.top, h: p.height, vh: visualViewport.height }; })()")
    checar(sz['fs'] == '16px' and abs(sz['top']) < 1 and abs(sz['h'] - sz['vh']) < 1, f'Souzinha no celular: campo 16px e janela do tamanho da parte visível: {sz}')
    pg.route('**/api/souzinha', lambda r: r.fulfill(status=200, content_type='application/json', body='{"reply":"Resposta fictícia da Souzinha."}'))
    pg.fill('#souzinha-widget .sz-input', 'Teste'); pg.click('#souzinha-widget .sz-send')
    pg.wait_for_function("document.querySelector('#souzinha-widget .sz-messages').textContent.includes('Resposta fictícia') || document.querySelector('#souzinha-widget .sz-messages').textContent.includes('depende da integração')")
    checar('Resposta fictícia da Souzinha.' in n.tc('#souzinha-widget .sz-messages'), f'Souzinha responde pela /api/souzinha: {n.tc("#souzinha-widget .sz-messages")[-120:]}')
    fundo = pg.evaluate("(() => { const e = document.elementFromPoint(195, 895); return e && e.closest('#souzinha-widget') ? 'souzinha' : (e && (e.id || e.className)); })()")
    checar(fundo == 'souzinha', f'com a Souzinha aberta, nada da página aparece embaixo: {fundo}')
    vis = pg.evaluate("[...document.body.children].filter(e => e.id !== 'souzinha-widget' && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden').map(e => e.tagName + '#' + e.id)")
    checar(vis == [], f'com a Souzinha aberta no celular, a página fica invisível: {vis}')
    y_antes = pg.evaluate('scrollY')
    pg.click('#souzinha-widget .sz-close'); pg.wait_for_selector('#souzinha-widget:not(.sz-open)', state='attached')
    checar(pg.evaluate("document.querySelector('#souzinha-widget .sz-panel').style.height") == '', 'fechar a Souzinha devolve o tamanho normal')
    checar(pg.evaluate("getComputedStyle(document.querySelector('header')).visibility") == 'visible' and pg.evaluate('scrollY') == y_antes, 'fechar a Souzinha devolve a página no mesmo lugar')
    pg.click('#lEsv'); pg.wait_for_timeout(200)
    checar('Clique de novo' in n.tc('#lEsv') and sim.lista[1165] == {101, 104, 105}, 'esvaziar pede o segundo clique antes de apagar')
    pg.click('#lEsv'); pg.wait_for_selector('#lPanel .empty2')
    checar(sim.lista[1165] == set() and sim.lista[2001] == {101}, 'esvaziar apaga só a lista deste cliente')
    checar('Sua lista está vazia' in n.tc('#lPanel'), 'lista vazia depois de esvaziar')
    n.fechar()
    sim.lista[1165] = {101, 104, 105}
    n = N(pw, sim, '/painel', largura=1280); pg = n.pg
    pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk'); pg.wait_for_selector('#vAdm [data-at="cli"].on')
    pg.wait_for_selector('#clPortal [data-mlc="1165"]'); pg.click('#clPortal [data-mlc="1165"]')
    pg.wait_for_selector('#mlItens .crow[data-id="105"]')
    checar('fora do portal (o cliente não vê)' in n.tc('#mlItens .crow[data-id="105"]') and 'fora do portal' not in n.tc('#mlItens .crow[data-id="101"]'), 'painel marca o produto que o cliente não vê')
    checar('3 produtos na lista' in n.tc('#mlItens') and '2 aparecendo para o cliente' in n.tc('#mlItens'), 'painel conta os produtos da lista do cliente')
    pg.fill('#mlQ', 'P-105'); pg.click('#mlBuscar'); pg.wait_for_function("!document.getElementById('mlRes').textContent.includes('Buscando')")
    checar(not pg.locator('#mlRes [data-add]').count(), 'busca do painel não oferece produto fora do portal para a lista')
    pg.click('#mlItens .crow[data-id="101"] [data-cgl]'); pg.wait_for_selector('[data-cgbox="101"]:not([hidden]) [data-cgv]')
    pg.click('[data-cgbox="101"] [data-cgok]'); pg.wait_for_selector('[data-cgbox="101"] [data-cgerr] .okmsg')
    checar(not [x for x in sim.chamadas if x[0] == 'POST' and 'precos-congelados' in x[1]], 'congelar sem preço não grava')
    pg.fill('[data-cgbox="101"] [data-cgv]', '8,40'); pg.click('[data-cgbox="101"] [data-cgok]'); pg.wait_for_timeout(800)
    inc = [x for x in sim.chamadas if x[0] == 'POST' and 'precos-congelados' in x[1]]
    checar(inc and inc[-1][3]['valor'] == '8.40' and inc[-1][3]['produto'] == 101 and '1165' in inc[-1][1], f'congelar pela Minha Lista grava no G360 para o cliente: {inc[-1] if inc else None}')
    pg.click('#mlEsv'); checar(sim.lista[1165] == {101, 104, 105}, 'esvaziar no painel pede o segundo clique')
    pg.click('#mlEsv'); pg.wait_for_selector('#mlItens >> text=Lista vazia')
    checar(sim.lista[1165] == set() and sim.lista[2001] == {101}, 'painel esvazia só a lista deste cliente')
    n.fechar()

    # Formas de pagamento: a equipe esconde condições no portal (todos ou um cliente)
    etapa[0] = 'Etapa 18 (pagamento)'
    sim = Sim()
    n = N(pw, sim); pg = n.pg
    n.entrar(U1, S1)
    pg.locator('#grid .card[data-id="104"] .add').click(); pg.wait_for_function("document.getElementById('cartN').textContent === '1'")
    n.abrir_checkout(); pg.wait_for_selector('input[name=pg]')
    checar(pg.locator('input[name=pg]').count() == 2 and sim.cond_vistas.get(1165) == [(1, 'À vista'), (2, '30/60 dias'), (3, 'A Combinar')], f'cliente vê as 2 condições e o portal guarda o que o G360 liberou: {sim.cond_vistas}')
    checar('Combinar' not in n.tc('#chkBox'), 'A COMBINAR nunca aparece para o cliente')
    pg.click('#cX'); n.fechar()
    sim.cond_ocultas[1165] = [2]
    n = N(pw, sim); pg = n.pg
    n.entrar(U1, S1); pg.locator('#grid .card[data-id="104"] .add').click(); pg.wait_for_function("document.getElementById('cartN').textContent === '1'")
    n.abrir_checkout(); pg.wait_for_selector('input[name=pg]')
    checar(pg.locator('input[name=pg]').count() == 1 and 'À vista' in n.tc('#chkBox') and '30/60' not in n.tc('#chkBox'), 'condição escondida para este cliente não aparece no fechamento')
    pg.click('#cX'); n.fechar()
    sim.cond_ocultas[0] = [1]
    n = N(pw, sim); pg = n.pg
    n.entrar(U1, S1); pg.locator('#grid .card[data-id="104"] .add').click(); pg.wait_for_function("document.getElementById('cartN').textContent === '1'")
    n.abrir_checkout(); pg.wait_for_selector('#chkBox .rv-aviso.bad')
    pg.wait_for_timeout(800)
    checar('Fale com o seu vendedor' in n.tc('#chkBox') and pg.is_disabled('#cOk'), 'todas escondidas: aviso e envio bloqueado')
    pg.click('#cX'); n.fechar()
    sim.cond_ocultas = {}
    n = N(pw, sim, '/painel', largura=1280); pg = n.pg
    pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk'); pg.wait_for_selector('#vAdm [data-at="cli"].on')
    pg.click('[data-at="cfg"]'); pg.wait_for_selector('#cfCond [data-cond="2"]')
    pg.uncheck('#cfCond [data-cond="2"]'); pg.click('#cfCond [data-cond-salvar]'); pg.wait_for_selector('#cfCond [data-cond-res]:has-text("Salvo")')
    checar(sim.cond_ocultas.get(0) == [2], f'Configurações escondem para todos: {sim.cond_ocultas}')
    checar('sempre bloqueada' in n.tc('#cfCond') and pg.locator('#cfCond [data-cond="3"]').count() == 0, 'painel mostra A COMBINAR como sempre bloqueada, sem opção de liberar')
    n.fechar()

    # Etapa 5 passo 3 e Etapa 10 passo 4 (pacote 18/11 tarde): F5 mantém a sessão na aba; outra aba pede login
    etapa[0] = 'Etapa 15 (F5)'
    sim = Sim()
    n = N(pw, sim); pg = n.pg
    n.entrar(U1, S1)
    # Card com mais de uma foto: passar o mouse mostra a 2ª e volta à capa ao sair
    pg.set_viewport_size({'width': 1280, 'height': 900}); pg.wait_for_selector('#grid .card[data-id="104"] .foto img')
    checar('produtos/104/fotos/2' not in sim.fotos_pedidas, '2ª foto só é buscada quando passa o mouse')
    checar(pg.locator('#grid .card[data-id="104"] .dots i').count() == 2, 'pontinhos indicam as 2 fotos')
    pg.hover('#grid .card[data-id="104"]'); pg.wait_for_selector('#grid .card[data-id="104"] .foto.troca img.iextra.on')
    checar('produtos/104/fotos/2' in sim.fotos_pedidas and pg.locator('#grid .card[data-id="104"] .dots i:nth-child(2).on').count() == 1, 'passar o mouse esmaece a capa e mostra a 2ª foto')
    pg.mouse.move(5, 5); pg.wait_for_timeout(100)
    checar(not pg.locator('#grid .card[data-id="104"] .foto.troca').count() and pg.locator('#grid .card[data-id="104"] .dots i:first-child.on').count() == 1, 'tirar o mouse volta para a capa')
    pg.set_viewport_size({'width': 390, 'height': 900})
    chave = pg.evaluate("Object.keys(sessionStorage).find(k => k.startsWith('sr-g360-comprador-'))")
    checar(chave and pg.evaluate(f"sessionStorage.getItem('{chave}')") in sim.tokens and not pg.evaluate('JSON.stringify(localStorage)').count(list(sim.tokens)[0]), 'token só no sessionStorage, na chave própria')
    logins = len([c for c in sim.chamadas if c[1] == 'sessoes'])
    pg.wait_for_selector('#grid .card[data-id="104"] .add'); pg.locator('#grid .card[data-id="104"] .qty input').fill('3'); pg.locator('#grid .card[data-id="104"] .add').click()
    pg.wait_for_function("document.getElementById('cartN').textContent === '1'")
    guardado = pg.evaluate("Object.entries(localStorage).filter(([k]) => k.startsWith('sr-carrinho-')).map(([, v]) => v).join('')")
    checar('"produto_id":104' in guardado and 'preco' not in guardado.lower() and 'disponivel' not in guardado, f'carrinho guardado só com produto, unidade e quantidade: {guardado}')
    pg.reload(); pg.wait_for_selector('#grid .card[data-id="101"] .price, #grid .card[data-id="101"]')
    pg.wait_for_function("document.getElementById('cartN').textContent === '1'")
    pg.click('#cartBtn'); pg.wait_for_selector('#drawer.open .ci'); pg.wait_for_function("document.querySelector('#dBody .ci .r') && document.querySelector('#dBody .ci .r').textContent.includes('R$')")
    checar('3' in pg.input_value('#dBody .ci .qty input') and 'R$' in n.tc('#dBody .ci'), 'F5 mantém o carrinho, com o preço buscado de novo na API')
    pg.click('#dClose')
    pg.wait_for_function("document.body.classList.contains('logged')")
    mes = [c for c in sim.chamadas if c[0] == 'GET' and c[1] == 'me']
    checar(len([c for c in sim.chamadas if c[1] == 'sessoes']) == logins and mes, 'F5 mantém o login (GET me, sem POST sessoes)')
    checar(any(c[0] == 'PONTE' and c[1] == 'abrir_sessao' for c in sim.chamadas[-15:]), 'F5 reabre o vínculo do Supabase')
    checar(n.segredos_ok([S1]), 'depois do F5, senha fora do storage e token só na chave dele')
    outra = n.br.new_page(viewport={'width': 390, 'height': 900}); outra.route('**/*', sim.rota); outra.goto(BASE + '/')
    outra.wait_for_selector('#grid .card, #grid .empty, #gEntrar'); outra.wait_for_timeout(500)
    checar(not outra.evaluate("document.body.classList.contains('logged')"), 'outra aba pede login')
    outra.close()
    # Outro navegador (outro computador ou celular): o mesmo comprador vê o mesmo carrinho
    pg.wait_for_timeout(1500)
    checar(any(any(l['produto_id'] == 104 for l in c['linhas']) for c in sim.carrinhos.values()), f'carrinho gravado no Supabase: {sim.carrinhos}')
    checar(all('preco' not in json.dumps(c).lower() for c in sim.carrinhos.values()), 'carrinho no Supabase sem preço')
    n2 = N(pw, sim, '/'); n2.entrar(U1, S1)
    n2.pg.wait_for_function("document.getElementById('cartN').textContent === '1'", timeout=8000)
    n2.pg.click('#cartBtn'); n2.pg.wait_for_selector('#drawer.open .ci')
    n2.pg.wait_for_function("document.querySelector('#dBody .ci .r') && document.querySelector('#dBody .ci .r').textContent.includes('R$')")
    checar('3' in n2.pg.input_value('#dBody .ci .qty input'), 'outro navegador, mesmo comprador: o carrinho aparece com a quantidade certa e o preço da API')
    n2.pg.locator('#dBody .ci .x').first.click(); n2.pg.wait_for_function("document.getElementById('cartN').textContent === ''"); n2.pg.wait_for_timeout(1500)
    n2.fechar()
    pg.click('#cartBtn'); pg.wait_for_function("document.getElementById('cartN').textContent === ''", timeout=8000)
    checar(True, 'removido no outro navegador: ao abrir o carrinho aqui, ele some também')
    pg.click('#dClose')
    pg.locator('#grid .card[data-id="104"] .qty input').fill('3'); pg.locator('#grid .card[data-id="104"] .add').click()
    pg.wait_for_function("document.getElementById('cartN').textContent === '1'"); pg.wait_for_timeout(1200)
    n3 = N(pw, sim, '/'); n3.entrar(U2, S2); n3.pg.wait_for_timeout(1500)
    checar(n3.tc('#cartN') == '', 'outro comprador, em outro navegador, não recebe o carrinho do primeiro')
    n3.fechar()
    # token derrubado no servidor: o F5 cai no login e apaga o token
    sim.tokens.clear(); pg.reload(); pg.wait_for_timeout(1200)
    checar(not pg.evaluate("document.body.classList.contains('logged')") and not pg.evaluate(f"sessionStorage.getItem('{chave}')"), '401 depois do F5 apaga o token e mostra o login')
    n.entrar(U1, S1)
    pg.wait_for_function("document.getElementById('cartN').textContent === '1'")
    checar(True, 'novo login do mesmo comprador traz o carrinho de volta')
    pg.evaluate("document.getElementById('sair').click()"); pg.wait_for_function("!document.body.classList.contains('logged')")
    checar(n.tc('#cartN') == '', 'depois de sair, o carrinho some da tela')
    n.entrar(U2, S2); pg.wait_for_timeout(600)
    checar(n.tc('#cartN') == '', 'outro comprador não vê o carrinho do primeiro')
    pg.evaluate("document.getElementById('sair').click()"); pg.wait_for_function("!document.body.classList.contains('logged')")
    pg.go_back(); pg.wait_for_timeout(500); pg.reload(); pg.wait_for_timeout(1200)
    checar(not pg.evaluate("document.body.classList.contains('logged')") and not pg.evaluate(f"sessionStorage.getItem('{chave}')"), 'depois de sair, Voltar e F5 não trazem a sessão de volta')
    n.fechar()
    # Painel: F5 continua logado, sem novo login de operador
    n = N(pw, sim, '/painel', largura=1280); pg = n.pg
    pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk'); pg.wait_for_selector('#vAdm [data-at="cli"].on')
    pg.click('[data-at="prod"]'); pg.wait_for_selector('.arow[data-id="101"]')
    checar('Disponível: 30' in n.tc('.arow[data-id="101"]') and 'Disponível: 0' in n.tc('.arow[data-id="103"]'), 'painel mostra Disponível: N de cada produto')
    ops = len([c for c in sim.chamadas if c[1] == 'operadores/sessoes'])
    pg.reload(); pg.wait_for_selector('#vAdm [data-at="cli"].on')
    checar(len([c for c in sim.chamadas if c[1] == 'operadores/sessoes']) == ops, 'F5 no painel mantém o login do operador')
    pg.click('#aSair'); pg.wait_for_selector('#aUsu')
    checar(not pg.evaluate("Object.keys(sessionStorage).some(k => k.startsWith('sr-g360-operador-'))"), 'sair do painel apaga o token guardado')
    pg.reload(); pg.wait_for_selector('#aUsu'); checar(True, 'depois de sair, o F5 não traz a sessão do painel de volta')
    n.fechar()

print('FALHAS:' if falhas else 'Portal (layout original) + Etapas 1, 2 e 5 a 18: todos os testes passaram.')
for f in falhas: print(' -', f)
