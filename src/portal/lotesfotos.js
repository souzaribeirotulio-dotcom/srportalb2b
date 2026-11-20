/* Planilhas para fotos (painel → Produtos).
 * Monta lotes de N produtos SEM foto no G360, pulando os que já estão em outra planilha,
 * e baixa um .xlsx no mesmo padrão da planilha de teste que o ChatGPT entende
 * (código, descrição, marca, categoria, unidade, LINK DA FOTO em amarelo, observações e
 * os três nomes de arquivo CODIGO_capa/ambiente/uso.jpg). Os lotes ficam gravados no Supabase. */
import { buscarProdutosOperador, listarFotosOperador, listarVitrine, interpretarErro, ErroApi, esperaPara } from '../api/g360.js';
import { carregarExibicao, registro, nomeExibicao, categoriaExibicao, pesoCurva } from '../catalogo/exibicao.js';
import { $, esc, toast, abrirModal, fecharModal } from './comum.js';

let ctx = null;   // { token, painel, aoSessaoEncerrada }
let lotes = [];
let gerando = false;

const sleep = (s) => new Promise((ok) => setTimeout(ok, s * 1000));
const marcaTxt = (m) => (m && typeof m === 'object' ? m.nome : m) || '';

export async function abrirLotesFotos(opcoes) {
  ctx = opcoes;
  abrirModal('mAdm');
  const box = $('admBox');
  box.innerHTML = `<div class="fxh"><div><h3>📄 Planilhas para fotos</h3><div class="sub">Gera a planilha no padrão do ChatGPT com produtos que ainda não têm foto no G360. Cada produto entra numa planilha só.</div></div><button class="fxx" id="lfX" title="Fechar">×</button></div>
    <div class="fgrid">
      <div><label for="lfQtd">Produtos por planilha</label><input class="inp" id="lfQtd" type="number" min="1" max="500" value="100"></div>
      <div><label for="lfResp">Funcionário responsável</label><input class="inp" id="lfResp" maxlength="80" placeholder="Ex.: Maria"></div>
      <div class="full"><label for="lfModo">Quais produtos</label><select class="inp" id="lfModo">
        <option value="visivel">Aparecendo no portal e sem foto (mais vendidos primeiro)</option>
        <option value="todos">Todos do G360 sem foto</option></select></div></div>
    <div id="lfMsg" aria-live="polite" style="margin-top:10px"></div>
    <div class="act"><button class="btn sec" id="lfFechar" type="button">Fechar</button><button class="btn pri" id="lfGerar" type="button">Gerar e baixar planilha</button></div>
    <div class="csec">Planilhas já geradas</div><div id="lfLista"><div class="hint">Carregando…</div></div>`;
  $('lfX').onclick = $('lfFechar').onclick = () => { if (!gerando) fecharModal('mAdm'); };
  $('lfGerar').onclick = gerar;
  await carregarLotes();
}

async function carregarLotes() {
  try { lotes = (await ctx.painel('lotes_listar')).dados || []; } catch (e) { $('lfLista').innerHTML = `<div class="g360-erro">${esc(e.message)}</div>`; return; }
  desenharLotes();
}

function desenharLotes() {
  const el = $('lfLista'); if (!el) return;
  if (!lotes.length) { el.innerHTML = '<div class="hint">Nenhuma planilha ainda. Gere a primeira acima.</div>'; return; }
  el.innerHTML = lotes.map((l) => `<div class="crow" data-id="${esc(l.id)}" style="grid-template-columns:1fr auto auto">
      <div class="nm"><b>Lote ${Number(l.numero)}</b>${l.responsavel ? ` · ${esc(l.responsavel)}` : ''}<small>${l.codigos.length} produtos · ${esc(new Date(l.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}</small></div>
      <button class="tool" data-baixar>⬇ Baixar de novo</button><button class="tool" data-apagar style="color:#ff8a8a">Liberar produtos</button></div>`).join('');
  el.querySelectorAll('[data-baixar]').forEach((b) => b.onclick = async () => {
    const l = lotes.find((x) => x.id === b.closest('[data-id]').dataset.id);
    b.disabled = true;
    try { await baixar(l, await produtosDosCodigos(l.codigos)); } catch (e) { erro(e); } finally { b.disabled = false; }
  });
  el.querySelectorAll('[data-apagar]').forEach((b) => b.onclick = async () => {
    if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = 'Confirmar: os produtos voltam para as próximas planilhas'; return; }
    b.disabled = true;
    try { await ctx.painel('lote_apagar', { id: b.closest('[data-id]').dataset.id }); await carregarLotes(); toast('Lote apagado: os produtos voltam para as próximas planilhas'); }
    catch (e) { b.disabled = false; toast(e.message); }
  });
}

