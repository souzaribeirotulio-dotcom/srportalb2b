/* Importação de fotos em massa (painel do operador).
 * O ZIP traz CODIGO_capa.jpg, CODIGO_ambiente.jpg e CODIGO_uso.jpg. O painel acha cada produto pelo código
 * comercial (POST operadores/produtos/busca com "codigos"), mostra a grade para aprovar e só então sobe as
 * aprovadas para a galeria do G360, uma de cada vez (POST operadores/produtos/{id}/fotos), com a capa definida
 * (PUT .../fotos/capa). Nada sai do navegador antes de "Publicar". */
import JSZip from 'jszip';
import {
  buscarProdutosOperador, listarFotosOperador, incluirFotoOperador, definirCapaOperador, removerFotoOperador,
  interpretarErro, esperaPara, ErroApi,
} from '../api/g360.js';
import { paraJpeg } from './jpeg.js';
import { $, esc, toast } from './comum.js';

const TIPOS = ['capa', 'ambiente', 'uso'];
const ROTULO = { capa: 'Capa', ambiente: 'Ambiente', uso: 'Em uso' };
const DESCRICAO = { capa: 'Capa', ambiente: 'Ambiente', uso: 'Em uso' };
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const PADRAO = /^(.+)_(capa|ambiente|uso)\.(jpe?g|png|webp)$/i;
const PARAR_TUDO = new Set(['SESSAO_INVALIDA', 'SESSAO_EXPIRADA', 'LICENCA_OPERADOR_INDISPONIVEL', 'OPERADOR_SEM_ACESSO', 'ORIGEM_OPERADOR_NAO_PERMITIDA']);

let ctx = null;   // { token, aoSessaoEncerrada, aoConcluir }
let lote = null;  // { itens: Map(chave → item), foraPadrao: [], repetidos: [], naoEncontrados: [] }
let pub = null;   // { rodando, parar, total, feitas }

const sleep = (s) => new Promise((ok) => setTimeout(ok, s * 1000));
const chave = (c) => String(c).trim().toUpperCase();

export function abrirImportacaoFotos(opcoes) {
  ctx = opcoes;
  if (!$('ifImp')) {
    document.body.insertAdjacentHTML('beforeend', `<div id="ifImp" class="ifimp" role="dialog" aria-modal="true" aria-labelledby="impT">
      <div class="impbox"><div class="imphead"><div><b id="impT">📦 Importar imagens</b><small class="hint" style="display:block;margin:2px 0 0">As fotos só vão para o G360 quando você clicar em "Publicar aprovadas".</small></div>
      <button class="fxx" id="impX" title="Fechar" aria-label="Fechar">×</button></div><div id="impCorpo"></div></div>
      <div class="implb" id="impLb" hidden><img alt=""><button class="fxx" title="Fechar" aria-label="Fechar">×</button></div></div>`);
    $('impX').addEventListener('click', fechar);
    $('impLb').addEventListener('click', () => { $('impLb').hidden = true; });
    window.addEventListener('beforeunload', (e) => { if (pub?.rodando) { e.preventDefault(); e.returnValue = ''; } });
  }
  $('ifImp').classList.add('open');
  if (!lote) telaInicial();
}

function fechar() {
  if (pub?.rodando) { toast('Espere o envio terminar ou clique em "Parar".'); return; }
  $('ifImp').classList.remove('open');
  limparLote();
}

function limparLote() {
  if (lote) for (const it of lote.itens.values()) for (const t of TIPOS) if (it.fotos[t]?.url) URL.revokeObjectURL(it.fotos[t].url);
  lote = null; pub = null;
}

