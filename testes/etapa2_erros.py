"""Etapa 2 — tratamento de erros central e quadro de mensagem.
Roda contra http://localhost:5173 (npm run build && npm run preview).
A API é SIMULADA com respostas fictícias no formato do contrato."""
import sys, os
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:5173/'
OUT = 'testes/capturas'; os.makedirs(OUT, exist_ok=True)
CHROME = os.environ.get('CHROME') or None
LOJA = {'dados': {'nome': 'Loja Exemplo Fictícia', 'troca_senha': True, 'sessao_minutos': 8}, 'request_id': '0011223344556677'}
def env(codigo, msg, resp, campos=None, rid='aabbccddeeff0011'):
    return {'erro': {'codigo': codigo, 'mensagem': msg, 'responsavel': resp, 'campos': campos or {}}, 'request_id': rid}
falhas = []
def checar(c, m):
    if not c: falhas.append(m)

def abrir(pw, caminho, loja_resp, me_resp=None, largura=390, nome='x'):
    br = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    pg = br.new_page(viewport={'width': largura, 'height': 900})
    erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
    cab = {}
    def r(route):
        u = route.request.url
        if u.startswith('http://localhost:5173') or u.startswith('data:'): return route.continue_()
        if u.endswith('/loja'): return loja_resp(route)
        if u.endswith('/me'):
            cab['auth'] = route.request.headers.get('authorization')
            return me_resp(route)
        return route.abort()
    pg.route('**/*', r)
    pg.goto(BASE + caminho)
    pg.wait_for_function("!/Carregando/.test(document.getElementById('g360Estado')?.innerText||'Carregando')", timeout=40000)
    return br, pg, erros, cab

with sync_playwright() as pw:
    ok = lambda rt: rt.fulfill(status=200, json=LOJA)

    # 1) Sem ?testar-erro o botão não aparece
    br, pg, erros, _ = abrir(pw, '', ok)
    checar(pg.locator('#g360TestarErro').count() == 0, 'botão de teste visível sem ?testar-erro')
    br.close()

    # 2) Testar erro: GET me sem token -> SESSAO_INVALIDA
    me = lambda rt: rt.fulfill(status=401, json=env('SESSAO_INVALIDA', 'Sua sessão terminou. Entre novamente.', 'usuario', rid='1122334455667788'))
    br, pg, erros, cab = abrir(pw, '?testar-erro', ok, me, nome='testar')
    pg.click('#g360TestarErro'); pg.wait_for_selector('#g360TesteSaida .g360-msg')
    t = pg.inner_text('#g360TesteSaida')
    checar('Sua sessão terminou. Entre novamente.' in t, 'mensagem SESSAO_INVALIDA não apareceu como veio')
    checar('Código para o suporte: SESSAO_INVALIDA · 1122334455667788' in t, 'código para o suporte ausente no teste')
    checar(cab.get('auth') is None, 'GET me sem token enviou Authorization')
    checar(not erros, f'erros de script: {erros}')
    pg.screenshot(path=f'{OUT}/etapa2_testar_erro_390.png'); br.close()

    # 3) 503 INDISPONIVEL -> tentar de novo com 30 s
    br, pg, *_ = abrir(pw, '', lambda rt: rt.fulfill(status=503, json=env('INDISPONIVEL', 'A API está indisponível no momento. Tente novamente em instantes.', 'tentar_de_novo')))
    b = pg.locator('.g360-msg-botao')
    checar(b.is_disabled() and 'em 30 s' in b.inner_text() or 'em 29 s' in b.inner_text(), f'espera de 30 s ausente: {b.inner_text()}')
    pg.screenshot(path=f'{OUT}/etapa2_indisponivel_390.png'); br.close()

    # 4) 429 -> 5 s na primeira recusa
    br, pg, *_ = abrir(pw, '', lambda rt: rt.fulfill(status=429, json=env('MUITAS_TENTATIVAS', 'Muitas solicitações. Aguarde e tente de novo.', 'tentar_de_novo')))
    t = pg.locator('.g360-msg-botao').inner_text()
    checar('em 5 s' in t or 'em 4 s' in t, f'espera de 5 s ausente no 429: {t}')
    br.close()

    # 5) integracao -> mensagem genérica + código (mensagem da API não é exibida)
    br, pg, *_ = abrir(pw, '', lambda rt: rt.fulfill(status=422, json=env('CAMPO_NAO_PERMITIDO', 'A solicitação tem campos que a API não aceita.', 'integracao')))
    t = pg.inner_text('#g360Estado')
    checar('Ocorreu um erro no portal' in t and 'CAMPO_NAO_PERMITIDO · aabbccddeeff0011' in t, 'tratamento de integracao incorreto')
    pg.screenshot(path=f'{OUT}/etapa2_integracao_390.png'); br.close()

    # 6) responsável desconhecido -> mesmo tratamento de integracao
    br, pg, *_ = abrir(pw, '', lambda rt: rt.fulfill(status=500, json=env('ALGO_NOVO', 'Mensagem qualquer', 'outro')))
    checar('Ocorreu um erro no portal' in pg.inner_text('#g360Estado'), 'responsável desconhecido não tratado como integracao')
    br.close()

    # 7) resposta fora do envelope
    br, pg, *_ = abrir(pw, '', lambda rt: rt.fulfill(status=502, body='<html>Bad gateway</html>', content_type='text/html'))
    checar('Ocorreu um erro no portal' in pg.inner_text('#g360Estado'), 'resposta sem envelope não tratada')
    br.close()

    # 8) fornecedor -> mensagem como veio
    br, pg, *_ = abrir(pw, '', lambda rt: rt.fulfill(status=404, json=env('LOJA_INDISPONIVEL', 'Esta loja não está disponível. Fale com o seu fornecedor.', 'fornecedor')))
    t = pg.inner_text('#g360Estado')
    checar('Esta loja não está disponível. Fale com o seu fornecedor.' in t and 'Precisa de ajuste da Souza Ribeiro' in t, 'tratamento de fornecedor incorreto')
    br.close()

    # 9) falha de rede
    br, pg, *_ = abrir(pw, '', lambda rt: rt.abort('failed'))
    t = pg.inner_text('#g360Estado')
    checar('Não foi possível falar com o servidor. Confira a conexão e tente de novo.' in t and 'Tentar de novo' in t, 'falha de rede incorreta')
    pg.click('.g360-msg-botao')  # tentar de novo dispara nova chamada
    br.close()

    # 10) larguras com o botão de teste
    for w in (360, 768, 1280, 1920):
        br, pg, *_ = abrir(pw, '?testar-erro', ok, me, largura=w)
        pg.click('#g360TestarErro'); pg.wait_for_selector('#g360TesteSaida .g360-msg')
        checar(pg.evaluate('document.documentElement.scrollWidth') <= w, f'rolagem horizontal em {w}px')
        if w == 1280: pg.screenshot(path=f'{OUT}/etapa2_testar_erro_1280.png')
        br.close()

print('FALHAS:', falhas if falhas else 'nenhuma')
sys.exit(1 if falhas else 0)