function msg(html) { if ($('lfMsg')) $('lfMsg').innerHTML = html; }
function erro(e) {
  if (e instanceof ErroApi && e.status === 401) { fecharModal('mAdm'); ctx.aoSessaoEncerrada?.(e); return; }
  const i = e instanceof ErroApi ? interpretarErro(e) : { mensagem: e.message };
  msg(`<div class="g360-erro">${esc(i.mensagem)}${i.suporte ? `<small style="display:block">Código para o suporte: ${esc(i.suporte)}</small>` : ''}</div>`);
}

/** Repete com espera o que a API marca como "tentar de novo". */
export async function comEspera(fn) {
  for (let t = 0; ; t++) {
    try { return await fn(); } catch (e) {
      if (!(e instanceof ErroApi) || e.responsavel !== 'tentar_de_novo' || e.tipo === 'rede' || e.tipo === 'tempo' || t >= 3) throw e;
      await sleep(esperaPara(e, t));
    }
  }
}

/** Para leituras (listar galeria, buscar produto): também insiste quando a conexão cai ou o servidor não responde,
 * porque é o que acontece quando muita gente da mesma rede usa o painel ao mesmo tempo (limite por IP e loja).
 * Espera 5, 10, 20 e 40 s antes de desistir. aoEsperar(segundos) mostra a espera na tela. */
export async function comEsperaLeitura(fn, aoEsperar) {
  for (let t = 0; ; t++) {
    try { return await fn(); } catch (e) {
      const rede = e instanceof ErroApi && (e.tipo === 'rede' || e.tipo === 'tempo');
      const tentar = e instanceof ErroApi && e.responsavel === 'tentar_de_novo';
      if (!(rede || tentar) || t >= 4) throw e;
      const s = rede ? [5, 10, 20, 40][Math.min(t, 3)] : esperaPara(e, t);
      aoEsperar?.(s); await sleep(s);
    }
  }
}

/** Ritmo das consultas de galeria: no máximo uma a cada 450 ms (≈130 por minuto), para sobrar limite para o resto da equipe. */
let ultimaGaleria = 0;
async function noRitmo(fn) {
  const agora = Date.now(); const vez = Math.max(agora, ultimaGaleria + 450); ultimaGaleria = vez;
  if (vez > agora) await sleep((vez - agora) / 1000);
  return fn();
}

/** Códigos que a vitrine já mostra com foto (uma consulta para 50 produtos). Vitrine fechada: devolve null. */
let ultimaVitrine = 0;
async function comFotoPelaVitrine(codigos) {
  try {
    const espera = ultimaVitrine + 2100 - Date.now(); if (espera > 0) await sleep(espera / 1000);
    ultimaVitrine = Date.now();
    const { dados } = await comEspera(() => listarVitrine({ codigos, limite: 50 }));
    return new Set(dados.filter((p) => Array.isArray(p.fotos) && p.fotos.length).map((p) => String(p.codigo)));
  } catch { return null; }
}

export async function produtosDosCodigos(codigos, token = ctx.token) {
  const porCod = new Map();
  for (let i = 0; i < codigos.length; i += 50) {
    const { dados } = await comEsperaLeitura(() => buscarProdutosOperador(token(), { codigos: codigos.slice(i, i + 50), limite: 50 }));
    dados.forEach((p) => porCod.set(String(p.codigo), p));
  }
  return codigos.map((c) => porCod.get(String(c))).filter(Boolean);
}

/**
 * Monta e grava um lote de até qtd produtos sem foto no G360, sem repetir os de outros lotes.
 * opcoes: { token, painel, qtd, responsavel, modo: 'visivel'|'todos', aoProgresso(txt) }
 * Devolve { lote, produtos } ou { vazio: true } ou { semLista: true }.
 */
