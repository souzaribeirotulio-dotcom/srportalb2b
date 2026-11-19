"""PDF fictício no formato do "Relatório de Vendas Completo 2" do G360, só para os testes."""
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

def gerar(caminho, cliente='1165-COMPRADOR FICTICIO UM LTDA', vendas=None):
    vendas = vendas or [
        ('05/08/2026', '5001', [('P-102', 'PRODUTO FICTICIO 102', 'UN', '2,00', '11,00', '0,00', '22,00')], '0,00', '22,00'),
        ('10/09/2026', '5002', [('P-102', 'PRODUTO FICTICIO 102', 'UN', '3,00', '12,40', '1,20', '37,20'),
                               ('P-101', 'PRODUTO FICTICIO 101', 'UN', '1,00', '10,90', '0,00', '10,90'),
                               ('P-103', 'PRODUTO FICTICIO 103', 'CX', '1,00', '120,00', '0,00', '120,00'),
                               ('X-999', 'PRODUTO QUE NAO EXISTE', 'UN', '1,00', '5,00', '0,00', '5,00')], '1,20', '171,90'),
        ('12/09/2026', '5003', [('P-106', 'PRODUTO FICTICIO 106', 'UN', '1,00', '99,00', '0,00', '99,00')], '0,00', '50,00'),  # não fecha
    ]
    c = canvas.Canvas(caminho, pagesize=A4); y = 800
    c.setFont('Helvetica-Bold', 11); c.drawString(40, y, 'Relatório de Vendas Completo 2'); y -= 24
    for data, doc, itens, desc, total in vendas:
        c.setFont('Helvetica', 8)
        c.drawString(40, y, f'Data: {data}'); c.drawString(120, y, f'Cliente: {cliente}'); c.drawString(380, y, f'N.Doc: {doc}'); c.drawString(460, y, 'Nat.: VENDA'); y -= 14
        for cod, nome, un, q, vu, d, t in itens:
            c.drawString(40, y, cod); c.drawString(90, y, nome); c.drawString(300, y, un)
            for x, v in ((380, q), (430, vu), (480, d), (530, t)): c.drawRightString(x + 30, y, v)
            y -= 12
        c.drawString(300, y, f'TOTAL DESC. : {desc}'); c.drawString(420, y, f'TOTAL DA VENDA : {total}'); y -= 22
    c.save()
