"""Etapa 1 — página da loja (GET loja).
Roda contra o portal em http://localhost:5173 (npm run build && npm run preview).
A API é SIMULADA com dados fictícios por interceptação: nenhum dado real é usado.
Cenários: sucesso, loja indisponível (envelope de erro), falha de comunicação e larguras de tela."""
import sys, os
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:5173/'
OUT = 'testes/capturas'; os.makedirs(OUT, exist_ok=True)
CHROME = os.environ.get('CHROME') or None
LOJA_FICTICIA = {'dados': {'nome': 'Loja Exemplo Fictícia', 'troca_senha': True, 'sessao_minutos': 8}, 'request_id': '0011223344556677'}
ERRO_LOJA = {'erro': {'codigo': 'LOJA_INDISPONIVEL', 'mensagem': 'Esta loja não está disponível. Fale com o seu fornecedor.', 'responsavel': 'fornecedor', 'campos': {}}, 'request_id': 'aabbccddeeff0011'}
falhas = []

def checar(cond, msg):
    if not cond: falhas.append(msg)

def cenario(pw, nome, rota, largura=390):
    br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    pg = br.new_page(viewport={'width': largura, 'height': 820})
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    chamadas = []
    def r(route):
        u = route.request.url
        if u.startswith('http://localhost:5173') or u.startswith('data:'): return route.continue_()
        chamadas.append(u)
        if '/b2b/v1/lojas/' in u: return rota(route)
        return route.abort()  # demais externos bloqueados (ex.: fonte)
    pg.route('**/*', r)
    pg.goto(BASE)
    pg.wait_for_function("document.getElementById('g360Estado') && !/Carregando/.test(document.getElementById('g360Estado').innerText)", timeout=40000)
    larg = pg.evaluate('document.documentElement.scrollWidth')
    checar(larg <= largura, f'{nome}: rolagem horizontal ({larg}px em {largura}px)')
    checar(not erros, f'{nome}: erros de script {erros}')
    pg.screenshot(path=f'{OUT}/etapa1_{nome}_{largura}.png')
    txt = pg.inner_text('#g360Entrada')
    api = [c for c in chamadas if '/b2b/v1/lojas/' in c]
    br.close()
    return txt, api

with sync_playwright() as pw:
    ok = lambda route: route.fulfill(status=200, json=LOJA_FICTICIA)
    for w in (360, 390, 768, 1280, 1920):
        txt, api = cenario(pw, 'sucesso', ok, w)
        checar('Loja Exemplo Fictícia' in txt, f'sucesso {w}: nome da loja não apareceu')
    checar(api == ['https://g360apihomolog.vps10038.panel.icontainer.cloud/b2b/v1/lojas/96da1e99a3f327f0/loja'], f'endereço chamado incorreto: {api}')
    checar('8 minutos' in txt, 'tempo de inatividade não apareceu')

    txt, _ = cenario(pw, 'loja_indisponivel', lambda route: route.fulfill(status=404, json=ERRO_LOJA))
    checar('Esta loja não está disponível. Fale com o seu fornecedor.' in txt, 'mensagem da API não apareceu como veio')
    checar('LOJA_INDISPONIVEL · aabbccddeeff0011' in txt, 'código para o suporte ausente')

    txt, _ = cenario(pw, 'sem_conexao', lambda route: route.abort('failed'))
    checar('Não foi possível falar com o servidor. Confira a conexão e tente de novo.' in txt, 'mensagem de falha de comunicação ausente')
    checar('Tentar de novo' in txt, 'botão tentar de novo ausente')

print('FALHAS:', falhas if falhas else 'nenhuma')
sys.exit(1 if falhas else 0)
