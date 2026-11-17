"""Simulador da API do G360, da ponte-g360 e do Supabase para os testes do portal.
Só dados fictícios. Segue o contrato api-sistemas-externos-2026-11-16.yaml."""
import json, re, base64, hashlib, time, uuid
from decimal import Decimal
from urllib.parse import urlparse, parse_qs

BASE = 'http://localhost:5173'
API = '/b2b/v1/lojas/96da1e99a3f327f0/'
SUPA = 'evaylnnzuqxhmunkdiqx.supabase.co'
LOJA = '96da1e99a3f327f0'
GIF = base64.b64decode('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==')
CORS = {'Access-Control-Allow-Origin': BASE, 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'}

def rid(): return uuid.uuid4().hex[:16]
def b64u(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')

def produto(i, **k):
    p = {'id': i, 'codigo': f'P-{i}', 'nome': f'Produto Fictício {i}', 'marca': 'Marca Exemplo' if i % 2 else 'Outra Marca',
         'grupo': {'codigo': 1 if i % 3 else 2, 'nome': 'Grupo Um' if i % 3 else 'Grupo Dois'},
         'marca_detalhe': {'codigo': 10 if i % 2 else 20, 'nome': 'Marca Exemplo' if i % 2 else 'Outra Marca'},
         'unidade': 'UN', 'aplicacao': None, 'imagem': None, 'fotos': [], 'preco': f'{10 + i % 7}.50', 'seu_preco': None,
         'compravel': True, 'disponibilidade': 'disponivel', 'faixa_disponibilidade': 'em_estoque', 'aviso': None, 'unidades': [], 'kit': None}
    p.update(k); return p

class Sim:
    def __init__(self, sessao_minutos=8, troca_senha=True):
        self.loja = {'nome': 'Loja Exemplo Fictícia', 'troca_senha': troca_senha, 'sessao_minutos': sessao_minutos, 'imagens': None}
        self.compradores = {
            '11.111.111/0001-11': {'senha': 'Teste12', 'codigo': 1165, 'nome': 'Comprador Fictício Um LTDA', 'fantasia': 'Fictício Um', 'bloq': False},
            '22.222.222/0001-22': {'senha': 'Teste34', 'codigo': 1919, 'nome': 'Comprador Fictício Dois LTDA', 'fantasia': 'Fictício Dois', 'bloq': False},
            '33.333.333/0001-33': {'senha': 'Teste56', 'codigo': 3030, 'nome': 'Comprador Bloqueado LTDA', 'fantasia': 'Bloqueado', 'bloq': True},
        }
        self.produtos = [produto(i) for i in range(101, 146)]
        P = {p['id']: p for p in self.produtos}
        P[101].update(preco='11.50', seu_preco='11.50', unidades=[{'id': 'CX12', 'nome': 'CX', 'descricao': 'Caixa com 12', 'preco': '125.00', 'seu_preco': '125.00'}])
        P[102].update(disponibilidade='sob_consulta', compravel=False, aviso='Preço sob consulta. Fale com o seu vendedor.')
        P[108].update(disponibilidade='sob_consulta', compravel=True, faixa_disponibilidade='indisponivel')
        P[103].update(disponibilidade='indisponivel', compravel=False, faixa_disponibilidade='indisponivel', aviso='Há uma venda em andamento com este produto no fornecedor. Tente de novo em instantes.')
        P[104].update(fotos=[1, 2], imagem='produtos/104/fotos/1')
        P[105].update(fotos=[1])  # foto que falha (404)
        P[106].update(faixa_disponibilidade='ultimas_unidades', unidade='KG')
        self.tokens = {}           # token -> doc
        self.supa = {}             # access_token -> {codigo, expira_vinculo}
        self.lista = {}            # codigo -> set(produto_id)
        self.ocorrencias = []
        self.pedidos = []          # {id, comprador, chave, corpo_sem_ass, dados}
        self.post_pedidos = 0
        self.preco_versao = 0
        self.cenario = {}
        self.chamadas = []
        self.op_tokens = {}
        self.congelados = []
        self.galeria = {104: [{'item': 1, 'descricao': 'Frente'}, {'item': 2, 'descricao': 'Lado'}]}
        self.capas = {104: 1}
        self.vinculo_segundos = 300
        self.fotos_pedidas = []

    # ---------- utilidades ----------
    def comprador_json(self, doc):
        c = self.compradores[doc]
        return {'nome': c['nome'], 'fantasia': c['fantasia'], 'documento': '**.***.***/****-' + doc[-2:], 'trocar_senha': False,
                'compra_bloqueada': c['bloq'], 'codigo': c['codigo'], 'segmento': None}

    def doc_do_token(self, req):
        a = req.headers.get('authorization') or ''
        t = a[7:] if a.startswith('Bearer ') else None
        return self.tokens.get(t)

    def ok(self, route, dados, status=200, extra=None):
        corpo = {'dados': dados, 'request_id': rid()}
        if extra: corpo.update(extra)
        return route.fulfill(status=status, headers=CORS, content_type='application/json', body=json.dumps(corpo))

    def erro(self, route, status, codigo, msg, resp, campos=None):
        return route.fulfill(status=status, headers=CORS, content_type='application/json',
                             body=json.dumps({'erro': {'codigo': codigo, 'mensagem': msg, 'responsavel': resp, 'campos': campos or {}}, 'request_id': rid()}))

    def sem_sessao(self, route): return self.erro(route, 401, 'SESSAO_INVALIDA', 'Sua sessão terminou. Entre novamente.', 'usuario')

    def filtrar(self, f):
        res = self.produtos
        if f.get('q'): q = f['q'].lower(); res = [p for p in res if q in p['nome'].lower() or q in p['codigo'].lower()]
        if f.get('grupo') not in (None, ''): res = [p for p in res if p['grupo']['codigo'] == int(f['grupo'])]
        if f.get('marca') not in (None, ''): res = [p for p in res if p['marca_detalhe']['codigo'] == int(f['marca'])]
        if f.get('ids'): ids = {int(x) for x in f['ids']}; res = [p for p in res if p['id'] in ids]
        pag, lim = int(f.get('pagina') or 1), int(f.get('limite') or 20)
        return res[(pag - 1) * lim: pag * lim], {'pagina': pag, 'limite': lim, 'total': len(res)}

    def revisar(self, doc, corpo):
        P = {p['id']: p for p in self.produtos}
        itens, sub, pend = [], Decimal('0'), []
        for it in corpo['itens']:
            p = P.get(it['produto_id'])
            u = next((x for x in p['unidades'] if x['id'] == it.get('unidade')), None) if p else None
            preco = (u['seu_preco'] or u['preco']) if u else (p['seu_preco'] or p['preco']) if p else None
            if self.preco_versao and preco: preco = str(Decimal(preco) + Decimal('1.00'))
            tot = (Decimal(preco) * Decimal(it['quantidade'])).quantize(Decimal('0.01')) if preco else None
            if tot: sub += tot
            itens.append({'produto_id': it['produto_id'], 'codigo': p['codigo'], 'nome': p['nome'], 'unidade_id': it.get('unidade'),
                          'unidade': u['nome'] if u else p['unidade'], 'kit': False, 'quantidade': it['quantidade'],
                          'preco_unitario': preco, 'seu_preco': (u['seu_preco'] if u else p['seu_preco']), 'total': str(tot) if tot else None,
                          'aviso': None, 'pendencia': None})
        sub = sub.quantize(Decimal('0.01'))
        if corpo['modalidade'] == 'entrega':
            frete = {'situacao': 'a_combinar', 'origem': None, 'valor': None}
            pend.append({'codigo': 'FRETE_A_COMBINAR', 'mensagem': 'O frete para este endereço será combinado com o fornecedor.', 'responsavel': 'fornecedor'})
        else:
            frete = {'situacao': 'nao_aplicavel', 'origem': None, 'valor': None}
        cond = corpo.get('condicao_pagamento_id')
        if cond == 2 and sub < Decimal('200.00'):
            pend.append({'codigo': 'PEDIDO_MINIMO', 'mensagem': 'O pedido mínimo desta condição é R$ 200,00.', 'responsavel': 'usuario'})
        if self.compradores[doc]['bloq']:
            pend.append({'codigo': 'CADASTRO_BLOQUEADO', 'mensagem': 'Seu cadastro está bloqueado para compras. Fale com o seu fornecedor.', 'responsavel': 'fornecedor'})
        base = json.dumps({k: v for k, v in corpo.items() if k != 'assinatura'}, sort_keys=True) + str(self.preco_versao)
        return {'itens': itens, 'subtotal': str(sub), 'frete': frete, 'taxa_pagamento': '0.00', 'total': str(sub), 'total_fechado': True,
                'data_prevista': None, 'credito': {'situacao': 'liberado' if not pend else None, 'mensagem': None},
                'entrega': {'modalidade': corpo['modalidade'], 'endereco_id': corpo.get('endereco_id')},
                'pagamento': {'exigido': 'parcelas', 'condicao_id': cond, 'descricao': {1: 'À vista', 2: '30/60 dias'}.get(cond),
                              'parcelas_a_definir': False, 'parcelas': [{'numero': 1, 'vencimento': '2026-12-16', 'valor': str(sub)}] if cond else []},
                'pode_enviar': not pend, 'pendencias': pend, 'observacao': corpo.get('observacao') or '',
                'assinatura': hashlib.sha256(base.encode()).hexdigest()}

    # ---------- roteador ----------
    def rota(self, route):
        req = route.request; u = urlparse(req.url)
        if req.url.startswith(BASE) or req.url.startswith('data:'): return route.continue_()
        if 'fonts.g' in req.url: return route.abort()
        if req.method == 'OPTIONS': return route.fulfill(status=204, headers=CORS)
        if u.netloc == SUPA: return self.supabase(route, u)
        if API in u.path: return self.api(route, u, u.path.split(API, 1)[1])
        return route.abort()

    def api(self, route, u, caminho):
        req = route.request; m = req.method; q = parse_qs(u.query)
        corpo = json.loads(req.post_data) if req.post_data else None
        self.chamadas.append((m, caminho, dict(req.headers), corpo))
        doc = self.doc_do_token(req)
        cen = self.cenario.get(caminho, {})
        if cen.get('falhar'):
            st, cod, msg, resp = cen['falhar']; return self.erro(route, st, cod, msg, resp)
        if caminho == 'loja' and m == 'GET': return self.ok(route, self.loja)
        if caminho == 'sessoes' and m == 'POST':
            c = self.compradores.get(corpo.get('usuario'))
            if not c or c['senha'] != corpo.get('senha'):
                return self.erro(route, 401, 'ACESSO_INVALIDO', 'CPF/CNPJ ou senha inválidos.', 'usuario')
            t = base64.urlsafe_b64encode(uuid.uuid4().bytes + uuid.uuid4().bytes[:16]).decode()[:43]
            t = re.sub(r'[^A-Za-z0-9_-]', 'a', t)
            self.tokens[t] = corpo['usuario']
            return self.ok(route, {'token': t, 'tipo': 'Bearer', 'expira_em': '2099-01-01T00:00:00Z', 'comprador': self.comprador_json(corpo['usuario']), 'loja': self.loja}, 201)
        if caminho.startswith('operadores/'): return self.operador(route, caminho, m, corpo, q)
        if not doc: return self.sem_sessao(route)
        cod = self.compradores[doc]['codigo']
        if caminho == 'me': return self.ok(route, {'comprador': self.comprador_json(doc), 'loja': self.loja, 'expira_em': '2099-01-01T00:00:00Z'})
        if caminho == 'sessao' and m == 'DELETE':
            self.tokens = {k: v for k, v in self.tokens.items() if k != req.headers['authorization'][7:]}
            return route.fulfill(status=204, headers=CORS, body='')
        if caminho == 'senha' and m == 'PUT':
            c = self.compradores[doc]
            if corpo['senha_atual'] != c['senha']: return self.erro(route, 422, 'SENHA_ATUAL_INCORRETA', 'A senha atual não confere.', 'usuario')
            c['senha'] = corpo['senha_nova']
            self.tokens = {k: v for k, v in self.tokens.items() if v != doc}
            t = 'N' * 20 + uuid.uuid4().hex[:23]; self.tokens[t] = doc
            return self.ok(route, {'token': t, 'tipo': 'Bearer', 'expira_em': '2099-01-01T00:00:00Z', 'comprador': self.comprador_json(doc)})
        if caminho in ('produtos', 'produtos/busca'):
            f = corpo if m == 'POST' else {k: (v if k == 'termos[]' else v[0]) for k, v in q.items()}
            if m == 'GET' and f.get('ids'): f['ids'] = f['ids'].split(',')
            dados, pag = self.filtrar(f)
            return self.ok(route, dados, extra={'paginacao': pag})
        if caminho == 'grupos': return self.ok(route, [{'codigo': 1, 'nome': 'Grupo Um', 'quantidade': 30}, {'codigo': 2, 'nome': 'Grupo Dois', 'quantidade': 15}])
        if caminho == 'marcas': return self.ok(route, [{'codigo': 10, 'nome': 'Marca Exemplo', 'quantidade': 23}, {'codigo': 20, 'nome': 'Outra Marca', 'quantidade': 22}])
        mm = re.match(r'produtos/(\d+)/fotos/(\d+)$', caminho)
        if mm:
            self.fotos_pedidas.append(caminho)
            if mm.group(1) == '105': return self.erro(route, 404, 'NAO_ENCONTRADO', 'Foto não encontrada.', 'integracao')
            return route.fulfill(status=200, headers={**CORS, 'Content-Type': 'image/gif'}, body=GIF)
        if caminho == 'opcoes':
            return self.ok(route, {'modalidades': ['entrega', 'retirada'], 'enderecos': [
                {'id': 7, 'descricao': 'Matriz', 'endereco': 'Rua Exemplo', 'numero': '100', 'complemento': '', 'cidade': 'Cidade Exemplo', 'cep': '38400-000', 'principal': True}],
                'pagamento': {'exigido': 'parcelas', 'condicoes': [
                    {'id': 1, 'descricao': 'À vista', 'parcelas': 1, 'dias': [0], 'pedido_minimo': None, 'parcela_minima': None, 'taxa_por_parcela': None, 'padrao': True, 'pix': False},
                    {'id': 2, 'descricao': '30/60 dias', 'parcelas': 2, 'dias': [30, 60], 'pedido_minimo': '200.00', 'parcela_minima': None, 'taxa_por_parcela': None, 'padrao': False, 'pix': False}]}})
        if caminho == 'revisoes': return self.ok(route, self.revisar(doc, corpo))
        if caminho == 'pedidos' and m == 'POST': return self.post_pedido(route, req, doc, cod, corpo)
        if caminho == 'pedidos' and m == 'GET':
            meus = [p['dados'] for p in reversed(self.pedidos) if p['comprador'] == cod]
            pag, lim = int(q.get('pagina', ['1'])[0]), int(q.get('limite', ['20'])[0])
            return self.ok(route, [{k: v for k, v in d.items() if k in ('id', 'numero', 'data', 'hora', 'situacao', 'situacao_nome', 'faturado', 'separacao_status', 'separacao_atualizada_em', 'total')} for d in meus[(pag-1)*lim:pag*lim]],
                           extra={'paginacao': {'pagina': pag, 'limite': lim, 'total': len(meus)}})
        mm = re.match(r'pedidos/por-chave/(.+)$', caminho)
        if mm:
            p = next((p for p in self.pedidos if p['chave'] == mm.group(1) and p['comprador'] == cod), None)
            return self.ok(route, p['dados']) if p else self.erro(route, 404, 'NAO_ENCONTRADO', 'Pedido não encontrado.', 'integracao')
        mm = re.match(r'pedidos/(\d+)$', caminho)
        if mm:
            p = next((p for p in self.pedidos if p['dados']['id'] == int(mm.group(1)) and p['comprador'] == cod), None)
            return self.ok(route, p['dados']) if p else self.erro(route, 404, 'NAO_ENCONTRADO', 'Pedido não encontrado.', 'integracao')
        if caminho == 'historico-compras':
            return self.ok(route, {'inicio': '2026-05-16', 'fim': '2026-11-16', 'produtos': [
                {'produto_id': 104, 'pedidos': 3, 'quantidade_media': '4', 'ultima_compra': {'data': '2026-11-01', 'quantidade': '5', 'unidade_base': 'UN', 'unidade_vendida': 'UN'}},
                {'produto_id': 999, 'pedidos': 1, 'quantidade_media': '2', 'ultima_compra': {'data': '2026-08-01', 'quantidade': '2', 'unidade_base': 'UN', 'unidade_vendida': 'UN'}}]})
        return self.erro(route, 404, 'NAO_ENCONTRADO', 'Recurso não encontrado.', 'integracao')

    def post_pedido(self, route, req, doc, cod, corpo):
        self.post_pedidos += 1
        chave = req.headers.get('idempotency-key') or ''
        if not re.match(r'^[A-Za-z0-9_-]{16,64}$', chave): return self.erro(route, 400, 'CHAVE_INVALIDA', 'Chave inválida.', 'integracao')
        sem = json.dumps({k: v for k, v in corpo.items() if k != 'assinatura'}, sort_keys=True)
        existente = next((p for p in self.pedidos if p['chave'] == chave and p['comprador'] == cod), None)
        if existente:
            if existente['corpo'] == sem: return self.ok(route, existente['dados'], 200)
            return self.erro(route, 409, 'CHAVE_REUTILIZADA', 'Esta chave de envio já foi usada para outro carrinho.', 'integracao')
        cen = self.cenario.get('pedidos_post', [])
        acao = cen.pop(0) if cen else None
        if acao == 'conflito': return self.erro(route, 409, 'OPERACAO_EM_ANDAMENTO', 'Seu pedido ainda está sendo processado. Aguarde alguns segundos.', 'tentar_de_novo')
        if acao == 'abortar_sem_gravar': return route.abort('connectionreset')
        if acao == 'mudar_preco': self.preco_versao += 1
        rev = self.revisar(doc, corpo)
        if not rev['pode_enviar']:
            return self.erro(route, 422, 'REVISAO_BLOQUEADA', 'Revise as pendências antes de enviar.', 'usuario', {'pendencias': rev['pendencias']})
        if corpo.get('assinatura') != rev['assinatura']:
            return self.erro(route, 409, 'REVISAO_ALTERADA', 'Os valores do pedido mudaram. Revise e confirme de novo.', 'usuario')
        n = len(self.pedidos) + 1
        dados = {'id': 500 + n, 'numero': 9000 + n, 'data': '2026-11-16', 'hora': '18:30', 'situacao': 'separado', 'situacao_nome': 'Separado',
                 'faturado': False, 'separacao_status': 2, 'separacao_atualizada_em': None, 'total': rev['total'], 'itens': [
                     {'produto_id': i['produto_id'], 'codigo': i['codigo'], 'nome': i['nome'], 'unidade': i['unidade'], 'quantidade': i['quantidade'],
                      'preco_unitario': i['preco_unitario'], 'seu_preco': i['seu_preco'], 'total': i['total'], 'kit_id': None} for i in rev['itens']],
                 'subtotal': rev['subtotal'], 'frete': {'situacao': 'definido', 'origem': None, 'valor': '0.00'}, 'taxa_pagamento': '0.00',
                 'entrega': {'modalidade': corpo['modalidade'], 'endereco': None}, 'pagamento': {'descricao': rev['pagamento']['descricao'], 'parcelas': rev['pagamento']['parcelas']},
                 'observacao': corpo.get('observacao') or '', 'data_prevista': None}
        self.pedidos.append({'comprador': cod, 'chave': chave, 'corpo': sem, 'dados': dados})
        if acao == 'abortar_gravado': return route.abort('connectionreset')
        return self.ok(route, dados, 201)

    def operador(self, route, caminho, m, corpo, q):
        req = route.request
        if caminho == 'operadores/sessoes':
            usuarios = {'operador': ('senha1', True), 'vendedor': ('senha2', False)}
            if corpo.get('usuario') == 'semlicenca': return self.erro(route, 423, 'LICENCA_OPERADOR_INDISPONIVEL', 'Confira a disponibilidade da sua licença no G360.', 'fornecedor')
            u = usuarios.get(corpo.get('usuario'))
            if not u or u[0] != corpo.get('senha'): return self.erro(route, 401, 'OPERADOR_LOGIN_INVALIDO', 'Usuário ou senha inválidos.', 'usuario')
            t = 'op_' + ('A' * 20) + uuid.uuid4().hex[:23]; self.op_tokens[t] = u[1]
            return self.ok(route, {'token': t, 'tipo': 'Bearer', 'expira_em': '2099-01-01T00:00:00Z'}, 201)
        a = req.headers.get('authorization') or ''
        tok = a[7:] if a.startswith('Bearer ') else None
        if tok not in self.op_tokens: return self.erro(route, 401, 'SESSAO_INVALIDA', 'Sua sessão terminou. Entre novamente.', 'usuario')
        custo = self.op_tokens[tok]
        if caminho == 'operadores/sessao': self.op_tokens.pop(tok, None); return route.fulfill(status=204, headers=CORS, body='')
        if caminho == 'operadores/clientes/consulta':
            if corpo['cnpj'] == '11.111.111/0001-11': return self.ok(route, {'codigo': 1165, 'nome': 'Comprador Fictício Um LTDA', 'acesso_portal': True, 'segmento': {'codigo': 1, 'descricao': 'Varejo'}})
            return self.erro(route, 404, 'CLIENTE_NAO_LOCALIZADO', 'Cliente não localizado.', 'usuario')
        def prod_op(p, cliente=False):
            return {'id': p['id'], 'codigo': p['codigo'], 'nome': p['nome'], 'grupo': p['grupo'], 'marca': p['marca_detalhe'], 'unidade': p['unidade'],
                    'preco': p['preco'], 'preco_congelado': '9.9000000' if cliente and p['id'] == 101 else None, 'origem_preco': 'tabela',
                    'custo_visivel': custo, 'custo': 5.1234 if custo else None, 'margem_percentual': 45.5 if custo else None}
        if caminho == 'operadores/produtos/busca':
            dados, pag = self.filtrar(corpo); return self.ok(route, [prod_op(p) for p in dados], extra={'paginacao': pag})
        if caminho == 'operadores/produtos/precos':
            P = {p['id']: p for p in self.produtos}; return self.ok(route, [prod_op(P[i], True) for i in corpo['ids'] if i in P])
        mm = re.match(r'operadores/clientes/(\d+)/precos-congelados(?:/(\d+))?$', caminho)
        if mm:
            if m == 'GET': return self.ok(route, {'itens': self.congelados, 'proximo': None, 'disponivel': True})
            if m == 'POST':
                r = {'id': len(self.congelados) + 1, 'cliente': int(mm.group(1)), 'produto': corpo['produto'], 'unidade_id': corpo.get('unidade_id'),
                     'valor': f"{Decimal(corpo['valor']):.7f}", 'inicio': corpo['inicio'], 'fim': corpo['fim'], 'situacao': 'ativo'}
                self.congelados.append(r); return self.ok(route, r, 201)
            r = next(x for x in self.congelados if x['id'] == int(mm.group(2)))
            if m == 'PUT': r.update(valor=f"{Decimal(corpo['valor']):.7f}", inicio=corpo['inicio'], fim=corpo['fim']); return self.ok(route, r)
            if m == 'DELETE': r['situacao'] = 'encerrado'; return self.ok(route, r)
        mm = re.match(r'operadores/produtos/(\d+)/fotos(?:/(capa|ordem|\d+))?$', caminho)
        if mm:
            pid = int(mm.group(1)); g = self.galeria.setdefault(pid, [])
            gal = lambda: {'fotos': g, 'capa': g[0]['item'] if g else None, 'maximo': 12}
            sub = mm.group(2)
            if sub is None and m == 'GET': return self.ok(route, gal())
            if sub is None and m == 'POST':
                item = max([f['item'] for f in g] or [0]) + 1; g.append({'item': item, 'descricao': corpo.get('descricao', '')})
                return self.ok(route, {**gal(), 'item': item}, 201)
            if sub == 'capa': f = next(x for x in g if x['item'] == corpo['item']); g.remove(f); g.insert(0, f); return self.ok(route, gal())
            if sub == 'ordem': g.sort(key=lambda x: corpo['itens'].index(x['item'])); return self.ok(route, gal())
            if m == 'GET': return route.fulfill(status=200, headers={**CORS, 'Content-Type': 'image/gif'}, body=GIF)
            if m == 'DELETE': g[:] = [x for x in g if x['item'] != int(sub)]; return self.ok(route, gal())
        return self.erro(route, 404, 'NAO_ENCONTRADO', 'Recurso não encontrado.', 'integracao')

    # ---------- ponte e Supabase ----------
    def jwt(self, sub, extra):
        return f"{b64u({'alg': 'HS256', 'typ': 'JWT'})}.{b64u({'sub': sub, 'exp': int(time.time()) + 3600, 'role': 'authenticated', **extra})}.assinatura"

    def supabase(self, route, u):
        req = route.request; m = req.method; p = u.path
        cab = {**CORS, 'Access-Control-Allow-Headers': '*'}
        if p == '/functions/v1/ponte-g360':
            corpo = json.loads(req.post_data or '{}')
            self.chamadas.append(('PONTE', corpo.get('acao'), dict(req.headers), {k: v for k, v in corpo.items() if k != 'token'}))
            if self.cenario.get('ponte') == 'fora': return route.fulfill(status=503, headers=cab, content_type='application/json', body=json.dumps({'mensagem': 'Não foi possível abrir a sessão. Tente de novo.'}))
            if corpo.get('acao') == 'pedir_link': return route.fulfill(status=202, headers=cab, content_type='application/json', body=json.dumps({'mensagem': 'Se o cadastro permitir, o link será enviado para o e-mail cadastrado.'}))
            doc = self.tokens.get(corpo.get('token'))
            if not doc: return route.fulfill(status=401, headers=cab, content_type='application/json', body=json.dumps({'mensagem': 'Sessão da API inválida.'}))
            cod = self.compradores[doc]['codigo']
            at = self.jwt(str(uuid.uuid5(uuid.NAMESPACE_DNS, str(cod))), {'session_id': str(uuid.uuid4()), 'app_metadata': {'g360_loja': LOJA, 'g360_comprador': cod}})
            exp = time.time() + self.vinculo_segundos
            self.supa[at] = {'codigo': cod, 'vinculo': exp}
            iso = lambda t: time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(t)) + '.000Z'
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps({
                'sessao': {'access_token': at, 'refresh_token': 'r' + uuid.uuid4().hex}, 'api_expira_em': '2099-01-01T00:00:00.000Z',
                'api_inatividade_minutos': self.loja['sessao_minutos'], 'api_vinculo_expira_em': iso(exp)}))
        a = (req.headers.get('authorization') or '')[7:]
        s = self.supa.get(a)
        if p == '/auth/v1/user':
            if not s: return route.fulfill(status=401, headers=cab, content_type='application/json', body='{"msg":"invalid"}')
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps({'id': 'u', 'aud': 'authenticated', 'role': 'authenticated', 'email': 'x@example.invalid', 'app_metadata': {}, 'user_metadata': {}}))
        if p == '/auth/v1/logout': self.supa.pop(a, None); return route.fulfill(status=204, headers=cab, body='')
        if p == '/auth/v1/token':
            corpo = json.loads(req.post_data or '{}')
            if corpo.get('email') == 'painel@example.invalid' and corpo.get('password') == 'SenhaPainel1':
                at = self.jwt('painel', {'app_metadata': {'g360_painel_loja': LOJA}})
                self.supa[at] = {'painel': True, 'vinculo': time.time() + 3600}
                return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps({
                    'access_token': at, 'refresh_token': 'r', 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': int(time.time()) + 3600,
                    'user': {'id': 'painel', 'aud': 'authenticated', 'email': 'painel@example.invalid', 'app_metadata': {'g360_painel_loja': LOJA}, 'user_metadata': {}}}))
            return route.fulfill(status=400, headers=cab, content_type='application/json', body='{"error":"invalid_grant","error_description":"Invalid login credentials"}')
        tabela = p.replace('/rest/v1/', '')
        valido = s and time.time() < s['vinculo'] and not s.get('painel')
        q = parse_qs(u.query)
        if tabela == 'minha_lista':
            if m == 'GET':
                linhas = [{'produto_id': i} for i in sorted(self.lista.get(s['codigo'], set()))] if valido else []
                return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps(linhas))
            if not valido: return route.fulfill(status=403, headers=cab, content_type='application/json', body='{"code":"42501","message":"new row violates row-level security policy"}')
            if m == 'POST':
                r = json.loads(req.post_data)
                if r['comprador_codigo'] != s['codigo'] or r['loja'] != LOJA: return route.fulfill(status=403, headers=cab, content_type='application/json', body='{"code":"42501"}')
                st = self.lista.setdefault(s['codigo'], set())
                if r['produto_id'] in st: return route.fulfill(status=409, headers=cab, content_type='application/json', body='{"code":"23505","message":"duplicate key"}')
                st.add(r['produto_id']); return route.fulfill(status=201, headers=cab, body='')
            if m == 'DELETE':
                pid = int(q['produto_id'][0].replace('eq.', ''))
                self.lista.get(s['codigo'], set()).discard(pid); return route.fulfill(status=204, headers=cab, body='')
        if tabela == 'ocorrencias_g360':
            if m == 'POST':
                if not valido: return route.fulfill(status=403, headers=cab, content_type='application/json', body='{"code":"42501"}')
                r = json.loads(req.post_data)
                if r.get('comprador_codigo') != s['codigo']: return route.fulfill(status=403, headers=cab, body='{"code":"42501"}')
                self.ocorrencias.append({**r, 'registrada_em': '2026-11-16T21:00:00+00:00'})
                return route.fulfill(status=201, headers=cab, body='')
            if m == 'GET':
                linhas = list(reversed(self.ocorrencias)) if s and s.get('painel') else []
                return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps(linhas))
        return route.fulfill(status=404, headers=cab, body='{}')
