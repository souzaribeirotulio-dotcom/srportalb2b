"""Etapa 1 do programa Executivo de Contas: aba Executivos no painel (cadastro, link, regras, permissão).
Roda contra http://localhost:5173 (npm run build && npm run preview), com o simulador (dados fictícios)."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from simulador import Sim, BASE
CHROME = os.environ.get('CHROME') or None
falhas = []
def checar(c, m):
    if not c: falhas.append(m)

def painel(pw, sim, largura=1280):
    br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    ctx = br.new_context(viewport={'width': largura, 'height': 900}, permissions=['clipboard-read', 'clipboard-write'])
    pg = ctx.new_page(); erros = []; console = []
    pg.on('pageerror', lambda e: erros.append(str(e))); pg.on('console', lambda m: console.append(m.text))
    pg.route('**/*', sim.rota); pg.goto(BASE + '/painel'); pg.wait_for_selector('#aUsu')
    pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk'); pg.wait_for_selector('#vAdm [data-at="cli"].on')
    pg.wait_for_timeout(600)
    return br, pg, erros, console

with sync_playwright() as pw:
    # 1) Sem a permissão: a aba não aparece
    sim = Sim(); sim.exec_pode = False
    br, pg, erros, _ = painel(pw, sim)
    checar(not pg.locator('#vAdm [data-at="exe"]').is_visible(), 'aba Executivos visível sem a permissão')
    br.close()

    # 2) Com a permissão: cadastra, valida, copia link, regras, desativa
    sim = Sim()
    br, pg, erros, console = painel(pw, sim)
    checar(pg.locator('#vAdm [data-at="exe"]').is_visible(), 'aba Executivos não aparece para quem tem a permissão')
    pg.click('#vAdm [data-at="exe"]'); pg.wait_for_selector('#exNovo')
    checar('Nenhum executivo ainda' in pg.inner_text('#exePanel'), 'estado vazio da lista')
    pg.click('#exNovo'); pg.wait_for_selector('#exForm')
    pg.wait_for_selector('#exVend option[value="3"]', state='attached')
    # teste que tem de dar erro: sem senha
    pg.fill('#exNome', 'Executivo Fictício'); pg.fill('#exCod', 'joao 1'); pg.fill('#exDoc', '123.456.789-09')
    pg.fill('#exWa', '(34) 99999-0000'); pg.fill('#exMail', 'joao@example.invalid')
    checar(pg.input_value('#exCod') == 'JOAO1', 'código não foi para maiúsculas sem espaço')
    checar('?ex=JOAO1' in pg.inner_text('#exLinkPrev'), 'prévia do link')
    pg.click('#exSalva'); pg.wait_for_selector('#exMsg.err')
    checar('senha' in pg.inner_text('#exMsg').lower(), 'salvou sem senha (teste que tem de dar erro)')
    pg.fill('#exCod', 'JOAO'); pg.fill('#exSenha', 'SenhaFicticia1'); pg.select_option('#exVend', '3'); pg.fill('#exPct', '4,5')
    # produtos escondidos: pesquisar, "Selecionar todos da pesquisa", tirar um
    pg.fill('#ocQ', 'x'); pg.click('#ocBuscar'); pg.wait_for_timeout(200)
    checar('2 letras' in pg.inner_text('#ocRes'), 'pesquisa curta deveria pedir 2 letras (teste que tem de dar erro)')
    pg.fill('#ocQ', 'Fictício 10'); pg.press('#ocQ', 'Enter'); pg.wait_for_selector('#ocTodos')
    esperados = sorted(p['codigo'] for p in sim.produtos if 'fictício 10' in p['nome'].lower())
    checar(f'({len(esperados)})' in pg.inner_text('#ocTodos'), f'botão selecionar todos: {pg.inner_text("#ocTodos")} esperado {len(esperados)}')
    pg.click('#ocTodos'); pg.wait_for_selector('.oc-chip')
    checar(pg.locator('.oc-chip').count() == len(esperados), f'chips: {pg.locator(".oc-chip").count()}')
    pg.locator('#exOcultos').screenshot(path='/tmp/vis/ocultos.png')
    pg.click(f'.oc-chip [data-tira="{esperados[0]}"]')
    checar(not pg.is_checked(f'input[data-c="{esperados[0]}"]'), 'tirar o chip não desmarcou na pesquisa')
    pg.click('#exSalva'); pg.wait_for_selector('.ex-linha')
    e = sim.executivos[0]
    checar(sorted(e.get('ocultar_codigos') or []) == esperados[1:], f"códigos escondidos gravados: {e.get('ocultar_codigos')} esperado {esperados[1:]}")
    checar(e['codigo'] == 'JOAO' and e['documento'] == '12345678909' and e['whatsapp'] == '34999990000' and e['vendedor_g360'] == 3 and e['vendedor_nome'] == 'Vendedor Exemplo' and e['percentual'] == 4.5, f'gravação do executivo: {e}')
    linha = pg.inner_text('.ex-linha')
    checar('JOAO' in linha and '4,5% (próprio)' in linha and '/?ex=JOAO' in linha and 'Vendedor Exemplo' in linha, f'linha do executivo: {linha}')
    pg.click('.ex-linha [data-copia]'); pg.wait_for_timeout(300)
    checar(pg.evaluate('navigator.clipboard.readText()').endswith('/?ex=JOAO'), 'copiar link')
    # código repetido
    pg.click('#exNovo'); pg.fill('#exNome', 'Outro'); pg.fill('#exCod', 'JOAO'); pg.fill('#exDoc', '11122233344'); pg.fill('#exMail', 'o@example.invalid'); pg.fill('#exSenha', 'SenhaFicticia2')
    pg.click('#exSalva'); pg.wait_for_selector('#exMsg.err')
    checar('já é de outro executivo' in pg.inner_text('#exMsg'), 'código repetido aceito')
    pg.click('#exCancela')
    # regras
    pg.click('#exVerCfg'); pg.wait_for_selector('#exCfg')
    checar(pg.input_value('#cfPct') == '3' and pg.input_value('#cfLib') == 'pagamento' and pg.input_value('#cfPrazo') == '12' and pg.is_checked('#cfNovos'), 'regras padrão')
    pg.fill('#cfPct', '3,5'); pg.select_option('#cfPrazo', ''); pg.click('#cfSalva'); pg.wait_for_selector('#exCfg', state='detached')
    checar(sim.exec_cfg['percentual'] == 3.5 and sim.exec_cfg['prazo_meses'] is None, f'regras gravadas: {sim.exec_cfg}')
    # desativar pede confirmação no botão
    pg.click('.ex-linha [data-liga]'); checar(sim.executivos[0]['ativo'], 'desativou sem confirmar')
    pg.click('.ex-linha [data-liga]'); pg.wait_for_selector('.ex-linha.off')
    checar(not sim.executivos[0]['ativo'], 'não desativou')
    # segurança: senha nunca no console/armazenamento
    arm = pg.evaluate('JSON.stringify(localStorage)+JSON.stringify(sessionStorage)')
    checar('SenhaFicticia' not in arm and not any('SenhaFicticia' in c for c in console), 'senha do executivo vazou')
    for w in (360, 390, 768, 1280, 1920):
        pg.set_viewport_size({'width': w, 'height': 900}); pg.wait_for_timeout(120)
        # A aba em si não pode passar da tela (o painel tem uma gaveta antiga que já passa em 768 px, fora desta etapa).
        checar(pg.evaluate("[...document.querySelectorAll('#exePanel *')].every(e => e.getBoundingClientRect().right <= innerWidth + 1)"), f'aba Executivos passa da tela em {w}px')
        if w == 390: pg.screenshot(path='/tmp/vis/exec390.png', full_page=True)
        if w == 1280: pg.screenshot(path='/tmp/vis/exec1280.png')
    checar(not erros, f'erros de script: {erros}')
    br.close()

print('FALHAS:' if falhas else 'Executivos (etapa 1): todos os testes passaram.')
for f in falhas: print(' -', f)
