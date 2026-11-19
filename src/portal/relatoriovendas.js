/* Leitura do "Relatório de Vendas Completo 2" do G360 (PDF), no próprio navegador.
 * Cada venda começa em "Data: DD/MM/AAAA Cliente: CODIGO-NOME ... N.Doc: NUM ... Nat.: ...",
 * seguida das linhas de item: CÓDIGO  NOME…  UNIDADE  QTD  VLUNIT  DESC  TOTALPROD,
 * e fecha em "TOTAL DESC. : x TOTAL DA VENDA : y". Nada é guardado: só o resumo vai para a tela.
 * Conferência: em cada venda, soma(TOTALPROD) − soma(DESC) tem de bater com o TOTAL DA VENDA. */

const NUM = /^\d{1,3}(\.\d{3})*,\d+$|^\d+,\d+$/;
const UNID = /^[A-Z]{1,3}$/;

/** "1.234,56" → "1234.56" (texto decimal com ponto, sem ponto flutuante). */
export function decimalBr(t) { return String(t).replace(/\./g, '').replace(',', '.'); }
function centavos(t) { const [i, d = ''] = decimalBr(t).split('.'); return BigInt(i) * 10000n + BigInt((d + '0000').slice(0, 4)); }

/** Linhas de texto de um PDF (pdf.js): agrupa os pedaços pela altura e ordena da esquerda para a direita. */
export async function linhasDoPdf(dados) {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: dados, isEvalSupported: false }).promise;
  const linhas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pag = await doc.getPage(n);
    const { items } = await pag.getTextContent();
    const pedacos = items.filter((i) => i.str && i.str.trim()).map((i) => ({ x: i.transform[4], y: i.transform[5], t: i.str.trim() }));
    pedacos.sort((a, b) => b.y - a.y || a.x - b.x);
    let atual = null;
    for (const p of pedacos) {
      if (!atual || Math.abs(atual.y - p.y) > 2.5) { atual = { y: p.y, partes: [] }; linhas.push(atual); }
      atual.partes.push(p);
    }
    pag.cleanup();
  }
  await doc.destroy();
  return linhas.map((l) => l.partes.sort((a, b) => a.x - b.x).map((p) => p.t).join(' ').replace(/\s+/g, ' ').trim());
}

/** Lê as linhas do relatório. Devolve { cliente: {codigo, nome}, vendas: [{data, doc, natureza, itens, fecha}], ignoradas }. */
export function lerRelatorio(linhas) {
  const vendas = []; let v = null; let cliente = null; let ignoradas = 0;
  for (const l of linhas) {
    const cab = l.match(/Data:\s*(\d{2})\/(\d{2})\/(\d{4}).*?Cliente:\s*(\d+)\s*-\s*(.*?)\s+(?:\S+\s+)?N\.Doc:\s*(\d+)(?:.*?Nat\.:\s*(.+))?$/);
    if (cab) {
      v = { data: `${cab[3]}-${cab[2]}-${cab[1]}`, doc: cab[6], natureza: (cab[7] || '').trim(), cliente: Number(cab[4]), itens: [], totalVenda: null, totalDesc: null };
      if (!cliente) cliente = { codigo: Number(cab[4]), nome: cab[5].replace(/\s+\d{6,}$/, '').trim() };
      vendas.push(v); continue;
    }
    const tot = l.match(/TOTAL DESC\.\s*:\s*([\d.,]+)\s*TOTAL DA VENDA\s*:\s*([\d.,]+)/);
    if (tot && v) { v.totalDesc = tot[1]; v.totalVenda = tot[2]; continue; }
    if (!v) continue;
    const t = l.split(' ');
    if (t.length < 7) continue;
    const n = t.slice(-4);
    if (!n.every((x) => NUM.test(x))) continue;
    if (/^\d+\/\d+$/.test(t[0])) continue; // parcelas: "1/1 756 …"
    const un = t[t.length - 5];
    const codigo = t[0];
    if (!UNID.test(un) || !/^[A-Za-z0-9.-]{2,15}$/.test(codigo) || /^(PC|CODIGO|TOTAL)$/i.test(codigo) && t[1] === 'BANCO') { ignoradas++; continue; }
    v.itens.push({ codigo, nome: t.slice(1, -5).join(' '), unidade: un, quantidade: decimalBr(n[0]), valor_unitario: decimalBr(n[1]), desconto: decimalBr(n[2]), total: decimalBr(n[3]) });
  }
  for (const x of vendas) {
    if (x.totalVenda === null) { x.fecha = false; continue; }
    const soma = x.itens.reduce((s, i) => s + centavos(i.total.replace('.', ',')) - centavos(i.desconto.replace('.', ',')), 0n);
    const dif = soma - centavos(x.totalVenda);
    x.fecha = (dif < 0n ? -dif : dif) <= 500n; // até R$ 0,05 de arredondamento
  }
  return { cliente, vendas, ignoradas };
}

/** Última compra de cada produto + embalagem (só vendas que fecham). */
export function ultimasCompras(rel) {
  const porChave = new Map();
  for (const v of rel.vendas) {
    if (!v.fecha) continue;
    for (const i of v.itens) {
      const k = `${i.codigo}|${i.unidade}`;
      const atual = porChave.get(k);
      const compras = (atual?.compras || 0) + 1;
      if (!atual || v.data > atual.data || (v.data === atual.data && Number(v.doc) > Number(atual.doc))) porChave.set(k, { ...i, data: v.data, doc: v.doc, compras });
      else atual.compras = compras;
    }
  }
  return [...porChave.values()].sort((a, b) => b.data.localeCompare(a.data) || a.codigo.localeCompare(b.codigo, 'pt', { numeric: true }));
}
