from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm

saida = 'docs/propostas/modelo-relatorio-ultimas-compras.pdf'
doc = SimpleDocTemplate(saida, pagesize=landscape(A4), leftMargin=14*mm, rightMargin=14*mm, topMargin=12*mm, bottomMargin=14*mm,
                        title='Modelo - Últimas compras do cliente por produto', author='Souza Ribeiro - Portal B2B')
st = getSampleStyleSheet()
T = ParagraphStyle('t', parent=st['Title'], fontSize=15, leading=18, alignment=0, spaceAfter=2)
S = ParagraphStyle('s', parent=st['Normal'], fontSize=8.5, leading=11, textColor=colors.HexColor('#444444'))
N = ParagraphStyle('n', parent=st['Normal'], fontSize=8, leading=10.5)
C = ParagraphStyle('c', parent=N, fontSize=7.8, leading=9.5)
H = ParagraphStyle('h', parent=C, textColor=colors.white, fontName='Helvetica-Bold')
VERDE = colors.HexColor('#1f4813'); LIMA = colors.HexColor('#e9f5d0'); CINZA = colors.HexColor('#f4f4f4')

story = []
story.append(Paragraph('Últimas compras do cliente por produto', T))
story.append(Paragraph('<b>MODELO</b> para a Movimento · relatório que o portal da Souza Ribeiro consegue importar para montar a Minha Lista e os preços congelados · <b>dados fictícios</b>', S))
story.append(Spacer(1, 6))

cab = [[Paragraph('<b>Empresa</b><br/>1 - SOUZA RIBEIRO (exemplo)', N), Paragraph('<b>Cliente</b><br/>42 - EMPRESA FICTÍCIA LTDA', N),
        Paragraph('<b>CNPJ</b><br/>12.ABC.345/01DE-35', N), Paragraph('<b>Período</b><br/>19/08/2026 a 19/11/2026', N),
        Paragraph('<b>Emitido em</b><br/>19/11/2026 17:15', N)]]
tc = Table(cab, colWidths=[52*mm, 70*mm, 42*mm, 50*mm, 40*mm])
tc.setStyle(TableStyle([('BOX', (0,0), (-1,-1), .6, VERDE), ('INNERGRID', (0,0), (-1,-1), .3, colors.HexColor('#c8d6c0')),
                        ('BACKGROUND', (0,0), (-1,-1), CINZA), ('VALIGN', (0,0), (-1,-1), 'TOP'), ('TOPPADDING', (0,0), (-1,-1), 4), ('BOTTOMPADDING', (0,0), (-1,-1), 4)]))
story.append(tc); story.append(Spacer(1, 8))

cols = ['Código', 'Produto', 'Embalagem', 'Unid. por<br/>emb.', 'Data da<br/>última compra', 'Nº do<br/>pedido', 'Qtd. da<br/>última compra', 'Valor unitário pago<br/>(com desconto)', 'Compras<br/>no período', 'Pode<br/>congelar']
linhas = [
    ['000101', 'COPO DESCARTÁVEL 200ML BRANCO C/100 EXEMPLO', 'UN', '1', '10/11/2026', '9001', '10', '18,9900000', '4', 'Sim'],
    ['000101', 'COPO DESCARTÁVEL 200ML BRANCO C/100 EXEMPLO', 'CX', '25', '02/09/2026', '8800', '2', '450,0000000', '1', 'Sim'],
    ['000214', 'PAPEL TOALHA INTERFOLHA 20X21 C/1000 EXEMPLO', 'FD', '1', '07/11/2026', '8987', '6', '32,5000000', '3', 'Sim'],
    ['000377', 'DETERGENTE NEUTRO 5L EXEMPLO', 'GL', '1', '28/10/2026', '8950', '4', '21,9000000', '2', 'Sim'],
    ['000412', 'SACO DE LIXO 100L PRETO C/100 EXEMPLO', 'PC', '1', '28/10/2026', '8950', '3', '39,0000000', '5', 'Sim'],
    ['000530', 'GUARDANAPO 30X30 BRANCO C/50 EXEMPLO', 'PC', '1', '15/09/2026', '8840', '20', '2,4500000', '2', 'Sim'],
    ['000655', 'LUVA NITRÍLICA AZUL M C/100 EXEMPLO', 'CX', '1', '03/09/2026', '8805', '2', '28,7000000', '1', 'Sim'],
    ['000901', 'KIT MARMITEX 750ML + TAMPA C/100 EXEMPLO', 'UN', '1', '12/10/2026', '8901', '5', '64,0000000', '2', 'Não (kit)'],
    ['000777', 'ÁLCOOL 70% 1L EXEMPLO', 'UN', '1', '20/08/2026', '8701', '12', '7,9000000', '1', 'Não (inativo)'],
]
dados = [[Paragraph(c, H) for c in cols]] + [[Paragraph(v, C) for v in l] for l in linhas]
tt = Table(dados, colWidths=[17*mm, 69*mm, 24*mm, 18*mm, 23*mm, 16*mm, 20*mm, 31*mm, 19*mm, 21*mm], repeatRows=1)
ts = [('BACKGROUND', (0,0), (-1,0), VERDE), ('GRID', (0,0), (-1,-1), .3, colors.HexColor('#b9c7b1')), ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
      ('TOPPADDING', (0,0), (-1,-1), 3), ('BOTTOMPADDING', (0,0), (-1,-1), 3), ('BACKGROUND', (7,1), (7,-1), LIMA)]
for i in range(1, len(dados)):
    if i % 2 == 0: ts.append(('BACKGROUND', (0,i), (6,i), CINZA)); ts.append(('BACKGROUND', (8,i), (9,i), CINZA))
tt.setStyle(TableStyle(ts)); story.append(tt); story.append(Spacer(1, 8))

regras = [
    '<b>Uma linha por produto e embalagem</b> (o mesmo produto vendido em UN e em CX aparece em duas linhas), porque o preço congelado é gravado por produto e unidade.',
    '<b>Só a última compra</b> de cada produto e embalagem no período, com a <b>data</b> e o <b>nº do pedido</b>. "Compras no período" conta em quantos pedidos o item apareceu.',
    '<b>Valor unitário pago</b> = o que foi cobrado por unidade vendida nessa linha, <b>já com o desconto do item</b>, sem frete e sem taxa de pagamento, na precisão da venda.',
    '<b>Embalagem</b>: a unidade em que o item foi vendido; "Unid. por emb." é quantas unidades base ela tem (1 = unidade base).',
    '<b>Pode congelar</b>: "Não" para kit, produto inativo ou não apto para venda (o portal não tenta gravar preço congelado nesses).',
    'Só vendas concluídas do cliente (as mesmas do histórico de compras do comprador). Ordem: da compra mais recente para a mais antiga.',
    '<b>Se possível, o mesmo conteúdo em Excel ou CSV</b> (ou numa consulta da API para o operador, como na proposta enviada): a leitura é mais confiável que a do PDF.',
]
story.append(Paragraph('<b>Regras do relatório</b>', N)); story.append(Spacer(1, 2))
for r in regras: story.append(Paragraph('• ' + r, N))

def rodape(cv, d):
    cv.saveState(); cv.setFont('Helvetica', 7); cv.setFillColor(colors.HexColor('#666666'))
    cv.drawString(14*mm, 8*mm, 'Modelo com dados fictícios · Souza Ribeiro · Portal B2B · 19/11/2026')
    cv.drawRightString(landscape(A4)[0] - 14*mm, 8*mm, f'Página {d.page}'); cv.restoreState()
doc.build(story, onFirstPage=rodape, onLaterPages=rodape)
print(saida)
