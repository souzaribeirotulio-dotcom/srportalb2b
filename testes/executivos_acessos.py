"""Área do executivo: acesso dos clientes ao portal e "Reenviar link de acesso".
Roda contra http://localhost:5173 (npm run build && npm run preview), com o simulador (dados fictícios)."""
import os, sys, uuid, json
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from simulador import Sim, BASE
CHROME = os.environ.get('CHROME') or None
falhas = []
def checar(c, m):
    if not c: falhas.append(m)

def montar():
    sim = Sim()
    exe = lambda cod, nome: {'id': str(uuid.uuid4()), 'codigo': cod, 'nome': nome, 'documento': '12345678909', 'email': f'{cod.lower()}@example.invalid', 'percentual': None,
                             'ativo': True, 'vendedor_g360': None, 'ocultar_termos': [], 'ocultar_codigos': []}
    joao, maria = exe('JOAO', 'João Fictício'), exe('MARIA', 'Maria Fictícia')
    sim.executivos = [joao, maria]; sim.exec_senhas = {joao['id']: 'SenhaJoao123', maria['id']: 'SenhaMaria123'}
    v = lambda e, nome, sit, cod, doc: {'id': str(uuid.uuid4()), 'executivo_id': e['id'], 'cadastro_id': None, 'documento': doc, 'razao_social': nome, 'situacao': sit,
                                        'motivo': None, 'inicio': '2026-11-01' if sit == 'ativo' else None, 'fim': None, 'cliente_codigo': cod, 'criado_em': '2026-11-01T10:00:00Z'}
    sim.vinculos = [v(joao, 'Padaria Fictícia', 'ativo', 1165, '11111111000111'), v(joao, 'Oficina Fictícia', 'ativo', 2020, '22222222000122'),
                    v(joao, 'Mercadinho Fictício', 'aguardando', None, '33333333000133'), v(maria, 'Cliente da Maria Fictício', 'ativo', 1919, '44444444000144')]
    sim.acessos_portal = {1165: {'primeiro_em': '2026-11-10T12:00:00Z', 'ultimo_em': '2026-11-24T17:30:00Z', 'acessos': 7}}
    sim.comissoes = []
    return sim, joao, maria

