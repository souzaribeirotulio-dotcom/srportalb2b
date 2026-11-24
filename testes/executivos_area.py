"""Etapa 4 do programa Executivo de Contas: área do executivo (/executivo).
Roda contra http://localhost:5173 (npm run build && npm run preview), com o simulador (dados fictícios)."""
import os, sys, uuid
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from simulador import Sim, BASE, LOJA, hoje_br
import datetime
HOJE = hoje_br(); ANTES = (datetime.date.fromisoformat(HOJE) - datetime.timedelta(days=3)).isoformat()
CHROME = os.environ.get('CHROME') or None
falhas = []
def checar(c, m):
    if not c: falhas.append(m)

sim = Sim()
def exe(cod, nome):
    return {'id': str(uuid.uuid4()), 'codigo': cod, 'nome': nome, 'documento': '12345678909', 'email': f'{cod.lower()}@example.invalid', 'percentual': None, 'ativo': True,
            'vendedor_g360': None, 'ocultar_termos': [], 'ocultar_codigos': []}
joao, maria = exe('JOAO', 'João Fictício'), exe('MARIA', 'Maria Fictícia')
sim.executivos = [joao, maria]; sim.exec_senhas = {joao['id']: 'SenhaJoao123', maria['id']: 'SenhaMaria123'}
v = lambda e, nome, sit, cod=None: {'id': str(uuid.uuid4()), 'executivo_id': e['id'], 'cadastro_id': None, 'documento': '11111111000111', 'razao_social': nome, 'situacao': sit,
                                    'motivo': None, 'inicio': '2026-11-01' if sit == 'ativo' else None, 'fim': '2027-11-01' if sit == 'ativo' else None, 'cliente_codigo': cod, 'criado_em': '2026-11-01T10:00:00Z'}
sim.vinculos = [v(joao, 'Padaria Fictícia', 'ativo', 1165), v(joao, 'Mercadinho Fictício', 'aguardando'), v(maria, 'Cliente da Maria Fictício', 'ativo', 1919)]
c = lambda e, vid, ped, base, val, sit, dia=HOJE: {'id': str(uuid.uuid4()), 'executivo_id': e['id'], 'vinculo_id': vid, 'cliente_codigo': 1165, 'pedido_ref': f'P{ped}', 'pedido_numero': str(ped),
                                         'pedido_data': dia, 'pedido_em': dia + 'T17:32:00Z', 'competencia': dia[:8] + '01',
                                         'itens': [{'nome': 'Saco Fictício 100 L', 'quantidade': '2'}, {'nome': 'Papel Toalha Fictício', 'quantidade': '1.5'}], 'base': base, 'percentual': 3.0, 'valor': val, 'situacao': sit, 'paga_em': '2026-11-23' if sit == 'paga' else None}
sim.comissoes = [c(joao, sim.vinculos[0]['id'], 701, 100.0, 3.0, 'prevista'), c(joao, sim.vinculos[0]['id'], 702, 200.0, 6.0, 'paga', ANTES), c(maria, sim.vinculos[2]['id'], 703, 999.0, 29.97, 'liberada')]