function telaInicial(msg = '') {
  $('impCorpo').innerHTML = `<div class="impini">
    <p>Monte um <b>ZIP</b> (ou selecione as fotos soltas) com os arquivos nomeados pelo <b>código do produto</b>:</p>
    <div class="impex"><code>12345_capa.jpg</code><code>12345_ambiente.jpg</code><code>12345_uso.jpg</code></div>
    <p class="hint">Aceita JPEG, PNG e WEBP. O painel converte para JPEG de até 2 MB. Recomendado: lotes de até 100 produtos por vez.</p>
    <label class="impdrop" id="impDrop" tabindex="0"><input type="file" id="impArq" accept=".zip,application/zip,image/jpeg,image/png,image/webp" multiple hidden>
      <span>Arraste o ZIP aqui ou <u>clique para escolher</u></span></label>
    <div id="impMsg">${msg}</div></div>`;
  $('impArq').addEventListener('change', () => ler([...$('impArq').files]));
  const d = $('impDrop');
  d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('impArq').click(); } });
  d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('on'); });
  d.addEventListener('dragleave', () => d.classList.remove('on'));
  d.addEventListener('drop', (e) => { e.preventDefault(); d.classList.remove('on'); ler([...e.dataTransfer.files]); });
}

function progresso(texto) { $('impCorpo').innerHTML = `<div class="impini"><div class="g360-carregando">${esc(texto)}</div></div>`; }

/* ---------- 1. Ler os arquivos ---------- */

async function ler(arquivos) {
  if (!arquivos.length) return;
  limparLote();
  lote = { itens: new Map(), foraPadrao: [], repetidos: [], naoEncontrados: [], invalidos: [] };
  progresso('Abrindo os arquivos…');
  const entradas = [];
  for (const a of arquivos) {
    if (/\.zip$/i.test(a.name) || a.type === 'application/zip' || a.type === 'application/x-zip-compressed') {
      let zip;
      try { zip = await JSZip.loadAsync(a); } catch { lote.invalidos.push(a.name); continue; }
      for (const f of Object.values(zip.files)) {
        if (f.dir || f.name.startsWith('__MACOSX/')) continue;
        const nome = f.name.split('/').pop();
        if (!nome || nome.startsWith('.')) continue;
        entradas.push({ nome, blob: () => f.async('blob') });
      }
    } else entradas.push({ nome: a.name, blob: async () => a });
  }
  for (const e of entradas) {
    const m = e.nome.match(PADRAO);
    if (!m) { lote.foraPadrao.push(e.nome); continue; }
    const [, codigo, tipoBruto, ext] = m; const tipo = tipoBruto.toLowerCase();
    const k = chave(codigo);
    if (!lote.itens.has(k)) lote.itens.set(k, { codigo: codigo.trim(), produto: null, galeria: null, fotos: {}, estado: '', erro: null, feito: false });
    const it = lote.itens.get(k);
    if (it.fotos[tipo]) { lote.repetidos.push(e.nome); URL.revokeObjectURL(it.fotos[tipo].url); }
    const bruto = await e.blob();
    const blob = new Blob([bruto], { type: MIME[ext.toLowerCase()] });
    it.fotos[tipo] = { nome: e.nome, blob, url: URL.createObjectURL(blob), aprovada: true, enviada: false };
  }
  if (!lote.itens.size) { const fp = lote.foraPadrao.length; limparLote(); telaInicial(`<div class="rv-aviso">Nenhum arquivo no padrão CODIGO_capa.jpg / CODIGO_ambiente.jpg / CODIGO_uso.jpg${fp ? ` (${fp} arquivo${fp === 1 ? '' : 's'} com outro nome)` : ''}.</div>`); return; }
  await localizar();
}

/* ---------- 2. Achar os produtos no G360 ---------- */

