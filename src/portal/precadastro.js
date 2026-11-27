/* Painel → Clientes → "Carteira do portal" (pré-cadastro em lote, decisão da Souza Ribeiro em 27/11/2026).
 *
 * 1. Importar: a equipe escolhe os dois arquivos do lote (Clientes_para_Cadastro.csv e
 *    Minha_Lista_e_Precos_Congelados.csv). Eles são lidos aqui no navegador e vão para o Supabase
 *    pela função precadastro-g360: lista de clientes, Minha Lista e os preços que vão ser congelados.
 * 2. Congelar no G360: com o login do operador, o painel grava cada preço com
 *    POST operadores/clientes/{cliente}/precos-congelados (o G360 confere cada um), no ritmo do limite da API.
 *    O andamento fica no Supabase, então dá para pausar, fechar e continuar depois.
 * 3. O cliente da lista cria a senha no "Quero ser cliente" (ou "Pedir acesso") e entra na hora
 *    (função cadastro-g360). Quem já entrou no portal aparece como "Entrou".
 */
import { buscarProdutosOperador, incluirPrecoCongelado, interpretarErro, ErroApi } from '../api/g360.js';
import { comEspera } from './lotesfotos.js';
import { dinheiro, numeroPainel } from '../ui/formato.js';
import { $, esc, toast } from './comum.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dataBr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const isoDeBr = (t) => { const m = String(t || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
const valorPonto = (t) => String(t || '').trim().replace(/\./g, '').replace(',', '.');
const POR_PAGINA = 50;
const RITMO_MS = 400; // ≈150 gravações por minuto: sobra limite da API (240/min) para o resto da equipe

/** CSV com ";" (o Excel do Brasil), com aspas. Devolve linhas como objetos pelo cabeçalho. */
export function lerCsv(texto) {
  const t = texto.replace(/^﻿/, '');
  const linhas = []; let campo = ''; let linha = []; let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ';') { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo); campo = ''; if (linha.some((x) => x !== '')) linhas.push(linha); linha = [];
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); if (linha.some((x) => x !== '')) linhas.push(linha); }
  const [cab, ...resto] = linhas;
  if (!cab) return [];
  const nomes = cab.map((n) => n.trim());
  return resto.map((l) => Object.fromEntries(nomes.map((n, i) => [n, (l[i] ?? '').trim()])));
}

/**
 * o: { alvo, pre(acao, dados) (função precadastro-g360), token(), limiteMargem(), montarLista(cliente), painelCondicoes(alvo, codigo), aoSessaoEncerrada(e) }
 */