with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    for largura in (360, 390, 768, 1280, 1920):
        ctx = br.new_context(viewport={'width': largura, 'height': 900}, permissions=['clipboard-read', 'clipboard-write'])
        pg = ctx.new_page(); erros = []; console = []
        pg.on('pageerror', lambda e: erros.append(str(e))); pg.on('console', lambda m: console.append(m.text))
        pg.route('**/*', sim.rota)
        pg.goto(BASE + '/'); pg.wait_for_selector('#grid .card')
        checar(pg.locator('footer .rodape-exec').count() == 1, 'link "Área do executivo" no rodapé')
        pg.goto(BASE + '/executivo'); pg.wait_for_selector('#exLogin')
        # teste que tem de dar erro: senha errada
        pg.fill('#exEmail', 'joao@example.invalid'); pg.fill('#exSenha', 'errada'); pg.click('#exEntrar')
        pg.wait_for_function("document.getElementById('exErro').textContent.includes('incorretos')")
        checar(pg.input_value('#exSenha') == '', 'senha errada continuou no campo')
        pg.fill('#exSenha', 'SenhaJoao123'); pg.click('#exEntrar'); pg.wait_for_selector('#exLink')
        t = ' '.join(pg.inner_text('#g360Conteudo').split())
        checar('Olá, João!' in t and 'JOAO' in t and '/?ex=JOAO' in t, f'topo e link: {t[:200]}')
        checar('Padaria Fictícia' in t and 'Mercadinho Fictício' in t and 'Aguardando aprovação' in t and 'Aprovado' in t, 'clientes indicados')
        checar('Prevista R$ 3,00' in t and 'Paga R$ 6,00' in t and 'Liberada R$ 0,00' in t, f'totais: {t}')
        checar('Maria' not in t and '29,97' not in t and 'Cliente da Maria' not in t, 'executivo viu dados de outro executivo')
        for proibido in ('custo', 'margem', 'Seu preço', 'Carrinho', 'Preço congelado'):
            checar(proibido.lower() not in t.lower(), f'área do executivo mostra "{proibido}"')
        zap = pg.get_attribute('#exZap', 'href')
        checar(zap.startswith('https://wa.me/?text=') and 'ex%3DJOAO' in zap, f'link do WhatsApp: {zap}')
        pg.click('#exCopiar'); pg.wait_for_timeout(200)
        checar(pg.evaluate('navigator.clipboard.readText()').endswith('/?ex=JOAO'), 'copiar link')
        # Suas vendas: abre em Hoje (há pedido hoje)
        checar(pg.get_attribute('.exa-per [data-p="hoje"]', 'aria-pressed') == 'true', 'período inicial Hoje')
        k = ' '.join(pg.inner_text('.exa-kpis').split())
        checar('Vendido R$ 100,00' in k and 'Pedidos 1' in k and 'Clientes que compraram 1' in k and 'Sua comissão R$ 3,00' in k, f'números de hoje: {k}')
        checar(pg.locator('.exa-pedido').count() == 1 and '14:32' in pg.inner_text('.exa-pedido summary'), 'pedido de hoje com a hora (Brasília)')
        pg.click('.exa-per [data-p="7d"]'); pg.wait_for_timeout(100)
        k = ' '.join(pg.inner_text('.exa-kpis').split())
        checar('Vendido R$ 300,00' in k and 'Pedidos 2' in k and 'Sua comissão R$ 9,00' in k, f'números de 7 dias: {k}')
        pg.click('.exa-pedido summary >> nth=0'); pg.wait_for_timeout(100)
        it = ' '.join(pg.inner_text('.exa-pedido[open] .exa-itens').split())
        checar('Saco Fictício 100 L' in it and '1,5' in it, f'produtos do pedido: {it}')
        pc = ' '.join(pg.inner_text('.exa-porcli').split())
        checar('Padaria Fictícia' in pc and 'R$ 300,00' in pc and '2 pedidos' in pc, f'por cliente: {pc}')
        checar('999' not in ' '.join(pg.inner_text('#exVendas').split()), 'vendas de outro executivo')
        checar(pg.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'rolagem horizontal em {largura}px')
        arm = pg.evaluate('JSON.stringify(localStorage)')
        checar('executivo-sessao' not in arm, 'sessão do executivo no localStorage (deveria ficar só na aba)')
        checar(not any('SenhaJoao' in x for x in console), 'senha no console')
        pg.screenshot(path=f'/tmp/vis/area{largura}.png', full_page=True)
        # F5 mantém a sessão na aba; Sair volta ao login
        pg.reload(); pg.wait_for_selector('#exLink')
        pg.click('#exSair'); pg.wait_for_selector('#exLogin')
        checar('saiu' in pg.inner_text('#g360Conteudo'), 'aviso ao sair')
        pg.wait_for_timeout(400)
        # executivo desativado não entra
        joao['ativo'] = False
        pg.fill('#exEmail', 'joao@example.invalid'); pg.fill('#exSenha', 'SenhaJoao123'); pg.click('#exEntrar'); pg.wait_for_selector('#exLogin')
        pg.wait_for_function("document.getElementById('g360Conteudo').innerText.includes('não está ativo')", timeout=8000)
        checar('não está ativo' in pg.inner_text('#g360Conteudo'), 'executivo desativado entrou')
        joao['ativo'] = True
        # o catálogo continua igual depois de passar pela área do executivo
        pg.goto(BASE + '/'); pg.wait_for_selector('#grid .card')
        checar(not erros, f'erros de script: {erros}')
        ctx.close()
    br.close()

print('FALHAS:' if falhas else 'Executivos (etapa 4): todos os testes passaram.')
for f in falhas: print(' -', f)
