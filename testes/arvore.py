"""Árvore do catálogo: departamento → seção → linha (portal e painel).
Roda contra http://localhost:5173 (npm run build && npm run preview), com o simulador (dados fictícios)."""
import os, sys, uuid
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from simulador import Sim, BASE
CHROME = os.environ.get('CHROME') or None
falhas = []
def checar(c, m):
    if not c: falhas.append(m)

sim = Sim()
nomes = {'P-120': 'Saco para Lixo Fictício 100L Preto', 'P-121': 'Saco para Lixo Fictício 100L Branco Infectante', 'P-122': 'Saco p Lixo Fictício 60L Preto',
         'P-123': 'Pano Multiuso Fictício Azul', 'P-124': 'Detergente Fictício Neutro 500ml', 'P-125': 'Vassoura Fictícia Pelo', 'P-126': 'Esponja Fictícia Dupla Face'}
for c, n in nomes.items(): sim.exibicao[c] = {'codigo': c, 'produto_id': int(c[2:]), 'nome': n, 'categoria': 'Limpeza', 'origem': 'equipe'}
sid = str(uuid.uuid4())
sim.secoes = [{'id': sid, 'categoria': 'Limpeza', 'pai': None, 'nome': 'Sacos de lixo', 'termos': ['saco lixo', 'saco p lixo'], 'ordem': 0},
              {'id': str(uuid.uuid4()), 'categoria': 'Limpeza', 'pai': sid, 'nome': 'Preto', 'termos': ['preto'], 'ordem': 0},
              {'id': str(uuid.uuid4()), 'categoria': 'Limpeza', 'pai': sid, 'nome': 'Branco infectante', 'termos': ['infectante'], 'ordem': 1},
              {'id': str(uuid.uuid4()), 'categoria': 'Limpeza', 'pai': None, 'nome': 'Panos e flanelas', 'termos': ['pano', 'flanela'], 'ordem': 1},
              {'id': str(uuid.uuid4()), 'categoria': 'Limpeza', 'pai': None, 'nome': 'Vazia', 'termos': ['naoexiste'], 'ordem': 2}]
quem = '11.111.111/0001-11'

def cards(pg): return sorted(pg.eval_on_selector_all('#grid .card', 'cs => cs.map(c => c.innerText)'))

