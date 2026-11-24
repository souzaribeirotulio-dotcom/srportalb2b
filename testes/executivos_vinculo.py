"""Etapa 2 do programa Executivo de Contas: link ?ex=, código no cadastro, "Indicado por" na aprovação,
vínculo ativo/recusado e produtos escondidos para os clientes do executivo.
Roda contra http://localhost:5173 (npm run build && npm run preview), com o simulador (dados fictícios)."""
import os, sys, uuid
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from simulador import Sim, BASE, LOJA
CHROME = os.environ.get('CHROME') or None
falhas = []
def checar(c, m):
    if not c: falhas.append(m)

def executivo(sim, cod='JOAO', **k):
    e = {'id': str(uuid.uuid4()), 'codigo': cod, 'nome': f'Executivo Fictício {cod}', 'documento': '12345678909', 'whatsapp': None, 'email': f'{cod.lower()}@example.invalid',
         'percentual': None, 'vendedor_g360': 3, 'vendedor_nome': 'Vendedor Exemplo', 'ocultar_termos': ['saco lixo'], 'ocultar_codigos': [], 'ativo': True, 'tem_acesso': True,
         'clientes': {'ativos': 0, 'aguardando': 0}, 'criado_em': '2026-11-24T12:00:00Z'}
    e.update(k); sim.__dict__.setdefault('executivos', []).append(e); return e

def pagina(pw, sim, caminho='/', largura=390):
    br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    pg = br.new_page(viewport={'width': largura, 'height': 900}); erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.route('**/*', sim.rota)
    for h in ('publica.cnpj.ws', 'open.cnpja.com', 'brasilapi.com.br', 'viacep.com.br'):
        pg.route(f'**/{h}/**', lambda r: r.fulfill(status=404, headers={'Access-Control-Allow-Origin': '*'}, body='{}'))
    pg.goto(BASE + caminho)
    return br, pg, erros

def preencher(pg, doc):
    for i, v in [('kDoc', doc), ('kRazao', 'Empresa Indicada Fictícia LTDA'), ('kResp', 'Pessoa Fictícia'), ('kWhats', '(34) 99999-0000'),
                 ('kEmail', 'indicada@example.invalid'), ('kRua', 'Rua Exemplo'), ('kNum', '10'), ('kCidade', 'Cidade Exemplo'), ('kBairro', 'Centro')]:
        pg.fill('#' + i, v)
    pg.fill('#kCep', '38400000'); pg.select_option('#kSeg', 'Escritório')