with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    for largura in (360, 1280):
        sim, joao, maria = montar()
        ctx = br.new_context(viewport={'width': largura, 'height': 900})
        pg = ctx.new_page(); erros = []; console = []
        pg.on('pageerror', lambda e: erros.append(str(e))); pg.on('console', lambda m: console.append(m.text))
        pg.route('**/*', sim.rota)
        pg.goto(BASE + '/executivo'); pg.wait_for_selector('#exLogin')
        pg.fill('#exEmail', 'joao@example.invalid'); pg.fill('#exSenha', 'SenhaJoao123'); pg.click('#exEntrar')
        pg.wait_for_selector('.exa-cli')
        linhas = {pg.locator('.exa-cli .exa-c2').nth(i).inner_text().split('\n')[0]: ' '.join(pg.locator('.exa-cli .exa-c2').nth(i).inner_text().split()) for i in range(pg.locator('.exa-cli .exa-c2').count())}
        pad = next((t for k, t in linhas.items() if 'Padaria' in k), ''); ofi = next((t for k, t in linhas.items() if 'Oficina' in k), ''); mer = next((t for k, t in linhas.items() if 'Mercadinho' in k), '')
        tit = pg.get_attribute('.exa-cli .exa-c2:has-text("Padaria") .exa-c2-l2', 'title') or ''
        checar('Acessou ontem' in pad or 'Acessou há' in pad, f'{largura}: acesso da Padaria: {pad}')
        checar('7 acessos' in tit and '24/11/2026' in tit, f'{largura}: detalhe do acesso: {tit}')
        checar('Nunca acessou' in ofi and 'Reenviar link' in ofi, f'{largura}: Oficina sem acesso: {ofi}')
        checar('Reenviar' not in mer and 'acess' not in mer.lower(), f'{largura}: cliente aguardando aprovação com botão/acesso: {mer}')
        html = pg.content()
        checar(all(d not in html for d in ('11111111000111', '22222222000122', '44444444000144')), f'{largura}: documento de cliente apareceu na página')
        checar('Maria' not in pg.inner_text('#g360Conteudo'), f'{largura}: viu cliente de outro executivo')
        checar(pg.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'{largura}: rolagem horizontal')
        checar('1 de 2 aprovados já acessaram' in pg.inner_text('#g360Conteudo'), f'{largura}: resumo de acessos')
        h = pg.locator('.exa-cli .exa-c2:has-text("Oficina") .exa-btlink').bounding_box()
        checar(h and h['height'] >= 44, f'{largura}: botão menor que 44 px')
        # Reenviar link da Oficina
        pg.click('.exa-cli .exa-c2:has-text("Oficina") .exa-btlink')
        pg.wait_for_function("document.querySelector('.exa-cli .exa-c2:nth-child(2) .exa-ac-msg, .exa-ac-msg') && [...document.querySelectorAll('.exa-ac-msg')].some(m => m.textContent.includes('Pedido enviado'))")
        bt = pg.locator('.exa-cli .exa-c2:has-text("Oficina") .exa-btlink')
        checar(bt.is_disabled() and 'pedido' in bt.inner_text(), f'{largura}: botão depois do envio: {bt.inner_text()}')
        env = [c for c in sim.chamadas if c[0] == 'EXEC_LINK']
        ofi_id = sim.vinculos[1]['id']
        checar(len(env) == 1 and env[0][1] == ofi_id and env[0][2] == ['token', 'vinculo_id'], f'{largura}: chamada da função: {env}')
        checar(any(c[0] == 'PONTE' and c[1] == 'pedir_link' and c[3].get('documento') == '22222222000122' for c in sim.chamadas), f'{largura}: ponte não recebeu o documento certo')
        # Tem de dar erro: pedir de novo logo em seguida (limite) e pedir para cliente de outro executivo.
        tok = pg.evaluate("""() => { for (const k of Object.keys(localStorage).concat(Object.keys(sessionStorage))) { const v = localStorage.getItem(k) || sessionStorage.getItem(k); if (v && v.includes('access_token')) return JSON.parse(v).access_token; } return null; }""")
        checar(bool(tok), f'{largura}: não achei a sessão do executivo')
        fn = pg.evaluate("() => [...performance.getEntriesByType('resource')].map(e => e.name).find(n => n.includes('/functions/v1/executivo-link'))")
        checar(bool(fn), f'{largura}: não achei a chamada da função')
        r2 = pg.evaluate("""async ([u, t, id]) => { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t, vinculo_id: id }) }); return [r.status, (await r.json()).mensagem]; }""", [fn, tok, ofi_id])
        checar(r2[0] == 429 and 'acabou de ser enviado' in r2[1], f'{largura}: segundo pedido seguido: {r2}')
        r3 = pg.evaluate("""async ([u, t, id]) => { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t, vinculo_id: id }) }); return [r.status, (await r.json()).mensagem]; }""", [fn, tok, sim.vinculos[3]['id']])
        checar(r3[0] == 404, f'{largura}: link para cliente de outro executivo: {r3}')
        r4 = pg.evaluate("""async ([u, id]) => { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'x.y.z', vinculo_id: id }) }); return r.status; }""", [fn, ofi_id])
        checar(r4 == 401, f'{largura}: sem sessão válida: {r4}')
        checar(not erros, f'{largura}: erros na página: {erros}')
        checar(not any('22222222000122' in m or 'access_token' in m for m in console), f'{largura}: documento/token no console')
        if largura == 1280: pg.screenshot(path='/tmp/exec-acessos.png', full_page=True)
        ctx.close()
    br.close()

if falhas:
    print('FALHAS:'); [print(' -', f) for f in falhas]; sys.exit(1)
print('Acesso dos clientes na área do executivo: todos os testes passaram.')