export function desenharPreCadastro(o) {
  const alvo = o.alvo;
  const st = { lista: null, q: '', filtro: '', curva: '', pagina: 1, cfg: null, rodando: false, pausar: false };

  async function carregar() {
    alvo.innerHTML = '<div class="empty2">Carregando a carteira…</div>';
    try {
      const [r, c] = await Promise.all([o.pre('pre_listar'), o.pre('pre_config_ler').catch(() => null)]);
      st.lista = r.dados || []; st.cfg = c?.dados || null;
    } catch (e) { alvo.innerHTML = `<div class="empty2">${esc(e.message)}</div>`; return; }
    pintar();
  }

  const situacao = (c) => (c.pedidos ? 'comprou' : c.entrou_em || c.senha_criada_em ? 'entrou' : 'nao');
  const ROTULO = { comprou: ['Comprou pelo portal', 'var(--lima)'], entrou: ['Entrou no portal', '#7fd3ff'], nao: ['Ainda não entrou', 'var(--tx3)'] };

  function pintar() {
    const l = st.lista || [];
    const soma = (k) => l.reduce((s, c) => s + Number(c[k] || 0), 0);
    const nEntrou = l.filter((c) => situacao(c) !== 'nao').length;
    const pend = soma('cong_pendentes'); const grav = soma('cong_gravados'); const fora = soma('cong_fora');
    alvo.innerHTML = `<div class="panel" style="margin:12px 16px;padding:14px 16px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b style="font-size:16px">👥 Carteira do portal</b>
          <span class="hint" style="margin:0">${l.length} cliente${l.length === 1 ? '' : 's'} · <b style="color:var(--lima)">${nEntrou} já entraram</b> · ${l.length - nEntrou} ainda não</span>
          <span style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
            <button class="tool ab" id="preImp" type="button">📥 Importar lote</button>
            ${pend ? `<button class="btn pri" id="preCong" type="button" style="height:36px">❄ Congelar no G360 (${pend.toLocaleString('pt-BR')} pendentes)</button>` : ''}</span></div>
        ${l.length ? `<div class="hint" style="margin:6px 0 0">Preços do lote: <b style="color:var(--lima)">${grav.toLocaleString('pt-BR')} congelados no G360</b> · ${pend.toLocaleString('pt-BR')} pendentes${fora ? ` · ${fora.toLocaleString('pt-BR')} ficaram de fora (veja em ❄ Preços do cliente)` : ''}</div>` : ''}
        <label class="isen" style="margin-top:8px"><input type="checkbox" id="preTrava" ${st.cfg?.pre_conferir_contato ? 'checked' : ''}> No "Quero ser cliente", só criar a senha se o WhatsApp ou o e-mail digitado for o da ficha no G360</label>
        <div class="hint" style="margin:2px 0 0">Quem está nesta lista cria a senha no próprio formulário ("Quero ser cliente" ou "Pedir acesso") e já entra vendo a Minha Lista e os preços dele, sem e-mail e sem aprovação.</div>
        <div id="preBox" aria-live="polite"></div></div>
      ${l.length ? `<div class="afil" style="padding:0 16px"><div class="search"><input id="preQ" type="search" placeholder="Buscar por nome, código, CNPJ/CPF, cidade ou vendedor…" value="${esc(st.q)}" aria-label="Buscar cliente da carteira"></div>
        <select id="preF" aria-label="Situação"><option value="">Todos</option><option value="nao" ${st.filtro === 'nao' ? 'selected' : ''}>Ainda não entraram</option><option value="entrou" ${st.filtro === 'entrou' ? 'selected' : ''}>Entraram</option><option value="comprou" ${st.filtro === 'comprou' ? 'selected' : ''}>Compraram pelo portal</option><option value="pend" ${st.filtro === 'pend' ? 'selected' : ''}>Com preço pendente</option></select>
        <select id="preCv" aria-label="Curva do cliente"><option value="">Todas as curvas</option>${['A', 'B', 'C'].map((k) => `<option value="${k}" ${st.curva === k ? 'selected' : ''}>Curva ${k} (${l.filter((c) => c.curva === k).length})</option>`).join('')}</select></div>
        <div id="preLinhas"></div>` : '<div class="empty2" style="margin:0 16px 16px">Nenhum cliente na carteira ainda. Clique em "📥 Importar lote" e escolha os dois arquivos do lote.</div>'}`;
    $('preImp').onclick = abrirImportar;
    $('preCong')?.addEventListener('click', abrirCongelar);
    $('preTrava').onchange = async (e) => {
      const v = e.target.checked; e.target.disabled = true;
      try { st.cfg = (await o.pre('pre_config_salvar', { pre_conferir_contato: v })).dados; toast(v ? 'Trava ligada: o formulário confere o WhatsApp ou o e-mail' : 'Trava desligada'); }
      catch (er) { e.target.checked = !v; toast(er.message); } finally { e.target.disabled = false; }
    };
    if (!l.length) return;
    $('preQ').addEventListener('input', () => { st.q = $('preQ').value; st.pagina = 1; linhas(); });
    $('preF').onchange = () => { st.filtro = $('preF').value; st.pagina = 1; linhas(); };
    $('preCv').onchange = () => { st.curva = $('preCv').value; st.pagina = 1; linhas(); };
    linhas();
  }

  function filtrados() {
    const q = semAcento(st.q.trim()); const qd = q.replace(/[^a-z0-9]/g, '');
    const l = (st.lista || []).filter((c) => {
      if (st.curva && c.curva !== st.curva) return false;
      if (st.filtro === 'pend' ? !Number(c.cong_pendentes) : st.filtro && situacao(c) !== st.filtro) return false;
      if (!q) return true;
      return semAcento(`${c.nome} ${c.cidade || ''} ${c.vendedores || ''} ${c.comprador_codigo}`).includes(q) || (qd.length >= 4 && String(c.documento || '').toLowerCase().includes(qd));
    });
    // Filtrando por curva: do cliente que mais comprou para o que menos comprou.
    return st.curva ? l.sort((a, b) => Number(b.faturamento || 0) - Number(a.faturamento || 0)) : l;
  }

  function linhas() {
    const f = filtrados(); const paginas = Math.max(1, Math.ceil(f.length / POR_PAGINA));
    st.pagina = Math.min(st.pagina, paginas);
    const pag = f.slice((st.pagina - 1) * POR_PAGINA, st.pagina * POR_PAGINA);
    const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    $('preLinhas').innerHTML = `<div class="crow2 h"><div>Cliente (${f.length})</div><div>Cód. G360</div><div>Situação</div><div>Lista e preços</div><div></div></div>`
      + (pag.length ? pag.map((c) => {
        const [rot, cor] = ROTULO[situacao(c)];
        return `<div class="crow2" data-cod="${esc(c.comprador_codigo)}"><div class="nm"><b>${c.curva ? `<span class="mk" style="background:${c.curva === 'A' ? 'rgba(178,224,74,.22);color:var(--lima)' : 'rgba(255,255,255,.08)'};margin-right:6px">${esc(c.curva)}</span>` : ''}${esc(c.nome)}</b><small>${esc(c.tipo)} ${esc(c.documento || '')} · ${esc(c.cidade || '—')}${c.vendedores ? ` · ${esc(c.vendedores)}` : ''} · última compra ${esc(dataBr(c.ultima_compra))}${c.faturamento ? ` · comprou ${esc(brl(c.faturamento))} no período` : ''}</small></div>
          <div class="sm sm2">${esc(c.comprador_codigo)}</div>
          <div class="sm"><b style="color:${cor}">${esc(rot)}</b>${c.ultimo_acesso ? `<small style="display:block">último acesso ${esc(new Date(c.ultimo_acesso).toLocaleDateString('pt-BR'))}</small>` : ''}${c.pedidos ? `<small style="display:block">${c.pedidos} pedido${c.pedidos === 1 ? '' : 's'} · ${esc(brl(c.valor))}</small>` : ''}</div>
          <div class="sm">${Number(c.itens_lista)} na lista<small style="display:block">❄ ${Number(c.cong_gravados)} congelados${Number(c.cong_pendentes) ? ` · ${Number(c.cong_pendentes)} pendentes` : ''}</small></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="tool ab" data-ml type="button">⭐ Minha Lista</button><button class="tool ab" data-pr type="button">❄ Preços</button><button class="tool ab" data-pg type="button">💳 Pagamento</button></div></div>
          <div data-det="${esc(c.comprador_codigo)}" hidden style="padding:0 16px 12px"></div>`;
      }).join('') : '<div class="empty2">Nenhum cliente com esse filtro.</div>')
      + (paginas > 1 ? `<div class="row" style="justify-content:center;gap:8px;padding:12px"><button class="tool" id="preAnt" ${st.pagina === 1 ? 'disabled' : ''}>‹ Anterior</button><span class="hint" style="margin:0">Página ${st.pagina} de ${paginas}</span><button class="tool" id="preProx" ${st.pagina === paginas ? 'disabled' : ''}>Próxima ›</button></div>` : '');
    $('preAnt')?.addEventListener('click', () => { st.pagina--; linhas(); });
    $('preProx')?.addEventListener('click', () => { st.pagina++; linhas(); });
    $('preLinhas').querySelectorAll('.crow2[data-cod]').forEach((row) => {
      const cod = Number(row.dataset.cod); const c = (st.lista || []).find((x) => Number(x.comprador_codigo) === cod);
      const det = $('preLinhas').querySelector(`[data-det="${cod}"]`);
      const alternar = (tipo, fn) => { if (!det.hidden && det.dataset.tipo === tipo) { det.hidden = true; det.innerHTML = ''; return; } det.hidden = false; det.dataset.tipo = tipo; fn(); };
      row.querySelector('[data-ml]').onclick = () => { o.montarLista({ codigo: cod, nome: c.nome }); };
      row.querySelector('[data-pr]').onclick = () => alternar('pr', () => precosDoCliente(det, c));
      row.querySelector('[data-pg]').onclick = () => alternar('pg', () => {
        det.innerHTML = '<div class="panel" style="margin:0;padding:12px 14px"><b>Formas de pagamento no portal</b><small class="hint" style="display:block;margin:2px 0 8px">Desmarque para esconder deste cliente. Para esconder de todos, use Configurações.</small><div data-cond-box></div></div>';
        o.painelCondicoes(det.querySelector('[data-cond-box]'), cod);
      });
    });
  }

  async function precosDoCliente(det, c) {
    det.innerHTML = '<div class="empty2">Carregando os preços do lote…</div>';
    let l;
    try { l = (await o.pre('pre_congelados_cliente', { comprador: Number(c.comprador_codigo) })).dados || []; }
    catch (e) { det.innerHTML = `<div class="empty2">${esc(e.message)}</div>`; return; }
    const SIT = { gravado: '✓ Congelado no G360', pendente: 'Pendente', recusado: 'Recusado pelo G360', ignorado: 'Ficou de fora' };
    det.innerHTML = l.length ? `<div class="panel" style="margin:0"><div style="max-height:360px;overflow:auto" data-rolar><table class="ivtab"><thead><tr><th>Produto</th><th>Preço</th><th>Validade</th><th>Última venda</th><th>Situação</th></tr></thead><tbody>
      ${l.map((p) => `<tr><td><b>Cód. ${esc(p.sku)}</b><small>${esc(p.unidade_venda)}</small></td><td>${esc(dinheiro(p.valor))}</td><td><small>${esc(dataBr(p.inicio))} a ${esc(dataBr(p.fim))}</small></td>
        <td><small>${esc(dataBr(p.data_venda))}${p.nf_origem ? ` · NF ${esc(p.nf_origem)}` : ''}</small></td><td><small class="${p.situacao === 'gravado' ? 'okmsg' : p.situacao === 'pendente' ? '' : 'ruim'}">${esc(SIT[p.situacao] || p.situacao)}${p.obs ? ` — ${esc(p.obs)}` : ''}</small></td></tr>`).join('')}
      </tbody></table></div></div>` : '<div class="empty2">Este cliente não tem preço para congelar no lote (só comprou antes de outubro).</div>';
  }

  /* ---------- 1. Importar os arquivos do lote ---------- */
  function abrirImportar() {
    const box = $('preBox');
    if (box.dataset.tipo === 'imp' && box.innerHTML) { box.innerHTML = ''; box.dataset.tipo = ''; return; }
    box.dataset.tipo = 'imp';
    const hoje = new Date().toISOString().slice(0, 10); const f = new Date(); f.setDate(f.getDate() + 60);
    box.innerHTML = `<div class="panel" style="margin:12px 0 0;padding:12px 14px">
      <b>📥 Importar lote</b><small class="hint" style="display:block;margin:2px 0 8px">Os arquivos são lidos aqui no navegador. Importar de novo não duplica nada e não desfaz o que já foi congelado.</small>
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <label class="btn sec" style="height:40px;display:inline-flex;align-items:center;cursor:pointer">1. Clientes_para_Cadastro.csv<input type="file" id="preArqC" accept=".csv,text/csv" hidden></label>
        <label class="btn sec" style="height:40px;display:inline-flex;align-items:center;cursor:pointer">2. Minha_Lista_e_Precos_Congelados.csv<input type="file" id="preArqL" accept=".csv,text/csv" hidden></label></div>
      <div class="hint" id="preArqs" style="margin:6px 0"></div>
      <div class="row" style="align-items:flex-end;gap:12px;flex-wrap:wrap">
        <label class="hint" style="margin:0">Preço congelado de <input type="date" id="preIni" value="${hoje}"></label>
        <label class="hint" style="margin:0">até <input type="date" id="preFim" value="${f.toISOString().slice(0, 10)}" min="${hoje}"></label>
        <button class="btn pri" id="preImpOk" type="button" disabled style="margin-left:auto">Importar</button></div>
      <div id="preImpRes" aria-live="polite"></div></div>`;
    const arqs = { c: null, l: null };
    const ver = () => {
      $('preArqs').innerHTML = [arqs.c ? `✓ ${arqs.c.linhas.length.toLocaleString('pt-BR')} clientes` : '', arqs.l ? `✓ ${arqs.l.linhas.length.toLocaleString('pt-BR')} itens de Minha Lista` : ''].filter(Boolean).join(' · ');
      $('preImpOk').disabled = !(arqs.c && arqs.l);
    };
    const ler = (id, tipo, colunas) => $(id).addEventListener('change', async (e) => {
      const f2 = e.target.files?.[0]; e.target.value = ''; if (!f2) return;
      const linhas = lerCsv(await f2.text());
      const faltam = colunas.filter((k) => !(linhas[0] && k in linhas[0]));
      if (!linhas.length || faltam.length) { $('preImpRes').innerHTML = `<div class="okmsg bad">Este não é o arquivo ${tipo === 'c' ? '1 (clientes)' : '2 (Minha Lista e preços)'}${faltam.length ? `: faltam as colunas ${esc(faltam.join(', '))}` : ''}.</div>`; return; }
      $('preImpRes').innerHTML = ''; arqs[tipo] = { linhas }; ver();
    });
    ler('preArqC', 'c', ['cod_cliente', 'cliente', 'cnpj_cpf', 'cidade', 'ultima_compra']);
    ler('preArqL', 'l', ['cod_cliente', 'produto_id_portal', 'sku', 'unidade', 'congelar', 'preco_congelado', 'data_ultima_venda']);
    $('preImpOk').onclick = async () => {
      const inicio = $('preIni').value; const fim = $('preFim').value; const res = $('preImpRes');
      if (!inicio || !fim || fim < inicio) { res.innerHTML = '<div class="okmsg bad">A data final precisa ser igual ou depois da inicial.</div>'; return; }
      const b = $('preImpOk'); b.disabled = true;
      const itens = arqs.l.linhas.filter((r) => /^\d+$/.test(r.produto_id_portal)).map((r) => ({
        codigo: Number(r.cod_cliente), produto_id: Number(r.produto_id_portal), sku: r.sku, unidade: r.unidade,
        congelar: r.congelar === 'SIM', valor: valorPonto(r.preco_congelado), nf: r.nf_ultima_venda, data: isoDeBr(r.data_ultima_venda),
      }));
      const porCli = new Map();
      itens.forEach((i) => { const r = porCli.get(i.codigo) || { lista: 0, cong: 0 }; r.lista++; if (i.congelar) r.cong++; porCli.set(i.codigo, r); });
      const clientes = arqs.c.linhas.map((r) => ({
        codigo: Number(r.cod_cliente), documento: r.cnpj_cpf, nome: r.cliente, cidade: r.cidade, bairro: r.bairro, vendedores: r.vendedores,
        ultima_compra: isoDeBr(r.ultima_compra), curva: r.curva || '', faturamento: r.faturamento_periodo ? valorPonto(r.faturamento_periodo) : '', itens_lista: porCli.get(Number(r.cod_cliente))?.lista || 0, itens_congelados: porCli.get(Number(r.cod_cliente))?.cong || 0,
      }));
      const codigos = new Set(clientes.map((c) => c.codigo));
      const semCliente = itens.filter((i) => !codigos.has(i.codigo)).length;
      try {
        for (let i = 0; i < clientes.length; i += 500) {
          b.textContent = `Clientes ${Math.min(i + 500, clientes.length)} de ${clientes.length}…`;
          await o.pre('pre_importar_clientes', { lote: `lote_${inicio}`, clientes: clientes.slice(i, i + 500) });
        }
        const validos = itens.filter((i) => codigos.has(i.codigo));
        for (let i = 0; i < validos.length; i += 1200) {
          b.textContent = `Itens ${Math.min(i + 1200, validos.length).toLocaleString('pt-BR')} de ${validos.length.toLocaleString('pt-BR')}…`;
          await o.pre('pre_importar_itens', { inicio, fim, itens: validos.slice(i, i + 1200) });
        }
      } catch (e) { b.disabled = false; b.textContent = 'Importar'; res.innerHTML = `<div class="okmsg bad">Parou no meio: ${esc(e.message)}. Pode importar de novo: o que já entrou não duplica.</div>`; return; }
      toast('Lote importado ✓');
      box.innerHTML = ''; box.dataset.tipo = '';
      await carregar();
      $('preBox').innerHTML = `<div class="okmsg">Importado: ${clientes.length.toLocaleString('pt-BR')} clientes e ${itens.length.toLocaleString('pt-BR')} itens de Minha Lista${semCliente ? ` (${semCliente} itens sem cliente no arquivo 1 ficaram de fora)` : ''}. Agora clique em "❄ Congelar no G360".</div>`;
    };
  }

  /* ---------- 2. Congelar no G360 ---------- */
  async function abrirCongelar() {
    const box = $('preBox');
    if (st.rodando) return;
    box.dataset.tipo = 'cong';
    box.innerHTML = '<div class="empty2">Conferindo os produtos no G360 (unidade, custo e margem)…</div>';
    let pend; const prods = new Map();
    try {
      const ids = (await o.pre('pre_congelados_produtos')).dados || [];
      for (let i = 0; i < ids.length; i += 50) {
        box.innerHTML = `<div class="empty2">Conferindo os produtos no G360… ${Math.min(i + 50, ids.length)} de ${ids.length}</div>`;
        const { dados } = await comEspera(() => buscarProdutosOperador(o.token(), { ids: ids.slice(i, i + 50), limite: 50 }));
        (dados || []).forEach((p) => prods.set(Number(p.id), p));
      }
      pend = [];
      for (let de = 0; ; ) {
        const r = await o.pre('pre_congelados_pendentes', { limite: 500, de });
        pend.push(...(r.dados || [])); de += (r.dados || []).length;
        box.innerHTML = `<div class="empty2">Lendo os preços pendentes… ${pend.length.toLocaleString('pt-BR')}</div>`;
        if (!(r.dados || []).length || (r.dados || []).length < 500) break;
      }
    } catch (e) { erro(box, e); return; }
    const lim = o.limiteMargem();
    const margem = (p, valor) => (p?.custo_visivel && p.custo !== null && p.custo !== undefined && Number(valor) > 0 ? ((Number(valor) - Number(p.custo)) / Number(valor)) * 100 : null);
    const grupos = { ok: [], unidade: [], sem: [], margem: [] };
    for (const k of pend) {
      const p = prods.get(Number(k.produto_id));
      if (!p) grupos.sem.push(k);
      else if (String(p.unidade || '').toUpperCase() !== String(k.unidade_venda).toUpperCase()) grupos.unidade.push(k);
      else { const m = margem(p, k.valor); if (m !== null && m < lim) grupos.margem.push({ ...k, m }); else grupos.ok.push(k); }
    }
    const n = (x) => x.toLocaleString('pt-BR');
    box.innerHTML = `<div class="panel" style="margin:12px 0 0;padding:12px 14px">
      <b>❄ Congelar no G360</b>
      <ul class="hint" style="margin:6px 0 8px 18px;padding:0">
        <li><b style="color:var(--lima)">${n(grupos.ok.length)} prontos para congelar</b></li>
        ${grupos.margem.length ? `<li><b style="color:#ffc400">${n(grupos.margem.length)} com margem abaixo de ${esc(numeroPainel(lim, 0))}%</b> pelo custo de hoje <button class="tool" id="preVerMg" type="button" style="height:28px">ver</button></li>` : ''}
        ${grupos.unidade.length ? `<li>${n(grupos.unidade.length)} vendidos em outra embalagem (ex.: caixa): ficam de fora, congele pela aba Preços congelados</li>` : ''}
        ${grupos.sem.length ? `<li>${n(grupos.sem.length)} produtos não encontrados no G360 (inativos): ficam de fora</li>` : ''}</ul>
      <div id="preMgLista" hidden></div>
      ${grupos.margem.length ? `<label class="isen"><input type="checkbox" id="preMgTb"> Congelar também os ${n(grupos.margem.length)} com margem abaixo do mínimo</label>` : ''}
      <div class="hint" style="margin:4px 0 8px">Leva uns ${Math.max(1, Math.ceil(((grupos.ok.length + grupos.margem.length) * RITMO_MS) / 60000))} minutos. Deixe esta aba aberta; se fechar ou pausar, é só clicar de novo que continua de onde parou.</div>
      <div class="row" style="gap:8px"><button class="btn pri" id="preIr" type="button">Começar</button><button class="btn sec" id="prePausa" type="button" hidden>Pausar</button><span class="hint" id="preAnd" style="margin:0 0 0 8px" aria-live="polite"></span></div>
      <div id="preCongRes"></div></div>`;
    $('preVerMg')?.addEventListener('click', () => {
      const el = $('preMgLista'); el.hidden = !el.hidden;
      el.innerHTML = `<div style="max-height:260px;overflow:auto;margin-bottom:8px" data-rolar><table class="ivtab"><thead><tr><th>Cliente</th><th>Produto</th><th>Preço</th><th>Margem</th></tr></thead><tbody>${grupos.margem.slice(0, 500).map((k) => {
        const c = (st.lista || []).find((x) => Number(x.comprador_codigo) === Number(k.comprador_codigo));
        const p = prods.get(Number(k.produto_id));
        return `<tr><td><small>${esc(c?.nome || k.comprador_codigo)}</small></td><td><small>${esc(p?.nome || k.sku)} · cód. ${esc(k.sku)}</small></td><td>${esc(dinheiro(k.valor))}</td><td><b class="mg bad">${esc(numeroPainel(k.m, 1))}%</b></td></tr>`;
      }).join('')}</tbody></table></div>${grupos.margem.length > 500 ? `<div class="hint">Mostrando 500 de ${n(grupos.margem.length)}.</div>` : ''}`;
    });
    $('preIr').onclick = async () => {
      const comMargem = $('preMgTb')?.checked === true;
      const fila = comMargem ? [...grupos.ok, ...grupos.margem] : grupos.ok;
      // Os de fora ficam marcados com o motivo (aparecem em ❄ Preços do cliente).
      const fora = [
        ...grupos.unidade.map((k) => ({ comprador: k.comprador_codigo, produto_id: k.produto_id, situacao: 'ignorado', obs: `Vendido em ${k.unidade_venda}; a unidade do produto é ${prods.get(Number(k.produto_id))?.unidade || '—'}. Congele pela aba Preços congelados.` })),
        ...grupos.sem.map((k) => ({ comprador: k.comprador_codigo, produto_id: k.produto_id, situacao: 'ignorado', obs: 'Produto não encontrado no G360 (inativo ou fora da venda).' })),
      ];
      await rodar(fila, fora);
    };
  }

  async function rodar(fila, fora) {
    st.rodando = true; st.pausar = false;
    const b = $('preIr'); const pa = $('prePausa'); const and = $('preAnd'); const res = $('preCongRes');
    b.disabled = true; pa.hidden = false; pa.onclick = () => { st.pausar = true; pa.disabled = true; pa.textContent = 'Pausando…'; };
    const marcas = [];
    const enviarMarcas = async (todas = false) => {
      while (marcas.length >= 50 || (todas && marcas.length)) await o.pre('pre_congelados_marcar', { itens: marcas.splice(0, 50) });
    };
    let ok = 0; let ja = 0; let recusados = 0; let parou = '';
    try {
      for (let i = 0; i < fora.length; i += 50) await o.pre('pre_congelados_marcar', { itens: fora.slice(i, i + 50) });
      for (const [i, k] of fila.entries()) {
        if (st.pausar) { parou = 'Pausado. Clique em "❄ Congelar no G360" para continuar.'; break; }
        and.textContent = `${n2(i + 1)} de ${n2(fila.length)} · ${n2(ok)} congelados${ja ? ` · ${n2(ja)} já tinham preço` : ''}${recusados ? ` · ${n2(recusados)} recusados` : ''}`;
        const inicio = Date.now();
        try {
          const r = await comEspera(() => incluirPrecoCongelado(o.token(), Number(k.comprador_codigo), { produto: Number(k.produto_id), unidade_id: null, valor: String(k.valor), inicio: k.inicio, fim: k.fim }));
          marcas.push({ comprador: k.comprador_codigo, produto_id: k.produto_id, situacao: 'gravado', preco_id: r?.id ?? null }); ok++;
        } catch (e) {
          if (e instanceof ErroApi && e.status === 401) { await enviarMarcas(true).catch(() => {}); o.aoSessaoEncerrada?.(e); return; }
          const info = e instanceof ErroApi ? interpretarErro(e) : { mensagem: e.message };
          if (e instanceof ErroApi && (e.status === 403 || e.status === 423 || e.tipo === 'rede' || e.tipo === 'tempo')) { parou = `${info.mensagem}${info.suporte ? ` (Código para o suporte: ${info.suporte})` : ''}`; break; }
          if (e instanceof ErroApi && e.codigo === 'VIGENCIA_SOBREPOSTA') { marcas.push({ comprador: k.comprador_codigo, produto_id: k.produto_id, situacao: 'ignorado', obs: 'Já tinha preço congelado neste período no G360 (ficou o que já estava).' }); ja++; }
          else { marcas.push({ comprador: k.comprador_codigo, produto_id: k.produto_id, situacao: 'recusado', obs: `${info.mensagem}${info.suporte ? ` (${info.suporte})` : ''}` }); recusados++; }
        }
        await enviarMarcas();
        const falta = RITMO_MS - (Date.now() - inicio); if (falta > 0) await sleep(falta);
      }
      await enviarMarcas(true);
    } catch (e) { parou = `O andamento não foi salvo: ${e.message}. Clique de novo para continuar.`; }
    finally { st.rodando = false; }
    res.innerHTML = `<div class="${parou || recusados ? 'rv-aviso' : 'okmsg'}">${n2(ok)} preço${ok === 1 ? '' : 's'} congelado${ok === 1 ? '' : 's'} no G360${ja ? ` · ${n2(ja)} já tinham preço` : ''}${recusados ? ` · <b>${n2(recusados)} recusados</b> (motivo em ❄ Preços do cliente)` : ''}${fora.length ? ` · ${n2(fora.length)} ficaram de fora` : ''}.${parou ? `<br><b>${esc(parou)}</b>` : ''}</div>`;
    toast(`${n2(ok)} preços congelados ✓`);
    pa.hidden = true;
    try { st.lista = (await o.pre('pre_listar')).dados || []; } catch { /* mantém a lista */ }
    const salvo = $('preBox').innerHTML; pintar(); $('preBox').innerHTML = salvo;
    $('preIr')?.remove(); $('prePausa')?.remove();
  }

  const n2 = (x) => Number(x).toLocaleString('pt-BR');
  function erro(box, e) {
    if (e instanceof ErroApi && e.status === 401) { o.aoSessaoEncerrada?.(e); return; }
    const i = e instanceof ErroApi ? interpretarErro(e) : { mensagem: e.message };
    box.innerHTML = `<div class="rv-aviso bad">${esc(i.mensagem)}${i.suporte ? ` <small>(Código para o suporte: ${esc(i.suporte)})</small>` : ''}</div>`;
  }

  carregar();
}
