"""Simulador da API do G360, da ponte-g360 e do Supabase para os testes do portal.
Só dados fictícios. Segue o contrato api-sistemas-externos-2026-11-18.yaml."""
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
         'compravel': True, 'disponibilidade': 'disponivel', 'faixa_disponibilidade': 'em_estoque', 'aviso': None, 'unidades': [], 'kit': None, 'quantidade_disponivel': None}
    p.update(k); return p

def hoje_br():
    return time.strftime('%Y-%m-%d', time.gmtime(time.time() - 3 * 3600))


class Sim:
    def __init__(self, sessao_minutos=8, troca_senha=True):
        self.loja = {'nome': 'Loja Exemplo Fictícia', 'troca_senha': troca_senha, 'sessao_minutos': sessao_minutos, 'imagens': None, 'pedido_minimo': '150.00', 'bloqueia_sem_estoque': True}
        self.vitrine_aberta = True; self.vitrine_chamadas = []
        self.cond_vistas = {}; self.cond_ocultas = {}
        self.carrinhos = {}
        self.compradores = {
            '11.111.111/0001-11': {'senha': 'Teste12', 'codigo': 1165, 'nome': 'Comprador Fictício Um LTDA', 'fantasia': 'Fictício Um', 'bloq': False},
            '22.222.222/0001-22': {'senha': 'Teste34', 'codigo': 1919, 'nome': 'Comprador Fictício Dois LTDA', 'fantasia': 'Fictício Dois', 'bloq': False},
            '33.333.333/0001-33': {'senha': 'Teste56', 'codigo': 3030, 'nome': 'Comprador Bloqueado LTDA', 'fantasia': 'Bloqueado', 'bloq': True},
        }
        self.produtos = [produto(i) for i in range(101, 146)]
        P = {p['id']: p for p in self.produtos}
        P[101].update(preco='11.50', seu_preco='11.50', quantidade_disponivel='30', unidades=[{'id': 'CX12', 'nome': 'CX', 'descricao': 'Caixa com 12', 'preco': '125.00', 'seu_preco': '125.00', 'quantidade_disponivel': '2'}])
        P[112].update(quantidade_disponivel='3')
        P[102].update(disponibilidade='sob_consulta', compravel=False, aviso='Preço sob consulta. Fale com o seu vendedor.')
        P[108].update(disponibilidade='sob_consulta', compravel=True, faixa_disponibilidade='indisponivel')
        P[103].update(disponibilidade='indisponivel', compravel=False, faixa_disponibilidade='indisponivel', aviso='Há uma venda em andamento com este produto no fornecedor. Tente de novo em instantes.')
        P[104].update(fotos=[1, 2], imagem='produtos/104/fotos/1')
        P[105].update(fotos=[1])  # foto que falha (404)
        P[119].update(fotos=[1])  # longe da tela: não pode ser baixada antes de rolar
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
        self.fotos_erro = set()  # produtos cuja galeria a API recusa (teste do caça-capa)
        self.galeria = {104: [{'item': 1, 'descricao': 'Frente'}, {'item': 2, 'descricao': 'Lado'}]}
        self.capas = {104: 1}
        self.vinculo_segundos = 300
        self.fotos_pedidas = []
        self.cadastros = []
        self.inclusoes = []; self.chaves_cli = {}; self.visiveis = None; self.lotes = []
        self.enderecos_post = []
        self.fichas = {1165: {'id': 1165, 'documento': '11111111000111', 'tipo_pessoa': 'juridica', 'nome': 'COMPRADOR FICTICIO UM LTDA', 'fantasia': 'Fictício Um', 'ie_rg': 'ISENTO', 'email': 'compras@example.invalid', 'telefone1': '34 99999-0000', 'telefone2': '', 'telefone3': '', 'contato': 'Fulano', 'endereco': {'cep': '38400100', 'logradouro': 'Avenida Exemplo', 'numero': '10', 'complemento': '', 'bairro': {'id': 5, 'nome': 'Centro'}, 'cidade': {'id': 9, 'nome': 'Cidade Exemplo'}, 'uf': 'MG', 'ibge': '3170206'}, 'acesso_liberado': False, 'revisao': 0, 'versao': 'a' * 64, 'pode_alterar': True, 'pode_alterar_acesso': True, 'ie_travada': False}}
        self.fichas_put = []
        self.vendedores = []
        self.clips = []
        self.banners = []
        self.negociacoes = []
        self.config = {'so_estoque': False, 'margem_minima': 15, 'estoque_minimo': 0}
        self.uploads = []
        self.sinonimos = [{'termo': 'durex', 'equivalentes': ['fita adesiva']}]
        self.eventos = []; self.acessos = {}; self.ensinos = []
        self.categorias = ['Limpeza', 'Descartáveis', 'Embalagens', 'Copa & Alimentos', 'Higiene', 'Utensílios & EPI', 'Papelaria', 'Outros']
        self.exibicao = {'P-104': {'codigo': 'P-104', 'produto_id': None, 'nome': 'Copo Descartável Exemplo 200ml (Pacote c/ 100 un)', 'categoria': 'Descartáveis', 'origem': 'legado'},
                         'P-140': {'codigo': 'P-140', 'produto_id': None, 'nome': 'Saco Lixo Exemplo Super Reforçado 100L', 'categoria': 'Limpeza', 'origem': 'legado'},
                         'P-141': {'codigo': 'P-141', 'produto_id': None, 'nome': 'Limpa Piso Exemplo Super Limpo 2L', 'categoria': 'Limpeza', 'origem': 'legado'}}

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
        if f.get('codigos'): cs = set(f['codigos'] if isinstance(f['codigos'], list) else f['codigos'].split(',')); res = [p for p in res if p['codigo'] in cs]
        pag, lim = int(f.get('pagina') or 1), min(int(f.get('limite') or 20), getattr(self, 'limite_api', 500))
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
                          'aviso': None, 'pendencia': None, 'quantidade_disponivel': (u.get('quantidade_disponivel') if u else p.get('quantidade_disponivel'))})
            disp = itens[-1]['quantidade_disponivel']
            if disp is not None and self.loja.get('bloqueia_sem_estoque') and Decimal(it['quantidade']) > Decimal(disp):
                itens[-1]['pendencia'] = 'Quantidade maior que a disponível.'
                pend.append({'codigo': 'ESTOQUE_INSUFICIENTE', 'mensagem': 'Há itens acima do estoque disponível.', 'responsavel': 'usuario'})
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
            longa = corpo.get('continuar_conectado') is True and int(self.loja.get('continuar_conectado_dias') or 0) > 0
            self.ultimo_login = corpo
            return self.ok(route, {'token': t, 'tipo': 'Bearer', 'expira_em': '2099-01-01T00:00:00Z', 'continuar_conectado': longa, 'comprador': self.comprador_json(corpo['usuario']), 'loja': self.loja}, 201)
        if caminho == 'acessos/senha' and m == 'POST':
            # Link de senha fictício: self.links = {token: documento}; o token vale uma vez.
            alvo = getattr(self, 'links', {}).pop(corpo.get('token'), None)
            if not alvo: return self.erro(route, 422, 'LINK_INVALIDO', 'O link é inválido ou expirou. Solicite um novo link.', 'usuario')
            self.compradores[alvo]['senha'] = corpo.get('senha_nova'); return route.fulfill(status=204, headers=CORS, body='')
        if caminho.startswith('operadores/'): return self.operador(route, caminho, m, corpo, q)
        if caminho.startswith('vitrine/'):
            self.vitrine_chamadas.append((caminho, dict(req.headers)))
            if not self.vitrine_aberta: return route.abort()   # vitrine fechada aparece como falha de rede/CORS
            if caminho == 'vitrine/produtos':
                f = {k: (v if k == 'termos[]' else v[0]) for k, v in q.items()}
                if f.get('ids'): f['ids'] = f['ids'].split(',')
                dados, pag = self.filtrar(f)
                pub = [{'id': p['id'], 'codigo': p['codigo'], 'nome': p['nome'], 'marca': p.get('marca'), 'grupo': p.get('grupo'), 'unidade': p.get('unidade'),
                        'aplicacao': None, 'imagem': (f"vitrine/produtos/{p['id']}/fotos/{p['fotos'][0]}" if p.get('fotos') else None), 'fotos': p.get('fotos', []),
                        'unidades': [{'id': u['id'], 'nome': u['nome'], 'descricao': u.get('descricao', '')} for u in p.get('unidades', [])], 'kit': False} for p in dados]
                return self.ok(route, pub, extra={'paginacao': pag})
            if caminho == 'vitrine/grupos': return self.ok(route, [{'codigo': 1, 'nome': 'Grupo Um', 'quantidade': 30}])
            if caminho == 'vitrine/marcas': return self.ok(route, [{'codigo': 10, 'nome': 'Marca Exemplo', 'quantidade': 23}, {'codigo': 20, 'nome': 'Outra Marca', 'quantidade': 22}])
            if re.match(r'vitrine/produtos/\d+/fotos/\d+$', caminho): return route.fulfill(status=200, headers={**CORS, 'Content-Type': 'image/gif'}, body=GIF)
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
            if mm.group(1) in getattr(self, 'foto_cair', {}) and self.foto_cair[mm.group(1)] > 0:
                self.foto_cair[mm.group(1)] -= 1; return route.abort()   # limite por IP/servidor ocupado: chega como falha de rede
            return route.fulfill(status=200, headers={**CORS, 'Content-Type': 'image/gif'}, body=GIF)
        if caminho == 'opcoes':
            return self.ok(route, {'modalidades': ['entrega', 'retirada'], 'enderecos': [
                {'id': 7, 'descricao': 'Matriz', 'endereco': 'Rua Exemplo', 'numero': '100', 'complemento': '', 'cidade': 'Cidade Exemplo', 'cep': '38400-000', 'principal': True}],
                'pagamento': {'exigido': 'parcelas', 'condicoes': [
                    {'id': 1, 'descricao': 'À vista', 'parcelas': 1, 'dias': [0], 'pedido_minimo': None, 'parcela_minima': None, 'taxa_por_parcela': None, 'padrao': True, 'pix': False},
                    {'id': 2, 'descricao': '30/60 dias', 'parcelas': 2, 'dias': [30, 60], 'pedido_minimo': '200.00', 'parcela_minima': None, 'taxa_por_parcela': None, 'padrao': False, 'pix': False},
                    {'id': 3, 'descricao': 'A Combinar', 'parcelas': 1, 'dias': [0], 'pedido_minimo': None, 'parcela_minima': None, 'taxa_por_parcela': None, 'padrao': False, 'pix': False}]}})
        mm = re.match(r'enderecos/cep/(\d{5}-?\d{3})$', caminho)
        if mm:
            c = mm.group(1).replace('-', '')
            if c == '38400100': return self.ok(route, {'cep': c, 'logradouro': 'Avenida Exemplo', 'bairro': {'id': 5, 'nome': 'Centro'}, 'cidade': {'id': 9, 'nome': 'Cidade Exemplo'}, 'uf': 'MG', 'ibge': '3170206'})
            if c == '38400000': return self.ok(route, {'cep': c, 'logradouro': '', 'bairro': {'id': None, 'nome': ''}, 'cidade': {'id': 9, 'nome': 'Cidade Exemplo'}, 'uf': 'MG', 'ibge': '3170206'})
            return self.erro(route, 404, 'CEP_NAO_ENCONTRADO', 'CEP não encontrado. Confira o número ou informe o endereço manualmente.', 'usuario')
        if caminho == 'enderecos/referencias':
            tipo = q.get('tipo', [''])[0]
            return self.ok(route, [{'id': 9, 'nome': 'Cidade Exemplo'}] if tipo == 'cidade' else [{'id': 5, 'nome': 'Centro'}, {'id': 6, 'nome': 'Bairro Dois'}])
        if caminho == 'enderecos' and m == 'POST':
            self.enderecos_post.append(corpo)
            return self.ok(route, {'id': 70 + len(self.enderecos_post), 'descricao': corpo['descricao'], 'endereco': corpo.get('endereco') or 'Avenida Exemplo', 'numero': corpo['numero'], 'complemento': corpo.get('complemento') or '', 'cidade': 'Cidade Exemplo', 'cep': corpo['cep'], 'principal': False}, 201)
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
            if cod != 1165: return self.ok(route, {'inicio': '2026-05-16', 'fim': '2026-11-16', 'produtos': []})
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
        mf = re.match(r'operadores/clientes/(\d+)(/acesso)?$', caminho)
        if mf:
            f = self.fichas.get(int(mf.group(1)))
            if not f: return self.erro(route, 404, 'CLIENTE_NAO_LOCALIZADO', 'Cliente não localizado.', 'usuario')
            if m == 'GET': return self.ok(route, f)
            if mf.group(2):
                if corpo.get('revisao') != f['revisao']: return self.erro(route, 409, 'CADASTRO_ALTERADO', 'O cadastro foi alterado em outra estação. Reabra a ficha antes de continuar.', 'usuario')
                f['acesso_liberado'] = corpo['liberado']; f['revisao'] += 1; f['versao'] = uuid.uuid4().hex * 2
                return self.ok(route, {'acesso_liberado': f['acesso_liberado'], 'revisao': f['revisao'], 'versao': f['versao']})
            self.fichas_put.append(corpo)
            if corpo.get('versao') != f['versao']: return self.erro(route, 409, 'CADASTRO_ALTERADO', 'O cadastro foi alterado em outra estação. Reabra a ficha antes de continuar.', 'usuario')
            if corpo.get('documento') == '99999999000199' and not corpo.get('confirmar_documento_repetido'):
                return self.erro(route, 409, 'DOCUMENTO_REPETIDO', 'Já existe um cadastro com este documento e outra IE ou RG. Confirme para continuar.', 'usuario')
            for k in ('documento', 'nome', 'fantasia', 'ie_rg', 'email', 'telefone1', 'telefone2', 'telefone3', 'contato'):
                if k in corpo: f[k] = corpo[k]
            if 'endereco' in corpo:
                e = corpo['endereco']
                for k in ('cep', 'logradouro', 'numero', 'complemento'):
                    if k in e: f['endereco'][k] = e[k]
            f['versao'] = uuid.uuid4().hex * 2
            return self.ok(route, f)
        mc = re.match(r'operadores/enderecos/cep/(\d{5}-?\d{3})$', caminho)
        if mc:
            c = mc.group(1).replace('-', '')
            if c == '38400200': return self.ok(route, {'cep': c, 'logradouro': 'Rua Nova', 'bairro': {'id': 6, 'nome': 'Bairro Dois'}, 'cidade': {'id': 9, 'nome': 'Cidade Exemplo'}, 'uf': 'MG', 'ibge': '3170206'})
            return self.erro(route, 404, 'CEP_NAO_ENCONTRADO', 'CEP não encontrado. Confira o número ou informe o endereço manualmente.', 'usuario')
        if caminho == 'operadores/enderecos/referencias':
            return self.ok(route, [{'id': 9, 'nome': 'Cidade Exemplo'}] if q.get('tipo', [''])[0] == 'cidade' else [{'id': 5, 'nome': 'Centro'}])
        if caminho == 'operadores/sessao': self.op_tokens.pop(tok, None); return route.fulfill(status=204, headers=CORS, body='')
        if caminho == 'operadores/cadastro/cliente':
            return self.ok(route, {'obrigatorios': ['telefone', 'categoria'], 'obrigatorios_pessoa_fisica': ['rg_se_nao_contribuinte'], 'editaveis': ['fantasia', 'email', 'telefone', 'contato', 'categoria', 'situacao', 'limite_credito_mensal'] + (['vendedor'] if getattr(self, 'novo_com_vendedor', False) else []), 'padroes': {'categoria_id': None, 'situacao_id': 2, 'vendedor_id': None}})
        if caminho == 'operadores/referencias':
            t = q.get('tipo', [''])[0]
            return self.ok(route, {'categoria': [{'id': 1, 'nome': 'Varejo'}, {'id': 3, 'nome': 'Atacado'}], 'situacao': [{'id': 2, 'nome': 'Normal'}], 'vendedor': [{'id': 3, 'nome': 'Vendedor Exemplo'}, {'id': 7, 'nome': 'Parceiro Fictício'}]}.get(t, []))
        if caminho == 'operadores/cadastro/cnpj':
            doc = re.sub(r'[^0-9A-Za-z]', '', corpo['cnpj']).upper()
            if set(corpo) != {'cnpj'}: return self.erro(route, 422, 'CAMPO_NAO_PERMITIDO', 'A solicitação tem campos que a API não aceita.', 'integracao')
            ja = [f for f in self.fichas.values() if f['documento'] == doc]
            if ja: return self.ok(route, {'ja_existe': True, 'cliente_id': ja[0]['id']})
            if doc == '55555555000155': return self.erro(route, 503, 'RECEITA_INDISPONIVEL', 'A consulta por CNPJ está indisponível. Tente novamente ou preencha o cadastro manualmente.', 'tentar_de_novo')
            return self.ok(route, {'ja_existe': False, 'documento': doc, 'razao_social': 'EMPRESA NOVA FICTICIA LTDA', 'nome': 'EMPRESA NOVA FICTICIA LTDA', 'fantasia': 'Nova Fictícia', 'ie_rg': '', 'email': '', 'telefone1': '', 'situacao_receita': 'INAPTA', 'situacao_irregular': True,
                                   'endereco': {'cep': '38400200', 'logradouro': 'Rua Nova', 'numero': '50', 'complemento': '', 'cidade': {'id': 9, 'nome': 'Cidade Exemplo'}, 'bairro': {'id': 6, 'nome': 'Bairro Dois'}, 'uf': 'MG'}})
        if caminho == 'operadores/clientes' and m == 'POST':
            chave = req.headers.get('idempotency-key', '')
            self.inclusoes.append((chave, corpo))
            if not re.match(r'^[A-Za-z0-9_-]{16,64}$', chave): return self.erro(route, 400, 'CHAVE_INVALIDA', 'Envio sem identificação. Atualize a página e tente novamente.', 'integracao')
            if self.cenario.get('incluir_cair'): self.cenario['incluir_cair'] -= 1; return route.abort()
            if chave in self.chaves_cli:
                if self.chaves_cli[chave][0] != corpo: return self.erro(route, 409, 'CHAVE_REUTILIZADA', 'Esta chave já foi usada em outra solicitação de inclusão.', 'integracao')
                return self.ok(route, self.fichas[self.chaves_cli[chave][1]])
            if corpo.get('ie_rg') == 'ISENTO' and not corpo.get('confirmar_isento'):
                return self.erro(route, 422, 'IE_ISENTO_SEM_CONFIRMACAO', 'Somente governo e organizações não governamentais podem ser ISENTO. Confirme ou informe NAO CONTRIBUINTE.', 'usuario')
            novo = max(self.fichas) + 1
            e = corpo['endereco']
            self.fichas[novo] = {'id': novo, 'documento': corpo['documento'], 'tipo_pessoa': 'fisica' if len(corpo['documento']) == 11 else 'juridica', 'nome': corpo['nome'], 'fantasia': corpo.get('fantasia', ''), 'ie_rg': corpo['ie_rg'],
                'email': corpo.get('email', ''), 'telefone1': corpo.get('telefone1', ''), 'telefone2': corpo.get('telefone2', ''), 'telefone3': corpo.get('telefone3', ''), 'contato': corpo.get('contato', ''),
                'endereco': {'cep': e['cep'], 'logradouro': e.get('logradouro') or 'Rua Nova', 'numero': e['numero'], 'complemento': e.get('complemento', ''), 'bairro': {'id': 6, 'nome': 'Bairro Dois'}, 'cidade': {'id': 9, 'nome': 'Cidade Exemplo'}, 'uf': 'MG', 'ibge': '3170206'},
                'acesso_liberado': False, 'revisao': 0, 'versao': 'b' * 64, 'pode_alterar': True, 'pode_alterar_acesso': True, 'ie_travada': False}
            self.chaves_cli[chave] = (corpo, novo)
            return self.ok(route, self.fichas[novo], 201)
        if caminho == 'operadores/clientes/consulta':
            if re.sub(r'[^0-9A-Za-z]', '', corpo['cnpj']) == '11111111000111': return self.ok(route, {'codigo': 1165, 'nome': 'Comprador Fictício Um LTDA', 'acesso_portal': True, 'segmento': {'codigo': 1, 'descricao': 'Varejo'}})
            return self.erro(route, 404, 'CLIENTE_NAO_LOCALIZADO', 'Cliente não localizado.', 'usuario')
        def prod_op(p, cliente=False):
            q = p.get('quantidade_disponivel')
            if q is None: q = '0' if p['disponibilidade'] == 'indisponivel' else '20'
            return {'id': p['id'], 'codigo': p['codigo'], 'nome': p['nome'], 'grupo': p['grupo'], 'marca': p['marca_detalhe'], 'unidade': p['unidade'], 'quantidade_disponivel': q,
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
            if sub is None and m == 'GET' and getattr(self, 'galeria_cair', 0) > 0:
                self.galeria_cair -= 1; return route.abort()   # servidor sobrecarregado: resposta sem CORS chega como falha de rede
            if sub is None and m == 'GET' and pid in self.fotos_erro: return self.erro(route, 404, 'NAO_ENCONTRADO', 'Produto não encontrado.', 'integracao')
            if sub is None and m == 'GET': return self.ok(route, gal())
            if sub is None and m == 'POST':
                item = max([f['item'] for f in g] or [0]) + 1; g.append({'item': item, 'descricao': corpo.get('descricao', '')})
                return self.ok(route, {**gal(), 'item': item}, 201)
            if sub == 'capa': f = next(x for x in g if x['item'] == corpo['item']); g.remove(f); g.insert(0, f); return self.ok(route, gal())
            if sub == 'ordem': g.sort(key=lambda x: corpo['itens'].index(x['item'])); return self.ok(route, gal())
            if m == 'GET': return route.fulfill(status=200, headers={**CORS, 'Content-Type': 'image/gif'}, body=GIF)
            if m == 'DELETE': g[:] = [x for x in g if x['item'] != int(sub)]; return self.ok(route, gal())
        return self.erro(route, 404, 'NAO_ENCONTRADO', 'Recurso não encontrado.', 'integracao')

    def comissao_do_pedido(self, r):
        # Igual ao gatilho do banco: pedido de cliente com vínculo ativo → comissão prevista (soma dos itens).
        if r.get('tipo') != 'pedido' or not r.get('pedido_id'): return
        from decimal import Decimal
        v = next((x for x in getattr(self, 'vinculos', []) if x.get('cliente_codigo') == r['comprador_codigo'] and x['situacao'] == 'ativo'), None)
        e = v and next((x for x in getattr(self, 'executivos', []) if x['id'] == v['executivo_id'] and x['ativo']), None)
        if not e: return
        com = self.__dict__.setdefault('comissoes', [])
        ref = f"P{r['pedido_id']}"
        if any(c['pedido_ref'] == ref for c in com): return
        base = sum((Decimal(str(i.get('total'))) for i in r.get('itens') or [] if re.fullmatch(r'\d+(\.\d+)?', str(i.get('total')))), Decimal(0))
        if base <= 0: return
        pct = Decimal(str(e['percentual'] if e.get('percentual') is not None else getattr(self, 'exec_cfg', {}).get('percentual', 3)))
        com.append({'id': str(uuid.uuid4()), 'executivo_id': e['id'], 'vinculo_id': v['id'], 'cliente_codigo': r['comprador_codigo'], 'pedido_ref': ref, 'pedido_numero': r.get('pedido_numero'),
                    'pedido_data': hoje_br(), 'pedido_em': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'competencia': hoje_br()[:8] + '01',
                    'itens': [{'nome': str(i.get('nome') or i.get('codigo') or 'Produto')[:120], 'quantidade': str(i.get('quantidade'))} for i in (r.get('itens') or [])[:100]], 'base': float(base.quantize(Decimal('0.01'))), 'percentual': float(pct),
                    'valor': float((base * pct / 100).quantize(Decimal('0.01'))), 'situacao': 'prevista', 'faturado_em': None, 'liberada_em': None, 'paga_em': None, 'observacao': None})

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
        if p == '/functions/v1/permissoes-g360':
            # Permissões próprias do painel: sim.perms_painel (padrão: tudo, menos 'executivos').
            corpo = json.loads(req.post_data or '{}')
            if corpo.get('token') not in self.op_tokens: return route.fulfill(status=401, headers=cab, content_type='application/json', body=json.dumps({'mensagem': 'Sua sessão do painel terminou. Entre novamente.'}))
            pp = getattr(self, 'perms_painel', ['visita', 'cli', 'neg', 'prod', 'cong', 'mrg', 'intel', 'souzinha', 'cfg', 'ocor'])
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps({'permissoes': pp, 'codigo': 12, 'nome': 'Operador Fictício'}))
        if p == '/functions/v1/push-g360':
            # Avisos no celular: só a parte do executivo (exec_*) e a chave pública.
            corpo = json.loads(req.post_data or '{}')
            res = lambda st, b: route.fulfill(status=st, headers=cab, content_type='application/json', body=json.dumps(b))
            self.__dict__.setdefault('push_chamadas', []).append(corpo.get('acao'))
            if corpo.get('acao') == 'chave': return res(200, {'chave': 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'})
            if str(corpo.get('acao', '')).startswith('exec_'):
                s2 = self.supa.get(corpo.get('sessao') or '') or {}
                e = next((x for x in getattr(self, 'executivos', []) if x['id'] == s2.get('executivo') and x['ativo']), None)
                if not e: return res(401, {'mensagem': 'Sua sessão terminou. Entre novamente.'})
                if corpo['acao'] == 'exec_teste': return res(200, {'enviados': 1, 'aparelhos': 1})
                return res(200, {'ok': True})
            return res(400, {'mensagem': 'Ação desconhecida.'})
        if p == '/functions/v1/cadastro-g360':
            # Cadastro automático: com cenario['auto'] == 'criado', o pedido recém-enviado ganha código no G360 e fica em análise.
            corpo = json.loads(req.post_data or '{}')
            doc = re.sub(r'[^A-Za-z0-9]', '', str(corpo.get('documento', ''))).upper()
            self.chamadas.append(('CADASTRO_AUTO', corpo.get('acao'), sorted(corpo.keys())))
            k = next((c for c in self.cadastros if c['documento'] == doc and not c.get('auto_status')), None)
            if corpo.get('acao') == 'cadastrar' and k and self.cenario.get('auto') == 'criado' and len(doc) in (11, 14):
                k.update({'codigo_g360': self.cenario.get('auto_codigo', 4242), 'em_analise': False, 'auto_status': 'criado', 'auto_obs': 'Ficha criada pelo portal.', 'status': 'aprovado'})
                return route.fulfill(status=200, headers=cab, content_type='application/json', body='{"resultado":"criado"}')
            if k: k.update({'auto_status': 'revisar', 'auto_obs': 'Ficou para a equipe.'})
            return route.fulfill(status=200, headers=cab, content_type='application/json', body='{"resultado":"analise"}')
        if p == '/functions/v1/executivo-link':
            # Executivo pede o link de acesso de um cliente aprovado dele (a função lê o documento e chama a ponte).
            corpo = json.loads(req.post_data or '{}')
            ses = self.supa.get(corpo.get('token') or '') or {}
            eid = ses.get('executivo'); e = next((x for x in getattr(self, 'executivos', []) if x['id'] == eid and x['ativo']), None)
            rs = lambda st, b: route.fulfill(status=st, headers=cab, content_type='application/json', body=json.dumps(b))
            if not e: return rs(401, {'mensagem': 'Sua sessão terminou. Entre novamente.'})
            v = next((x for x in getattr(self, 'vinculos', []) if x['id'] == corpo.get('vinculo_id') and x['executivo_id'] == eid and x['situacao'] in ('ativo', 'sem_comissao') and x.get('cliente_codigo')), None)
            if not v: return rs(404, {'mensagem': 'Este cliente não está na sua lista de clientes aprovados.'})
            links = self.__dict__.setdefault('exec_links', [])
            agora = time.time()
            if any(l['vinculo_id'] == v['id'] and agora - l['t'] < 120 for l in links):
                return rs(429, {'mensagem': 'O link acabou de ser enviado. Peça ao cliente para olhar o e-mail (e a caixa de spam) antes de pedir outro.'})
            em = time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(agora)) + '.000Z'
            links.append({'vinculo_id': v['id'], 't': agora, 'em': em})
            self.chamadas.append(('PONTE', 'pedir_link', {'via': 'executivo-link'}, {'documento': v['documento']}))
            self.chamadas.append(('EXEC_LINK', v['id'], sorted(corpo.keys())))
            return rs(200, {'dados': {'link_em': em}, 'mensagem': 'Pedido enviado. Se o acesso do cliente estiver liberado no G360, ele recebe o link no e-mail do cadastro. O link vale 30 minutos e serve uma vez só.'})
        if p == '/functions/v1/executivos-g360':
            # Programa Executivo de Contas (painel). exec_pode: o operador tem a permissão 'executivos'.
            corpo = json.loads(req.post_data or '{}')
            res = lambda st, b: route.fulfill(status=st, headers=cab, content_type='application/json', body=json.dumps(b))
            if corpo.get('token') not in self.op_tokens: return res(401, {'mensagem': 'Sua sessão do painel terminou. Entre novamente.'})
            ac = corpo.get('acao'); d = corpo.get('dados') or {}
            self.chamadas.append(('EXEC', ac, {k: v for k, v in d.items() if k != 'executivo'}))
            pode = getattr(self, 'exec_pode', True)
            ex = self.__dict__.setdefault('executivos', []); cfg = self.__dict__.setdefault('exec_cfg', {'percentual': 3, 'liberar_em': 'pagamento', 'so_novos': True, 'prazo_meses': 12})
            vs = self.__dict__.setdefault('vinculos', [])
            if ac == 'pode': return res(200, {'dados': {'pode': pode}})
            if ac in ('vinculo_do_cadastro', 'vinculo_ativar', 'vinculo_recusar'):
                v = next((x for x in vs if x['cadastro_id'] == d.get('cadastro_id') and x['situacao'] in ('aguardando', 'ativo')), None)
                if ac == 'vinculo_do_cadastro':
                    e = v and next((x for x in ex if x['id'] == v['executivo_id']), None)
                    return res(200, {'dados': {'nome': e['nome'], 'codigo': e['codigo'], 'vendedor_g360': e.get('vendedor_g360'), 'vendedor_nome': e.get('vendedor_nome'), 'situacao': v['situacao']} if e else None})
                if ac == 'vinculo_recusar':
                    if v and v['situacao'] == 'aguardando': v.update(situacao='recusado', motivo='Pedido reprovado')
                    return res(200, {'ok': True})
                if not v: return res(200, {'dados': None})
                ja = d.get('novo') is not True or int(d['cliente_codigo']) in self.acessos
                if cfg['so_novos'] and ja: v.update(situacao='sem_comissao', motivo='Cliente já existente — não gera comissão', cliente_codigo=int(d['cliente_codigo']), inicio=None, fim=None)
                else: v.update(situacao='ativo', motivo=None, cliente_codigo=int(d['cliente_codigo']), inicio='2026-11-24', fim='2027-11-24' if cfg['prazo_meses'] == 12 else None)
                return res(200, {'dados': {'situacao': v['situacao'], 'motivo': v['motivo'], 'fim': v['fim']}})
            if not pode: return res(403, {'mensagem': 'Só o administrador do programa de executivos pode ver esta área.'})
            if ac == 'vinculos_cadastros': return res(200, {'dados': {'executivos': [{k: e[k] for k in ('id', 'codigo', 'nome', 'ativo')} for e in ex], 'vinculos': [v for v in vs if v.get('cadastro_id')]}})
            if ac == 'clientes': return res(200, {'dados': [v for v in vs if v['executivo_id'] == d.get('executivo_id')]})
            com = self.__dict__.setdefault('comissoes', [])
            if ac == 'relatorio':
                nomes = {v['id']: v.get('razao_social') for v in vs}
                return res(200, {'dados': {'config': cfg, 'executivos': [{k: e.get(k) for k in ('id', 'codigo', 'nome', 'ativo', 'percentual')} for e in ex],
                                           'comissoes': [{**c, 'cliente': nomes.get(c['vinculo_id']) or f"Cliente {c['cliente_codigo']}"} for c in com if c['competencia'] == d['mes'] + '-01']}})
            if ac == 'recalcular':
                n0 = len(com)
                for r in self.eventos: self.comissao_do_pedido(r)
                return res(200, {'dados': {'novas': len(com) - n0}})
            if ac == 'comissao_marcar':
                dia = d.get('data') or '2026-11-24'; obs = d.get('observacao') or None
                regras = {'faturada': (['prevista'], {'situacao': 'liberada', 'faturado_em': dia, 'liberada_em': dia} if cfg['liberar_em'] == 'faturamento' else {'situacao': 'faturada', 'faturado_em': dia}),
                          'cliente_pagou': (['prevista', 'faturada'], {'situacao': 'liberada', 'liberada_em': dia}),
                          'paga': (['liberada'], {'situacao': 'paga', 'paga_em': dia, **({'observacao': obs} if obs else {})}),
                          'cancelar': (['prevista', 'faturada', 'liberada'], {'situacao': 'cancelada', **({'observacao': obs} if obs else {})}),
                          'reabrir': (['cancelada'], {'situacao': 'prevista'})}
                de, mud = regras[d['acao']]; n = 0
                for c in com:
                    if c['id'] in d['ids'] and c['situacao'] in de: c.update(mud); n += 1
                return res(200, {'dados': {'alterados': n}})
            if ac == 'vinculo_definir':
                abertos = [v for v in vs if v['cadastro_id'] == d['cadastro_id'] and v['situacao'] in ('aguardando', 'ativo')]
                if d.get('executivo_id') is None:
                    for v in abertos: v.update(situacao='removido', motivo='Removido pela equipe')
                    return res(200, {'ok': True})
                if abertos: abertos[0]['executivo_id'] = d['executivo_id']
                else:
                    k = next(c for c in self.cadastros if c.get('id') == d['cadastro_id'])
                    vs.append({'id': str(uuid.uuid4()), 'executivo_id': d['executivo_id'], 'cadastro_id': k['id'], 'documento': k['documento'], 'razao_social': k.get('razao_social', ''), 'situacao': 'aguardando', 'motivo': None, 'inicio': None, 'fim': None, 'cliente_codigo': None, 'criado_em': '2026-11-24T12:00:00Z'})
                return res(200, {'ok': True})
            if ac == 'listar': return res(200, {'dados': {'executivos': [{k: v for k, v in e.items() if k != 'senha'} for e in ex], 'config': cfg}})
            if ac == 'salvar':
                e = d['executivo']; cod = str(e.get('codigo', '')).upper()
                if not re.fullmatch(r'[A-Z0-9]{3,20}', cod): return res(400, {'mensagem': 'Código com 3 a 20 letras ou números, sem espaços (ex.: JOAO).'})
                if any(x['codigo'] == cod and x['id'] != e.get('id') for x in ex): return res(409, {'mensagem': f'O código {cod} já é de outro executivo.'})
                if not e.get('id') and len(e.get('senha') or '') < 8: return res(400, {'mensagem': 'Defina a senha de acesso do executivo (8 caracteres ou mais).'})
                if '@' not in (e.get('email') or ''): return res(400, {'mensagem': 'Digite um e-mail válido. Ele é o login do executivo.'})
                self.exec_senhas = getattr(self, 'exec_senhas', {})
                atual = next((x for x in ex if x['id'] == e.get('id')), None)
                if not atual: atual = {'id': str(uuid.uuid4()), 'ativo': True, 'tem_acesso': True, 'clientes': {'ativos': 0, 'aguardando': 0}, 'criado_em': '2026-11-24T12:00:00Z'}; ex.append(atual)
                pct = str(e.get('percentual') or '').replace(',', '.')
                norm = lambda t: re.sub(r'[^a-z0-9]+', ' ', t.lower()).strip()
                atual['ocultar_termos'] = [norm(t) for t in str(e.get('ocultar_termos') or '').split(',') if norm(t)]
                oc = e.get('ocultar_codigos') or []
                atual['ocultar_codigos'] = [str(c).strip().upper() for c in (oc if isinstance(oc, list) else re.split(r'[,;\s]+', str(oc))) if str(c).strip()]
                atual.update(codigo=cod, nome=e.get('nome'), documento=e.get('documento'), whatsapp=e.get('whatsapp') or None, email=e.get('email'),
                             percentual=float(pct) if pct else None, vendedor_g360=e.get('vendedor_g360'), vendedor_nome=e.get('vendedor_nome') or None)
                if e.get('senha'): self.exec_senhas[atual['id']] = e['senha']
                return res(200, {'dados': atual})
            if ac == 'situacao':
                for x in ex:
                    if x['id'] == d.get('id'): x['ativo'] = d.get('ativo') is True
                return res(200, {'ok': True})
            if ac == 'config_salvar':
                cfg.update(percentual=float(str(d.get('percentual')).replace(',', '.')), liberar_em=d.get('liberar_em'), so_novos=d.get('so_novos') is not False, prazo_meses=d.get('prazo_meses'))
                return res(200, {'dados': cfg})
            return res(400, {'mensagem': 'Ação desconhecida.'})
        if p == '/functions/v1/painel-g360':
            corpo = json.loads(req.post_data or '{}')
            res = lambda st, b: route.fulfill(status=st, headers=cab, content_type='application/json', body=json.dumps(b))
            if corpo.get('token') not in self.op_tokens: return res(401, {'mensagem': 'Sua sessão do painel terminou. Entre novamente.'})
            ac = corpo.get('acao'); d = corpo.get('dados') or {}
            if ac == 'exibicao_salvar':
                n = 0
                for l in d.get('linhas', []):
                    atual = self.exibicao.get(l['codigo'])
                    if d.get('preservar') and atual and atual['origem'] != 'automatico': continue
                    novo = {k: l.get(k) for k in ('codigo', 'produto_id', 'nome', 'categoria', 'origem')}
                    if 'secao' in l:
                        ok_sec = any(x['categoria'] == l.get('categoria') and x['nome'] == l['secao'] and not x.get('pai') for x in getattr(self, 'secoes', []))
                        novo['secao'] = l['secao'] if l['secao'] and ok_sec else None
                    elif atual and 'secao' in atual: novo['secao'] = atual['secao']
                    self.exibicao[l['codigo']] = {**(atual or {}), **novo}; n += 1
                self.chamadas.append(('PAINEL', ac, n))
                return res(200, {'gravados': n})
            if ac in ('lista_ler', 'lista_incluir', 'lista_remover'):
                cod = int(d['comprador']); atual = self.lista.setdefault(cod, set())
                if ac == 'lista_incluir': atual.update(int(i) for i in d['produto_ids'])
                if ac == 'lista_remover': atual.discard(int(d['produto_id']))
                return res(200, {'dados': sorted(atual)})
            if ac == 'ensinos_listar': return res(200, {'dados': self.ensinos})
            if ac == 'ensinos_salvar':
                x = dict(d); x['id'] = x.get('id') or f'00000000-0000-0000-0000-{len(self.ensinos)+1:012d}'
                self.ensinos = [e for e in self.ensinos if e['id'] != x['id']] + [x]; return res(200, {'ok': True})
            if ac == 'ensinos_apagar': self.ensinos = [e for e in self.ensinos if e['id'] != d['id']]; return res(200, {'ok': True})
            if ac == 'sinonimos_salvar': self.sinonimos = d['sinonimos']; return res(200, {'gravados': len(d['sinonimos'])})
            if ac == 'clientes_listar': return res(200, {'dados': [{'codigo': c, 'nome': n, 'primeiro_em': '2026-11-17T12:00:00Z', 'ultimo_em': '2026-11-17T12:00:00Z', 'acessos': 1, 'pedidos': 0, 'valor': 0} for c, n in self.acessos.items()]})
            if ac == 'inteligencia':
                peds = [e for e in self.eventos if e['tipo'] == 'pedido']; bus = [e for e in self.eventos if e['tipo'] == 'busca']
                return res(200, {'dados': {'dias': d.get('dias', 30), 'pedidos': len(peds), 'valor': sum(float(e.get('valor') or 0) for e in peds), 'ticket': 0, 'clientes_compraram': len({e['comprador_codigo'] for e in peds}), 'clientes_entraram': len(self.acessos),
                    'buscas': len(bus), 'buscas_sem_resultado': len([b for b in bus if not b.get('resultados')]), 'top_buscas': [{'termo': b['termo'], 'vezes': 1} for b in bus], 'sem_resultado': [{'termo': b['termo'], 'vezes': 1} for b in bus if not b.get('resultados')],
                    'aparelhos': {k: (lambda l: {**{t: len([e for e in l if e.get('aparelho') == t]) for t in ('computador', 'celular', 'tablet')}, 'app': len([e for e in l if e.get('app')]),
                        'clientes': {t: len({e['comprador_codigo'] for e in l if e.get('aparelho') == t}) for t in ('computador', 'celular', 'tablet')},
                        'valor': {t: sum(float(e.get('valor') or 0) for e in l if e.get('aparelho') == t) for t in ('computador', 'celular', 'tablet')}})([e for e in self.eventos if e['tipo'] == k2])
                        for k, k2 in (('acessos', 'acesso'), ('pedidos', 'pedido'))},
                    'top_produtos': [], 'top_clientes': [], 'por_dia': [], 'ultimos_pedidos': [{'quando': '2026-11-17T12:00:00Z', 'cliente': 'x', 'numero': e.get('pedido_numero'), 'valor': e.get('valor')} for e in peds]}})
            if ac == 'categorias_salvar': self.categorias = d['categorias']; return res(200, {'ok': True})
            if ac == 'secoes_salvar':
                if not any(x['termos'] for x in d['secoes']) and d['secoes']: return res(400, {'mensagem': 'precisa de palavra'})
                sec = [x for x in getattr(self, 'secoes', []) if x['categoria'] != d['categoria']]
                for i, x in enumerate(d['secoes']):
                    sid = str(uuid.uuid4()); sec.append({'id': sid, 'categoria': d['categoria'], 'pai': None, 'nome': x['nome'], 'termos': x['termos'], 'ordem': i})
                    for j, l in enumerate(x.get('linhas', [])): sec.append({'id': str(uuid.uuid4()), 'categoria': d['categoria'], 'pai': sid, 'nome': l['nome'], 'termos': l['termos'], 'ordem': j})
                self.secoes = sec; return res(200, {'gravadas': len(d['secoes'])})
            if ac == 'ocorrencias_listar': return res(200, {'dados': list(reversed(self.ocorrencias))})
            if ac == 'cadastros_listar':
                for i, c in enumerate(self.cadastros):
                    c.setdefault('id', str(uuid.UUID(int=i + 1))); c.setdefault('status', 'pendente'); c.setdefault('criado_em', '2026-11-17T12:00:00+00:00')
                return res(200, {'dados': list(reversed(self.cadastros))})
            if ac == 'produto_extra_salvar':
                r = self.exibicao.get(d['codigo'])
                if not r: r = self.exibicao[d['codigo']] = {'codigo': d['codigo'], 'produto_id': d.get('produto_id'), 'nome': d.get('nome'), 'categoria': d.get('categoria'), 'origem': 'automatico'}
                if 'descricao' in d: r['descricao'] = d['descricao'] or None
                if 'oculto' in d: r['oculto'] = d['oculto'] is True
                if 'palavras_chave' in d: r['palavras_chave'] = ', '.join(dict.fromkeys(x.strip() for x in d['palavras_chave'].split(',') if x.strip())) or None
                return res(200, {'ok': True})
            if ac == 'condicoes_ler':
                comp = int(d.get('comprador') or 0); por = {}
                for cod, cs in self.cond_vistas.items():
                    if comp and cod != comp: continue
                    for i, desc in cs: r = por.setdefault(i, {'id': i, 'descricao': desc, 'clientes': 0, 'visto_em': '2026-11-18T22:00:00+00:00'}); r['clientes'] += 1
                return res(200, {'dados': {'condicoes': sorted(por.values(), key=lambda x: x['descricao']), 'ocultas_todos': self.cond_ocultas.get(0, []), 'ocultas_cliente': self.cond_ocultas.get(comp, []) if comp else []}})
            if ac == 'condicoes_salvar':
                self.cond_ocultas[int(d.get('comprador') or 0)] = [int(x) for x in d.get('condicoes', [])]; return res(200, {'ok': True})
            if ac == 'visiveis_ler': return res(200, {'dados': self.visiveis})
            if ac == 'visiveis_gravar':
                self.visiveis = {'visiveis': d['visiveis'], 'estoque_baixo': d['estoque_baixo'], 'sem_estoque': d['sem_estoque'], 'estoque_minimo': d['estoque_minimo'], 'atualizado_em': '2026-11-18T22:00:00+00:00'}
                return res(200, {'ok': True})
            if ac == 'lotes_listar':
                # Teste: outra pessoa grava um lote enquanto este é conferido (na n-ésima leitura)
                if getattr(self, 'intruso', None):
                    self.intruso['n'] -= 1
                    if self.intruso['n'] < 0:
                        self.lotes.append({'id': str(uuid.uuid4()), 'numero': max([x['numero'] for x in self.lotes] or [0]) + 1, 'responsavel': 'Maria', 'codigos': self.intruso['codigos'], 'pulados': [], 'criado_em': '2026-11-18T13:00:00+00:00'}); self.intruso = None
                return res(200, {'dados': sorted(self.lotes, key=lambda l: -l['numero'])})
            if ac == 'lote_salvar':
                # Como o gatilho do banco: produto que já está em outro lote sai do lote novo
                ja = {c for x in self.lotes for c in x['codigos']}
                l = {'id': str(uuid.uuid4()), 'numero': max([x['numero'] for x in self.lotes] or [0]) + 1, 'responsavel': d.get('responsavel') or None, 'codigos': [c for c in d['codigos'] if c not in ja], 'pulados': [], 'criado_em': '2026-11-18T13:00:00+00:00'}
                self.lotes.append(l); return res(200, {'dados': l})
            if ac == 'lote_sobras':
                # Como a função portal_lote_sobras: tira dos lotes de dias anteriores e grava um lote novo
                hoje = time.strftime('%Y-%m-%d')
                for x in self.lotes:
                    if x['criado_em'][:10] < hoje:
                        x['codigos'] = [c for c in x['codigos'] if c not in d['codigos']]; x['pulados'] = [c for c in x.get('pulados', []) if c not in d['codigos']]
                self.lotes = [x for x in self.lotes if x['codigos']]  # lote antigo que esvaziou é apagado (o banco não aceita lote vazio)
                ja = {c for x in self.lotes for c in x['codigos']}
                livres = [c for c in d['codigos'] if c not in ja]
                if not livres: return res(200, {'dados': None})
                l = {'id': str(uuid.uuid4()), 'numero': max([x['numero'] for x in self.lotes] or [0]) + 1, 'responsavel': d.get('responsavel') or None, 'codigos': livres, 'pulados': [], 'criado_em': time.strftime('%Y-%m-%dT%H:%M:%S+00:00')}
                self.lotes.append(l); return res(200, {'dados': l})
            if ac == 'lote_pular':
                l = next(x for x in self.lotes if x['id'] == d['id']); pul = set(l.get('pulados', []))
                (pul.discard if d.get('pular') is False else pul.add)(d['codigo']); l['pulados'] = sorted(pul); return res(200, {'dados': l['pulados']})
            if ac == 'lote_apagar': self.lotes = [x for x in self.lotes if x['id'] != d['id']]; return res(200, {'ok': True})
            if ac == 'config_ler': return res(200, {'dados': dict(self.config)})
            if ac == 'config_salvar':
                for k in ('so_estoque', 'margem_minima', 'estoque_minimo'):
                    if k in d: self.config[k] = d[k]
                return res(200, {'dados': dict(self.config)})
            if ac == 'clips_listar': return res(200, {'dados': list(self.clips)})
            if ac == 'clip_upload_url':
                cam = f"{LOJA}/{uuid.uuid4()}.mp4"; return res(200, {'dados': {'caminho': cam, 'url': f'https://sb.example/storage/v1/object/upload/sign/portal-clips/{cam}?token=t', 'token': 't'}})
            if ac == 'clip_salvar':
                if d.get('id'):
                    for c in self.clips:
                        if c['id'] == d['id']: c.update({k: d[k] for k in ('titulo', 'ativo') if k in d})
                    return res(200, {'ok': True})
                c = {'id': str(uuid.uuid4()), 'produto_id': d['produto_id'], 'codigo': d['codigo'], 'titulo': d.get('titulo') or None, 'caminho': d['caminho'], 'ativo': True, 'criado_em': '2026-11-17T18:00:00+00:00'}
                self.clips.insert(0, c); return res(200, {'dados': {'id': c['id']}})
            if ac == 'banners_listar': return res(200, {'dados': sorted(self.banners, key=lambda b: b['ordem'])})
            if ac == 'banner_upload_url':
                video = d.get('tipo') == 'video/mp4'
                assert (video and 0 < d.get('tamanho', 0) <= 8 * 1024 * 1024) or (d.get('tipo') == 'image/jpeg' and 0 < d.get('tamanho', 0) <= 3 * 1024 * 1024), d
                cam = f"{LOJA}/{uuid.uuid4()}.{'mp4' if video else 'jpg'}"; return res(200, {'dados': {'caminho': cam, 'url': f'https://sb.example/storage/v1/object/upload/sign/portal-banners/{cam}?token=t', 'token': 't'}})
            if ac == 'banner_salvar':
                campos = ('titulo', 'img_desktop', 'img_celular', 'video_desktop', 'video_celular', 'destino_tipo', 'destino_valor', 'ordem', 'inicio', 'fim', 'ativo')
                val = {k: (d[k] if d[k] != '' else None) for k in campos if k in d}
                if d.get('id'):
                    for b in self.banners:
                        if b['id'] == d['id']: b.update(val)
                    return res(200, {'ok': True})
                if not val.get('titulo') or not val.get('img_desktop'): return res(400, {'mensagem': 'Título e imagem do computador são obrigatórios.'})
                b = {'id': str(uuid.uuid4()), 'img_celular': None, 'video_desktop': None, 'video_celular': None, 'destino_valor': None, 'inicio': None, 'fim': None, 'ativo': True, 'ordem': 0, 'criado_em': '2026-11-21T02:00:00+00:00', **val}
                self.banners.append(b); return res(200, {'dados': {'id': b['id']}})
            if ac == 'banner_apagar': self.banners = [b for b in self.banners if b['id'] != d['id']]; return res(200, {'ok': True})
            if ac == 'clip_apagar': self.clips = [c for c in self.clips if c['id'] != d['id']]; return res(200, {'ok': True})
            if ac == 'negociacoes_listar': return res(200, {'dados': list(reversed(self.negociacoes))})
            if ac == 'negociacao_decidir':
                for n in self.negociacoes:
                    if n['id'] == d['id'] and n['status'] == 'aberta':
                        n.update({'status': d['status'], 'resposta': d.get('resposta') or None, 'preco_aprovado': d.get('preco_aprovado'), 'valido_ate': d.get('valido_ate')}); return res(200, {'ok': True})
                return res(409, {'mensagem': 'Esta negociação já foi respondida ou cancelada pelo cliente.'})
            if ac == 'vendedores_listar': return res(200, {'dados': list(self.vendedores)})
            if ac == 'vendedores_salvar': self.vendedores = [v.strip() for v in d.get('vendedores', []) if v.strip()]; return res(200, {'dados': list(self.vendedores)})
            if ac == 'cliente_salvar':
                c = dict(d.get('cliente') or {}); doc = re.sub(r'[^A-Za-z0-9]', '', c.get('documento', '')).upper()
                igual = [x for x in self.cadastros if x['documento'] == doc and x.get('id') != c.get('id')]
                if igual: return res(409, {'mensagem': 'Já existe uma ficha com este CNPJ. Abrimos a ficha existente.', 'id': igual[0].get('id')})
                c['documento'] = doc; c['codigo_g360'] = int(c['codigo_g360']) if c.get('codigo_g360') else None
                if c.get('id'):
                    for x in self.cadastros:
                        if x.get('id') == c['id']: x.update(c); return res(200, {'dados': x})
                    return res(404, {'mensagem': 'Ficha não encontrada.'})
                c.update({'id': str(uuid.uuid4()), 'criado_por': 'equipe', 'criado_em': '2026-11-17T13:00:00+00:00', 'loja': '96da1e99a3f327f0'}); self.cadastros.append(c)
                return res(200, {'dados': c})
            if ac == 'cadastro_vincular':
                cod = int(d['codigo_g360']); f = self.fichas.get(cod)
                for c in self.cadastros:
                    if c['id'] == d['id']:
                        if not f or f['documento'] != c['documento']: return res(409, {'mensagem': 'O cliente do G360 tem outro documento. O pedido não foi vinculado.'})
                        c.update(codigo_g360=cod, status='aprovado'); return res(200, {'dados': c})
                return res(404, {'mensagem': 'Cadastro não encontrado.'})
            if ac == 'cadastro_liberar_precos':
                k = next((c for c in self.cadastros if c.get('id') == d.get('id') and c.get('em_analise')), None)
                if not k: return res(409, {'mensagem': 'Este pedido não está mais em análise. Atualize a lista.'})
                k.update({'em_analise': False, 'status': 'aprovado'}); self.chamadas.append(('LIBERAR_PRECOS', k['id']))
                return res(200, {'dados': k, 'email_enviado': True})
            if ac == 'cadastro_decidir':
                for c in self.cadastros:
                    if c.get('id') == d.get('id'): c['status'] = d['status']; c['observacao_equipe'] = d.get('observacao') or None; return res(200, {'ok': True})
                return res(404, {'mensagem': 'Cadastro não encontrado.'})
            return res(400, {'mensagem': 'Ação desconhecida.'})
        if p == '/rest/v1/rpc/portal_cadastro_situacao':
            corpo = json.loads(req.post_data or '{}'); doc = re.sub(r'[^A-Za-z0-9]', '', corpo.get('p_documento', '')).upper()
            k = next((c for c in self.cadastros if c['documento'] == doc), None)
            st = None if not k else ('aprovado' if k.get('codigo_g360') else k.get('status', 'pendente'))
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps(st))
        if p == '/rest/v1/rpc/portal_cadastro_solicitar':
            corpo = json.loads(req.post_data or '{}'); d = corpo.get('d', {})
            doc = re.sub(r'[^A-Za-z0-9]', '', d.get('documento', '')).upper()
            if any(c['documento'] == doc for c in self.cadastros):
                return route.fulfill(status=400, headers=cab, content_type='application/json', body=json.dumps({'code': 'P0001', 'message': 'Já recebemos um cadastro com este documento. A equipe da Souza Ribeiro vai entrar em contato.'}))
            novo = {**d, 'documento': doc, 'loja': corpo.get('p_loja'), 'id': str(uuid.uuid4())}
            ex_cod = re.sub(r'[^A-Z0-9]', '', str(novo.pop('executivo', '') or '').upper())
            novo['executivo_codigo'] = ex_cod or None
            self.cadastros.append(novo)
            e = next((x for x in getattr(self, 'executivos', []) if x['codigo'] == ex_cod and x['ativo']), None)
            if e and not any(v['documento'] == doc and v['situacao'] in ('aguardando', 'ativo') for v in self.__dict__.setdefault('vinculos', [])):
                self.vinculos.append({'id': str(uuid.uuid4()), 'executivo_id': e['id'], 'cadastro_id': novo['id'], 'documento': doc, 'razao_social': d.get('razao_social', ''), 'situacao': 'aguardando', 'motivo': None, 'inicio': None, 'fim': None, 'cliente_codigo': None, 'criado_em': '2026-11-24T12:00:00Z'})
            return route.fulfill(status=200, headers=cab, content_type='application/json', body='{"status":"pendente"}')
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
            # Área do executivo: e-mail + senha cadastrados no painel (exec_senhas por id do executivo).
            e = next((x for x in getattr(self, 'executivos', []) if x.get('email') == corpo.get('email') and getattr(self, 'exec_senhas', {}).get(x['id']) == corpo.get('password')), None)
            if e:
                at = self.jwt('ex-' + e['id'], {'app_metadata': {'g360_executivo': e['id'], 'g360_loja': LOJA}})
                self.supa[at] = {'executivo': e['id'], 'vinculo': time.time() + 3600}
                return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps({
                    'access_token': at, 'refresh_token': 'r', 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': int(time.time()) + 3600,
                    'user': {'id': 'ex-' + e['id'], 'aud': 'authenticated', 'email': e['email'], 'app_metadata': {}, 'user_metadata': {}}}))
            return route.fulfill(status=400, headers=cab, content_type='application/json', body='{"error":"invalid_grant","error_description":"Invalid login credentials"}')
        tabela = p.replace('/rest/v1/', '')
        if tabela == 'rpc/portal_ocultos_executivo':
            cod = json.loads(req.post_data or '{}').get('p_codigo')
            e = next((x for x in getattr(self, 'executivos', []) if x['codigo'] == cod and x['ativo']), None)
            self.chamadas.append(('RPC', 'portal_ocultos_executivo', cod))
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps({'termos': e.get('ocultar_termos', []), 'codigos': e.get('ocultar_codigos', [])} if e else {'termos': [], 'codigos': []}))
        if tabela == 'rpc/executivo_acessos':
            # Último acesso dos clientes aprovados do executivo logado (portal_acessos) e o último link pedido.
            eid = (s or {}).get('executivo'); e = next((x for x in getattr(self, 'executivos', []) if x['id'] == eid and x['ativo']), None)
            linhas = []
            for v in (getattr(self, 'vinculos', []) if e else []):
                if v['executivo_id'] != eid or v['situacao'] not in ('ativo', 'sem_comissao') or not v.get('cliente_codigo'): continue
                a = getattr(self, 'acessos_portal', {}).get(v['cliente_codigo'], {})
                ls = [l['em'] for l in getattr(self, 'exec_links', []) if l['vinculo_id'] == v['id']]
                linhas.append({'vinculo_id': v['id'], 'primeiro_em': a.get('primeiro_em'), 'ultimo_em': a.get('ultimo_em'), 'acessos': a.get('acessos'), 'link_em': max(ls) if ls else None})
            self.chamadas.append(('RPC', 'executivo_acessos', eid))
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps(linhas))
        if tabela in ('executivos', 'executivo_clientes', 'comissoes'):
            # RLS: só o executivo logado (e ativo) lê as próprias linhas; qualquer outra sessão recebe lista vazia.
            eid = (s or {}).get('executivo'); e = next((x for x in getattr(self, 'executivos', []) if x['id'] == eid and x['ativo']), None)
            if not e: return route.fulfill(status=200, headers=cab, content_type='application/json', body='[]')
            cols = {'executivos': ['id', 'codigo', 'nome', 'ocultar_termos', 'ocultar_codigos'], 'executivo_clientes': ['id', 'razao_social', 'situacao', 'inicio', 'fim', 'criado_em'],
                    'comissoes': ['id', 'vinculo_id', 'pedido_data', 'pedido_em', 'pedido_numero', 'itens', 'competencia', 'base', 'percentual', 'valor', 'situacao', 'paga_em']}[tabela]
            fonte = [e] if tabela == 'executivos' else [x for x in getattr(self, 'vinculos' if tabela == 'executivo_clientes' else 'comissoes', []) if x['executivo_id'] == eid]
            self.chamadas.append(('EXEC_RLS', tabela, eid))
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps([{k: x.get(k) for k in cols} for x in fonte]))
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
                if q.get('comprador_codigo', [''])[0] != f"eq.{s['codigo']}" or q.get('loja', [''])[0] != f'eq.{LOJA}':
                    return route.fulfill(status=204, headers=cab, body='')  # a RLS só apaga as linhas do próprio comprador
                if 'produto_id' not in q: self.lista[s['codigo']] = set(); return route.fulfill(status=204, headers=cab, body='')
                pid = int(q['produto_id'][0].replace('eq.', ''))
                self.lista.get(s['codigo'], set()).discard(pid); return route.fulfill(status=204, headers=cab, body='')
        if p.startswith('/storage/v1/object/upload/sign/portal-clips/'):
            self.uploads.append(p); self.upload_corpos = getattr(self, 'upload_corpos', []) + [(req.post_data_buffer or b'', dict(req.headers))]; return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps({'Key': p}))
        if p.startswith('/storage/v1/object/public/portal-clips/'):
            if getattr(self, 'clip_publico', None): return route.fulfill(status=200, headers={**cab, 'Content-Type': 'video/mp4'}, body=self.clip_publico)
            return route.fulfill(status=404, headers=cab, body='')
        if p.startswith('/storage/v1/object/upload/sign/portal-banners/'):
            self.banner_uploads = getattr(self, 'banner_uploads', []) + [(p, len(req.post_data_buffer or b''))]; self.banner_bytes = getattr(self, 'banner_bytes', []) + [req.post_data_buffer or b'']; return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps({'Key': p}))
        if p.startswith('/storage/v1/object/public/portal-banners/') and p.endswith('.mp4'):
            return route.fulfill(status=200, headers={**cab, 'Content-Type': 'video/mp4'}, body=getattr(self, 'banner_video', b''))
        if p.startswith('/storage/v1/object/public/portal-banners/'):
            # JPEG 1x1 branco (só para a imagem carregar)
            jpg = base64.b64decode('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=')
            return route.fulfill(status=200, headers={**cab, 'Content-Type': 'image/jpeg'}, body=jpg)
        if tabela == 'portal_banners':
            hoje = '2026-11-21'
            vis = [b for b in sorted(self.banners, key=lambda b: b['ordem']) if b['ativo'] and (not b['inicio'] or b['inicio'] <= hoje) and (not b['fim'] or b['fim'] >= hoje)]
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps(vis))
        if tabela == 'portal_clips':
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps([c for c in self.clips if c['ativo']]))
        if tabela == 'rpc/portal_condicoes_sincronizar':
            if not valido: return route.fulfill(status=400, headers=cab, content_type='application/json', body=json.dumps({'message': 'sessao'}))
            b = json.loads(req.post_data or '{}'); cod = s['codigo']
            self.cond_vistas[cod] = [(int(c['id']), c['descricao']) for c in b.get('p_condicoes', [])]
            oc = sorted(set(self.cond_ocultas.get(0, [])) | set(self.cond_ocultas.get(cod, [])))
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps(oc))
        if tabela == 'rpc/portal_carrinho_ler':
            if not valido: return route.fulfill(status=400, headers=cab, content_type='application/json', body=json.dumps({'message': 'sessao'}))
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps(self.carrinhos.get(s['codigo'])))
        if tabela == 'rpc/portal_carrinho_gravar':
            if not valido: return route.fulfill(status=400, headers=cab, content_type='application/json', body=json.dumps({'message': 'sessao'}))
            b = json.loads(req.post_data or '{}'); cod = s['codigo']; atual = self.carrinhos.get(cod)
            assert all(set(l) <= {'produto_id', 'unidade', 'quantidade', 'nome', 'codigo', 'unidadeNome'} for l in b['p_linhas']), 'carrinho com campo a mais'
            gravou = not atual or atual['em'] < b['p_em']
            if gravou: self.carrinhos[cod] = {'linhas': b['p_linhas'], 'em': b['p_em']}
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps(gravou))
        if tabela == 'rpc/portal_visiveis_gravar':
            if not valido: return route.fulfill(status=400, headers=cab, content_type='application/json', body=json.dumps({'message': 'sessao'}))
            b = json.loads(req.post_data or '{}')
            self.visiveis = {'visiveis': b['p_visiveis'], 'estoque_baixo': b['p_estoque_baixo'], 'sem_estoque': b['p_sem_estoque'], 'estoque_minimo': b['p_estoque_minimo'], 'atualizado_em': '2026-11-18T12:00:00+00:00'}
            return route.fulfill(status=204, headers=cab, body='')
        if tabela == 'rpc/portal_vitrine_codigos':
            ocs = {k for k, v in self.exibicao.items() if v.get('oculto')}
            d = [{'codigos': [c for c in self.visiveis['visiveis'] if c not in ocs], 'atualizado_em': self.visiveis['atualizado_em']}] if self.visiveis else []
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps(d))
        if tabela == 'rpc/portal_config_publica':
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps({'so_estoque': self.config['so_estoque'], 'estoque_minimo': self.config['estoque_minimo']}))
        if tabela == 'portal_negociacoes':
            if not valido:
                return route.fulfill(status=200 if m == 'GET' else 403, headers=cab, content_type='application/json', body='[]' if m == 'GET' else '{"code":"42501"}')
            if m == 'GET':
                return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps([n for n in reversed(self.negociacoes) if n['comprador_codigo'] == s['codigo']]))
            if m == 'POST':
                rs = json.loads(req.post_data); rs = rs if isinstance(rs, list) else [rs]
                for r in rs:
                    if r['comprador_codigo'] != s['codigo'] or r['loja'] != LOJA or set(r) - {'loja', 'comprador_codigo', 'comprador_nome', 'produto_id', 'codigo', 'produto_nome', 'unidade', 'unidade_id', 'preco_atual', 'preco_desejado', 'quantidade', 'mensagem'}:
                        return route.fulfill(status=403, headers=cab, content_type='application/json', body='{"code":"42501"}')
                    self.negociacoes.append({**r, 'id': str(uuid.uuid4()), 'status': 'aberta', 'criado_em': '2026-11-17T18:00:00+00:00', 'preco_aprovado': None, 'valido_ate': None, 'resposta': None})
                return route.fulfill(status=201, headers=cab, body='')
            if m == 'PATCH':
                nid = q['id'][0].replace('eq.', ''); r = json.loads(req.post_data)
                for n in self.negociacoes:
                    if n['id'] == nid and n['comprador_codigo'] == s['codigo'] and n['status'] == 'aberta' and r.get('status') == 'cancelada': n['status'] = 'cancelada'
                return route.fulfill(status=204, headers=cab, body='')
        if tabela == 'portal_sinonimos':
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps(self.sinonimos))
        if tabela == 'portal_eventos' and m == 'POST':
            if not valido: return route.fulfill(status=403, headers=cab, content_type='application/json', body='{"code":"42501"}')
            r = json.loads(req.post_data)
            if r.get('comprador_codigo') != s['codigo']: return route.fulfill(status=403, headers=cab, body='{"code":"42501"}')
            self.eventos.append(r); self.comissao_do_pedido(r); return route.fulfill(status=201, headers=cab, body='')
        if tabela == 'rpc/portal_ocultos_comprador':
            vazio = {'termos': [], 'codigos': []}
            if not valido: return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps(vazio))
            v = next((x for x in getattr(self, 'vinculos', []) if x.get('cliente_codigo') == s['codigo'] and x['situacao'] == 'ativo'), None)
            e = v and next((x for x in getattr(self, 'executivos', []) if x['id'] == v['executivo_id'] and x['ativo']), None)
            r = {'termos': e.get('ocultar_termos', []), 'codigos': e.get('ocultar_codigos', [])} if e else dict(vazio)
            r['em_analise'] = any(c.get('codigo_g360') == s['codigo'] and c.get('em_analise') for c in self.cadastros)
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps(r))
        if tabela == 'rpc/portal_registrar_acesso':
            if valido: self.acessos[s['codigo']] = json.loads(req.post_data).get('p_nome')
            return route.fulfill(status=204, headers=cab, body='')
        if tabela == 'portal_secoes':
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps(getattr(self, 'secoes', [])))
        if tabela == 'portal_categorias':
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps([{'nome': c, 'ordem': i} for i, c in enumerate(self.categorias)]))
        if tabela == 'portal_produtos_exibicao':
            return route.fulfill(status=200, headers=cab, content_type='application/json', body=json.dumps(list(self.exibicao.values())))
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