async function localizar() {
  const codigos = [...lote.itens.values()].map((i) => i.codigo);
  try {
    for (let i = 0; i < codigos.length; i += 50) {
      progresso(`Procurando os produtos no G360… ${Math.min(i + 50, codigos.length)} de ${codigos.length}`);
      const { dados } = await comEspera(() => buscarProdutosOperador(ctx.token(), { codigos: codigos.slice(i, i + 50), limite: 50 }));
      for (const p of dados) { const it = lote.itens.get(chave(p.codigo)); if (it) it.produto = p; }
    }
    const achados = [...lote.itens.values()].filter((i) => i.produto);
    let n = 0; let fatal = null;
    // Um produto que o G360 não deixa conferir fica marcado (fotos desmarcadas) e o resto segue.
    // Só para tudo em sessão encerrada, sem acesso ou licença; depois disso ninguém mais escreve o progresso.
    await emParalelo(achados, 4, async (it) => {
      if (fatal) return;
      try { it.galeria = await comEspera(() => listarFotosOperador(ctx.token(), it.produto.id)); }
      catch (e) {
        if (e instanceof ErroApi && (e.status === 401 || e.status === 403 || e.status === 423 || PARAR_TUDO.has(e.codigo))) { fatal = fatal || e; return; }
        const i = e instanceof ErroApi ? interpretarErro(e) : { mensagem: e.message };
        it.erro = `Não deu para conferir as fotos que já existem: ${i.mensagem}${i.suporte ? ` (Código para o suporte: ${i.suporte})` : ''}`;
        for (const t of TIPOS) if (it.fotos[t]) it.fotos[t].aprovada = false;
        lote.semConferir = (lote.semConferir || 0) + 1;
      }
      if (!fatal) progresso(`Conferindo as fotos que já existem… ${++n} de ${achados.length}`);
    });
    if (fatal) throw fatal;
  } catch (e) {
    if (pararTudo(e)) return;
    const i = interpretarErro(e);
    telaInicial(`<div class="g360-msg"><p>${esc(i.mensagem)}</p>${i.suporte ? `<small>Código para o suporte: ${esc(i.suporte)}</small>` : ''}</div>`);
    return;
  }
  for (const [k, it] of lote.itens) if (!it.produto) { lote.naoEncontrados.push(it.codigo); for (const t of TIPOS) if (it.fotos[t]) URL.revokeObjectURL(it.fotos[t].url); lote.itens.delete(k); }
  desenharGrade();
}

/* ---------- 3. Grade de aprovação ---------- */

function aprovadas() { let n = 0; for (const it of lote.itens.values()) for (const t of TIPOS) if (it.fotos[t]?.aprovada && !it.fotos[t].enviada) n++; return n; }
function comFotos() { return [...lote.itens.values()].filter((i) => i.galeria?.fotos?.length && !i.feito).length; }

function desenharGrade() {
  const itens = [...lote.itens.values()];
  const avisos = [];
  if (lote.naoEncontrados.length) avisos.push(`<b>${lote.naoEncontrados.length} código${lote.naoEncontrados.length === 1 ? '' : 's'} não encontrado${lote.naoEncontrados.length === 1 ? '' : 's'} no G360</b> (ficam de fora): ${esc(lote.naoEncontrados.slice(0, 30).join(', '))}${lote.naoEncontrados.length > 30 ? '…' : ''}`);
  if (lote.foraPadrao.length) avisos.push(`<b>${lote.foraPadrao.length} arquivo${lote.foraPadrao.length === 1 ? '' : 's'} fora do padrão de nome</b> (ignorado${lote.foraPadrao.length === 1 ? '' : 's'}): ${esc(lote.foraPadrao.slice(0, 15).join(', '))}${lote.foraPadrao.length > 15 ? '…' : ''}`);
  if (lote.repetidos.length) avisos.push(`<b>${lote.repetidos.length} arquivo${lote.repetidos.length === 1 ? '' : 's'} repetido${lote.repetidos.length === 1 ? '' : 's'}</b>: vale o último de cada.`);
  if (lote.semConferir) avisos.push(`<b>${lote.semConferir} produto${lote.semConferir === 1 ? '' : 's'} sem resposta do G360</b> ao conferir as fotos atuais: ficaram desmarcados (veja a mensagem em cada um).`);
  if (lote.invalidos.length) avisos.push(`<b>Não deu para abrir:</b> ${esc(lote.invalidos.join(', '))}`);
  const faltando = itens.filter((i) => TIPOS.some((t) => !i.fotos[t])).length;
  if (faltando) avisos.push(`<b>${faltando} produto${faltando === 1 ? '' : 's'} sem alguma das 3 fotos</b> (marcados abaixo). Sobem só as que vieram.`);
  const existentes = comFotos();

  $('impCorpo').innerHTML = `<div class="impbar">
      <span id="impConta" class="hint" style="margin:0"></span>
      <button class="tool" id="impTodas">✓ Aprovar todas</button><button class="tool" id="impNenhuma">Desmarcar todas</button>
      ${existentes ? `<label class="hint" style="margin:0">${existentes} já ${existentes === 1 ? 'tem' : 'têm'} fotos:
        <select id="impPol"><option value="pular">Pular esses produtos</option><option value="somar">Adicionar às fotos atuais</option><option value="trocar">Substituir as fotos atuais</option></select></label>` : ''}
      <span style="flex:1"></span><button class="btn sec" id="impOutro" style="height:38px">Outro arquivo</button>
      <button class="btn pri" id="impPub" style="height:38px">Publicar aprovadas</button></div>
    ${avisos.length ? `<div class="impav">${avisos.map((a) => `<div>${a}</div>`).join('')}</div>` : ''}
    <div id="impProg"></div>
    <div class="impgrid" id="impGrid">${itens.map(linha).join('')}</div>`;
  contar();
  $('impTodas').onclick = () => marcarTodas(true);
  $('impNenhuma').onclick = () => marcarTodas(false);
  $('impOutro').onclick = () => { if (!pub?.rodando) { limparLote(); telaInicial(); } };
  $('impPub').onclick = publicar;
  $('impPol')?.addEventListener('change', () => { $('impPub').dataset.confirmar = ''; contar(); });
  $('impGrid').addEventListener('change', (e) => {
    const c = e.target.closest('input[data-t]'); if (!c) return;
    const it = lote.itens.get(c.closest('[data-k]').dataset.k); it.fotos[c.dataset.t].aprovada = c.checked;
    c.closest('.impslot').classList.toggle('off', !c.checked); contar();
  });
  $('impGrid').addEventListener('click', (e) => {
    const img = e.target.closest('.impslot img'); if (!img) return;
    $('impLb').querySelector('img').src = img.src; $('impLb').hidden = false;
  });
}