export async function montarLote(o) {
  ctx = ctx || o;
  const usar = { token: o.token, painel: o.painel };
  await carregarExibicao();
  const existentes = (await usar.painel('lotes_listar')).dados || [];
  const tomados = new Set(existentes.flatMap((l) => l.codigos.map(String)));
  const escolhidos = []; let conferidos = 0; let falhas = 0; let ultimoErro = null; let fatal = null;
  // Um produto que a API não deixa conferir (foto, produto fora da loja…) é deixado de lado; o lote segue.
  // Para tudo só em sessão encerrada, sem acesso ou sem conexão. Depois de parar, ninguém mais escreve o progresso,
  // para a mensagem de erro não ser apagada pelas conferências que ainda estavam a caminho.
  let comFoto = 0; let aguardando = 0; let vitrineAberta = true; let quedas = 0;
  const progresso = () => { if (!fatal) o.aoProgresso?.(`Conferindo quem já tem foto no G360… ${escolhidos.length} de ${o.qtd} produtos sem foto (${conferidos} conferidos${comFoto ? `, ${comFoto} já com foto` : ''}${falhas ? `, ${falhas} sem resposta do G360 deixados de lado` : ''})${aguardando ? ` · servidor ocupado, tentando de novo em ${aguardando} s…` : ''}`); };
  const aoEsperar = (s) => { aguardando = s; progresso(); setTimeout(() => { aguardando = 0; }, s * 1000); };
  const conferirFotos = async (lista) => {
    let fila = lista.filter((p) => !tomados.has(String(p.codigo)) && !registro(p)?.oculto);
    // A vitrine diz de uma vez quais já têm foto: esses nem passam pela galeria.
    if (vitrineAberta) {
      const vistos = new Set();
      for (let k = 0; k < fila.length; k += 50) {
        const r = await comFotoPelaVitrine(fila.slice(k, k + 50).map((p) => String(p.codigo)));
        if (!r) { vitrineAberta = false; vistos.clear(); break; }
        r.forEach((c) => vistos.add(c));
      }
      const antes = fila.length; fila = fila.filter((p) => !vistos.has(String(p.codigo)));
      comFoto += antes - fila.length; conferidos += antes - fila.length;
    }
    progresso();
    let i = 0;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (!fatal && i < fila.length && escolhidos.length < o.qtd) {
        const p = fila[i++];
        let g;
        try { g = await comEsperaLeitura(() => noRitmo(() => listarFotosOperador(usar.token(), p.id)), aoEsperar); }
        catch (e) {
          if (!(e instanceof ErroApi) || e.status === 401 || e.status === 403) { fatal = fatal || e; return; }
          // Sem conexão mesmo depois de esperar: pula só este produto; três seguidos = servidor fora, para.
          if (e.tipo === 'rede' || e.tipo === 'tempo') { quedas++; if (quedas >= 3) { fatal = fatal || e; return; } } else quedas = 0;
          falhas++; ultimoErro = e;
          if (falhas >= 20 && falhas > conferidos) { fatal = e; return; } // quase tudo falhando: para e mostra o erro
          progresso(); continue;
        }
        conferidos++; quedas = 0;
        if (g.fotos?.length) comFoto++;
        if (!g.fotos?.length && escolhidos.length < o.qtd) { escolhidos.push(p); tomados.add(String(p.codigo)); }
        progresso();
      }
    }));
    if (fatal) throw fatal;
  };
  if (o.modo === 'visivel') {
    const vis = (await usar.painel('visiveis_ler')).dados;
    if (!vis?.visiveis?.length) return { semLista: true };
    const ordem = vis.visiveis.map(String).filter((c) => !tomados.has(c))
      .map((c, i) => ({ c, i, w: pesoCurva({ codigo: c }) })).sort((a, b) => a.w - b.w || a.i - b.i).map((x) => x.c);
    for (let i = 0; i < ordem.length && escolhidos.length < o.qtd; i += 50) await conferirFotos(await produtosDosCodigos(ordem.slice(i, i + 50), usar.token));
  } else {
    for (let pagina = 1, total = Infinity; (pagina - 1) * 50 < total && escolhidos.length < o.qtd; pagina++) {
      const r = await comEsperaLeitura(() => buscarProdutosOperador(usar.token(), { pagina, limite: 50 }), aoEsperar);
      total = r.paginacao?.total ?? 0;
      await conferirFotos(r.dados);
    }
  }
  if (!escolhidos.length) { if (ultimoErro) throw ultimoErro; return { vazio: true }; }
  const lote = (await usar.painel('lote_salvar', { codigos: escolhidos.map((p) => String(p.codigo)), responsavel: o.responsavel })).dados;
  return { lote, produtos: escolhidos };
}

