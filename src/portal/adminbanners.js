/* Painel: aba Banners (topo do catálogo).
   A imagem é comprimida no navegador (JPEG, até 1920 px de largura e ~400 KB) e enviada por URL
   assinada da função painel-g360, como os clips. Período em datas (horário de Brasília). */
import { supabaseComprador } from '../api/supabase.js';
import { categorias } from '../catalogo/exibicao.js';
import { esquecerBanners, urlBanner } from './banners.js';
import { esc, toast } from './comum.js';
import { dataBr } from '../ui/formato.js';

const DESTINOS = { nenhum: 'Não leva a lugar nenhum', categoria: 'Uma categoria', busca: 'Uma busca', produto: 'Um produto (código)', lista: 'Minha Lista', cadastro: 'Quero ser cliente' };
const ALVO_BYTES = 400 * 1024;

function carregar(arq) {
  return new Promise((ok, falha) => {
    const img = new Image(); const u = URL.createObjectURL(arq);
    img.onload = () => { URL.revokeObjectURL(u); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(u); falha(new Error('Não consegui abrir essa imagem. Use JPG, PNG ou WebP.')); };
    img.src = u;
  });
}

/** Redimensiona e comprime para JPEG. Devolve { blob, w, h }. */
async function comprimir(arq, larguraMax) {
  const img = await carregar(arq);
  let w = img.naturalWidth; let h = img.naturalHeight;
  if (w > larguraMax) { h = Math.round(h * (larguraMax / w)); w = larguraMax; }
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c2 = cv.getContext('2d'); // Fundo do portal (verde-escuro), não branco: PNG com partes transparentes ficava esbranquiçado no banner.
  c2.fillStyle = '#0d220c'; c2.fillRect(0, 0, w, h); c2.drawImage(img, 0, 0, w, h);
  let blob = null;
  for (const q of [0.86, 0.8, 0.72, 0.64, 0.56]) {
    blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', q));
    if (blob && blob.size <= ALVO_BYTES) break;
  }
  if (!blob || blob.size > 3 * 1024 * 1024) throw new Error('A imagem ficou grande demais. Use uma imagem menor.');
  return { blob, w: img.naturalWidth, h: img.naturalHeight };
}

/** Capa tirada do próprio vídeo (quadro de 0,5 s), para quando só o vídeo foi escolhido. */
function capaDoVideo(arq) {
  return new Promise((ok, falha) => {
    const v = document.createElement('video'); const u = URL.createObjectURL(arq);
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = u;
    v.onloadeddata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
    v.onseeked = () => {
      const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight;
      cv.getContext('2d').drawImage(v, 0, 0);
      cv.toBlob((b) => { URL.revokeObjectURL(u); if (b) ok(new File([b], 'capa.jpg', { type: 'image/jpeg' })); else falha(new Error('Não consegui tirar a capa do vídeo. Escolha uma imagem.')); }, 'image/jpeg', .9);
    };
    v.onerror = () => { URL.revokeObjectURL(u); falha(new Error('Não consegui abrir o vídeo. Use MP4 (H.264).')); };
  });
}

async function enviarVideo(painel, arq) {
  if (arq.type !== 'video/mp4') throw new Error('O vídeo do banner tem de ser MP4.');
  if (arq.size > 8 * 1024 * 1024) throw new Error('O vídeo do banner pode ter até 8 MB. Use um vídeo mais curto ou mais leve.');
  let envio = arq;
  try { const { prepararVideo } = await import('./mp4rapido.js'); const r = prepararVideo(await arq.arrayBuffer()); if (r) envio = new Blob([r], { type: 'video/mp4' }); } catch { /* vai como veio */ }
  const up = (await painel('banner_upload_url', { tipo: 'video/mp4', tamanho: envio.size })).dados;
  const { error } = await supabaseComprador().storage.from('portal-banners').uploadToSignedUrl(up.caminho, up.token, envio, { contentType: 'video/mp4', cacheControl: '31536000' });
  if (error) throw new Error('Não foi possível enviar o vídeo agora. Tente de novo em instantes.');
  return up.caminho;
}