function linha(it) {
  const k = chave(it.codigo); const g = it.galeria?.fotos?.length || 0;
  return `<div class="improw" data-k="${esc(k)}"><div class="impnm"><b>${esc(it.produto.nome)}</b><small>Cód. ${esc(it.produto.codigo)}${g ? ` · já tem ${g} foto${g === 1 ? '' : 's'} no G360` : ''}</small><span class="impst" data-st>${estadoHtml(it)}</span></div>
    ${TIPOS.map((t) => { const f = it.fotos[t]; return f
      ? `<label class="impslot ${f.aprovada ? '' : 'off'} ${f.enviada ? 'ok' : ''}"><img src="${f.url}" alt="${ROTULO[t]} de ${esc(it.produto.codigo)}" loading="lazy"><span><input type="checkbox" data-t="${t}" ${f.aprovada ? 'checked' : ''} ${f.enviada ? 'disabled' : ''}> ${ROTULO[t]}${f.enviada ? ' ✓' : ''}</span></label>`
      : `<div class="impslot falta"><div class="impvazio">sem ${ROTULO[t].toLowerCase()}</div><span>${ROTULO[t]}</span></div>`; }).join('')}</div>`;
}

function estadoHtml(it) {
  if (it.erro) return `<span class="ruim">${esc(it.erro)}</span>`;
  return it.estado ? esc(it.estado) : '';
}

function atualizarLinha(it) {
  const r = $('impGrid')?.querySelector(`[data-k="${CSS.escape(chave(it.codigo))}"]`);
  if (r) r.outerHTML = linha(it);
}

function marcarTodas(v) {
  for (const it of lote.itens.values()) for (const t of TIPOS) if (it.fotos[t] && !it.fotos[t].enviada) it.fotos[t].aprovada = v;
  $('impGrid').innerHTML = [...lote.itens.values()].map(linha).join(''); contar();
}

function contar() {
  const n = aprovadas(); const prods = [...lote.itens.values()].filter((i) => TIPOS.some((t) => i.fotos[t]?.aprovada && !i.fotos[t].enviada)).length;
  $('impConta').textContent = `${lote.itens.size} produto${lote.itens.size === 1 ? '' : 's'} · ${n} foto${n === 1 ? '' : 's'} aprovada${n === 1 ? '' : 's'} para enviar (${prods} produto${prods === 1 ? '' : 's'})`;
  const b = $('impPub'); if (!b || pub?.rodando) return;
  b.disabled = n === 0;
  b.textContent = b.dataset.confirmar === '1' ? `Confirmar: apagar as fotos atuais de ${comFotos()} produto${comFotos() === 1 ? '' : 's'}` : 'Publicar aprovadas';
}

