"""Árvore do catálogo: departamento → seção (portal e painel).
Roda contra http://localhost:5173 (npm run build && npm run preview), com o simulador (dados fictícios)."""
import os, sys, uuid
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from simulador import Sim, BASE
CHROME = os.environ.get('CHROME') or None
falhas = []
def checar(c, m):
    if not c: falhas.append(m)

def ir_dep(pg, nome):
    """Abre um departamento pelo menu ☰ Departamentos (a barra agora só tem o menu e os atalhos de seção)."""
    pg.click('#cats [data-deps]'); pg.wait_for_selector('#mDeps .dm-item')
    pg.click('#mDeps button[data-dep]:has-text("%s")' % nome); pg.wait_for_timeout(300)
    # no computador, o departamento já aberto vai direto no clique; nos outros casos, "Ver tudo em ..."
    if pg.locator('#mDeps').count(): pg.click('#mDeps .dm-secs .dm-tudo')
    pg.wait_for_function("document.getElementById('depTit')?.textContent === %r" % nome)

sim = Sim()
nomes = {'P-120': 'Saco para Lixo Fictício 100L Preto', 'P-121': 'Saco para Lixo Fictício 100L Branco Infectante', 'P-122': 'Saco p Lixo Fictício 60L Preto',
         'P-123': 'Pano Multiuso Fictício Azul', 'P-124': 'Detergente Fictício Neutro 500ml', 'P-125': 'Vassoura Fictícia Pelo', 'P-126': 'Esponja Fictícia Dupla Face'}
for c, n in nomes.items(): sim.exibicao[c] = {'codigo': c, 'produto_id': int(c[2:]), 'nome': n, 'categoria': 'Limpeza', 'origem': 'equipe'}
sid = str(uuid.uuid4())
sim.secoes = [{'id': sid, 'categoria': 'Limpeza', 'pai': None, 'nome': 'Sacos de lixo', 'termos': ['saco lixo', 'saco p lixo'], 'ordem': 0},
              {'id': str(uuid.uuid4()), 'categoria': 'Limpeza', 'pai': None, 'nome': 'Panos e flanelas', 'termos': ['pano', 'flanela'], 'ordem': 1},
              {'id': str(uuid.uuid4()), 'categoria': 'Limpeza', 'pai': None, 'nome': 'Vazia', 'termos': ['naoexiste'], 'ordem': 2}]
quem = '11.111.111/0001-11'

def secao(pg, largura, sid):
    if largura >= 1000: pg.click('#depLado [data-sec="%s"]' % sid)
    else: pg.click('#depFiltrar'); pg.wait_for_selector('#mSecs'); pg.click('#mSecs [data-sec="%s"]' % sid)

def cards(pg): return sorted(pg.eval_on_selector_all('#grid .card', 'cs => cs.map(c => c.innerText)'))

