/* Caça-capa (painel → Produtos): capa de muitos produtos por copiar e colar.
 * O funcionário pega um lote (100 produtos sem foto, sem repetir entre pessoas), vê um produto por vez,
 * acha a foto oficial, "Copiar imagem" → Ctrl+V. O painel recorta as sobras brancas, centraliza num
 * quadrado branco de 1200 × 1200 com margem e cantos de cima livres, mostra a prévia e, no Enter,
 * sobe como capa no G360 (uma de cada vez, em segundo plano) e já mostra o próximo.
 * "Não achei" grava o produto no lote como "fotografar no estoque". */
import { listarFotosOperador, incluirFotoOperador, definirCapaOperador, interpretarErro, ErroApi } from '../api/g360.js';
import { carregarExibicao, nomeExibicao, categoriaExibicao } from '../catalogo/exibicao.js';
import { montarLote, produtosDosCodigos, comEspera } from './lotesfotos.js';
import { $, esc, toast } from './comum.js';

const LADO = 1200;
// Área do produto: margem de 150 px dos lados e 170 px em cima (cantos de cima livres para selo e ícone).
const AREA = { x: 150, y: 170, w: 900, h: 900 };

let ctx = null;
let st = null; // { lote, itens: [{ p, estado: 'fazer'|'enviando'|'feito'|'erro'|'pulado'|'tinha', erro }], i, previa }
const fila = []; let enviando = false;

export async function abrirCacaCapa(opcoes) {
  ctx = opcoes;
  if (!$('ccFull')) {
    document.body.insertAdjacentHTML('beforeend', `<div id="ccFull" class="ifimp" role="dialog" aria-modal="true" aria-labelledby="ccT">
      <div class="impbox"><div class="imphead"><div><b id="ccT">🎯 Caça-capa</b><small class="hint" style="display:block;margin:2px 0 0">Ache a foto oficial, clique com o botão direito em "Copiar imagem" e cole aqui (Ctrl+V). Enter envia e passa para o próximo.</small></div>
      <button class="fxx" id="ccX" title="Fechar" aria-label="Fechar">×</button></div><div id="ccCorpo"></div></div></div>`);
    $('ccX').addEventListener('click', fechar);
    document.addEventListener('paste', aoColar);
    document.addEventListener('keydown', aoTeclar);
    window.addEventListener('beforeunload', (e) => { if (fila.length || enviando) { e.preventDefault(); e.returnValue = ''; } });
  }
  $('ccFull').classList.add('open');
  if (!st) await escolherLote();
}

function aberto() { return $('ccFull')?.classList.contains('open'); }
function fechar() {
  if (fila.length || enviando) { toast('Espere terminar de enviar as fotos.'); return; }
  $('ccFull').classList.remove('open');
  if (st?.previa?.url) URL.revokeObjectURL(st.previa.url);
  st = null;
  ctx.aoConcluir?.();
}

