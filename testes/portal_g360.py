"""Portal no layout original + integração G360 (Etapas 1, 2 e 5 a 11).
Roda contra http://localhost:5173 (npm run build && npm run preview), com o simulador (dados fictícios)."""
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
        armaz = self.pg.evaluate('JSON.stringify(localStorage)+JSON.stringify(sessionStorage)+document.cookie')
        toks = list(self.sim.tokens.keys())
        return not any(t in armaz for t in toks) and not any(x in armaz for x in extras) and not any(any(t in c for t in toks) for c in self.console)
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
    checar('Entre para ver o catálogo' in n.tc('#grid'), 'visitante sem convite para entrar')
    n.abrir_login()
    checar('8 minutos sem uso' in n.tc('#lgSessao'), 'tempo de sessão no login')
    n.pg.screenshot(path=f'{OUT}/portal_visitante_390.png')
    # Quero ser cliente: cadastro de quem ainda não é cliente
    n.pg.click('#lgX'); n.pg.click('#gCadastro'); n.pg.wait_for_selector('#mCad.open #kDoc')
    n.pg.click('#kEnviar')
    checar('CNPJ' in n.tc('#kDocErr') and 'WhatsApp' in n.tc('#kWhatsErr'), 'cadastro vazio sem avisos por campo')
    for i, v in [('kDoc', '12.ABC.345/01DE-35'), ('kRazao', 'Empresa Fictícia LTDA'), ('kResp', 'Pessoa Fictícia'), ('kWhats', '(34) 99999-0000'),
                 ('kEmail', 'compras@example.invalid'), ('kRua', 'Rua Exemplo'), ('kNum', '10'), ('kCidade', 'Cidade Exemplo'), ('kBairro', 'Centro')]:
        n.pg.fill('#' + i, v)
    n.pg.fill('#kCep', '38400000')
    n.pg.click('#kEnviar'); n.pg.wait_for_selector('#cadBox .ok')
    checar(len(sim.cadastros) == 1 and sim.cadastros[0]['documento'] == '12ABC34501DE35' and sim.cadastros[0]['loja'] == '96da1e99a3f327f0', f'cadastro não chegou: {sim.cadastros}')
    n.pg.screenshot(path=f'{OUT}/portal_cadastro_enviado_390.png')
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
    checar(n.pg.locator('#cTrocar').count() == 0 and 'definida pela Souza Ribeiro' in n.tc('#contaBox'), 'trocar senha com troca_senha falso')
    n.fechar()

    # ================= ETAPA 6 =================
    etapa[0] = 'Etapa 6'
    sim = Sim()
    n = N(pw, sim); pg = n.pg
    n.entrar(U1, S1)
    checar(pg.locator('#grid .card').count() == 20, 'catálogo sem 20 produtos')
    checar('45 produtos · página 1 de 3' in n.tc('#cnt'), f'contagem: {n.tc("#cnt")}')
    checar(n.tc('#tot') == '45' and n.tc('#nMarcas') == '2', 'contadores da página inicial')
    c = pg.locator('.card[data-id="101"]')
    checar('R$ 11,50' in c.locator('.price').text_content() and 'Seu preço' in c.locator('.price').text_content(), 'preço/Seu preço')
    checar(c.locator('s, del').count() == 0, 'preço riscado')
    c.locator('[data-un="CX12"]').click()
    checar('R$ 125,00' in c.locator('.price').text_content(), 'troca de embalagem')
    c102 = pg.locator('.card[data-id="102"]')
    checar(c102.locator('.add').is_disabled() and 'Preço sob consulta. Fale com o seu vendedor.' in c102.text_content(), 'compravel falso')
    c108 = pg.locator('.card[data-id="108"]')
    checar(not c108.locator('.add').is_disabled() and 'Disponibilidade a confirmar' in c108.text_content() and 'vendedor' not in c108.text_content(), 'sob_consulta comprável')
    checar('Há uma venda em andamento' in pg.locator('.card[data-id="103"]').text_content() and pg.locator('.card[data-id="103"] .add').is_disabled(), 'aviso 103')
    checar('Últimas unidades' in pg.locator('.card[data-id="106"]').text_content(), 'últimas unidades')
    pg.wait_for_timeout(600)
    checar('produtos/119/fotos/1' not in sim.fotos_pedidas, f'foto fora da tela baixada: {sim.fotos_pedidas}')
    pg.locator('.card[data-id="105"]').scroll_into_view_if_needed(); pg.locator('.card[data-id="104"]').scroll_into_view_if_needed()
    pg.wait_for_selector('.card[data-id="104"] .g360-foto img', timeout=10000)
    foto = [x for x in sim.chamadas if x[1] == 'produtos/104/fotos/1'][0]
    checar(foto[2].get('authorization', '').startswith('Bearer '), 'foto sem Bearer')
    pg.wait_for_timeout(600)
    checar('Sem foto' in pg.locator('.card[data-id="105"]').text_content(), 'foto com falha sem espaço reservado')
    pg.screenshot(path=f'{OUT}/portal_catalogo_390.png')
    n.sem_rolagem('catálogo')
    pg.click('#gProx'); pg.wait_for_function("document.getElementById('cnt').textContent.includes('página 2 de 3')")
    pg.click('#gAnt'); pg.wait_for_function("document.getElementById('cnt').textContent.includes('página 1 de 3')")
    pg.locator('.card[data-id="105"]').scroll_into_view_if_needed(); pg.locator('.card[data-id="104"]').scroll_into_view_if_needed(); pg.wait_for_timeout(700)
    checar(sim.fotos_pedidas.count('produtos/105/fotos/1') == 1 and sim.fotos_pedidas.count('produtos/104/fotos/1') == 1, 'foto pedida de novo')
    pg.fill('#q', 'P-121'); pg.press('#q', 'Enter'); pg.wait_for_function("document.getElementById('cnt').textContent.startsWith('1 produto')")
    pg.fill('#q', 'nada-existe'); pg.press('#q', 'Enter'); pg.wait_for_selector('#gLimpar')
    pg.click('#gLimpar'); pg.wait_for_function("document.getElementById('cnt').textContent.startsWith('45')")
    pg.click('.chip[data-c="2"]'); pg.wait_for_function("document.getElementById('cnt').textContent.startsWith('15')")
    pg.click('.chip[data-c=""]'); pg.wait_for_function("document.getElementById('cnt').textContent.startsWith('45')")
    c110 = pg.locator('.card[data-id="110"]')
    c110.locator('.qty input').fill('abc'); c110.locator('.add').click()
    checar('Quantidade inválida' in n.toast(), 'quantidade inválida aceita')
    c110.locator('.qty input').fill('1,5'); c110.locator('.add').click()
    checar('Adicionado' in n.toast(), 'não adicionou')
    c110.locator('[data-d="1"]').click(); checar(c110.locator('.qty input').input_value() == '2', 'botão + da quantidade')
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
    fora = pg.locator('.lrow[data-fora="999"]')
    checar('Indisponível no momento' in fora.text_content() and 'R$' not in fora.text_content(), 'fora do catálogo')
    checar('Última compra: 5 UN em 01/11/2026' in pg.locator('.lrow[data-id="104"]').text_content(), 'histórico de compra na lista')
    busca = [x for x in sim.chamadas if x[1] == 'produtos/busca'][-1][3]
    checar(busca.get('limite') == 50 and {101, 999, 104} <= set(busca.get('ids')), f'filtro ids/limite: {busca}')
    fora.locator('[data-rm]').click(); pg.wait_for_selector('#lPanel .lrow[data-id="101"]'); pg.wait_for_timeout(300)
    checar(999 not in sim.lista[1165], 'remover da lista')
    pg.locator('.lrow[data-id="101"] [data-d="1"]').click(); pg.locator('.lrow[data-id="104"] .qty input').fill('3')
    checar('2 itens' in n.tc('#lN'), 'quantidades na lista')
    pg.click('#lAdd'); pg.wait_for_selector('#drawer.open .ci')
    checar(pg.locator('#dBody .ci').count() == 2, 'lista → carrinho')
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
    sim.lista.setdefault(1919, set()).add(108)
    n.ir('cat'); n.pg.wait_for_selector('#grid .card')
    n.ir('lista'); n.pg.wait_for_selector('#lPanel .lrow[data-id="108"]')
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
    checar(pg.locator('#vAdm [data-at]').count() == 9, 'nove abas do painel antigo + ocorrências')
    pg.fill('#clQ', '11.111.111/0001-11'); pg.click('#clNovo'); pg.wait_for_selector('#clG360 >> text=Liberado')
    pg.click('[data-ircg]'); pg.wait_for_selector('#atCong:not([hidden])')
    pg.click('[data-at="prod"]'); pg.fill('#aQ', 'P-101'); pg.press('#aQ', 'Enter'); pg.wait_for_selector('.arow[data-id="101"]')
    t = n.tc('#aPanel'); checar('5,1234' in t and '45,5' in t, f'preço/custo/margem no Produtos')
    pg.click('.arow[data-id="101"] [data-cg]'); pg.wait_for_selector('#atCong:not([hidden])')
    pg.fill('#cgP', '9,75'); pg.click('#cgAdd'); pg.wait_for_selector('#cgPanel .crow')
    inc = [x for x in sim.chamadas if x[0] == 'POST' and 'precos-congelados' in x[1]][-1][3]
    checar(inc['valor'] == '9.75' and inc['produto'] == 101 and inc['unidade_id'] is None, f'preço congelado: {inc}')
    pg.click('[data-at="prod"]'); pg.fill('#aQ', 'P-104'); pg.press('#aQ', 'Enter'); pg.wait_for_selector('.arow[data-id="104"]')
    pg.click('.arow[data-id="104"] [data-ed]'); pg.wait_for_selector('#mod.open #fxTh img')
    pg.click('#mOk')
    pg.click('[data-at="intel"]'); checar('parte 4' in n.tc('#intelPanel'), 'aba em preparação')
    sim.op_tokens.clear(); pg.click('[data-at="prod"]'); pg.fill('#aQ', 'P-101'); pg.press('#aQ', 'Enter'); pg.wait_for_selector('#aForm')
    checar('Sua sessão terminou.' in n.tc('#aLogin'), '401 do painel')
    pg.fill('#aUsu', 'vendedor'); pg.fill('#aSen', 'senha2'); pg.click('#aOk'); pg.wait_for_selector('#vAdm [data-at="prod"].on')
    pg.click('[data-at="prod"]'); pg.fill('#aQ', 'P-104'); pg.press('#aQ', 'Enter'); pg.wait_for_selector('.arow[data-id="104"]')
    checar('sem acesso' in n.tc('#aPanel'), 'custo para operador sem acesso')
    etapa[0] = 'Etapa 11'
    pg.click('[data-at="ocor"]'); pg.fill('#ocPanel [data-e]', 'painel@example.invalid'); pg.fill('#ocPanel [data-s]', 'SenhaPainel1'); pg.click('#ocPanel form button'); pg.wait_for_selector('#ocPanel .mrow:not(.h)')
    t = n.tc('#ocPanel'); checar('FRETE_A_COMBINAR' in t and 'LOJA_INDISPONIVEL' in t, 'ocorrências no painel')
    n.fechar()

print('FALHAS:' if falhas else 'Portal (layout original) + Etapas 1, 2 e 5 a 11: todos os testes passaram.')
for f in falhas: print(' -', f)
