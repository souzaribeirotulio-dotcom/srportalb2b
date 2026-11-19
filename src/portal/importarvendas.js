/* Painel → Minha Lista do cliente → "Importar relatório de vendas (PDF do G360)".
 * Lê o "Relatório de Vendas Completo 2" no navegador (nada é guardado), acha a última compra de cada
 * produto + embalagem e mostra para conferir. O preço congelado sugerido é o VALOR UNITÁRIO da última
 * compra, SEM o desconto (o desconto da forma de pagamento continua sendo aplicado pelo G360 na venda).
 * Gravar: POST operadores/clientes/{cliente}/precos-congelados (um por produto, o G360 confere cada um)
 * e a Minha Lista do cliente pelo painel-g360 (só produtos que aparecem no portal). */
import { buscarProdutosOperador, consultarPrecosOperador, incluirPrecoCongelado, interpretarErro, ErroApi } from '../api/g360.js';
import { linhasDoPdf, lerRelatorio, ultimasCompras } from './relatoriovendas.js';
import { comEspera } from './lotesfotos.js';
import { dinheiro, numeroPainel } from '../ui/formato.js';
import { $, esc, toast } from './comum.js';

const dataBr = (iso) => iso.split('-').reverse().join('/');
const semZeros = (c) => String(c).trim().replace(/^0+(?=.)/, '').toUpperCase();
const valorTela = (v) => String(v ?? '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').replace('.', ',');
function valorPreco(d) {
  let s = String(d || '').trim();
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return /^(?:0|[1-9][0-9]{0,10})(?:\.[0-9]{1,7})?$/.test(s) && !/^0(?:\.0+)?$/.test(s) ? s : null;
}

/**
 * o: { alvo (elemento), cliente: {codigo, nome}, token(), painel(acao, dados), limiteMargem(), noPortal(p),
 *      aoMudarLista(ids), aoSessaoEncerrada(e) }
 */
