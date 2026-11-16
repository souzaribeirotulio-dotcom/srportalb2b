"""Etapas 5 a 11 — login, catálogo, carrinho/revisão, envio, pedidos/Minha Lista, painel e ocorrências.
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

class Navegador:
    def __init__(self, pw, sim, caminho='/', largura=390, relogio=False):
        self.br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        self.ctx = self.br.new_context(viewport={'width': largura, 'height': 900})
        self.pg = self.ctx.new_page(); self.sim = sim
        self.erros, self.console = [], []
        self.pg.on('pageerror', lambda e: self.erros.append(str(e)))
        self.pg.on('console', lambda m: self.console.append(m.text))
        if relogio: self.pg.clock.install()
        self.pg.route('**/*', sim.rota)
        self.pg.goto(BASE + caminho)
        self.pg.wait_for_selector('#g360Conteudo, #pLogin')
    def entrar(self, u, s):
        pg = self.pg
        pg.wait_for_selector('#g360Usuario')
        pg.fill('#g360Usuario', u); pg.fill('#g360Senha', s); pg.click('#g360Entrar')
    def texto(self, sel='#g360Conteudo'): return self.pg.inner_text(sel)
    def ir(self, nome): self.pg.click(f'.app-nav button:has-text("{nome}")')
    def segredos_ok(self, extras=()):
        armaz = self.pg.evaluate('JSON.stringify(localStorage)+JSON.stringify(sessionStorage)+document.cookie')
        toks = list(self.sim.tokens.keys())
        return not any(t in armaz for t in toks) and not any(x in armaz for x in extras) and not any(any(t in c for t in toks) for c in self.console)
    def sem_rolagem(self, nome):
        for w in (360, 390, 768, 1280, 1920):
            self.pg.set_viewport_size({'width': w, 'height': 900})
            checar(self.pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth && document.getElementById("g360Entrada").scrollWidth <= window.innerWidth'), f'rolagem horizontal em {w}px ({nome})')
        self.pg.set_viewport_size({'width': 390, 'height': 900})
    def fechar(self):
        checar(not self.erros, f'erros de script: {self.erros}')
        self.br.close()

with sync_playwright() as pw:
    # ================= ETAPA 5 =================
    etapa[0] = 'Etapa 5'
    sim = Sim()
    n = Navegador(pw, sim)
    n.entrar(U1, 'errada1')
    n.pg.wait_for_selector('#g360LoginResultado .g360-msg')
    checar('CPF/CNPJ ou senha inválidos.' in n.texto('#g360LoginResultado'), 'senha errada sem a mensagem da API')
    checar(n.pg.evaluate('location.pathname') == '/', 'senha errada saiu da entrada')
    checar(n.pg.input_value('#g360Senha') == '', 'senha ficou no campo após erro')
    n.entrar(U1, S1)
    n.pg.wait_for_url('**/catalogo')
    checar('Fictício Um' in n.texto('.app-topo'), 'nome do comprador ausente no topo')
    ponte = [c for c in sim.chamadas if c[0] == 'PONTE' and c[1] == 'abrir_sessao']
    checar(len(ponte) == 1, 'abrir_sessao não chamado uma vez após o login')
    extras = {k for k in ponte[0][2]} - {'content-type', 'accept', 'user-agent', 'referer', 'origin', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'accept-language', 'content-length'}
    checar(not extras, f'cabeçalhos a mais na ponte: {extras}')
    login = [c for c in sim.chamadas if c[1] == 'sessoes'][-1]
    checar(set(login[3]) == {'usuario', 'senha'}, f'corpo do login com campos a mais: {login[3]}')
    checar(n.segredos_ok([S1]), 'token ou senha em storage/console')
    n.pg.screenshot(path=f'{OUT}/etapa5_logado_390.png')
    # 401 em qualquer operação: volta ao login com a mensagem da API
    sim.tokens.clear()
    n.ir('Meus pedidos')
    n.pg.wait_for_selector('#g360FormLogin')
    checar('Sua sessão terminou. Entre novamente.' in n.texto(), '401 sem a mensagem de sessão encerrada')
    checar(n.pg.evaluate('location.pathname') == '/', '401 não voltou para a entrada')
    # entrar e sair
    n.entrar(U1, S1); n.pg.wait_for_url('**/catalogo')
    n.pg.click('#g360Sair'); n.pg.wait_for_selector('#g360FormLogin')
    checar(any(c[0] == 'DELETE' and c[1] == 'sessao' for c in sim.chamadas), 'Sair não chamou DELETE sessao')
    checar('Você saiu do portal.' in n.texto(), 'aviso de saída ausente')
    # página privada sem login vai para a entrada
    n.pg.goto(BASE + '/pedidos'); n.pg.wait_for_selector('#g360FormLogin')
    checar('Entre para continuar.' in n.texto(), 'página privada sem login não pediu login')
    n.fechar()

    # inatividade (relógio controlado)
    sim = Sim(sessao_minutos=1)
    n = Navegador(pw, sim, relogio=True)
    n.entrar(U1, S1); n.pg.wait_for_url('**/catalogo'); n.pg.wait_for_selector('.cartao-produto')
    chamadas_antes = len(sim.chamadas)
    n.pg.clock.run_for(75000)
    n.pg.wait_for_selector('#g360FormLogin', timeout=10000)
    checar('inatividade' in n.texto(), 'inatividade não encerrou a sessão')
    checar(not [c for c in sim.chamadas[chamadas_antes:] if c[1] in ('me', 'loja')], 'fez chamada periódica para manter a sessão')
    n.fechar()

    # comprador bloqueado, ponte fora do ar, troca de senha, troca_senha falso
    sim = Sim(); sim.cenario['ponte'] = 'fora'
    n = Navegador(pw, sim)
    n.entrar(UB, SB); n.pg.wait_for_url('**/catalogo')
    checar('Compras bloqueadas' in n.texto('#g360Entrada'), 'aviso de compra bloqueada ausente')
    checar('A Minha Lista está indisponível' in n.texto('#g360Entrada'), 'ponte 503 sem aviso da Minha Lista')
    n.fechar()
    sim = Sim()
    n = Navegador(pw, sim)
    n.entrar(U1, S1); n.pg.wait_for_url('**/catalogo')
    n.pg.click('button:has-text("Minha conta")'); n.pg.wait_for_selector('#g360FormTroca')
    n.pg.fill('#tAtual', 'errada1'); n.pg.fill('#tNova1', 'Nova123'); n.pg.fill('#tNova2', 'Nova123'); n.pg.click('#g360FormTroca button')
    n.pg.wait_for_selector('#tResultado .g360-msg')
    checar('A senha atual não confere.' in n.texto('#tResultado'), 'senha atual errada sem mensagem')
    pontes = len([c for c in sim.chamadas if c[0] == 'PONTE'])
    n.pg.fill('#tAtual', S1); n.pg.click('#g360FormTroca button'); n.pg.wait_for_selector('#tResultado .g360-ok')
    checar(len([c for c in sim.chamadas if c[0] == 'PONTE']) == pontes + 1, 'troca de senha não reabriu a sessão do Supabase')
    n.ir('Meus pedidos'); n.pg.wait_for_selector('#g360ListaPedidos .estado-tela:not(.carregando)')
    checar(n.pg.evaluate('location.pathname') == '/pedidos', 'token novo não foi usado depois da troca de senha')
    checar(n.segredos_ok(['Nova123']), 'senha nova em storage/console')
    n.fechar()
    sim = Sim(troca_senha=False)
    n = Navegador(pw, sim)
    checar(n.pg.locator('button:has-text("Primeiro acesso")').count() == 0, 'Primeiro acesso com troca_senha falso')
    n.entrar(U1, S1); n.pg.wait_for_url('**/catalogo')
    n.pg.click('button:has-text("Minha conta")'); n.pg.wait_for_selector('.app-titulo')
    checar(n.pg.locator('#g360FormTroca').count() == 0 and 'definida pela Souza Ribeiro' in n.texto(), 'trocar senha visível com troca_senha falso')
    n.fechar()

    # ================= ETAPA 6 =================
    etapa[0] = 'Etapa 6'
    sim = Sim()
    n = Navegador(pw, sim)
    n.entrar(U1, S1); n.pg.wait_for_url('**/catalogo'); n.pg.wait_for_selector('.cartao-produto')
    checar(n.pg.locator('.cartao-produto').count() == 20, 'catálogo não mostrou 20 produtos')
    checar('45 produtos · página 1 de 3' in n.texto(), 'contagem/paginação errada')
    c101 = n.pg.locator('.cartao-produto[data-id="101"]')
    checar('R$ 11,50' in c101.inner_text() and 'Seu preço' in c101.inner_text(), 'preço/selo Seu preço do 101')
    checar(c101.locator('s, del').count() == 0, 'preço riscado no catálogo')
    c101.locator('select.cp-unidade').select_option('CX12')
    checar('R$ 125,00' in c101.locator('.cp-preco').inner_text() and 'Seu preço' in c101.locator('.cp-preco').inner_text(), 'preço da caixa não apareceu')
    checar(n.pg.locator('.cartao-produto[data-id="102"] .cp-add').count() == 0 and 'Sob consulta' in n.pg.locator('.cartao-produto[data-id="102"]').inner_text(), 'sob consulta com botão de comprar')
    checar('Há uma venda em andamento' in n.pg.locator('.cartao-produto[data-id="103"]').inner_text(), 'aviso do produto ausente')
    checar('Últimas unidades' in n.pg.locator('.cartao-produto[data-id="106"]').inner_text(), 'faixa últimas unidades ausente')
    checar(not any(c[1] == 'produtos/110/fotos/1' for c in sim.chamadas), 'x')
    checar(len(sim.fotos_pedidas) == 0, f'fotos fora da tela foram baixadas: {sim.fotos_pedidas}')
    n.pg.locator('.cartao-produto[data-id="105"]').scroll_into_view_if_needed()
    n.pg.locator('.cartao-produto[data-id="104"]').scroll_into_view_if_needed()
    n.pg.wait_for_selector('.cartao-produto[data-id="104"] .foto img', timeout=10000)
    foto = [c for c in sim.chamadas if c[1] == 'produtos/104/fotos/1'][0]
    checar(foto[2].get('authorization', '').startswith('Bearer '), 'foto sem o Bearer')
    n.pg.wait_for_timeout(800)
    checar('Sem foto' in n.pg.locator('.cartao-produto[data-id="107"]').inner_text(), 'produto sem fotos sem espaço reservado')
    checar(n.pg.locator('.cartao-produto[data-id="105"] .foto img').count() == 0 and n.pg.locator('.cartao-produto[data-id="105"] .g360-msg').count() == 0, 'foto com 404 mostrou imagem ou mensagem')
    n.pg.screenshot(path=f'{OUT}/etapa6_catalogo_390.png')
    n.sem_rolagem('catálogo')
    n.pg.click('#g360Proxima'); n.pg.wait_for_selector('text=página 2 de 3')
    n.pg.click('#g360Anterior'); n.pg.wait_for_selector('text=página 1 de 3')
    n.pg.locator('.cartao-produto[data-id="105"]').scroll_into_view_if_needed(); n.pg.locator('.cartao-produto[data-id="104"]').scroll_into_view_if_needed()
    n.pg.wait_for_selector('.cartao-produto[data-id="104"] .foto img'); n.pg.wait_for_timeout(800)
    checar(sim.fotos_pedidas.count('produtos/105/fotos/1') == 1, f'foto que falhou foi pedida de novo: {sim.fotos_pedidas.count("produtos/105/fotos/1")}')
    checar(sim.fotos_pedidas.count('produtos/104/fotos/1') == 1, 'foto já baixada foi pedida de novo')
    n.pg.fill('#g360Busca', 'P-121'); n.pg.click('#g360Filtros button[type="submit"]'); n.pg.wait_for_selector('text=1 produto · página 1 de 1')
    q = [c for c in sim.chamadas if c[1] == 'produtos'][-1]
    n.pg.fill('#g360Busca', 'nada-existe'); n.pg.click('#g360Filtros button[type="submit"]'); n.pg.wait_for_selector('#g360Limpar')
    checar('Nenhum produto encontrado.' in n.texto(), 'busca vazia sem estado vazio')
    n.pg.click('#g360Limpar'); n.pg.wait_for_selector('text=45 produtos')
    n.pg.select_option('#g360Grupo', '2'); n.pg.wait_for_selector('text=15 produtos')
    n.pg.select_option('#g360Grupo', '')
    n.pg.wait_for_selector('text=45 produtos')
    # adicionar ao carrinho, com vírgula
    c110 = n.pg.locator('.cartao-produto[data-id="110"]')
    c110.locator('.cp-qtd').fill('abc'); c110.locator('.cp-add').click()
    checar('Quantidade inválida' in c110.inner_text(), 'quantidade inválida aceita')
    c110.locator('.cp-qtd').fill('1,5'); c110.locator('.cp-add').click()
    checar('Adicionado ao carrinho.' in c110.inner_text(), 'não adicionou ao carrinho')
    c110.locator('.cp-qtd').fill('2'); c110.locator('.cp-add').click()
    checar('somada' in c110.inner_text(), 'mesmo produto não somou')
    checar(n.pg.inner_text('#g360ContaCarrinho') == '1', 'contador do carrinho')
    n.fechar()

    # ================= ETAPAS 7, 8, 9, 11 (mesmo simulador) =================
    etapa[0] = 'Etapa 7'
    sim = Sim()
    n = Navegador(pw, sim)
    pg = n.pg
    n.entrar(U1, S1); pg.wait_for_url('**/catalogo'); pg.wait_for_selector('.cartao-produto')
    pg.locator('.cartao-produto[data-id="110"] .cp-qtd').fill('1,5'); pg.locator('.cartao-produto[data-id="110"] .cp-add').click()
    c101 = pg.locator('.cartao-produto[data-id="101"]'); c101.locator('select.cp-unidade').select_option('CX12'); c101.locator('.cp-add').click()
    n.ir('Carrinho'); pg.wait_for_selector('#g360Revisar')
    t = n.texto()
    checar('estimado' in t, 'estimativa não marcada como estimada')
    checar('R$ 148,25' in t, 'estimativa errada (esperado R$ 148,25)')
    pg.check('input[name="modalidade"][value="retirada"]')
    pg.click('#g360Revisar'); pg.wait_for_selector('.resumo')
    rev = [c for c in sim.chamadas if c[1] == 'revisoes'][-1][3]
    checar(rev == {'itens': [{'produto_id': 110, 'quantidade': '1.5', 'unidade': None}, {'produto_id': 101, 'quantidade': '1', 'unidade': 'CX12'}], 'modalidade': 'retirada', 'condicao_pagamento_id': 1},
           f'corpo da revisão diferente: {rev}')
    t = n.texto('.resumo')
    checar('R$ 148,25' in t and 'Retirada: sem frete' in t, 'resumo da revisão sem subtotal/frete')
    checar(not pg.locator('#g360Enviar').is_disabled(), 'Enviar desligado com pode_enviar verdadeiro')
    pg.screenshot(path=f'{OUT}/etapa7_revisao_390.png', full_page=True)
    n.sem_rolagem('carrinho')
    pg.check('input[name="modalidade"][value="entrega"]'); pg.click('#g360Revisar'); pg.wait_for_selector('.pendencias')
    checar('Depende da Souza Ribeiro' in n.texto('.pendencias') and 'frete' in n.texto('.pendencias').lower(), 'FRETE_A_COMBINAR sem responsável')
    checar(pg.locator('#g360Enviar').is_disabled(), 'Enviar ligado com pendência')
    pg.wait_for_timeout(600)
    etapa[0] = 'Etapa 11'
    checar(any(o['codigo'] == 'FRETE_A_COMBINAR' and o['operacao'] == 'POST revisoes' and o['comprador_codigo'] == 1165 for o in sim.ocorrencias), f'ocorrência FRETE_A_COMBINAR não gravada: {sim.ocorrencias}')
    checar(all(set(o) == {'loja', 'comprador_codigo', 'codigo', 'request_id', 'operacao', 'registrada_em'} for o in sim.ocorrencias), 'ocorrência com campos a mais')
    pg.click('#g360Revisar'); pg.wait_for_selector('.pendencias'); pg.wait_for_timeout(400)
    checar(len([o for o in sim.ocorrencias if o['codigo'] == 'FRETE_A_COMBINAR']) == 1, 'mesma pendência gravada a cada revisão')
    etapa[0] = 'Etapa 7'
    pg.check('input[name="modalidade"][value="retirada"]'); pg.select_option('#g360Condicao', '2'); pg.click('#g360Revisar'); pg.wait_for_selector('.pendencias')
    checar('pedido mínimo' in n.texto('.pendencias').lower() and 'Para você ajustar' in n.texto('.pendencias'), 'PEDIDO_MINIMO sem orientação')
    pg.select_option('#g360Condicao', '1')
    checar('O carrinho mudou' in n.texto('#g360Revisao'), 'mudar a condição não invalidou a revisão')
    pg.click('#g360Revisar'); pg.wait_for_selector('#g360Enviar:not([disabled])')

    etapa[0] = 'Etapa 8'
    pg.dblclick('#g360Enviar')
    pg.wait_for_selector('.g360-ok.enviado', timeout=15000)
    checar(sim.post_pedidos == 1, f'clique duplo gerou {sim.post_pedidos} envios')
    envio = [c for c in sim.chamadas if c[0] == 'POST' and c[1] == 'pedidos'][-1]
    checar(re.match(r'^[A-Za-z0-9_-]{16,64}$', envio[2].get('idempotency-key', '')), 'Idempotency-Key ausente ou fora do padrão')
    checar(set(envio[3]) == {'itens', 'modalidade', 'condicao_pagamento_id', 'assinatura'}, f'corpo do pedido: {set(envio[3])}')
    checar('Pedido nº 9001' in n.texto() and 'Separado' in n.texto(), 'pedido enviado sem número/situação')
    checar(pg.evaluate("sessionStorage.getItem('sr_g360_envio_pendente')") is None, 'chave não apagada após 201')
    checar(pg.inner_text('#g360ContaCarrinho') == '', 'carrinho não esvaziou')
    pg.screenshot(path=f'{OUT}/etapa8_enviado_390.png', full_page=True)

    def montar_e_revisar(pid='110'):
        n.ir('Catálogo'); pg.wait_for_selector(f'.cartao-produto[data-id="{pid}"] .cp-add')
        pg.locator(f'.cartao-produto[data-id="{pid}"] .cp-add').click()
        n.ir('Carrinho'); pg.wait_for_selector('#g360Revisar')
        pg.check('input[name="modalidade"][value="retirada"]'); pg.click('#g360Revisar'); pg.wait_for_selector('#g360Enviar:not([disabled])')

    # resposta perdida, mas o pedido foi gravado: consulta pela chave e mostra
    sim.cenario['pedidos_post'] = ['abortar_gravado']
    montar_e_revisar(); antes = len(sim.pedidos)
    pg.click('#g360Enviar'); pg.wait_for_selector('.g360-ok.enviado', timeout=15000)
    checar(len(sim.pedidos) == antes + 1, 'resposta perdida duplicou ou perdeu o pedido')
    checar(any(c[1].startswith('pedidos/por-chave/') for c in sim.chamadas), 'não consultou por chave após resposta perdida')
    # sem gravar: 404 na consulta, reenvia com a mesma chave
    sim.cenario['pedidos_post'] = ['abortar_sem_gravar']
    montar_e_revisar(); antes = len(sim.pedidos); n_post = sim.post_pedidos
    pg.click('#g360Enviar'); pg.wait_for_selector('.g360-ok.enviado', timeout=15000)
    posts = [c for c in sim.chamadas if c[0] == 'POST' and c[1] == 'pedidos'][-2:]
    checar(sim.post_pedidos == n_post + 2 and posts[0][2]['idempotency-key'] == posts[1][2]['idempotency-key'] and posts[0][3] == posts[1][3], 'reenvio sem a mesma chave e o mesmo corpo')
    checar(len(sim.pedidos) == antes + 1, 'reenvio criou mais de um pedido')
    # 409 em andamento: espera 3 s e reenvia
    sim.cenario['pedidos_post'] = ['conflito']
    montar_e_revisar(); t0 = time.time()
    pg.click('#g360Enviar'); pg.wait_for_selector('.g360-ok.enviado', timeout=20000)
    checar(time.time() - t0 >= 2.9, 'não esperou 3 s no 409')
    # revisão alterada: revisa de novo, pede confirmação, mesma chave
    sim.cenario['pedidos_post'] = ['mudar_preco']
    montar_e_revisar('112')
    pg.click('#g360Enviar'); pg.wait_for_selector('text=Os valores mudaram', timeout=15000)
    checar(not pg.locator('#g360Enviar').is_disabled(), 'sem confirmação após REVISAO_ALTERADA')
    pg.click('#g360Enviar'); pg.wait_for_selector('.g360-ok.enviado', timeout=15000)
    posts = [c for c in sim.chamadas if c[0] == 'POST' and c[1] == 'pedidos'][-2:]
    checar(posts[0][2]['idempotency-key'] == posts[1][2]['idempotency-key'] and posts[0][3]['assinatura'] != posts[1][3]['assinatura'], 'REVISAO_ALTERADA sem mesma chave e assinatura nova')

    etapa[0] = 'Etapa 9'
    n.ir('Meus pedidos'); pg.wait_for_selector('.pedido-item')
    checar(pg.locator('.pedido-item').count() == len(sim.pedidos), 'lista de pedidos incompleta')
    pg.locator('.pedido-item').first.click(); pg.wait_for_selector('.itens-pedido')
    checar(re.search(r'/pedidos/\d+$', pg.evaluate('location.pathname')) and 'Separado' in n.texto(), 'detalhe do pedido')
    # Minha Lista
    n.ir('Catálogo'); pg.wait_for_selector('.cartao-produto[data-id="101"] .cp-lista')
    pg.locator('.cartao-produto[data-id="101"] .cp-lista').click(); pg.wait_for_selector('.cartao-produto[data-id="101"] .cp-lista[aria-pressed="true"]')
    checar(101 in sim.lista.get(1165, set()), 'Salvar na Minha Lista não gravou')
    sim.lista[1165].add(999)  # produto que saiu do catálogo
    n.ir('Minha Lista'); pg.wait_for_selector('#g360MinhaLista .cartao-produto')
    checar(pg.locator('.cartao-produto[data-id="101"]').count() == 1 and 'R$ 11,50' in pg.locator('.cartao-produto[data-id="101"]').inner_text(), 'Minha Lista sem o produto com preço atual')
    fora = pg.locator('.cartao-produto[data-fora="999"]')
    checar('Indisponível no momento.' in fora.inner_text() and 'R$' not in fora.inner_text(), 'produto fora do catálogo com preço ou sem aviso')
    busca_ids = [c for c in sim.chamadas if c[1] == 'produtos/busca'][-1][3]
    checar(busca_ids.get('limite') == 50 and set(busca_ids.get('ids')) == {101, 999}, f'Minha Lista sem filtro ids/limite 50: {busca_ids}')
    fora.locator('.cp-remover-fora').click(); pg.wait_for_timeout(500)
    checar(999 not in sim.lista[1165], 'remover da lista não apagou')
    pg.screenshot(path=f'{OUT}/etapa9_minha_lista_390.png', full_page=True)
    # Comprar de novo
    n.ir('Comprar de novo'); pg.wait_for_selector('#g360Recompra .cartao-produto')
    t = n.texto('#g360Recompra')
    checar('Última compra: 5 UN em 01/11/2026' in t and 'Indisponível no momento.' in t, 'recompra sem histórico ou sem produto indisponível')
    etapa[0] = 'Etapa 11'
    # erro do fornecedor numa operação qualquer vira ocorrência com o modelo do caminho
    sim.cenario['opcoes'] = {'falhar': (404, 'LOJA_INDISPONIVEL', 'Esta loja não está disponível. Fale com o seu fornecedor.', 'fornecedor')}
    n.ir('Catálogo'); pg.wait_for_selector('.cartao-produto[data-id="110"] .cp-add'); pg.locator('.cartao-produto[data-id="110"] .cp-add').click()
    n.ir('Carrinho'); pg.wait_for_selector('#g360Carrinho .g360-msg')
    checar('Esta loja não está disponível.' in n.texto() and 'Precisa de ajuste da Souza Ribeiro' in n.texto(), 'erro do fornecedor sem mensagem/rótulo')
    pg.wait_for_timeout(600)
    checar(any(o['codigo'] == 'LOJA_INDISPONIVEL' and o['operacao'] == 'GET opcoes' for o in sim.ocorrencias), 'erro do fornecedor não virou ocorrência')
    sim.cenario.pop('opcoes')
    checar(n.segredos_ok([S1]), 'token/senha em storage ou console')
    n.fechar()

    # outro comprador não vê a lista nem os pedidos do primeiro
    etapa[0] = 'Etapa 9'
    sim.vinculo_segundos = 5  # vínculo curto: antes de cada leitura a ponte é chamada de novo
    n = Navegador(pw, sim)
    n.entrar(U2, S2); n.pg.wait_for_url('**/catalogo')
    n.ir('Minha Lista'); n.pg.wait_for_selector('#g360MinhaLista .estado-tela.vazia')
    checar(1165 not in [c for c in sim.lista if 101 in sim.lista.get(1919, set())], 'x')
    antes = len([c for c in sim.chamadas if c[0] == 'PONTE'])
    sim.lista.setdefault(1919, set()).add(108)
    n.ir('Catálogo'); n.pg.wait_for_selector('.cartao-produto')
    n.ir('Minha Lista'); n.pg.wait_for_selector('#g360MinhaLista .cartao-produto[data-id="108"]')
    checar(len([c for c in sim.chamadas if c[0] == 'PONTE']) >= antes + 1, 'vínculo vencido não foi reaberto pela ponte')
    checar(n.pg.locator('#g360MinhaLista .cartao-produto[data-id="101"]').count() == 0, 'comprador 2 viu item da lista do comprador 1')
    sim.vinculo_segundos = 300
    n.ir('Meus pedidos'); n.pg.wait_for_selector('#g360ListaPedidos .estado-tela.vazia')
    checar('ainda não tem pedidos' in n.texto(), 'outro comprador viu pedidos do primeiro')
    n.fechar()

    # comprador bloqueado: envio desligado
    etapa[0] = 'Etapa 8'
    n = Navegador(pw, sim)
    n.entrar(UB, SB); n.pg.wait_for_url('**/catalogo'); n.pg.wait_for_selector('.cartao-produto[data-id="110"] .cp-add')
    n.pg.locator('.cartao-produto[data-id="110"] .cp-add').click()
    n.ir('Carrinho'); n.pg.wait_for_selector('#g360Revisar'); n.pg.check('input[name="modalidade"][value="retirada"]'); n.pg.click('#g360Revisar'); n.pg.wait_for_selector('.resumo')
    checar(n.pg.locator('#g360Enviar').is_disabled() and 'bloqueado para compras' in n.texto('.resumo'), 'comprador bloqueado com envio ligado')
    n.fechar()

    # ================= ETAPA 10 + leitura das ocorrências =================
    etapa[0] = 'Etapa 10'
    n = Navegador(pw, sim, '/painel')
    pg = n.pg
    pg.wait_for_selector('#pLogin')
    pg.fill('#pUsuario', 'operador'); pg.fill('#pSenha', 'errada'); pg.click('#pLogin button')
    pg.wait_for_selector('#pResultado .g360-msg'); checar('Usuário ou senha inválidos.' in n.texto('#pResultado'), 'login de operador errado sem mensagem')
    pg.fill('#pUsuario', 'semlicenca'); pg.fill('#pSenha', 'x'); pg.click('#pLogin button')
    pg.wait_for_selector('text=Confira a disponibilidade da sua licença no G360.')
    checar(not sim.ocorrencias or all(o['codigo'] != 'LICENCA_OPERADOR_INDISPONIVEL' for o in sim.ocorrencias), 'painel gravou ocorrência sem sessão do comprador')
    pg.fill('#pUsuario', 'operador'); pg.fill('#pSenha', 'senha1'); pg.click('#pLogin button')
    pg.wait_for_selector('#pFormCliente')
    pg.fill('#pCnpj', '99.999.999/0001-99'); pg.click('#pFormCliente button'); pg.wait_for_selector('text=Cliente não localizado.')
    pg.fill('#pCnpj', '11.111.111/0001-11'); pg.click('#pFormCliente button'); pg.wait_for_selector('text=Liberado')
    pg.fill('#pBuscaPreco', 'P-101'); pg.click('#pFormPrecos button'); pg.wait_for_selector('#pTabelaPrecos table')
    t = n.texto('#pTabelaPrecos')
    checar('R$ 5,1234' in t and '45,50%' in t and 'R$ 9,90' in t, f'preço/custo/margem/congelado ausentes: {t[:200]}')
    pg.click('[data-negociar="101"]'); pg.fill('#cValor', '9,75'); pg.click('#pCongelados form button[type="submit"]')
    pg.wait_for_selector('#pListaCongelados table')
    inc = [c for c in sim.chamadas if c[0] == 'POST' and 'precos-congelados' in c[1]][-1][3]
    checar(inc['valor'] == '9.75' and inc['produto'] == 101 and inc['unidade_id'] is None, f'corpo do preço congelado: {inc}')
    b = pg.locator('[data-encerrar]').first; b.click(); checar('Confirmar' in b.inner_text(), 'encerrar sem confirmação'); b.click()
    pg.wait_for_selector('text=Encerrado')
    n.sem_rolagem('painel clientes')
    pg.screenshot(path=f'{OUT}/etapa10_painel_390.png', full_page=True)
    pg.click('[data-aba="produtos"]'); pg.fill('#pBuscaProd', 'P-104'); pg.click('#pFormProd button'); pg.wait_for_selector('[data-fotos="104"]')
    pg.click('[data-fotos="104"]'); pg.wait_for_selector('.fotos-galeria img')
    checar('2 de 12 fotos' in n.texto('#pGaleria'), 'galeria sem contagem')
    pg.click('[data-capa="2"]'); pg.wait_for_function("document.querySelector('.fotos-galeria li')?.dataset.item === '2'")
    r = pg.locator('[data-remover="1"]'); r.click(); r.click(); pg.wait_for_selector('text=1 de 12 fotos')
    # 401 no painel encerra só o painel
    sim.op_tokens.clear()
    pg.click('[data-aba="clientes"]')  # recarrega os preços congelados do cliente: a API responde 401
    pg.wait_for_selector('#pLogin')
    checar('Sua sessão terminou.' in n.texto('#g360Entrada'), '401 do painel sem mensagem')
    pg.fill('#pUsuario', 'vendedor'); pg.fill('#pSenha', 'senha2'); pg.click('#pLogin button'); pg.wait_for_selector('#pFormCliente')
    pg.click('[data-aba="produtos"]'); pg.fill('#pBuscaProd', 'P-104'); pg.click('#pFormProd button'); pg.wait_for_selector('[data-fotos="104"]')
    checar('sem acesso' in n.texto('#pProdutos') and 'R$ 5,1234' not in n.texto('#pProdutos'), 'custo visível para operador sem acesso')
    etapa[0] = 'Etapa 11'
    pg.click('[data-aba="ocorrencias"]'); pg.wait_for_selector('#oLogin')
    pg.fill('#oEmail', 'painel@example.invalid'); pg.fill('#oSenha', 'errada'); pg.click('#oLogin button'); pg.wait_for_selector('text=E-mail ou senha incorretos')
    pg.fill('#oEmail', 'painel@example.invalid'); pg.fill('#oSenha', 'SenhaPainel1'); pg.click('#oLogin button'); pg.wait_for_selector('#pOcorr table')
    t = n.texto('#pOcorr')
    checar('FRETE_A_COMBINAR' in t and 'POST revisoes' in t and 'LOJA_INDISPONIVEL' in t and 'GET opcoes' in t, 'painel não mostrou as ocorrências')
    pg.screenshot(path=f'{OUT}/etapa11_ocorrencias_390.png', full_page=True)
    n.sem_rolagem('ocorrências')
    n.fechar()

print('FALHAS:' if falhas else 'Etapas 5 a 11: todos os testes passaram.')
for f in falhas: print(' -', f)