/* ---------- 4. Publicar ---------- */

async function publicar() {
  const pol = $('impPol')?.value || 'pular';
  const b = $('impPub');
  if (pol === 'trocar' && b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; contar(); return; }
  b.dataset.confirmar = '';
  const fila = [...lote.itens.values()].filter((it) => TIPOS.some((t) => it.fotos[t]?.aprovada && !it.fotos[t].enviada));
  const total = fila.reduce((s, it) => s + TIPOS.filter((t) => it.fotos[t]?.aprovada && !it.fotos[t].enviada).length, 0);
  pub = { rodando: true, parar: false, total, feitas: 0, ok: 0, falhas: 0, puladas: 0, ids: new Set() };
  ['impTodas', 'impNenhuma', 'impOutro', 'impPol'].forEach((id) => { if ($(id)) $(id).disabled = true; });
  b.disabled = true; b.textContent = 'Enviando…';
  $('impGrid').querySelectorAll('input[data-t]').forEach((c) => { c.disabled = true; });
  $('impProg').innerHTML = `<div class="impprog"><div class="impbarra"><i id="impBarra"></i></div><span id="impPTxt" class="hint" style="margin:0"></span><button class="tool" id="impParar">Parar</button></div>`;
  $('impParar').onclick = () => { pub.parar = true; $('impParar').disabled = true; $('impParar').textContent = 'Parando…'; };
  andamento();
  let interrompido = null;
  await emParalelo(fila, 2, async (it) => {
    if (pub.parar || interrompido) return;
    try { await publicarProduto(it, pol); }
    catch (e) {
      if (e instanceof ErroApi && (e.status === 401 || PARAR_TUDO.has(e.codigo) || e.status === 423)) { interrompido = e; pub.parar = true; }
      if (e instanceof ErroApi) { const i = interpretarErro(e); it.erro = `${i.mensagem}${i.suporte ? ` (Código para o suporte: ${i.suporte})` : ''}`; }
      else it.erro = e.message;
      it.estado = '';
      pub.falhas++;
    }
    atualizarLinha(it); andamento();
  });
  pub.rodando = false;
  if (pub.ids.size) ctx.aoConcluir?.([...pub.ids]);
  if (interrompido && (interrompido.status === 401 || /^SESSAO_/.test(interrompido.codigo || ''))) { ctx.aoSessaoEncerrada?.(interrompido); return; }
  resumo(interrompido);
}

async function publicarProduto(it, pol) {
  const id = it.produto.id; it.erro = null;
  const tem = it.galeria?.fotos?.length || 0;
  if (tem && pol === 'pular' && !it.feito) {
    const n = TIPOS.filter((t) => it.fotos[t]?.aprovada && !it.fotos[t].enviada).length;
    it.estado = 'Pulado: já tinha fotos'; pub.puladas += n; pub.feitas += n; return;
  }
  if (tem && pol === 'trocar' && !it.feito) {
    it.estado = 'Apagando as fotos atuais…'; atualizarLinha(it);
    for (const f of [...it.galeria.fotos]) it.galeria = await comEspera(() => removerFotoOperador(ctx.token(), id, f.item));
  }
  it.feito = true;
  let capaItem = null;
  for (const t of TIPOS) {
    const f = it.fotos[t];
    if (!f?.aprovada || f.enviada) continue;
    if (pub.parar) return;
    if ((it.galeria?.fotos?.length || 0) >= (it.galeria?.maximo || 12)) { it.estado = 'Galeria cheia (12 fotos)'; pub.feitas++; pub.falhas++; continue; }
    it.estado = `Enviando ${ROTULO[t].toLowerCase()}…`; atualizarLinha(it);
    let dados;
    try { dados = await paraJpeg(f.blob); } catch { throw new Error(`Não deu para preparar ${f.nome}. Confira se é uma imagem válida.`); }
    const antes = it.galeria?.fotos?.map((x) => x.item) || [];
    const g = await incluirSemDuplicar(id, dados, DESCRICAO[t], antes);
    it.galeria = g; f.enviada = true; pub.feitas++; pub.ok++; pub.ids.add(id);
    if (t === 'capa') capaItem = g.item;
    andamento();
  }
  if (capaItem && it.galeria.capa !== capaItem) it.galeria = await comEspera(() => definirCapaOperador(ctx.token(), id, capaItem));
  it.estado = 'Publicado ✓';
}