with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    for largura in (390, 1280, 768):
        ctx = br.new_context(viewport={'width': largura, 'height': 900}); pg = ctx.new_page(); erros = []
        pg.on('pageerror', lambda e: erros.append(str(e))); pg.route('**/*', sim.rota)
        pg.goto(BASE + '/'); pg.wait_for_selector('#grid .card')
        pg.eval_on_selector('#tbConta', 'b => b.click()'); pg.wait_for_selector('#lgC'); pg.fill('#lgC', quem); pg.fill('#lgS', sim.compradores[quem]['senha']); pg.click('#lgOk')
        pg.wait_for_selector('body.logged #grid .card'); pg.wait_for_timeout(800)
        # departamento → faixa de seções (sem a seção vazia)
        # barra: só ☰ Departamentos (sem atalhos nem cartões de destaque)
        pg.wait_for_selector('#cats .chip.deps')
        checar(pg.locator('#cats .chip').count() == 1 and pg.locator('#destaques, .dest-card').count() == 0, 'barra com mais que o Departamentos')
        ir_dep(pg, 'Limpeza')
        if largura < 1000: pg.click('#depFiltrar'); pg.wait_for_selector('#mSecs')
        sub = ' '.join(pg.inner_text('#mSecs' if largura < 1000 else '#depLado').split())
        if largura < 1000: pg.keyboard.press('Escape')
        checar('Sacos de lixo 4' in sub and 'Panos e flanelas 1' in sub and 'Vazia' not in sub, f'seções: {sub}')
        # ordem por tipo: seção → item da seção → nome (sacos 100L juntos, depois 60L; pano; o resto por nome)
        pg.wait_for_timeout(800)
        em_ordem = ' '.join(pg.eval_on_selector_all('#grid .card', 'cs => cs.map(c => c.innerText)')).replace('\n', ' ')
        pos = [em_ordem.find(x) for x in ('100L Branco', '100L Preto', '60L Preto', 'Pano Multiuso', 'Detergente', 'Esponja', 'Vassoura')]
        checar(-1 not in pos and pos == sorted(pos), f'ordem por tipo: {pos}')
        secao(pg, largura, sid); pg.wait_for_timeout(1200)
        checar(pg.inner_text('#depTit') == 'Sacos de lixo', f"título: {pg.inner_text('#depTit')}")
        checar(pg.get_attribute('#depCab .dep-ic', 'data-desenho') == 'lixo' and pg.locator('#depCab .dep-ic svg').count() == 1, 'desenho da seção')
        g = ' '.join(' '.join(cards(pg)).split())
        checar('Preto' in g and 'Infectante' in g and 'Pano' not in g and 'Detergente' not in g, f'cards da seção: {g[:300]}')
        checar('limpeza › sacos de lixo' in pg.inner_text('#cnt').lower(), f"caminho: {pg.inner_text('#cnt')}")
        # busca dentro da seção: só o que está nela
        pass
        pg.fill('#q', 'fictício'); pg.keyboard.press('Enter'); pg.wait_for_timeout(1800)
        g = ' '.join(' '.join(cards(pg)).split())
        checar('Saco' in g and 'Pano' not in g, f'busca na seção: {g[:300]}')
        pg.fill('#q', ''); pg.keyboard.press('Enter'); pg.wait_for_timeout(600)
        # endereço da seção e trilha
        checar(pg.evaluate('location.pathname') == '/limpeza/sacos-de-lixo', f"endereço: {pg.evaluate('location.pathname')}")
        checar('Início › Limpeza › Sacos de lixo' in ' '.join(pg.inner_text('.dep-trilha').split()), f"trilha: {pg.inner_text('.dep-trilha')}")
        # menu Departamentos
        pg.click('#cats [data-deps]'); pg.wait_for_selector('#mDeps .dm-item')
        checar(pg.locator('#mDeps').get_attribute('role') == 'dialog', 'menu sem role dialog')
        pg.keyboard.press('Escape'); checar(pg.locator('#mDeps').count() == 0, 'Esc não fechou o menu')
        pg.click('#cats [data-deps]'); pg.wait_for_selector('#mDeps .dm-item')
        if largura < 900:
            pg.click('#mDeps button[data-dep]:has-text("Limpeza")'); pg.wait_for_selector('#mDeps .dm-voltar')
            checar('Ver tudo em Limpeza' in pg.inner_text('#mDeps'), 'celular: Ver tudo em')
            pg.screenshot(path=f'/tmp/vis/deps{largura}.png')
        else:
            pg.hover('#mDeps button[data-dep]:has-text("Limpeza")'); pg.wait_for_selector('#mDeps .dm-secs')
            pg.hover('#mDeps button[data-sec]:has-text("Sacos de lixo")'); pg.wait_for_timeout(300)
            checar(pg.locator('#mDeps .dm-lins').count() == 0, 'menu com terceira coluna')
            pg.screenshot(path=f'/tmp/vis/deps{largura}.png')
        pg.click('#mDeps button[data-sec]:has-text("Panos e flanelas")'); pg.wait_for_timeout(1200)
        g = ' '.join(' '.join(cards(pg)).split())
        checar('Pano' in g and 'Saco' not in g and pg.locator('#mDeps').count() == 0, f'menu → seção: {g[:200]}')
        checar(pg.evaluate('location.pathname') == '/limpeza/panos-e-flanelas', f"endereço menu: {pg.evaluate('location.pathname')}")
        # Voltar do navegador volta para a seção anterior; link direto abre a seção
        pg.go_back(); pg.wait_for_timeout(1500)
        g = ' '.join(' '.join(cards(pg)).split())
        checar('Saco' in g and 'Pano' not in g, f'voltar do navegador: {g[:200]}')
        pg.goto(BASE + '/limpeza/sacos-de-lixo'); pg.wait_for_selector('#grid .card'); pg.wait_for_timeout(1500)
        g = ' '.join(' '.join(cards(pg)).split())
        checar('Preto' in g and 'Pano' not in g, f'link direto da seção: {g[:200]}')
        # teste que tem de dar erro: endereço que não existe volta ao início
        pg.goto(BASE + '/limpeza/sacos-de-lixo/preto'); pg.wait_for_selector('#grid .card'); pg.wait_for_timeout(800)
        checar(pg.evaluate('location.pathname') == '/', f"terceiro nível no endereço: {pg.evaluate('location.pathname')}")
        pg.goto(BASE + '/nao-existe-isso'); pg.wait_for_selector('#grid .card'); pg.wait_for_timeout(800)
        checar(pg.evaluate('location.pathname') == '/', f"endereço inválido: {pg.evaluate('location.pathname')}")
        pg.goto(BASE + '/limpeza/panos-e-flanelas'); pg.wait_for_selector('#grid .card'); pg.wait_for_timeout(1500)
        pg.screenshot(path=f'/tmp/vis/arvore{largura}.png')
        checar(pg.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'rolagem horizontal em {largura}')
        checar(not erros, f'erros ({largura}): {erros}')
        ctx.close()
    # visitante: mesma árvore pela vitrine
    ctx = br.new_context(viewport={'width': 390, 'height': 900}); pg = ctx.new_page(); erros = []
    pg.on('pageerror', lambda e: erros.append(str(e))); pg.route('**/*', sim.rota)
    pg.goto(BASE + '/'); pg.wait_for_selector('#grid .card')
    ir_dep(pg, 'Limpeza')
    secao(pg, 390, sid); pg.wait_for_timeout(1500)
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
    checar([x['nome'] for x in novas] == ['Sacos de lixo', 'Panos e flanelas', 'Vazia', 'Detergentes'] and not [x for x in sim.secoes if x['pai']], f'gravado: {[x["nome"] for x in novas]}')
    pg.locator('#cfSecoes').screenshot(path='/tmp/vis/editor_secoes.png')
    # aba Produtos: departamento e seção escolhidos na própria linha do produto
    pg.click('[data-at="prod"]'); pg.fill('#aQ', 'P-125'); pg.press('#aQ', 'Enter'); pg.wait_for_selector('.arow[data-id="125"] .psec')
    op = pg.locator('.arow[data-id="125"] .psec option').first.inner_text()
    checar(op == 'Sem seção (automática)', f'opção automática: {op}')
    checar(pg.locator('.arow[data-id="125"] .psec option').count() == 5, 'seções do departamento na caixinha')
    pg.select_option('.arow[data-id="125"] .psec', 'Panos e flanelas'); pg.wait_for_timeout(800)
    checar(sim.exibicao['P-125'].get('secao') == 'Panos e flanelas', f"seção gravada: {sim.exibicao['P-125']}")
    checar(not erros, f'erros painel: {erros}')
    # o catálogo respeita a seção escolhida: a vassoura aparece em Panos e flanelas
    vis = br.new_context(viewport={'width': 1280, 'height': 900}); vp = vis.new_page(); vp.route('**/*', sim.rota)
    vp.goto(BASE + '/limpeza/panos-e-flanelas'); vp.wait_for_selector('#grid .card'); vp.wait_for_timeout(800)
    g = ' '.join(' '.join(cards(vp)).split())
    checar('Vassoura' in g and 'Pano' in g, f'seção escolhida no catálogo: {g[:200]}')
    vis.close()
    # o que tem de dar errado: trocar o departamento não pode levar a seção junto (volta para a automática)
    pg.select_option('.arow[data-id="125"] .pcat', 'Descartáveis'); pg.wait_for_timeout(800)
    checar(sim.exibicao['P-125'].get('secao') is None and sim.exibicao['P-125'].get('categoria') == 'Descartáveis', f"trocar departamento: {sim.exibicao['P-125']}")
    checar(pg.locator('.arow[data-id="125"] .psec').input_value() == '', 'caixinha da seção não voltou para automática')
    checar(not erros, f'erros painel: {erros}')
    br.close()

print('FALHAS:' if falhas else 'Árvore do catálogo: todos os testes passaram.')
for f in falhas: print(' -', f)
