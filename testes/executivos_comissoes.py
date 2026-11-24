"""Etapa 3 do programa Executivo de Contas: comissão por pedido do portal e relatório do mês no painel.
Roda contra http://localhost:5173 (npm run build && npm run preview), com o simulador (dados fictícios)."""
import os, sys, uuid
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from simulador import Sim, BASE, LOJA
CHROME = os.environ.get('CHROME') or None
falhas = []
def checar(c, m):
    if not c: falhas.append(m)

sim = Sim()
ex = {'id': str(uuid.uuid4()), 'codigo': 'JOAO', 'nome': 'Executivo Fictício', 'documento': '12345678909', 'whatsapp': None, 'email': 'joao@example.invalid', 'percentual': None,
      'vendedor_g360': None, 'vendedor_nome': None, 'ocultar_termos': [], 'ocultar_codigos': [], 'ativo': True, 'tem_acesso': True, 'clientes': {'ativos': 1, 'aguardando': 0}, 'criado_em': 'x'}
sim.executivos = [ex]
sim.vinculos = [{'id': str(uuid.uuid4()), 'executivo_id': ex['id'], 'cadastro_id': None, 'documento': '11111111000111', 'razao_social': 'Cliente Indicado Fictício', 'situacao': 'ativo',
                 'motivo': None, 'inicio': '2026-11-01', 'fim': '2027-11-01', 'cliente_codigo': 1165, 'criado_em': 'x'}]
# Pedidos registrados pelo portal: dois do cliente vinculado (um repetido) e um de outro cliente
for pid, cod, itens in ((501, 1165, [{'total': '100.00'}, {'total': '20.50'}]), (501, 1165, [{'total': '100.00'}]), (502, 1165, [{'total': '200.00'}]), (503, 1919, [{'total': '80.00'}])):
    r = {'loja': LOJA, 'comprador_codigo': cod, 'tipo': 'pedido', 'pedido_id': pid, 'pedido_numero': str(9000 + pid), 'valor': None, 'itens': itens}
    sim.eventos.append(r); sim.comissao_do_pedido(r)
checar(len(sim.comissoes) == 2 and sim.comissoes[0]['valor'] == 3.62 and sim.comissoes[1]['valor'] == 6.0, f'comissões geradas: {sim.comissoes}')

with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    for largura in (1280, 390):
        pg = br.new_page(viewport={'width': largura, 'height': 900}); erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        pg.route('**/*', sim.rota); pg.goto(BASE + '/painel'); pg.wait_for_selector('#aUsu')
        pg.fill('#aUsu', 'operador'); pg.fill('#aSen', 'senha1'); pg.click('#aOk'); pg.wait_for_selector('#vAdm [data-at="cli"].on')
        pg.click('#vAdm [data-at="exe"]'); pg.wait_for_selector('#exVerRel'); pg.click('#exVerRel')
        pg.wait_for_selector('.ex-rel-bloco')
        if largura == 390:
            checar(pg.evaluate("[...document.querySelectorAll('.ex-rel *')].every(e => e.getBoundingClientRect().right <= innerWidth + 1)"), 'relatório passa da tela no celular')
            pg.screenshot(path='/tmp/vis/comissoes390.png', full_page=True); checar(not erros, f'erros: {erros}'); pg.close(); break
        t = ' '.join(pg.inner_text('.ex-rel').split())
        checar('Cliente Indicado Fictício' in t and 'vendas R$ 320,50' in t and 'Prevista R$ 9,62' in t, f'resumo do mês: {t[:400]}')
        checar('Cliente 1919' not in t, 'pedido de cliente sem vínculo entrou na comissão')
        l1 = f'.ex-rel-l[data-c="{sim.comissoes[0]["id"]}"]'; l2 = f'.ex-rel-l[data-c="{sim.comissoes[1]["id"]}"]'
        pg.click(f'{l1} [data-m="faturada"]'); pg.wait_for_function(f"document.querySelector('{l1}')?.classList.contains('faturada')")
        checar(sim.comissoes[0]['situacao'] == 'faturada', 'faturado (regra: liberar depois do pagamento)')
        pg.click(f'{l1} [data-m="cliente_pagou"]'); pg.wait_for_function(f"document.querySelector('{l1}')?.classList.contains('liberada')")
        # teste que tem de dar erro: cancelar sem confirmar não muda nada
        pg.click(f'{l2} [data-m="cancelar"]'); pg.wait_for_timeout(300)
        checar(sim.comissoes[1]['situacao'] == 'prevista', 'cancelou sem confirmar')
        pg.click(f'{l2} [data-m="cancelar"]'); pg.wait_for_function(f"document.querySelector('{l2}')?.classList.contains('cancelada')")
        t = ' '.join(pg.inner_text('.ex-rel').split())
        checar('Liberada R$ 3,62' in t and 'Prevista R$ 0,00' in t, f'totais depois das marcações: {t[:300]}')
        pg.click('[data-pagar]'); pg.wait_for_selector('#exPgObs'); pg.fill('#exPgObs', 'NF 123 do executivo'); pg.click('[data-pgok]')
        pg.wait_for_function(f"document.querySelector('{l1}')?.classList.contains('paga')")
        checar(sim.comissoes[0]['situacao'] == 'paga' and sim.comissoes[0]['observacao'] == 'NF 123 do executivo', f'pagamento: {sim.comissoes[0]}')
        pg.click(f'{l2} [data-m="reabrir"]'); pg.wait_for_function(f"document.querySelector('{l2}')?.classList.contains('prevista')")
        # recalcular: pedido novo que o gatilho perdeu
        sim.eventos.append({'loja': LOJA, 'comprador_codigo': 1165, 'tipo': 'pedido', 'pedido_id': 504, 'pedido_numero': '9504', 'itens': [{'total': '50.00'}]})
        pg.click('#exRecalc'); pg.wait_for_function("document.querySelectorAll('.ex-rel-l').length === 3")
        checar(len(sim.comissoes) == 3, 'recalcular não trouxe o pedido que faltava')
        pg.fill('#exMes', '2026-10'); pg.dispatch_event('#exMes', 'change'); pg.wait_for_selector('text=Nenhuma comissão neste mês')
        pg.screenshot(path='/tmp/vis/comissoes1280.png')
        checar(not erros, f'erros: {erros}')
        pg.close()
    br.close()

print('FALHAS:' if falhas else 'Executivos (etapa 3): todos os testes passaram.')
for f in falhas: print(' -', f)