/* ---------- 1. escolher ou pegar um lote ---------- */
async function escolherLote(aviso = '') {
  const c = $('ccCorpo');
  c.innerHTML = '<div class="impini"><div class="g360-carregando">Carregando os lotes…</div></div>';
  let lotes = [];
  try { lotes = (await ctx.painel('lotes_listar')).dados || []; } catch (e) { c.innerHTML = `<div class="impini"><div class="g360-erro">${esc(e.message)}</div></div>`; return; }
  c.innerHTML = `<div class="impini">${aviso}
    <div class="csec" style="margin-top:0">Pegar produtos novos</div>
    <div class="fgrid"><div><label for="ccNome">Seu nome</label><input class="inp" id="ccNome" maxlength="80" placeholder="Ex.: Maria"></div>
      <div><label for="ccQtd">Quantos produtos</label><input class="inp" id="ccQtd" type="number" min="1" max="500" value="100"></div>
      <div class="full"><label for="ccModo">Quais produtos</label><select class="inp" id="ccModo"><option value="visivel">Aparecendo no portal e sem foto (mais vendidos primeiro)</option><option value="todos">Todos do G360 sem foto</option></select></div></div>
    <div id="ccMsg" class="hint" aria-live="polite"></div>
    <div class="act" style="justify-content:flex-start"><button class="btn pri" id="ccPegar" type="button">Pegar produtos e começar</button></div>
    ${lotes.length ? `<div class="csec">Ou continuar um lote</div>${lotes.map((l) => `<div class="crow" style="grid-template-columns:1fr auto"><div class="nm"><b>Lote ${Number(l.numero)}</b>${l.responsavel ? ` · ${esc(l.responsavel)}` : ''}<small>${l.codigos.length} produtos${l.pulados?.length ? ` · ${l.pulados.length} sem foto encontrada` : ''}</small></div><button class="tool" data-lote="${esc(l.id)}">Continuar</button></div>`).join('')}` : ''}</div>`;
  $('ccPegar').onclick = async () => {
    const b = $('ccPegar'); b.disabled = true; b.textContent = 'Separando os produtos…';
    try {
      const r = await montarLote({ token: ctx.token, painel: ctx.painel, qtd: Math.max(1, Math.min(500, Math.round(Number($('ccQtd').value) || 100))), responsavel: $('ccNome').value.trim().slice(0, 80), modo: $('ccModo').value, aoProgresso: (t) => { $('ccMsg').textContent = t; } });
      if (r.semLista) { $('ccMsg').innerHTML = '<span class="ruim">Ainda não temos a lista do que aparece no portal. Entre uma vez como cliente ou escolha "Todos do G360 sem foto".</span>'; b.disabled = false; b.textContent = 'Pegar produtos e começar'; return; }
      if (r.vazio) { $('ccMsg').textContent = 'Nenhum produto sem foto ficou de fora dos lotes. 🎉'; b.disabled = false; b.textContent = 'Pegar produtos e começar'; return; }
      iniciar(r.lote, r.produtos);
    } catch (e) { b.disabled = false; b.textContent = 'Pegar produtos e começar'; falha(e, $('ccMsg')); }
  };
  c.querySelectorAll('[data-lote]').forEach((b) => b.onclick = async () => {
    const l = lotes.find((x) => x.id === b.dataset.lote);
    b.disabled = true; b.textContent = 'Abrindo…';
    try { iniciar(l, await produtosDosCodigos(l.codigos, ctx.token)); } catch (e) { b.disabled = false; b.textContent = 'Continuar'; falha(e); }
  });
}

function falha(e, alvo) {
  if (e instanceof ErroApi && e.status === 401) { $('ccFull').classList.remove('open'); st = null; ctx.aoSessaoEncerrada?.(e); return; }
  const i = e instanceof ErroApi ? interpretarErro(e) : { mensagem: e.message };
  const html = `${esc(i.mensagem)}${i.suporte ? ` <small>(Código para o suporte: ${esc(i.suporte)})</small>` : ''}`;
  if (alvo) alvo.innerHTML = `<span class="ruim">${html}</span>`; else toast(i.mensagem);
}

/* ---------- 2. trabalhar no lote ---------- */
async function iniciar(lote, produtos) {
  await carregarExibicao();
  const pulados = new Set((lote.pulados || []).map(String));
  st = { lote, itens: produtos.map((p) => ({ p, estado: pulados.has(String(p.codigo)) ? 'pulado' : 'conferir' })), i: 0, previa: null };
  st.i = Math.max(0, st.itens.findIndex((x) => x.estado === 'conferir'));
  desenhar();
  conferirAtual();
}

/** Antes de mostrar, confere se o produto já ganhou foto (por outra pessoa ou pela importação). */
async function conferirAtual() {
  const it = st?.itens[st.i]; if (!it || it.estado !== 'conferir') return;
  try {
    const g = await comEspera(() => listarFotosOperador(ctx.token(), it.p.id));
    it.estado = g.fotos?.length ? 'tinha' : 'fazer';
  } catch (e) { if (e instanceof ErroApi && e.status === 401) return falha(e); it.estado = 'fazer'; }
  if (it.estado === 'tinha' && st.itens[st.i] === it) { proximo(); return; }
  desenhar();
}

function contagem() {
  const n = (e) => st.itens.filter((x) => x.estado === e).length;
  return { feitos: n('feito') + n('enviando'), pulados: n('pulado'), tinha: n('tinha'), erros: n('erro'), total: st.itens.length };
}