with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    for largura in (390, 1280):
        ctx = br.new_context(viewport={'width': largura, 'height': 900}); pg = ctx.new_page(); erros = []
        pg.on('pageerror', lambda e: erros.append(str(e))); pg.route('**/*', sim.rota)
        pg.goto(BASE + '/'); pg.wait_for_selector('#grid .card')
        pg.eval_on_selector('#tbConta', 'b => b.click()'); pg.wait_for_selector('#lgC'); pg.fill('#lgC', quem); pg.fill('#lgS', sim.compradores[quem]['senha']); pg.click('#lgOk')
        pg.wait_for_selector('body.logged #grid .card'); pg.wait_for_timeout(800)
        # departamento → faixa de seções (sem a seção vazia)
        pg.click('#cats .chip[data-c="Limpeza"]'); pg.wait_for_selector('#subcats:not([hidden]) .sub-l1')
        sub = ' '.join(pg.inner_text('#subcats').split())
        checar('Sacos de lixo4' in sub.replace(' ', '') .replace('Sacosdelixo4','Sacos de lixo4') or 'Sacos de lixo 4' in sub and 'Panos e flanelas 1' in sub and 'Vazia' not in sub, f'seções: {sub}')
        pg.click('#subcats [data-s="%s"]' % sid); pg.wait_for_selector('.sub-l2'); pg.wait_for_timeout(1200)
        g = ' '.join(' '.join(cards(pg)).split())
        checar('Preto' in g and 'Infectante' in g and 'Pano' not in g and 'Detergente' not in g, f'cards da seção: {g[:300]}')
        checar('limpeza › sacos de lixo' in pg.inner_text('#cnt').lower(), f"caminho: {pg.inner_text('#cnt')}")
        linha_preto = [x['id'] for x in sim.secoes if x['nome'] == 'Preto'][0]
        pg.click('#subcats [data-s="%s"]' % linha_preto); pg.wait_for_timeout(1200)
        g = ' '.join(' '.join(cards(pg)).split())
        checar('100L Preto' in g and '60L Preto' in g and 'Infectante' not in g, f'cards da linha: {g[:300]}')
        checar('limpeza › sacos de lixo › preto' in pg.inner_text('#cnt').lower(), f"caminho linha: {pg.inner_text('#cnt')}")
        # busca dentro da seção: só o que está nela
        pg.click('#subcats [data-s="%s"]' % sid); pg.wait_for_timeout(600)
        pg.fill('#q', 'fictício'); pg.keyboard.press('Enter'); pg.wait_for_timeout(1800)
        g = ' '.join(' '.join(cards(pg)).split())
        checar('Saco' in g and 'Pano' not in g, f'busca na seção: {g[:300]}')
        pg.fill('#q', ''); pg.keyboard.press('Enter'); pg.wait_for_timeout(600)
        # menu Departamentos
        pg.click('#cats [data-deps]'); pg.wait_for_selector('#mDeps .deps-dep')
        checar(pg.locator('#mDeps').get_attribute('role') == 'dialog', 'menu sem role dialog')
        pg.screenshot(path=f'/tmp/vis/deps{largura}.png')
        pg.keyboard.press('Escape'); checar(pg.locator('#mDeps').count() == 0, 'Esc não fechou o menu')
        pg.click('#cats [data-deps]'); pg.wait_for_selector('#mDeps')
        if largura < 900: pg.click('#mDeps details:has(summary:has-text("Limpeza")) summary') if not pg.is_visible('#mDeps button[data-s]:has-text("Panos e flanelas")') else None
        pg.click('#mDeps button[data-s]:has-text("Panos e flanelas")'); pg.wait_for_timeout(1200)
        g = ' '.join(' '.join(cards(pg)).split())
        checar('Pano' in g and 'Saco' not in g and pg.locator('#mDeps').count() == 0, f'menu → seção: {g[:200]}')
        pg.screenshot(path=f'/tmp/vis/arvore{largura}.png')
        checar(pg.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'rolagem horizontal em {largura}')
        checar(not erros, f'erros ({largura}): {erros}')
        ctx.close()
    # visitante: mesma árvore pela vitrine
    ctx = br.new_context(viewport={'width': 390, 'height': 900}); pg = ctx.new_page(); erros = []
    pg.on('pageerror', lambda e: erros.append(str(e))); pg.route('**/*', sim.rota)
    pg.goto(BASE + '/'); pg.wait_for_selector('#grid .card')
    pg.click('#cats .chip[data-c="Limpeza"]'); pg.wait_for_selector('#subcats:not([hidden]) .sub-l1')
    pg.click('#subcats [data-s="%s"]' % sid); pg.wait_for_timeout(1500)
    g = ' '.join(' '.join(cards(pg)).split())
    checar('Saco' in g and 'Pano' not in g and 'Entre para ver' in pg.inner_text('#cnt') + g, f'visitante na seção: {g[:200]}')
    checar(not erros, f'erros visitante: {erros}')
    ctx.close()
    # painel: editor de seções
    ctx = br.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); erros = []
    pg.on('pageerror', lambda e: erros.append(str(e))); pg.route('**/*', sim.rota)
    pg.goto(BASE + '/painel'); pg.wait_for_selector('#aUsu')
    pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk'); pg.wait_for_timeout(1500)
    pg.eval_on_selector('#vAdm [data-at="cfg"]', 'b => b.click()'); pg.wait_for_selector('#cfSecoes .sx-sec')
    pg.select_option('#sxDep', 'Limpeza'); pg.wait_for_selector('#cfSecoes .sx-sec')
    t = ' '.join(pg.inner_text('#cfSecoes').split())
    checar('4 produtos' in t and 'Produtos sem seção neste departamento (' in t, f'editor: {t[:300]}')
    # teste que tem de dar erro: seção sem palavra
    pg.click('#sxAdd'); pg.fill('#cfSecoes .sx-sec:last-child .sx-nome', 'Detergentes'); pg.click('#sxSalvar')
    checar('pelo menos uma palavra' in pg.inner_text('#sxRes'), 'salvou seção sem palavra')
    pg.fill('#cfSecoes .sx-sec:last-child .sx-termos', 'detergente'); pg.wait_for_timeout(200)
    checar('1 produto' in pg.inner_text('#cfSecoes .sx-sec:last-child'), 'contagem ao vivo')
    pg.click('#sxSalvar'); pg.wait_for_timeout(1200)
    novas = [x for x in sim.secoes if x['categoria'] == 'Limpeza' and not x['pai']]
    checar([x['nome'] for x in novas] == ['Sacos de lixo', 'Panos e flanelas', 'Vazia', 'Detergentes'] and len([x for x in sim.secoes if x['pai']]) == 2, f'gravado: {[x["nome"] for x in novas]}')
    pg.locator('#cfSecoes').screenshot(path='/tmp/vis/editor_secoes.png')
    checar(not erros, f'erros painel: {erros}')
    br.close()

print('FALHAS:' if falhas else 'Árvore do catálogo: todos os testes passaram.')
for f in falhas: print(' -', f)
