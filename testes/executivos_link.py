"""Executivo de Contas: os dois links de indicação. ?ex=JOAO (completo) mostra todos os produtos ao visitante;
?ex=JOAO&oc=1 (sem os produtos escondidos) já esconde, antes do cadastro, o que os clientes do executivo não veem.
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
nomes = {'P-120': 'Saco para Lixo Fictício 100L Preto', 'P-121': 'Saco para Lixo Fictício 60L Azul', 'P-123': 'Pano Multiuso Fictício Azul', 'P-124': 'Detergente Fictício Neutro 500ml'}
for c, n in nomes.items(): sim.exibicao[c] = {'codigo': c, 'produto_id': int(c[2:]), 'nome': n, 'categoria': 'Limpeza', 'origem': 'equipe'}
sim.secoes = [{'id': str(uuid.uuid4()), 'categoria': 'Limpeza', 'pai': None, 'nome': 'Sacos de lixo', 'termos': ['saco lixo'], 'ordem': 0}]
sim.executivos = [{'id': str(uuid.uuid4()), 'codigo': 'JOAO', 'nome': 'Executivo Fictício', 'ocultar_termos': ['saco lixo'], 'ocultar_codigos': ['P-124'], 'ativo': True}]

def nomes_na_tela(pg):
    pg.wait_for_selector('#grid .card'); pg.wait_for_timeout(900)
    return ' '.join(' '.join(pg.eval_on_selector_all('#grid .card', 'cs => cs.map(c => c.innerText)')).split())

with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox']); erros = []
    for caminho, esconde in (('/limpeza?ex=JOAO&oc=1', True), ('/limpeza?ex=JOAO', False)):
        for w in (390, 1280):
            ctx = br.new_context(viewport={'width': w, 'height': 900}); pg = ctx.new_page()
            pg.on('pageerror', lambda e: erros.append(str(e))); pg.route('**/*', sim.rota)
            pg.goto(BASE + caminho)
            t = nomes_na_tela(pg)
            checar('Pano Multiuso' in t, f'{caminho} {w}: pano sumiu: {t[:200]}')
            if esconde:
                checar('Saco para Lixo' not in t and 'Detergente' not in t, f'{caminho} {w}: escondido aparecendo antes do cadastro: {t[:300]}')
                checar(pg.evaluate("location.search") == '', 'código ficou no endereço')
                # a seção que só tem escondidos some do menu Departamentos e da página do departamento
                lado = ' '.join((pg.inner_text('#depLado') if pg.is_visible('#depLado') else '').split())
                checar('Sacos de lixo' not in lado, f'{caminho} {w}: seção Sacos de lixo na página do departamento: {lado[:200]}')
                pg.click('[data-deps]'); pg.wait_for_selector('#mDeps'); pg.wait_for_timeout(400)
                if w < 900: pg.click('#mDeps .dm-item:has-text("Limpeza")'); pg.wait_for_timeout(300)
                menu = ' '.join(pg.inner_text('#mDeps').split())
                checar('Sacos de lixo' not in menu and 'Pano' not in menu[:0], f'{caminho} {w}: seção Sacos de lixo no menu: {menu[:300]}')
                pg.keyboard.press('Escape'); pg.evaluate("document.getElementById('mDeps')?.remove()")
                # busca também não mostra
                pg.fill('#q', 'saco lixo'); pg.press('#q', 'Enter'); pg.wait_for_timeout(1500)
                checar('Saco para Lixo' not in ' '.join(pg.inner_text('#grid').split()), 'busca mostrou o escondido')
            else:
                # o que tem de dar errado se o link completo esconder: os sacos têm de aparecer
                checar('Saco para Lixo' in t and 'Detergente' in t, f'{caminho} {w}: link completo escondendo: {t[:300]}')
                # caso que tem de dar o contrário: no link completo a seção aparece no menu
                pg.click('[data-deps]'); pg.wait_for_selector('#mDeps'); pg.wait_for_timeout(400)
                if w < 900: pg.click('#mDeps .dm-item:has-text("Limpeza")'); pg.wait_for_timeout(300)
                checar('Sacos de lixo' in ' '.join(pg.inner_text('#mDeps').split()), f'{caminho} {w}: link completo sem a seção no menu')
                pg.evaluate("document.getElementById('mDeps')?.remove()")
            ctx.close()
    # trocar de link no mesmo navegador: vale o último usado
    ctx = br.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page(); pg.route('**/*', sim.rota)
    pg.goto(BASE + '/limpeza?ex=JOAO&oc=1'); checar('Saco para Lixo' not in nomes_na_tela(pg), 'oc=1 não escondeu')
    pg.goto(BASE + '/limpeza?ex=JOAO'); checar('Saco para Lixo' in nomes_na_tela(pg), 'link completo depois do oc=1 continuou escondendo')
    ctx.close(); br.close()
    checar(not erros, f'erros: {erros}')

if falhas:
    print('FALHAS:'); [print(' -', f) for f in falhas]; sys.exit(1)
print('Links do executivo: todos os testes passaram.')