/** Inclusão com resposta incerta (rede caiu): confere a galeria antes de repetir, para não duplicar a foto. */
async function incluirSemDuplicar(id, dados, descricao, antes) {
  for (let tentativa = 0; ; tentativa++) {
    try { return await comEspera(() => incluirFotoOperador(ctx.token(), id, dados, descricao)); }
    catch (e) {
      if (!(e instanceof ErroApi) || (e.tipo !== 'rede' && e.tipo !== 'tempo') || tentativa >= 2) throw e;
      await sleep(3);
      const g = await comEspera(() => listarFotosOperador(ctx.token(), id));
      const nova = g.fotos.find((x) => !antes.includes(x.item));
      if (nova) return { ...g, item: nova.item };
    }
  }
}

/** Repete com espera só o que a API marca como "tentar de novo" (409, 429, 503), no máximo 4 vezes. */
async function comEspera(fn) {
  for (let t = 0; ; t++) {
    try { return await fn(); }
    catch (e) {
      if (!(e instanceof ErroApi) || e.responsavel !== 'tentar_de_novo' || e.tipo === 'rede' || e.tipo === 'tempo' || t >= 3) throw e;
      const s = esperaPara(e, t);
      if ($('impPTxt')) $('impPTxt').textContent = `A API pediu uma pausa. Continuando em ${s} s…`;
      await sleep(s);
    }
  }
}

async function emParalelo(lista, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, async () => { while (i < lista.length) await fn(lista[i++]); }));
}

function pararTudo(e) {
  if (e instanceof ErroApi && (e.status === 401 || /^SESSAO_/.test(e.codigo || ''))) { limparLote(); $('ifImp').classList.remove('open'); ctx.aoSessaoEncerrada?.(e); return true; }
  return false;
}

function andamento() {
  if (!pub || !$('impBarra')) return;
  $('impBarra').style.width = `${pub.total ? Math.round((pub.feitas / pub.total) * 100) : 100}%`;
  $('impPTxt').textContent = `${pub.feitas} de ${pub.total} fotos · ${pub.ok} publicada${pub.ok === 1 ? '' : 's'}${pub.puladas ? ` · ${pub.puladas} pulada${pub.puladas === 1 ? '' : 's'}` : ''}${pub.falhas ? ` · ${pub.falhas} com erro` : ''}`;
}

function resumo(interrompido) {
  const comErro = [...lote.itens.values()].filter((i) => i.erro || TIPOS.some((t) => i.fotos[t]?.aprovada && !i.fotos[t].enviada && i.feito));
  const parado = pub.parar && !interrompido;
  $('impProg').innerHTML = `<div class="impfim ${pub.falhas || interrompido ? 'aviso' : ''}">
    <b>${parado ? 'Envio parado.' : interrompido ? 'Envio interrompido.' : 'Envio concluído.'}</b>
    ${pub.ok} foto${pub.ok === 1 ? '' : 's'} publicada${pub.ok === 1 ? '' : 's'} no G360${pub.puladas ? `, ${pub.puladas} pulada${pub.puladas === 1 ? '' : 's'} (produto já tinha fotos)` : ''}${pub.falhas ? `, ${pub.falhas} com erro` : ''}.
    ${interrompido ? `<div>${esc(interpretarErro(interrompido).mensagem)}</div>` : ''}
    ${comErro.length || parado ? '<button class="btn pri" id="impDeNovo" style="height:36px;margin-left:8px">Tentar de novo o que faltou</button>' : ''}</div>`;
  $('impDeNovo')?.addEventListener('click', () => { for (const it of lote.itens.values()) it.erro = null; desenharGrade(); });
  ['impTodas', 'impNenhuma', 'impOutro', 'impPol'].forEach((id) => { if ($(id)) $(id).disabled = false; });
  $('impPub').dataset.confirmar = ''; contar();
  toast(`${pub.ok} foto${pub.ok === 1 ? '' : 's'} publicada${pub.ok === 1 ? '' : 's'} ✓`);
}