export function abrirImportarVendas(o) {
  let linhas = []; // [{ compra, p, valor, marcado, motivo, resultado }]
  const alvo = o.alvo;
  alvo.innerHTML = `<div class="panel" style="margin:12px 16px;padding:14px 16px">
    <b>📄 Importar relatório de vendas (PDF do G360)</b>
    <small class="hint" style="display:block;margin:2px 0 8px">Use o "Relatório de Vendas Completo 2" deste cliente. O arquivo é lido aqui no navegador e não fica salvo. Preço sugerido: o <b>valor unitário da última compra, sem desconto</b>.</small>
    <label class="btn sec" style="height:40px;display:inline-flex;align-items:center;cursor:pointer;margin-bottom:8px">📄 Escolher o PDF<input type="file" id="ivArq" accept="application/pdf,.pdf" hidden></label>
    <div id="ivCorpo" aria-live="polite"></div></div>`;
  $('ivArq').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) ler(f); e.target.value = ''; });

  const corpo = (h) => { $('ivCorpo').innerHTML = h; };
  const erro = (e) => {
    if (e instanceof ErroApi && e.status === 401) { o.aoSessaoEncerrada?.(e); return; }
    const i = e instanceof ErroApi ? interpretarErro(e) : { mensagem: e.message };
    corpo(`<div class="rv-aviso bad">${esc(i.mensagem)}${i.suporte ? ` <small>(Código para o suporte: ${esc(i.suporte)})</small>` : ''}</div>`);
  };

  async function ler(arquivo) {
    corpo('<div class="g360-carregando">Lendo o PDF…</div>');
    let rel;
    try {
      rel = lerRelatorio(await linhasDoPdf(new Uint8Array(await arquivo.arrayBuffer())));
    } catch { corpo('<div class="rv-aviso bad">Não deu para ler este arquivo. Confira se é o PDF do "Relatório de Vendas Completo 2" do G360.</div>'); return; }
    if (!rel.vendas.length) { corpo('<div class="rv-aviso bad">Nenhuma venda encontrada. Confira se é o "Relatório de Vendas Completo 2" do G360.</div>'); return; }
    const outros = [...new Set(rel.vendas.map((v) => v.cliente))].filter((x) => x !== Number(o.cliente.codigo));
    if (outros.length) { corpo(`<div class="rv-aviso bad">Este relatório tem vendas de outro cliente (cód. ${esc(outros.join(', '))}). Gere o relatório só de <b>${esc(o.cliente.nome)}</b> (cód. ${esc(o.cliente.codigo)}) e importe de novo.</div>`); return; }
    const naoFecham = rel.vendas.filter((v) => !v.fecha);
    const compras = ultimasCompras(rel);
    const datas = rel.vendas.map((v) => v.data).sort();
    corpo(`<div class="g360-carregando">Conferindo ${compras.length} produtos no G360…</div>`);
    try {
      // Produtos pelo código comercial (com e sem zeros à esquerda).
      const cods = [...new Set(compras.flatMap((c) => [c.codigo, semZeros(c.codigo)]))];
      const porCod = new Map();
      for (let i = 0; i < cods.length; i += 50) {
        const { dados } = await comEspera(() => buscarProdutosOperador(o.token(), { codigos: cods.slice(i, i + 50), limite: 50 }));
        dados.forEach((p) => porCod.set(semZeros(p.codigo), p));
      }
      // Preço de hoje para este cliente (tabela, congelado vigente, custo e margem quando o acesso permite).
      const ids = [...new Set([...porCod.values()].map((p) => Number(p.id)))];
      const precos = new Map();
      for (let i = 0; i < ids.length; i += 50) (await comEspera(() => consultarPrecosOperador(o.token(), Number(o.cliente.codigo), ids.slice(i, i + 50)))).forEach((p) => precos.set(Number(p.id), p));
      linhas = compras.map((compra) => {
        const base = porCod.get(semZeros(compra.codigo));
        const p = base ? { ...base, ...(precos.get(Number(base.id)) || {}) } : null;
        const l = { compra, p, valor: compra.valor_unitario, marcado: true, motivo: '', resultado: '' };
        if (!p) { l.marcado = false; l.fixo = true; l.motivo = 'Não encontrado no G360 (inativo ou fora da venda)'; }
        else if (String(p.unidade || '').toUpperCase() !== compra.unidade) { l.marcado = false; l.fixo = true; l.motivo = `Vendido em ${compra.unidade}; a unidade do produto é ${p.unidade || '—'}. Congele pela aba Preços congelados.`; }
        else if (p.preco_congelado) { l.marcado = false; l.motivo = `Já tem preço congelado (${dinheiro(p.preco_congelado)})`; }
        else if (margem(l) !== null && margem(l) < o.limiteMargem()) { l.marcado = false; l.motivo = 'Margem abaixo do mínimo'; }
        return l;
      });
    } catch (e) { erro(e); return; }
    desenhar({ vendas: rel.vendas.length, naoFecham, de: datas[0], ate: datas[datas.length - 1] });
  }

  function margem(l) {
    if (!l.p?.custo_visivel || l.p.custo === null || l.p.custo === undefined) return null;
    const v = Number(valorPreco(valorTela(l.valor)) || 0);
    return v > 0 ? ((v - Number(l.p.custo)) / v) * 100 : null;
  }

  function desenhar(info) {
    const hoje = new Date().toISOString().slice(0, 10); const f = new Date(); f.setFullYear(f.getFullYear() + 1);
    corpo(`<div class="hint" style="margin:4px 0 8px">${info.vendas} vendas de ${dataBr(info.de)} a ${dataBr(info.ate)} · <b>${linhas.length} produtos</b> (última compra de cada produto e embalagem)${info.naoFecham.length ? ` · <span class="ruim">${info.naoFecham.length} venda${info.naoFecham.length === 1 ? '' : 's'} não fecha${info.naoFecham.length === 1 ? '' : 'm'} com o total (fica${info.naoFecham.length === 1 ? '' : 'm'} de fora): ${esc(info.naoFecham.map((v) => v.doc).join(', '))}</span>` : ''}</div>
      <div class="row" style="align-items:center;margin-bottom:6px"><button class="tool" id="ivTodos" type="button">Marcar todos</button><button class="tool" id="ivNenhum" type="button">Desmarcar todos</button><span class="hint" id="ivConta" style="margin:0 0 0 auto"></span></div>
      <div style="max-height:420px;overflow:auto;border:1px solid var(--linha2);border-radius:12px" data-rolar><table class="ivtab"><thead><tr>
        <th></th><th>Produto</th><th>Última compra</th><th>Preço a congelar</th><th>Hoje para o cliente</th><th>Margem</th><th>Situação</th></tr></thead>
        <tbody id="ivLinhas"></tbody></table></div>
      <div class="row" style="align-items:flex-end;gap:12px;margin-top:10px;flex-wrap:wrap">
        <label class="hint" style="margin:0">De <input type="date" id="ivIni" value="${hoje}"></label>
        <label class="hint" style="margin:0">Até <input type="date" id="ivFim" value="${f.toISOString().slice(0, 10)}" min="${hoje}"></label>
        <label class="isen"><input type="checkbox" id="ivLista" checked> Adicionar à Minha Lista</label>
        <label class="isen"><input type="checkbox" id="ivCong" checked> Congelar o preço</label>
        <button class="btn pri" id="ivGravar" type="button" style="margin-left:auto">Adicionar à Minha Lista e congelar</button></div>
      <div id="ivRes" aria-live="polite"></div>`);
    const pintar = () => {
      $('ivLinhas').innerHTML = linhas.map((l, i) => {
        const p = l.p; const mg = margem(l);
        return `<tr data-i="${i}" class="${l.marcado ? '' : 'off'}">
          <td><input type="checkbox" data-m ${l.marcado ? 'checked' : ''} ${l.fixo || l.resultado === 'ok' ? 'disabled' : ''} aria-label="Incluir ${esc(l.compra.codigo)}"></td>
          <td><b>${esc(p?.nome || l.compra.nome)}</b><small>Cód. ${esc(l.compra.codigo)} · ${esc(l.compra.unidade)}</small></td>
          <td>${dataBr(l.compra.data)}<small>${esc(numeroPainel(Number(l.compra.quantidade), 0))} ${esc(l.compra.unidade)} · venda ${esc(l.compra.doc)} · ${l.compra.compras} compra${l.compra.compras === 1 ? '' : 's'}</small></td>
          <td><div class="pin" style="width:120px"><span>R$</span><input data-v inputmode="decimal" value="${esc(valorTela(l.valor))}" ${l.fixo ? 'disabled' : ''} aria-label="Preço a congelar de ${esc(l.compra.codigo)}"></div><small>pago: ${esc(dinheiro(l.compra.valor_unitario))}${Number(l.compra.desconto) > 0 ? ` − desc. ${esc(dinheiro(l.compra.desconto))}` : ''}</small></td>
          <td>${p ? `${esc(dinheiro(p.preco))}${p.preco_congelado ? `<small style="color:var(--lima)">❄ ${esc(dinheiro(p.preco_congelado))}</small>` : ''}` : '—'}</td>
          <td>${mg === null ? '<small>—</small>' : `<b class="mg ${mg < o.limiteMargem() ? 'bad' : 'ok'}">${esc(numeroPainel(mg, 1))}%</b>`}</td>
          <td><small>${l.resultado === 'ok' ? '<span class="okmsg">✓ Gravado</span>' : l.resultado ? `<span class="ruim">${esc(l.resultado)}</span>` : esc(l.motivo)}</small></td></tr>`;
      }).join('');
      const n = linhas.filter((l) => l.marcado && l.resultado !== 'ok').length;
      $('ivConta').textContent = `${n} de ${linhas.length} marcados`;
      $('ivGravar').disabled = !n;
    };
    $('ivLinhas').addEventListener('change', (e) => {
      const l = linhas[Number(e.target.closest('tr')?.dataset.i)]; if (!l) return;
      if (e.target.matches('[data-m]')) { l.marcado = e.target.checked; pintar(); }
    });
    $('ivLinhas').addEventListener('input', (e) => {
      const l = linhas[Number(e.target.closest('tr')?.dataset.i)]; if (!l || !e.target.matches('[data-v]')) return;
      l.valor = valorPreco(e.target.value) || e.target.value;
      const td = e.target.closest('tr').children[5]; const mg = margem(l);
      td.innerHTML = mg === null ? '<small>—</small>' : `<b class="mg ${mg < o.limiteMargem() ? 'bad' : 'ok'}">${esc(numeroPainel(mg, 1))}%</b>`;
    });
    $('ivTodos').onclick = () => { linhas.forEach((l) => { if (!l.fixo && l.resultado !== 'ok') l.marcado = true; }); pintar(); };
    $('ivNenhum').onclick = () => { linhas.forEach((l) => { if (l.resultado !== 'ok') l.marcado = false; }); pintar(); };
    $('ivGravar').onclick = gravar;
    pintar();

    async function gravar() {
      const inicio = $('ivIni').value; const fim = $('ivFim').value;
      const congelar = $('ivCong').checked; const naLista = $('ivLista').checked;
      const res = $('ivRes'); res.innerHTML = '';
      if (!congelar && !naLista) { res.innerHTML = '<div class="okmsg bad">Marque "Adicionar à Minha Lista" ou "Congelar o preço".</div>'; return; }
      if (congelar && (!inicio || !fim || fim < inicio)) { res.innerHTML = '<div class="okmsg bad">A data final precisa ser igual ou depois da inicial.</div>'; return; }
      const fila = linhas.filter((l) => l.marcado && l.resultado !== 'ok' && l.p);
      const ruins = fila.filter((l) => congelar && !valorPreco(valorTela(l.valor)));
      if (ruins.length) { res.innerHTML = `<div class="okmsg bad">Confira o preço de: ${esc(ruins.map((l) => l.compra.codigo).join(', '))}.</div>`; return; }
      const b = $('ivGravar'); b.disabled = true;
      let ok = 0; let falhas = 0;
      for (const [k, l] of fila.entries()) {
        b.textContent = `Gravando ${k + 1} de ${fila.length}…`;
        if (!congelar) { l.resultado = 'ok'; continue; }
        try {
          await comEspera(() => incluirPrecoCongelado(o.token(), Number(o.cliente.codigo), { produto: Number(l.p.id), unidade_id: null, valor: valorPreco(valorTela(l.valor)), inicio, fim }));
          l.resultado = 'ok'; ok++;
        } catch (e) {
          if (e instanceof ErroApi && e.status === 401) { o.aoSessaoEncerrada?.(e); return; }
          const i = e instanceof ErroApi ? interpretarErro(e) : { mensagem: e.message };
          l.resultado = i.mensagem + (i.suporte ? ` (Código para o suporte: ${i.suporte})` : ''); falhas++;
          if (e instanceof ErroApi && (e.status === 403 || e.status === 423)) { pintar(); break; }
        }
        if (k % 5 === 4) pintar();
      }
      let naListaN = 0; let foraPortal = 0;
      if (naLista) {
        const ids = [...new Set(fila.filter((l) => l.resultado === 'ok' || !congelar).filter((l) => { const dentro = o.noPortal(l.p); if (!dentro) foraPortal++; return dentro; }).map((l) => Number(l.p.id)))];
        try { if (ids.length) { o.aoMudarLista?.((await o.painel('lista_incluir', { comprador: Number(o.cliente.codigo), produto_ids: ids })).dados); naListaN = ids.length; } }
        catch (e) { res.innerHTML = `<div class="rv-aviso bad">Os preços foram gravados, mas a Minha Lista não: ${esc(e.message)}</div>`; }
      }
      pintar();
      b.textContent = 'Adicionar à Minha Lista e congelar';
      res.insertAdjacentHTML('beforeend', `<div class="${falhas ? 'rv-aviso' : 'okmsg'}">${congelar ? `${ok} preço${ok === 1 ? '' : 's'} congelado${ok === 1 ? '' : 's'} no G360` : 'Preços não alterados'}${naLista ? ` · ${naListaN} produto${naListaN === 1 ? '' : 's'} na Minha Lista` : ''}${foraPortal ? ` · ${foraPortal} fora do portal não entraram na lista` : ''}${falhas ? ` · <b>${falhas} com erro</b> (veja a coluna Situação)` : ''}.</div>`);
      toast(`${ok} preço${ok === 1 ? '' : 's'} congelado${ok === 1 ? '' : 's'} ✓`);
    }
  }
}