async function enviar(painel, arq, larguraMax) {
  const { blob, w, h } = await comprimir(arq, larguraMax);
  const up = (await painel('banner_upload_url', { tipo: 'image/jpeg', tamanho: blob.size })).dados;
  const { error } = await supabaseComprador().storage.from('portal-banners').uploadToSignedUrl(up.caminho, up.token, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw new Error('Não foi possível enviar a imagem agora. Tente de novo em instantes.');
  return { caminho: up.caminho, w, h };
}

const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
function situacao(b) {
  if (!b.ativo) return ['Desligado', 'var(--tx3)'];
  if (b.inicio && b.inicio > hoje()) return [`Começa em ${dataBr(b.inicio)}`, '#ffc400'];
  if (b.fim && b.fim < hoje()) return [`Terminou em ${dataBr(b.fim)}`, 'var(--tx3)'];
  return [b.fim ? `No ar até ${dataBr(b.fim)}` : 'No ar', 'var(--lima)'];
}

export async function desenharBannersPainel(alvo, { painel }) {
  let lista = [];
  let editando = null; // null = fechado; {} = novo; banner = editar
  const pintar = () => {
    const form = editando ? formHtml(editando) : '';
    alvo.innerHTML = `<div style="padding:16px 18px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><b>Banners do catálogo</b><small class="hint" style="display:block;margin:2px 0 0">Aparecem no topo do catálogo, para clientes e visitantes, na ordem abaixo. Tamanho recomendado: 1600×500 px (computador) e 1080×540 px (celular).</small></div>
        ${editando ? '' : '<button class="btn pri" id="bnNovo" type="button">＋ Novo banner</button>'}
      </div>
      ${form}
      <div id="bnLista" style="margin-top:14px">${lista.length ? lista.map((b, i) => linhaHtml(b, i)).join('') : (editando ? '' : '<div class="hint" style="padding:18px 0">Nenhum banner ainda. Clique em "Novo banner" para começar.</div>')}</div></div>`;
    ligarForm();
  };
  const linhaHtml = (b, i) => {
    const [sit, cor] = situacao(b);
    const dest = DESTINOS[b.destino_tipo] + (b.destino_valor ? `: ${b.destino_valor}` : '');
    return `<div class="bn-linha" data-id="${esc(b.id)}" style="display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--linha,#ffffff1a);flex-wrap:wrap">
      <img src="${esc(urlBanner(b.img_desktop))}" alt="" style="width:160px;aspect-ratio:16/5;object-fit:cover;border-radius:8px;background:#fff" loading="lazy">
      <div style="flex:1;min-width:180px"><b>${esc(b.titulo)}</b><small class="hint" style="display:block;margin:2px 0 0">Leva para: ${esc(dest)}${b.img_celular ? ' · com imagem de celular' : ''}${b.video_desktop || b.video_celular ? ' · 🎬 com vídeo' : ''}</small>
        <small style="color:${cor};font-weight:700">${esc(sit)}</small></div>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <button class="tool" data-sobe ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button><button class="tool" data-desce ${i === lista.length - 1 ? 'disabled' : ''} aria-label="Descer">↓</button>
        <button class="tool" data-liga>${b.ativo ? 'Desligar' : 'Ligar'}</button><button class="tool" data-edita>Editar</button><button class="tool" data-apaga>Apagar</button>
      </div></div>`;
  };
  const formHtml = (b) => {
    return `<form id="bnForm" class="panel" style="margin-top:14px;padding:14px" novalidate>
      <b>${b.id ? 'Editar banner' : 'Novo banner'}</b>
      <div class="fgrid" style="margin-top:10px">
        <div class="full"><label for="bnTit">Título (o que o banner diz — é lido para quem não enxerga a imagem)</label><input class="inp" id="bnTit" maxlength="120" value="${esc(b.titulo || '')}" placeholder="Ex.: Natal Souza Ribeiro — tudo para a sua empresa"></div>
        <div><label for="bnImg">Imagem do computador ${b.img_desktop ? '(deixe vazio para manter)' : '(obrigatória; com vídeo, pode deixar vazio que eu tiro a capa do vídeo)'}</label><input class="inp" id="bnImg" type="file" accept="image/jpeg,image/png,image/webp">${b.img_desktop ? `<img src="${esc(urlBanner(b.img_desktop))}" alt="" style="width:100%;max-width:320px;aspect-ratio:16/5;object-fit:cover;border-radius:8px;margin-top:6px">` : ''}</div>
        <div><label for="bnCel">Imagem do celular (opcional, 1080×540)</label><input class="inp" id="bnCel" type="file" accept="image/jpeg,image/png,image/webp">${b.img_celular ? `<img src="${esc(urlBanner(b.img_celular))}" alt="" style="width:160px;aspect-ratio:2/1;object-fit:cover;border-radius:8px;margin-top:6px"><label style="display:flex;gap:6px;align-items:center;margin-top:4px;font-size:13px"><input type="checkbox" id="bnCelTira"> Tirar a imagem do celular</label>` : ''}</div>
        <div><label for="bnVid">Vídeo do computador (opcional, MP4 até 8 MB, sem som)</label><input class="inp" id="bnVid" type="file" accept="video/mp4">${b.video_desktop ? '<small class="hint" style="display:block">Já tem vídeo. <label style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" id="bnVidTira"> Tirar</label></small>' : ''}</div>
        <div><label for="bnVidC">Vídeo do celular (opcional, MP4 1080×540)</label><input class="inp" id="bnVidC" type="file" accept="video/mp4">${b.video_celular ? '<small class="hint" style="display:block">Já tem vídeo. <label style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" id="bnVidCTira"> Tirar</label></small>' : ''}</div>
        <div><label for="bnTipo">Ao tocar, leva para</label><select class="inp" id="bnTipo">${Object.entries(DESTINOS).map(([k, t]) => `<option value="${k}" ${k === (b.destino_tipo || 'nenhum') ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div id="bnValBox"></div>
        <div><label for="bnIni">Começa em (opcional)</label><input class="inp" id="bnIni" type="date" value="${esc(b.inicio || '')}"></div>
        <div><label for="bnFim">Termina em (opcional)</label><input class="inp" id="bnFim" type="date" value="${esc(b.fim || '')}"></div>
      </div>
      <div class="okmsg" id="bnMsg" aria-live="polite" style="margin-top:8px"></div>
      <div class="act" style="margin-top:10px"><button class="btn sec" type="button" id="bnCancela">Cancelar</button><button class="btn pri" type="submit" id="bnSalva">Salvar banner</button></div>
      </form>`;
  };
  const valorHtml = (tipo, valor) => {
    if (tipo === 'categoria') return `<label for="bnVal">Categoria</label><select class="inp" id="bnVal">${categorias().map((c) => `<option ${c === valor ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
    if (tipo === 'busca') return `<label for="bnVal">Texto da busca</label><input class="inp" id="bnVal" maxlength="120" value="${esc(valor || '')}" placeholder="Ex.: luva nitrílica">`;
    if (tipo === 'produto') return `<label for="bnVal">Código do produto</label><input class="inp" id="bnVal" maxlength="40" value="${esc(valor || '')}" placeholder="Ex.: 25777">`;
    return '';
  };
  const ligarForm = () => {
    alvo.querySelector('#bnNovo')?.addEventListener('click', () => { editando = { ordem: (lista.at(-1)?.ordem ?? 0) + 10 }; pintar(); alvo.querySelector('#bnTit')?.focus(); });
    const f = alvo.querySelector('#bnForm'); if (!f) return;
    const tipo = f.querySelector('#bnTipo');
    const val = () => { f.querySelector('#bnValBox').innerHTML = valorHtml(tipo.value, tipo.value === editando.destino_tipo ? editando.destino_valor : ''); };
    tipo.addEventListener('change', val); val();
    f.querySelector('#bnCancela').addEventListener('click', () => { editando = null; pintar(); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = f.querySelector('#bnMsg'); const btn = f.querySelector('#bnSalva');
      const titulo = f.querySelector('#bnTit').value.trim();
      let img = f.querySelector('#bnImg').files[0]; let cel = f.querySelector('#bnCel').files[0];
      const vid = f.querySelector('#bnVid').files[0]; const vidC = f.querySelector('#bnVidC').files[0];
      if (!titulo) { msg.textContent = 'Dê um título ao banner.'; f.querySelector('#bnTit').focus(); return; }
      if (!img && !editando.img_desktop && !vid) { msg.textContent = 'Escolha a imagem do computador.'; return; }
      const ini = f.querySelector('#bnIni').value; const fim = f.querySelector('#bnFim').value;
      if (ini && fim && fim < ini) { msg.textContent = 'O fim do período tem de ser depois do início.'; return; }
      const dados = { titulo, destino_tipo: tipo.value, destino_valor: f.querySelector('#bnVal')?.value.trim() || '', inicio: ini, fim, ordem: editando.ordem ?? 0 };
      if (['categoria', 'busca', 'produto'].includes(dados.destino_tipo) && !dados.destino_valor) { msg.textContent = 'Informe para onde o banner leva.'; return; }
      btn.disabled = true;
      try {
        if (!img && !editando.img_desktop && vid) { msg.textContent = 'Tirando a capa do vídeo…'; img = await capaDoVideo(vid); }
        if (!cel && !editando.img_celular && vidC) cel = await capaDoVideo(vidC);
        if (vid) { msg.textContent = 'Enviando o vídeo do computador…'; dados.video_desktop = await enviarVideo(painel, vid); }
        else if (f.querySelector('#bnVidTira')?.checked) dados.video_desktop = '';
        if (vidC) { msg.textContent = 'Enviando o vídeo do celular…'; dados.video_celular = await enviarVideo(painel, vidC); }
        else if (f.querySelector('#bnVidCTira')?.checked) dados.video_celular = '';
        if (img) {
          msg.textContent = 'Enviando a imagem do computador…';
          const r = await enviar(painel, img, 1920); dados.img_desktop = r.caminho;
          if (r.w < 1200) toast('Atenção: a imagem tem menos de 1200 px de largura e pode ficar borrada no computador.');
        }
        if (cel) { msg.textContent = 'Enviando a imagem do celular…'; dados.img_celular = (await enviar(painel, cel, 1080)).caminho; }
        else if (f.querySelector('#bnCelTira')?.checked) dados.img_celular = '';
        msg.textContent = 'Salvando…';
        if (editando.id) await painel('banner_salvar', { id: editando.id, ...dados });
        else await painel('banner_salvar', { ...dados, ativo: true });
        esquecerBanners();
        editando = null; await recarregar(); toast('Banner salvo ✓');
      } catch (err) { msg.textContent = err.message; btn.disabled = false; }
    });
  };
  alvo.addEventListener('click', async (e) => {
    const linha = e.target.closest('.bn-linha'); if (!linha) return;
    const i = lista.findIndex((b) => b.id === linha.dataset.id); const b = lista[i]; if (!b) return;
    try {
      if (e.target.closest('[data-edita]')) { editando = { ...b }; pintar(); alvo.scrollIntoView({ block: 'start' }); return; }
      if (e.target.closest('[data-liga]')) await painel('banner_salvar', { id: b.id, ativo: !b.ativo });
      else if (e.target.closest('[data-apaga]')) {
        const bt = e.target.closest('[data-apaga]');
        if (bt.dataset.conf !== '1') { bt.dataset.conf = '1'; bt.textContent = 'Clique de novo para apagar'; setTimeout(() => { if (bt.isConnected) { bt.dataset.conf = ''; bt.textContent = 'Apagar'; } }, 4000); return; }
        await painel('banner_apagar', { id: b.id });
      } else if (e.target.closest('[data-sobe]') || e.target.closest('[data-desce]')) {
        const j = i + (e.target.closest('[data-sobe]') ? -1 : 1); const outro = lista[j]; if (!outro) return;
        // Renumera tudo em passos de 10 e troca os dois de lugar.
        const nova = lista.slice(); [nova[i], nova[j]] = [nova[j], nova[i]];
        await Promise.all(nova.map((x, k) => (x.ordem === k * 10 ? null : painel('banner_salvar', { id: x.id, ordem: k * 10 }))).filter(Boolean));
      } else return;
      esquecerBanners(); await recarregar();
    } catch (err) { toast(err.message); }
  });
  async function recarregar() {
    try { lista = (await painel('banners_listar')).dados || []; } catch (err) { alvo.innerHTML = `<div class="g360-erro" style="margin:16px 18px">${esc(err.message)}</div>`; return; }
    pintar();
  }
  alvo.innerHTML = '<div class="hint" style="padding:18px">Carregando os banners…</div>';
  await recarregar();
}
