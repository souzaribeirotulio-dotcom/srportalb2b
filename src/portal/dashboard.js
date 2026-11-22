/* =====================================================================
   Painel de vendas dos gestores (pedidos feitos pelo portal).
   Números: função dashboard-g360. Gráfico em SVG próprio (sem biblioteca de fora):
   uma série só (vendas por dia) na cor da marca, barras finas com ponta arredondada,
   grade discreta e dica ao tocar/passar o mouse. Toda informação também aparece em texto.
   ===================================================================== */
import { lerDashboard } from '../api/dashboard.js';
import { esc } from '../ui/util.js';

const PERIODOS = [[1, 'Hoje'], [7, '7 dias'], [30, '30 dias'], [90, '90 dias']];
let periodo = 30;
const cache = new Map(); // dias -> { quando, dados }

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCurto = (v) => {
  const n = Number(v || 0);
  if (n >= 1e6) return `R$ ${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (n >= 1e3) return `R$ ${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `R$ ${n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
};
const pct = (v, casas = 1) => `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
const qtd = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const dataCurta = (dia) => { const [, m, d] = dia.split('-'); return `${d}/${m}`; };
const semana = (dia) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(`${dia}T12:00:00`).getDay()];
function quando(t) {
  const d = new Date(t); const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  const hh = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return mesmoDia ? `hoje, ${hh}` : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}, ${hh}`;
}

/** Variação contra o período anterior: seta + texto (nunca só cor). */
function variacao(atual, anterior) {
  if (!anterior && !atual) return '<span class="db-var">—</span>';
  if (!anterior) return '<span class="db-var sobe">▲ novo</span>';
  const v = ((atual - anterior) / anterior) * 100;
  const cls = v > 0.5 ? 'sobe' : v < -0.5 ? 'desce' : '';
  return `<span class="db-var ${cls}">${v > 0.5 ? '▲' : v < -0.5 ? '▼' : '■'} ${pct(Math.abs(v), 0)} <small>vs. período anterior</small></span>`;
}

/**
 * alvo: elemento. opcoes: { token: () => string, limiteMargem: () => number, aoSessaoEncerrada(e) }
 */
export async function desenharDashboard(alvo, opcoes, forcar = false) {
  const c = cache.get(periodo);
  if (!forcar && c && Date.now() - c.quando < 60_000) { pintar(alvo, c.dados, opcoes); return; }
  if (!c) alvo.innerHTML = esqueleto();
  else pintar(alvo, c.dados, opcoes, true);
  try {
    const dados = await lerDashboard(opcoes.token(), periodo);
    cache.set(periodo, { quando: Date.now(), dados });
    pintar(alvo, dados, opcoes);
  } catch (e) {
    if (e.status === 401) { opcoes.aoSessaoEncerrada?.(e); return; }
    alvo.innerHTML = `${cabecalho()}<div class="db-erro"><b>${e.status === 403 ? 'Painel de vendas só para gestores' : 'Não deu para carregar as vendas'}</b><span>${esc(e.message)}</span>${e.status === 403 ? '' : '<button class="btn sec" type="button" data-db-tentar>Tentar de novo</button>'}</div>`;
    ligarCabecalho(alvo, opcoes);
    alvo.querySelector('[data-db-tentar]')?.addEventListener('click', () => desenharDashboard(alvo, opcoes, true));
  }
}

function cabecalho(carregando = false) {
  return `<div class="db-topo"><div><h2>Vendas pelo portal</h2><p>Pedidos feitos pelos clientes no portal${carregando ? ' · atualizando…' : ''}</p></div>
    <div class="db-per" role="group" aria-label="Período">${PERIODOS.map(([d, t]) => `<button type="button" data-db-dias="${d}" class="${d === periodo ? 'on' : ''}" aria-pressed="${d === periodo}">${t}</button>`).join('')}
    <button type="button" class="db-atu" data-db-atu title="Atualizar" aria-label="Atualizar">↻</button></div></div>`;
}
function ligarCabecalho(alvo, opcoes) {
  alvo.querySelectorAll('[data-db-dias]').forEach((b) => b.addEventListener('click', () => { periodo = Number(b.dataset.dbDias); desenharDashboard(alvo, opcoes); }));
  alvo.querySelector('[data-db-atu]')?.addEventListener('click', () => desenharDashboard(alvo, opcoes, true));
}
function esqueleto() {
  return `${cabecalho(true)}<div class="db-kpis">${'<div class="db-kpi sk"></div>'.repeat(6)}</div><div class="db-card sk" style="height:240px"></div>`;
}

function pintar(alvo, d, opcoes, carregando = false) {
  const lim = Number(opcoes.limiteMargem?.() ?? 25);
  const mg = d.margem;
  const kpi = (rot, valor, extra = '', destaque = false) => `<div class="db-kpi ${destaque ? 'dest' : ''}"><span class="db-rot">${rot}</span><b>${valor}</b>${extra}</div>`;
  const margemExtra = mg
    ? `<span class="db-var ${mg.percentual < lim ? 'desce' : 'sobe'}">${mg.percentual < lim ? '▼ abaixo' : '✓ acima'} do mínimo de ${pct(lim, 0)}</span>${mg.cobertura < 99.5 ? `<small class="db-nota">calculada em ${pct(mg.cobertura, 0)} das vendas</small>` : ''}`
    : `<small class="db-nota">${d.custo_visivel === false ? 'Seu usuário do G360 não vê custo (acesso 01110)' : 'Sem vendas com custo no período'}</small>`;
  const vazio = !d.pedidos;
  alvo.innerHTML = `${cabecalho(carregando)}
    <div class="db-kpis">
      ${kpi('Vendas', brl(d.valor), variacao(d.valor, d.anterior.valor), true)}
      ${kpi('Pedidos', d.pedidos.toLocaleString('pt-BR'), variacao(d.pedidos, d.anterior.pedidos))}
      ${kpi('Ticket médio', d.pedidos ? brl(d.ticket) : '—')}
      ${kpi('Margem bruta', mg ? `${pct(mg.percentual)} <small>· ${brl(mg.valor)}</small>` : '—', margemExtra)}
      ${kpi('Clientes que compraram', d.clientes.toLocaleString('pt-BR'), variacao(d.clientes, d.anterior.clientes))}
      ${kpi('Clientes que entraram', d.clientes_entraram.toLocaleString('pt-BR'), '<small class="db-nota">acessaram o portal no período</small>')}
    </div>
    ${vazio ? `<div class="db-card db-vazio"><b>Nenhum pedido pelo portal neste período.</b><span>Quando os clientes comprarem pelo portal, as vendas aparecem aqui na hora. Experimente um período maior.</span></div>` : `
    ${d.dias > 1 ? `<section class="db-card"><div class="db-ct"><h3>Vendas por dia</h3><span>${esc(dataCurta(d.por_dia[0].dia))} a ${esc(dataCurta(d.por_dia[d.por_dia.length - 1].dia))} · toque nas barras</span></div>${grafico(d.por_dia)}</section>` : ''}
    <div class="db-duas">
      <section class="db-card"><div class="db-ct"><h3>Produtos mais vendidos</h3><span>por valor vendido</span></div>${rankProdutos(d.produtos, lim)}</section>
      <section class="db-card"><div class="db-ct"><h3>Clientes que compraram</h3><span>por valor comprado</span></div>${rankClientes(d.clientes_lista)}</section>
    </div>
    <section class="db-card"><div class="db-ct"><h3>Últimos pedidos</h3></div>
      <div class="db-ult">${d.ultimos.map((p) => `<div><span class="db-q">${esc(quando(p.quando))}</span><b>${esc(p.cliente)}</b><span>${p.numero ? `nº ${esc(p.numero)}` : 'aguardando aprovação'}</span><b class="db-v">${brl(p.valor)}</b></div>`).join('')}</div></section>`}
    <p class="db-rod">Considera só os pedidos feitos pelo portal. Margem bruta = (venda − custo) ÷ venda, com o custo atual do G360, sem impostos, frete e comissão. Itens vendidos em caixa ou pacote entram nas vendas, mas ficam fora da margem.</p>`;
  ligarCabecalho(alvo, opcoes);
  const caixa = alvo.querySelector('.db-graf');
  if (caixa) {
    const desenhar = () => { const w = caixa.clientWidth; if (w) { caixa.outerHTML = grafico(d.por_dia, w); alvo.querySelector('.db-graf')._w = w; ligarGrafico(alvo); } };
    desenhar();
    if (!alvo._ro) { alvo._ro = new ResizeObserver(() => { const g = alvo.querySelector('.db-graf'); if (g && Math.abs(g.clientWidth - (g._w || 0)) > 4) { const w = g.clientWidth; g.outerHTML = grafico(JSON.parse(g.dataset.serie), w); const n = alvo.querySelector('.db-graf'); if (n) n._w = w; ligarGrafico(alvo); } }); alvo._ro.observe(alvo); }
  } else ligarGrafico(alvo);
}

/* ---------- Gráfico de barras (vendas por dia) ---------- */
function grafico(serie, largura = 720) {
  // O desenho usa a largura real da tela (sem esticar): letras e barras ficam sempre no tamanho certo.
  const W = Math.max(280, Math.round(largura)); const H = W < 500 ? 190 : 220; const padL = 52; const padR = 8; const padT = 12; const padB = 26;
  const max = Math.max(...serie.map((s) => s.valor), 1);
  const passo = (() => { const bruto = max / 3; const p10 = 10 ** Math.floor(Math.log10(bruto)); return [1, 2, 2.5, 5, 10].map((m) => m * p10).find((m) => m >= bruto) || bruto; })();
  const topo = passo * Math.ceil(max / passo);
  const n = serie.length; const banda = (W - padL - padR) / n; const larg = Math.max(3, Math.min(24, banda * 0.62));
  const y = (v) => padT + (H - padT - padB) * (1 - v / topo);
  const marcas = []; for (let v = 0; v <= topo + 1e-9; v += passo) marcas.push(v);
  const cabem = Math.max(2, Math.floor((W - padL) / 52)); // ~52px por data
  const cadaRotulo = Math.ceil(n / cabem);
  // Datas espaçadas; a última sempre aparece e a anterior some se ficar colada nela.
  const mostraRotulo = (i) => i === n - 1 || (i % cadaRotulo === 0 && n - 1 - i >= cadaRotulo * 0.7);
  const barras = serie.map((s, i) => {
    const cx = padL + banda * i + banda / 2; const x = cx - larg / 2; const yv = y(s.valor); const h = Math.max(0, H - padB - yv);
    const r = Math.min(4, larg / 2, h);
    const caminho = h > 0 ? `M${x},${H - padB} V${yv + r} Q${x},${yv} ${x + r},${yv} H${x + larg - r} Q${x + larg},${yv} ${x + larg},${yv + r} V${H - padB} Z` : '';
    return `<g class="db-bar" data-i="${i}" tabindex="0" role="img" aria-label="${esc(`${dataCurta(s.dia)}: ${brl(s.valor)}, ${s.pedidos} pedido${s.pedidos === 1 ? '' : 's'}`)}">
      <rect x="${padL + banda * i}" y="${padT}" width="${banda}" height="${H - padT - padB}" fill="transparent"/>
      ${caminho ? `<path d="${caminho}"/>` : `<rect x="${x}" y="${H - padB - 1}" width="${larg}" height="1" class="db-zero"/>`}
      ${mostraRotulo(i) ? `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="db-eixo">${esc(n <= 7 ? semana(s.dia) : dataCurta(s.dia))}</text>` : ''}</g>`;
  }).join('');
  return `<div class="db-graf" data-serie='${esc(JSON.stringify(serie))}'>
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="Vendas por dia">
      ${marcas.map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="db-grade"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" class="db-eixo">${esc(brlCurto(v))}</text>`).join('')}
      ${barras}</svg>
    <div class="db-dica" hidden></div></div>`;
}
function ligarGrafico(alvo) {
  const g = alvo.querySelector('.db-graf'); if (!g) return;
  const serie = JSON.parse(g.dataset.serie); const dica = g.querySelector('.db-dica');
  const mostrar = (el) => {
    const s = serie[Number(el.dataset.i)];
    g.querySelectorAll('.db-bar.on').forEach((b) => b.classList.remove('on')); el.classList.add('on');
    dica.innerHTML = `<b>${esc(semana(s.dia))}, ${esc(dataCurta(s.dia))}</b><span>${brl(s.valor)}</span><small>${s.pedidos} pedido${s.pedidos === 1 ? '' : 's'}</small>`;
    dica.hidden = false;
    const r = el.getBoundingClientRect(); const rg = g.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2 - rg.left, 70), rg.width - 70);
    dica.style.left = `${x}px`;
  };
  g.querySelectorAll('.db-bar').forEach((el) => {
    el.addEventListener('pointerenter', () => mostrar(el));
    el.addEventListener('click', () => mostrar(el));
    el.addEventListener('focus', () => mostrar(el));
  });
  g.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { dica.hidden = true; g.querySelectorAll('.db-bar.on').forEach((b) => b.classList.remove('on')); } });
}

/* ---------- Rankings ---------- */
function rankProdutos(lista, lim) {
  if (!lista.length) return '<div class="db-vz">Sem produtos no período.</div>';
  const max = Math.max(...lista.map((p) => p.total), 1);
  return `<ol class="db-rank">${lista.map((p, i) => `<li><span class="db-pos">${i + 1}</span><div class="db-rk">
      <div class="db-rl"><b>${esc(p.nome || p.codigo)}</b><b class="db-v">${brl(p.total)}</b></div>
      <div class="db-barra"><i style="width:${Math.max(2, (p.total / max) * 100)}%"></i></div>
      <small>Cód. ${esc(p.codigo)} · ${qtd(p.quantidade)} vendido${Number(p.quantidade) === 1 ? '' : 's'} · ${p.pedidos} pedido${p.pedidos === 1 ? '' : 's'}${p.margem !== null ? ` · <span class="db-mg ${p.margem < lim ? 'baixa' : ''}">margem ${pct(p.margem)}${p.margem < lim ? ' ▼' : ''}</span>` : ''}</small></div></li>`).join('')}</ol>`;
}
function rankClientes(lista) {
  if (!lista.length) return '<div class="db-vz">Nenhum cliente comprou no período.</div>';
  const max = Math.max(...lista.map((c) => c.total), 1);
  return `<ol class="db-rank">${lista.map((c, i) => `<li><span class="db-pos">${i + 1}</span><div class="db-rk">
      <div class="db-rl"><b>${esc(c.nome || `Cliente ${c.codigo}`)}</b><b class="db-v">${brl(c.total)}</b></div>
      <div class="db-barra"><i style="width:${Math.max(2, (c.total / max) * 100)}%"></i></div>
      <small>Cód. ${esc(c.codigo)} · ${c.pedidos} pedido${c.pedidos === 1 ? '' : 's'} · ticket ${brl(c.ticket)} · último ${esc(quando(c.ultima))}</small></div></li>`).join('')}</ol>`;
}