async function gerar() {
  if (gerando) return;
  const qtd = Math.max(1, Math.min(500, Math.round(Number($('lfQtd').value) || 100)));
  gerando = true; $('lfGerar').disabled = true; $('lfGerar').textContent = 'Montando a planilha…';
  try {
    const r = await montarLote({ token: ctx.token, painel: ctx.painel, qtd, responsavel: $('lfResp').value.trim().slice(0, 80), modo: $('lfModo').value, aoProgresso: (t) => msg(`<div class="hint">${esc(t)}</div>`) });
    if (r.semLista) { msg('<div class="rv-aviso">Ainda não temos a lista do que aparece no portal (ela nasce quando um cliente entra). Entre uma vez como cliente ou escolha "Todos do G360 sem foto".</div>'); return; }
    if (r.vazio) { msg('<div class="rv-aviso">Nenhum produto sem foto ficou de fora das planilhas já geradas. 🎉</div>'); return; }
    await baixar(r.lote, r.produtos);
    msg(`<div class="okmsg">✓ Lote ${Number(r.lote.numero)} com ${r.produtos.length} produtos baixado${r.produtos.length < qtd ? ` (só havia ${r.produtos.length} sem foto)` : ''}.</div>`);
    await carregarLotes();
  } catch (e) { erro(e); }
  finally { gerando = false; if ($('lfGerar')) { $('lfGerar').disabled = false; $('lfGerar').textContent = 'Gerar e baixar planilha'; } }
}

/* ---------- arquivo .xlsx no padrão da planilha de teste ---------- */
async function baixar(lote, produtos) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Lote ${lote.numero}`, { views: [{ state: 'frozen', ySplit: 4 }] });
  [12, 56, 17, 16, 10, 55, 29, 23, 23, 23].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const fill = (c) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });
  const cor = (c, extra = {}) => ({ name: 'Calibri', color: { argb: c }, ...extra });
  ws.mergeCells('A1:J1'); ws.mergeCells('A2:J2');
  const t = ws.getCell('A1');
  t.value = `SOUZA RIBEIRO  |  IMAGENS DO PORTAL  |  LOTE ${lote.numero}${lote.responsavel ? `  |  ${lote.responsavel}` : ''}`;
  t.font = cor('FFFFFFFF', { bold: true, size: 15 }); t.fill = fill('FF17351E'); t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 39.75;
  const ins = ws.getCell('A2');
  ins.value = 'Preencha somente a coluna amarela (F) com o LINK DIRETO da foto real de cada produto (site do fabricante ou foto de vocês). Depois envie esta planilha ao ChatGPT.';
  ins.font = cor('FF244B2B', { size: 11 }); ins.fill = fill('FFE9F4E9'); ins.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
  ws.getRow(2).height = 30;
  const cab = ['Código', 'Descrição do produto', 'Marca', 'Categoria', 'Unid.', 'LINK DA FOTO (PREENCHER)', 'Observações (opcional)', 'Nome capa', 'Nome ambiente', 'Nome uso'];
  const r4 = ws.getRow(4); r4.height = 34.5;
  cab.forEach((h, i) => { const c = r4.getCell(i + 1); c.value = h; c.font = cor('FFFFFFFF', { bold: true, size: 10 }); c.fill = fill('FF2F5B37'); c.alignment = { vertical: 'middle', wrapText: true }; });
  produtos.forEach((p, i) => {
    const n = 5 + i; const r = ws.getRow(n); r.height = 45;
    const cod = String(p.codigo);
    const vals = [cod, nomeExibicao(p), marcaTxt(p.marca), categoriaExibicao(p), p.unidade || '', null, null,
      { formula: `A${n}&"_capa.jpg"`, result: `${cod}_capa.jpg` }, { formula: `A${n}&"_ambiente.jpg"`, result: `${cod}_ambiente.jpg` }, { formula: `A${n}&"_uso.jpg"`, result: `${cod}_uso.jpg` }];
    vals.forEach((v, j) => {
      const c = r.getCell(j + 1); c.value = v;
      c.alignment = { vertical: 'middle', wrapText: true };
      if (j === 5) { c.font = cor('FF7B4A00', { bold: true, size: 11 }); c.fill = fill('FFFFF0A6'); }
      else { c.font = cor('FF18331C', { size: 11 }); c.fill = fill('FFF5F8F4'); }
      if (j === 0) c.numFmt = '@';
    });
  });
  const fim = 5 + produtos.length + 2;
  ws.mergeCells(`A${fim}:J${fim}`);
  const f = ws.getCell(`A${fim}`);
  f.value = 'Entrega planejada: 3 imagens JPEG de 1200 × 1200 px por produto, nomeadas pelo código (CODIGO_capa.jpg, CODIGO_ambiente.jpg, CODIGO_uso.jpg), todas num único ZIP.';
  f.font = cor('FF244B2B', { size: 10 }); f.fill = fill('FFE9F4E9'); f.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(fim).height = 27.75;
  const buf = await wb.xlsx.writeBuffer();
  const nome = `Fotos_Lote_${String(lote.numero).padStart(2, '0')}${lote.responsavel ? `_${lote.responsavel.normalize('NFD').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}` : ''}_${produtos.length}_produtos.xlsx`;
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