function desenhar() {
  const c = $('ccCorpo'); if (!c || !st) return;
  const it = st.itens[st.i];
  const k = contagem();
  const barra = Math.round(((k.feitos + k.pulados + k.tinha) / k.total) * 100);
  const topo = `<div class="impprog"><div class="impbarra"><i style="width:${barra}%"></i></div>
    <span class="hint" style="margin:0">Lote ${Number(st.lote.numero)}${st.lote.responsavel ? ` · ${esc(st.lote.responsavel)}` : ''} · ${k.feitos} com capa · ${k.pulados} não achei${k.tinha ? ` · ${k.tinha} já tinham` : ''}${k.erros ? ` · <b class="ruim">${k.erros} com erro</b>` : ''} · ${st.i + 1} de ${k.total}</span>
    <span class="hint" id="ccFila" style="margin:0">${fila.length || enviando ? `Enviando ${fila.length + (enviando ? 1 : 0)}…` : ''}</span>
    <button class="tool" id="ccLotes">Trocar de lote</button></div>`;
  if (!it) { c.innerHTML = topo + fim(); ligarTopo(); return; }
  const p = it.p; const nome = nomeExibicao(p); const marca = (p.marca && typeof p.marca === 'object' ? p.marca.nome : p.marca) || '';
  const q = encodeURIComponent(`${p.nome} ${marca}`.trim());
  const pv = st.previa;
  c.innerHTML = topo + `<div class="ccgrid">
    <div class="ccinfo">
      <div class="hint" style="margin:0">Cód. <b>${esc(p.codigo)}</b> · ${esc(p.unidade || '')} · ${esc(categoriaExibicao(p))}</div>
      <h3 style="margin:6px 0 2px">${esc(nome)}</h3>
      <div class="hint" style="margin:0">G360: ${esc(p.nome)}${marca ? ` · Marca: <b>${esc(marca)}</b>` : ''}</div>
      <div class="ccbusca">
        <a class="btn sec" target="_blank" rel="noopener noreferrer" href="https://www.google.com/search?tbm=isch&tbs=ic:specific,isc:white&q=${q}">🔎 Google Imagens (fundo branco)</a>
        ${marca ? `<a class="btn sec" target="_blank" rel="noopener noreferrer" href="https://www.google.com/search?q=${encodeURIComponent(`${marca} ${p.nome} site oficial`)}">🏭 Site da marca</a>` : ''}
      </div>
      <ol class="hint ccpassos"><li>Abra a foto grande do produto (de preferência no site da marca).</li><li>Botão direito na foto → <b>Copiar imagem</b>.</li><li>Volte aqui e aperte <b>Ctrl+V</b>.</li><li>Confira a prévia e aperte <b>Enter</b>.</li></ol>
      ${it.estado === 'erro' ? `<div class="g360-erro">${esc(it.erro || 'Não deu para enviar.')}</div>` : ''}
      ${it.estado === 'feito' || it.estado === 'enviando' ? '<div class="okmsg">✓ Capa enviada. Pode colar outra para trocar.</div>' : ''}
      ${it.estado === 'pulado' ? '<div class="rv-aviso">Marcado como "não achei" (fotografar no estoque).</div>' : ''}
      <div class="act" style="justify-content:flex-start;flex-wrap:wrap">
        <button class="btn sec" id="ccVoltar" type="button" ${st.i === 0 ? 'disabled' : ''}>‹ Anterior</button>
        <button class="btn sec" id="ccPular" type="button">${it.estado === 'pulado' ? 'Tirar do "não achei"' : 'Não achei'}</button>
        <button class="btn sec" id="ccProx" type="button">Pular ›</button>
        <button class="btn pri" id="ccEnviar" type="button" ${pv?.dados ? '' : 'disabled'}>Enviar capa (Enter)</button>
      </div></div>
    <div class="cccola ${pv ? 'tem' : ''}" id="ccCola" tabindex="0" aria-label="Área para colar a foto">
      ${it.estado === 'conferir' ? '<div class="g360-carregando">Conferindo no G360…</div>'
      : pv ? `<div class="ccprev"><img src="${pv.url}" alt="Prévia da capa"><span class="ccselo">Selo</span><span class="ccolho">👁</span></div>
          <div class="hint" style="margin:6px 0 0">${pv.avisos.length ? pv.avisos.map((a) => `<span class="ruim">⚠ ${esc(a)}</span>`).join('<br>') : '✓ Pronta: fundo branco, produto centralizado, cantos livres.'}</div>`
      : '<div class="ccvazio"><b>Cole a foto aqui</b><br>Ctrl+V · ou arraste o arquivo · ou <label class="ccarq"><u>escolha no computador</u><input type="file" id="ccArq" accept="image/*" hidden></label></div>'}
    </div></div>`;
  ligarTopo();
  $('ccVoltar').onclick = () => ir(st.i - 1);
  $('ccProx').onclick = () => proximo();
  $('ccPular').onclick = pular;
  $('ccEnviar').onclick = enviar;
  $('ccArq')?.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) preparar(f); });
  const z = $('ccCola');
  z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('on'); });
  z.addEventListener('dragleave', () => z.classList.remove('on'));
  z.addEventListener('drop', (e) => { e.preventDefault(); z.classList.remove('on'); const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/')); if (f) preparar(f); });
}

function ligarTopo() { if ($('ccLotes')) $('ccLotes').onclick = () => { if (st?.previa?.url) URL.revokeObjectURL(st.previa.url); st = null; escolherLote(); }; }

function fim() {
  const k = contagem();
  const pul = st.itens.filter((x) => x.estado === 'pulado');
  const err = st.itens.filter((x) => x.estado === 'erro');
  return `<div class="impini"><h3>Lote ${Number(st.lote.numero)} terminado 🎉</h3>
    <p>${k.feitos} capas enviadas${k.tinha ? `, ${k.tinha} já tinham foto` : ''}, ${k.pulados} sem foto encontrada.</p>
    ${err.length ? `<div class="g360-erro">Com erro (volte neles com "‹ Anterior"): ${esc(err.map((x) => x.p.codigo).join(', '))}</div>` : ''}
    ${pul.length ? `<div class="rv-aviso"><b>Fotografar no estoque:</b><br>${pul.map((x) => `${esc(x.p.codigo)} · ${esc(nomeExibicao(x.p))}`).join('<br>')}</div>` : ''}
    <div class="act" style="justify-content:flex-start"><button class="btn sec" id="ccRevisar" type="button">‹ Revisar o lote</button><button class="btn pri" id="ccNovo" type="button">Pegar mais produtos</button></div></div>`;
}

function ir(i) {
  if (!st) return;
  if (st.previa?.url) URL.revokeObjectURL(st.previa.url);
  st.previa = null;
  st.i = Math.max(0, Math.min(st.itens.length, i));
  desenhar();
  if ($('ccRevisar')) { $('ccRevisar').onclick = () => ir(st.itens.length - 1); $('ccNovo').onclick = () => { st = null; escolherLote(); }; }
  conferirAtual();
}
function proximo() {
  // vai para o próximo ainda por fazer; se não houver, para o fim
  let j = st.i + 1;
  while (j < st.itens.length && !['conferir', 'fazer', 'erro'].includes(st.itens[j].estado)) j++;
  ir(j);
}

async function pular() {
  const it = st.itens[st.i]; if (!it) return;
  const voltar = it.estado === 'pulado';
  try {
    await ctx.painel('lote_pular', { id: st.lote.id, codigo: String(it.p.codigo), pular: !voltar });
    it.estado = voltar ? 'fazer' : 'pulado';
    if (voltar) desenhar(); else proximo();
  } catch (e) { falha(e); }
}

/* ---------- colar e ajustar a foto ---------- */
function aoColar(e) {
  if (!aberto() || !st?.itens[st.i]) return;
  if (e.target.closest?.('input, textarea')) return;
  const f = [...(e.clipboardData?.items || [])].find((x) => x.kind === 'file' && x.type.startsWith('image/'))?.getAsFile();
  if (f) { e.preventDefault(); preparar(f); return; }
  const txt = e.clipboardData?.getData('text') || '';
  if (/^https?:\/\//i.test(txt.trim())) toast('Isso é o endereço da imagem. Clique com o botão direito na foto e escolha "Copiar imagem".');
}

function aoTeclar(e) {
  if (!aberto() || !st) return;
  if (e.target.closest?.('input, textarea, select')) return;
  if (e.key === 'Enter' && st.previa?.dados) { e.preventDefault(); enviar(); }
  if (e.key === 'Escape' && st.previa) { e.preventDefault(); ir(st.i); }
}

async function preparar(arquivo) {
  const it = st.itens[st.i];
  if (!it || it.estado === 'conferir') return;
  try {
    const r = await ajustarCapa(arquivo);
    if (st.previa?.url) URL.revokeObjectURL(st.previa.url);
    st.previa = r;
    desenhar();
    $('ccEnviar')?.focus();
  } catch { toast('Não deu para ler essa imagem. Tente copiar de novo ou use outra foto.'); }
}

function carregar(blob) {
  return new Promise((ok, falha) => { const img = new Image(); const u = URL.createObjectURL(blob); img.onload = () => { URL.revokeObjectURL(u); ok(img); }; img.onerror = () => { URL.revokeObjectURL(u); falha(new Error('formato')); }; img.src = u; });
}

/** Recorta as sobras claras, centraliza em 1200 × 1200 branco com margem e devolve { dados (data URL JPEG), url (prévia), avisos }. */
export async function ajustarCapa(blob) {
  const img = await carregar(blob);
  const W = img.naturalWidth; const H = img.naturalHeight;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); c.drawImage(img, 0, 0);
  const px = c.getImageData(0, 0, W, H).data;
  const claro = (i) => px[i] > 238 && px[i + 1] > 238 && px[i + 2] > 238;
  let x0 = W; let y0 = H; let x1 = -1; let y1 = -1; let bordaEscura = 0; let borda = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const ok = claro(i);
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) { borda++; if (!ok) bordaEscura++; }
      if (!ok) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  const avisos = [];
  const fundoBranco = borda && bordaEscura / borda < 0.15;
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; avisos.push('A imagem parece toda branca.'); }
  if (!fundoBranco) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; avisos.push('O fundo não é branco: a foto foi colocada inteira. Se possível, procure uma com fundo branco.'); }
  const cw = x1 - x0 + 1; const ch = y1 - y0 + 1;
  if (Math.max(cw, ch) < 400) avisos.push(`Foto pequena (${cw} × ${ch} px): pode sair borrada. Procure uma maior.`);
  const esc2 = Math.min(AREA.w / cw, AREA.h / ch);
  const dw = Math.round(cw * esc2); const dh = Math.round(ch * esc2);
  const out = document.createElement('canvas'); out.width = LADO; out.height = LADO;
  const o = out.getContext('2d');
  o.fillStyle = '#fff'; o.fillRect(0, 0, LADO, LADO);
  o.imageSmoothingQuality = 'high';
  o.drawImage(cv, x0, y0, cw, ch, AREA.x + Math.round((AREA.w - dw) / 2), AREA.y + Math.round((AREA.h - dh) / 2), dw, dh);
  let dados = null;
  for (const q of [0.9, 0.82, 0.72, 0.6]) { const d = out.toDataURL('image/jpeg', q); if ((d.length - 23) * 0.75 <= 2 * 1024 * 1024) { dados = d; break; } }
  if (!dados) throw new Error('grande');
  const bin = await (await fetch(dados)).blob();
  return { dados, url: URL.createObjectURL(bin), avisos };
}