with sync_playwright() as pw:
    sim = Sim(); ex = executivo(sim); outro = executivo(sim, 'MARIA', ocultar_termos=[])
    sim.produtos[0]['nome'] = 'Saco para Lixo Preto 100L Exemplo'      # P-101
    sim.produtos[1]['nome'] = 'Saco Plástico Transparente Exemplo'      # P-102: não é saco de lixo

    # 1) Link ?ex=: some do endereço, fica guardado e preenche o cadastro
    br, pg, erros = pagina(pw, sim, '/?ex=joao')
    pg.wait_for_selector('#grid .card')
    checar('ex=' not in pg.url, f'código ficou no endereço: {pg.url}')
    guard = pg.evaluate(f"localStorage.getItem('g360:{LOJA}:executivo')") or ''
    checar('"c":"JOAO"' in guard, f'código não guardado: {guard}')
    pg.click('#heroCadB'); pg.wait_for_selector('#mCad.open #kExec')
    checar(pg.input_value('#kExec') == 'JOAO', 'campo do executivo não veio preenchido')
    preencher(pg, '12.ABC.345/01DE-35'); pg.click('#kEnviar'); pg.wait_for_selector('#cadBox .ok')
    cad = sim.cadastros[-1]
    checar(cad.get('executivo_codigo') == 'JOAO', f'código não foi no cadastro: {cad}')
    checar(any(v['cadastro_id'] == cad['id'] and v['situacao'] == 'aguardando' and v['executivo_id'] == ex['id'] for v in sim.vinculos), 'vínculo aguardando não criado')
    # "Já é cliente": sem o campo
    pg.keyboard.press('Escape'); pg.evaluate("localStorage.removeItem('g360:96da1e99a3f327f0:cadastro-em-analise')")
    checar(not erros, f'erros de script (visitante): {erros}')
    br.close()

    # 2) Sem link: campo vazio e opcional (cadastro segue como hoje)
    br, pg, erros = pagina(pw, sim, '/'); pg.wait_for_selector('#grid .card')
    pg.click('#heroCadB'); pg.wait_for_selector('#mCad.open #kExec')
    checar(pg.input_value('#kExec') == '', 'campo do executivo preenchido sem link')
    preencher(pg, '98.765.432/0001-10'); pg.click('#kEnviar'); pg.wait_for_selector('#cadBox .ok')
    checar(sim.cadastros[-1].get('executivo_codigo') is None, 'cadastro sem código ganhou executivo')
    br.close()
    br, pg, erros = pagina(pw, sim, '/'); pg.wait_for_selector('#grid .card')
    pg.click('#heroAcesso'); pg.wait_for_selector('#mCad.open #kDoc')
    checar(not pg.locator('#kExec').is_visible(), '"Já é cliente" mostra o campo do executivo')
    br.close()

    # 3) Painel: "Indicado por", trocar/remover, aprovar como cliente novo (vendedor do executivo) → vínculo ativo
    sim.novo_com_vendedor = True
    cad['status'] = 'aprovado'; cad.update(inscricao_estadual='', telefone=None, complemento='', logradouro='Rua Nova', bairro='Centro', uf='MG', numero='10', cep='38400200', codigo_g360=None, criado_por='portal', criado_em='2026-11-24T10:00:00+00:00')
    br, pg, erros = pagina(pw, sim, '/painel', 1280)
    pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk'); pg.wait_for_selector('#vAdm [data-at="cli"].on')
    sel = f'#clCad .crow2[data-id="{cad["id"]}"]'
    pg.wait_for_selector(sel)
    linha = ' '.join(pg.inner_text(sel).split())
    checar('Indicado por: Executivo Fictício JOAO (JOAO)' in linha and 'Aguardando aprovação' in linha, f'"Indicado por" no pedido: {linha}')
    pg.click(f'{sel} [data-exec]'); pg.wait_for_selector('#mAdm.open #vxSel')
    pg.select_option('#vxSel', outro['id']); pg.click('#vxOk'); pg.wait_for_selector('#mAdm.open', state='detached') if False else pg.wait_for_timeout(600)
    checar('MARIA' in pg.inner_text(sel), 'trocar executivo do pedido')
    pg.click(f'{sel} [data-exec]'); pg.wait_for_selector('#mAdm.open #vxSel'); pg.select_option('#vxSel', ''); pg.click('#vxOk'); pg.wait_for_timeout(600)
    checar('Indicado por' not in pg.inner_text(sel), 'remover executivo do pedido')
    pg.click(f'{sel} [data-exec]'); pg.wait_for_selector('#mAdm.open #vxSel'); pg.select_option('#vxSel', ex['id']); pg.click('#vxOk'); pg.wait_for_timeout(600)
    pg.click(f'{sel} [data-novo]'); pg.wait_for_selector('#mAdm.open #nSalvar')
    checar(pg.input_value('#n_vendedor_id') == '3' and 'Vendedor do executivo' in pg.inner_text('#admBox'), 'vendedor do executivo sugerido no Novo cliente')
    pg.wait_for_function("document.getElementById('nCepM').textContent.includes('encontrado')")
    pg.fill('#nT1', '34 99999-0000'); pg.select_option('#n_categoria_id', '3'); pg.fill('#nIe', 'ISENTO'); pg.click('#nSalvar')
    pg.click('[data-ie="NAO CONTRIBUINTE"]'); pg.click('#nSalvar'); pg.wait_for_selector('#mAdm.open #gLib')
    corpo = sim.inclusoes[-1][1]
    checar(corpo.get('vendedor_id') == 3, f'cliente não nasceu com o vendedor do executivo: {corpo}')
    v = next(x for x in sim.vinculos if x['cadastro_id'] == cad['id'] and x['situacao'] != 'removido')
    checar(v['situacao'] == 'ativo' and v['cliente_codigo'] == cad['codigo_g360'] and v['inicio'] and v['fim'], f'vínculo não ativou: {v}')
    pg.click('#gX'); pg.wait_for_timeout(300)
    checar('Ativo' in pg.inner_text(sel), 'pedido aprovado mostra vínculo ativo')
    # 4) Reprovar um pedido indicado → recusado
    k2 = sim.cadastros[-2] if sim.cadastros[-2]['id'] != cad['id'] else sim.cadastros[-1]
    k2 = next(c for c in sim.cadastros if c.get('executivo_codigo') is None and c['documento'] == '98765432000110')
    sim.vinculos.append({'id': str(uuid.uuid4()), 'executivo_id': outro['id'], 'cadastro_id': k2['id'], 'documento': k2['documento'], 'razao_social': 'x', 'situacao': 'aguardando', 'motivo': None, 'inicio': None, 'fim': None, 'cliente_codigo': None, 'criado_em': 'x'})
    pg.reload(); pg.wait_for_selector('#aUsu, #vAdm [data-at="cli"].on')
    if pg.locator('#aUsu').is_visible(): pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk')
    pg.wait_for_selector(f'#clCad .crow2[data-id="{k2["id"]}"] [data-d="recusado"]')
    pg.click(f'#clCad .crow2[data-id="{k2["id"]}"] [data-d="recusado"]'); pg.wait_for_timeout(800)
    checar(sim.vinculos[-1]['situacao'] == 'recusado', f'reprovar não recusou o vínculo: {sim.vinculos[-1]}')
    # lista de clientes do executivo na aba
    pg.click('#vAdm [data-at="exe"]'); pg.wait_for_selector('.ex-linha')
    pg.click(f'.ex-linha[data-id="{ex["id"]}"] [data-clientes]'); pg.wait_for_selector(f'.ex-linha[data-id="{ex["id"]}"] .ex-cli-l')
    t = pg.inner_text(f'.ex-linha[data-id="{ex["id"]}"] .ex-cli')
    checar('Ativo' in t and 'até' in t, f'clientes do executivo: {t}')
    checar('saco lixo' in pg.inner_text(f'.ex-linha[data-id="{ex["id"]}"]'), 'ficha não mostra o que está escondido')
    checar(not erros, f'erros de script (painel): {erros}')
    br.close()

    # 5) Cliente do executivo logado: não vê saco de lixo; outro cliente vê
    cod_novo = cad['codigo_g360']
    doc_cli = '11.111.111/0001-11'
    v['cliente_codigo'] = sim.compradores[doc_cli]['codigo']        # o comprador fictício 1 passa a ser cliente do JOAO
    for quem, esconde in ((doc_cli, True), ('22.222.222/0001-22', False)):
        br, pg, erros = pagina(pw, sim, '/', 390); pg.wait_for_selector('#grid .card')
        pg.click('#tbConta'); pg.fill('#lgC', quem); pg.fill('#lgS', sim.compradores[quem]['senha']); pg.click('#lgOk')
        pg.wait_for_selector('body.logged #grid .card'); pg.wait_for_timeout(800)
        txt = pg.inner_text('#grid')
        if esconde: checar('Saco para Lixo' not in txt, f'{quem}: saco de lixo aparece no catálogo')
        pg.fill('#q', 'saco'); pg.keyboard.press('Enter'); pg.wait_for_timeout(1500)
        txt = pg.inner_text('#grid')
        checar(('Saco para Lixo' not in txt) == esconde, f'{quem}: saco de lixo na busca')
        if esconde: checar('Saco Plástico Transparente' in txt, f'busca escondeu demais: {txt[:200]}')
        checar(pg.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'rolagem horizontal no celular')
        checar(not erros, f'erros de script ({quem}): {erros}')
        br.close()

print('FALHAS:' if falhas else 'Executivos (etapa 2): todos os testes passaram.')
for f in falhas: print(' -', f)