/* ---------- enviar em segundo plano ---------- */
function enviar() {
  const it = st?.itens[st.i]; const pv = st?.previa;
  if (!it || !pv?.dados) return;
  it.estado = 'enviando'; it.erro = null;
  fila.push({ it, dados: pv.dados, lote: st.lote.id });
  rodarFila();
  proximo();
}

async function rodarFila() {
  if (enviando) return;
  enviando = true;
  while (fila.length) {
    const { it, dados } = fila.shift();
    atualizarFila();
    try {
      const antes = await comEspera(() => listarFotosOperador(ctx.token(), it.p.id));
      if ((antes.fotos?.length || 0) >= (antes.maximo || 12)) throw new Error('A galeria deste produto já tem 12 fotos.');
      const g = await comEspera(() => incluirFotoOperador(ctx.token(), it.p.id, dados, 'Capa'));
      if (g.item && g.capa !== g.item) await comEspera(() => definirCapaOperador(ctx.token(), it.p.id, g.item));
      it.estado = 'feito';
      ctx.aoFoto?.(it.p.id);
    } catch (e) {
      if (e instanceof ErroApi && e.status === 401) { fila.length = 0; enviando = false; falha(e); return; }
      it.estado = 'erro';
      it.erro = e instanceof ErroApi ? `${interpretarErro(e).mensagem}${e.requestId ? ` (Código para o suporte: ${[e.codigo, e.requestId].filter(Boolean).join(' · ')})` : ''}` : e.message;
      toast(`Capa de ${it.p.codigo} não foi enviada: ${it.erro}`);
    }
    atualizarFila();
  }
  enviando = false;
  atualizarFila();
}

function atualizarFila() {
  if (!st) return;
  const k = contagem();
  const el = $('ccFila'); if (el) el.textContent = fila.length || enviando ? `Enviando ${fila.length + (enviando ? 1 : 0)}…` : '';
  const s = $('ccCorpo')?.querySelector('.impprog .hint');
  if (s) s.innerHTML = `Lote ${Number(st.lote.numero)}${st.lote.responsavel ? ` · ${esc(st.lote.responsavel)}` : ''} · ${k.feitos} com capa · ${k.pulados} não achei${k.tinha ? ` · ${k.tinha} já tinham` : ''}${k.erros ? ` · <b class="ruim">${k.erros} com erro</b>` : ''} · ${Math.min(st.i + 1, k.total)} de ${k.total}`;
}
