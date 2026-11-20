/* "Início rápido" para vídeos MP4/MOV: celulares gravam o índice do vídeo (caixa moov) no FIM do arquivo,
 * e o navegador precisa buscar o fim antes de começar a tocar. Aqui o índice vai para o começo (como o
 * "faststart" do ffmpeg), sem recomprimir nada: só reorganiza as caixas e corrige as posições dos trechos.
 * Devolve um Uint8Array novo, ou null quando o arquivo já está no formato certo ou não dá para mexer. */
const CONTEINERES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex']);

function caixas(v, de, ate) {
  const lista = [];
  let p = de;
  while (p + 8 <= ate) {
    let tam = v.getUint32(p); const tipo = String.fromCharCode(v.getUint8(p + 4), v.getUint8(p + 5), v.getUint8(p + 6), v.getUint8(p + 7));
    let cab = 8;
    if (tam === 1) { tam = Number(v.getBigUint64(p + 8)); cab = 16; } else if (tam === 0) tam = ate - p;
    if (tam < cab || p + tam > ate) return null; // arquivo estranho: não mexe
    lista.push({ tipo, ini: p, tam, cab });
    p += tam;
  }
  return p === ate ? lista : null;
}

function corrigirPosicoes(v, ini, fim, delta) {
  const filhos = caixas(v, ini, fim); if (!filhos) return false;
  for (const c of filhos) {
    const corpo = c.ini + c.cab;
    if (CONTEINERES.has(c.tipo)) { if (!corrigirPosicoes(v, corpo, c.ini + c.tam, delta)) return false; continue; }
    if (c.tipo === 'stco') {
      const n = v.getUint32(corpo + 4);
      for (let i = 0; i < n; i++) { const o = corpo + 8 + i * 4; const novo = v.getUint32(o) + delta; if (novo > 0xffffffff) return false; v.setUint32(o, novo); }
    } else if (c.tipo === 'co64') {
      const n = v.getUint32(corpo + 4);
      for (let i = 0; i < n; i++) { const o = corpo + 8 + i * 8; v.setBigUint64(o, v.getBigUint64(o) + BigInt(delta)); }
    }
  }
  return true;
}

export function inicioRapido(buffer) {
  const v = new DataView(buffer);
  const topo = caixas(v, 0, buffer.byteLength);
  if (!topo) return null;
  const iMoov = topo.findIndex((c) => c.tipo === 'moov'); const iMdat = topo.findIndex((c) => c.tipo === 'mdat');
  if (iMoov < 0 || iMdat < 0 || iMoov < iMdat) return null; // sem índice, sem dados ou já no começo
  const moov = topo[iMoov];
  const copia = new Uint8Array(buffer.slice(moov.ini, moov.ini + moov.tam));
  if (!corrigirPosicoes(new DataView(copia.buffer), moov.cab, moov.tam, moov.tam)) return null;
  const saida = new Uint8Array(buffer.byteLength); let p = 0;
  for (let i = 0; i < topo.length; i++) {
    if (i === iMoov) continue;
    if (i === iMdat) { saida.set(copia, p); p += copia.length; }
    const c = topo[i]; saida.set(new Uint8Array(buffer, c.ini, c.tam), p); p += c.tam;
  }
  return saida;
}

/* ---------- MP4 fragmentado (moof/mdat), comum em vídeo baixado de rede social ou de streaming ----------
 * O iPhone nem sempre toca esse formato num <video> comum (fica preto). Aqui ele vira um MP4 normal:
 * índice completo no começo (moov com stts/stsz/stco...) e os dados em seguida, intercalados de ~1 s.
 * Não recomprime nada: só reorganiza. Devolve Uint8Array ou null se não for fragmentado / não der. */
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
function caixa(tipo, ...partes) {
  const corpo = partes.flat().filter(Boolean);
  const tam = 8 + corpo.reduce((s, p) => s + p.length, 0);
  const b = new Uint8Array(tam); const v = new DataView(b.buffer);
  v.setUint32(0, tam); for (let i = 0; i < 4; i++) b[4 + i] = tipo.charCodeAt(i);
  let p = 8; for (const c of corpo) { b.set(c, p); p += c.length; }
  return b;
}
const completa = (tipo, verFlags, ...partes) => caixa(tipo, u32(verFlags), ...partes);
const filhos = (v, c) => caixas(v, c.ini + c.cab, c.ini + c.tam) || [];
const achar = (v, c, tipo) => filhos(v, c).find((x) => x.tipo === tipo);

export function desfragmentar(buffer) {
  const v = new DataView(buffer); const bytes = new Uint8Array(buffer);
  const topo = caixas(v, 0, buffer.byteLength);
  if (!topo || !topo.some((c) => c.tipo === 'moof')) return null;
  const moov = topo.find((c) => c.tipo === 'moov'); const ftyp = topo.find((c) => c.tipo === 'ftyp');
  if (!moov) return null;
  const mvhd = achar(v, moov, 'mvhd'); if (!mvhd) return null;
  const mvhdVer = v.getUint8(mvhd.ini + 8); const escalaFilme = v.getUint32(mvhd.ini + (mvhdVer ? 28 : 20));
  const trex = new Map();
  const mvex = achar(v, moov, 'mvex');
  if (mvex) for (const t of filhos(v, mvex).filter((x) => x.tipo === 'trex')) {
    const b = t.ini + 12; trex.set(v.getUint32(b), { dur: v.getUint32(b + 8), tam: v.getUint32(b + 12), flags: v.getUint32(b + 16) });
  }
  const trilhas = new Map(); // id → { trak, amostras: [] }
  for (const t of filhos(v, moov).filter((x) => x.tipo === 'trak')) {
    const tkhd = achar(v, t, 'tkhd'); if (!tkhd) return null;
    const ver = v.getUint8(tkhd.ini + 8); const id = v.getUint32(tkhd.ini + (ver ? 28 : 20));
    trilhas.set(id, { trak: t, amostras: [] });
  }
  // Amostras de cada moof
  for (const mf of topo.filter((c) => c.tipo === 'moof')) {
    for (const traf of filhos(v, mf).filter((x) => x.tipo === 'traf')) {
      const tfhd = achar(v, traf, 'tfhd'); if (!tfhd) return null;
      const fl = v.getUint32(tfhd.ini + 8) & 0xffffff; let p = tfhd.ini + 12;
      const id = v.getUint32(p); p += 4;
      const tr = trilhas.get(id); if (!tr) return null;
      const def = trex.get(id) || { dur: 0, tam: 0, flags: 0 };
      let base = mf.ini; if (fl & 0x1) { base = Number(v.getBigUint64(p)); p += 8; }
      if (fl & 0x2) p += 4;
      let dDur = def.dur; let dTam = def.tam; let dFl = def.flags;
      if (fl & 0x8) { dDur = v.getUint32(p); p += 4; }
      if (fl & 0x10) { dTam = v.getUint32(p); p += 4; }
      if (fl & 0x20) { dFl = v.getUint32(p); p += 4; }
      let fim = 0;
      for (const run of filhos(v, traf).filter((x) => x.tipo === 'trun')) {
        const rv = v.getUint8(run.ini + 8); const rf = v.getUint32(run.ini + 8) & 0xffffff; let q = run.ini + 12;
        const n = v.getUint32(q); q += 4;
        let pos = base; if (rf & 0x1) { pos = base + v.getInt32(q); q += 4; } else if (fim) pos = fim;
        let primeiro = null; if (rf & 0x4) { primeiro = v.getUint32(q); q += 4; }
        for (let i = 0; i < n; i++) {
          let dur = dDur; let tam = dTam; let flg = (i === 0 && primeiro !== null) ? primeiro : dFl; let cto = 0;
          if (rf & 0x100) { dur = v.getUint32(q); q += 4; }
          if (rf & 0x200) { tam = v.getUint32(q); q += 4; }
          if (rf & 0x400) { flg = v.getUint32(q); q += 4; }
          if (rf & 0x800) { cto = rv ? v.getInt32(q) : v.getUint32(q); q += 4; }
          if (pos + tam > buffer.byteLength) return null;
          tr.amostras.push({ pos, tam, dur, sync: !(flg & 0x10000), cto });
          pos += tam;
        }
        fim = pos;
      }
    }
  }
  const lista = [...trilhas.values()].filter((t) => t.amostras.length);
  if (!lista.length) return null;
  // Pedaços de ~1 s por trilha, intercalados pelo tempo
  const pedacos = [];
  for (const t of lista) {
    const mdhd = achar(v, achar(v, t.trak, 'mdia'), 'mdhd'); const ver = v.getUint8(mdhd.ini + 8);
    t.escala = v.getUint32(mdhd.ini + (ver ? 28 : 20)); t.pedacos = [];
    let tempo = 0; let atual = null;
    for (const a of t.amostras) {
      if (!atual || tempo - atual.ini >= t.escala) { atual = { trilha: t, ini: tempo, amostras: [] }; t.pedacos.push(atual); pedacos.push(atual); }
      atual.amostras.push(a); tempo += a.dur;
    }
    t.duracao = tempo;
  }
  pedacos.sort((a, b) => a.ini / a.trilha.escala - b.ini / b.trilha.escala);
  // stco: posição de cada pedaço no mdat novo (descoberta depois do tamanho do moov)
  const montarMoov = (inicioDados) => {
    let pos = inicioDados; for (const p of pedacos) { p.pos = pos; pos += p.amostras.reduce((s, a) => s + a.tam, 0); }
    const duracoes = lista.map((t) => Math.round((t.duracao / t.escala) * escalaFilme));
    const mv = bytes.slice(mvhd.ini, mvhd.ini + mvhd.tam); const mvv = new DataView(mv.buffer);
    const durFilme = Math.max(...duracoes);
    if (mvhdVer) mvv.setBigUint64(32, BigInt(durFilme)); else mvv.setUint32(24, durFilme);
    const traks = lista.map((t, k) => {
      const tk = achar(v, t.trak, 'tkhd'); const tkb = bytes.slice(tk.ini, tk.ini + tk.tam); const tkv = new DataView(tkb.buffer);
      if (tkv.getUint8(8)) tkv.setBigUint64(36, BigInt(duracoes[k])); else tkv.setUint32(28, duracoes[k]);
      const mdia = achar(v, t.trak, 'mdia'); const md = achar(v, mdia, 'mdhd'); const mdb = bytes.slice(md.ini, md.ini + md.tam); const mdv = new DataView(mdb.buffer);
      if (mdv.getUint8(8)) mdv.setBigUint64(32, BigInt(t.duracao)); else mdv.setUint32(24, t.duracao);
      const hdlr = achar(v, mdia, 'hdlr'); const minf = achar(v, mdia, 'minf');
      const stbl = achar(v, minf, 'stbl'); const stsd = achar(v, stbl, 'stsd');
      const copia = (c) => (c ? bytes.slice(c.ini, c.ini + c.tam) : null);
      const am = t.amostras;
      const stts = []; for (const a of am) { const u = stts[stts.length - 1]; if (u && u[1] === a.dur) u[0]++; else stts.push([1, a.dur]); }
      const temCto = am.some((a) => a.cto); const ctts = [];
      if (temCto) for (const a of am) { const u = ctts[ctts.length - 1]; if (u && u[1] === a.cto) u[0]++; else ctts.push([1, a.cto]); }
      const sync = am.every((a) => a.sync) ? null : am.map((a, i) => (a.sync ? i + 1 : 0)).filter(Boolean);
      const stsc = []; t.pedacos.forEach((p, i) => { const u = stsc[stsc.length - 1]; if (!u || u[1] !== p.amostras.length) stsc.push([i + 1, p.amostras.length]); });
      const novoStbl = caixa('stbl', copia(stsd),
        completa('stts', 0, u32(stts.length), stts.flatMap(([n, d]) => [u32(n), u32(d)])),
        temCto ? completa('ctts', ctts.some(([, c]) => c < 0) ? 0x01000000 : 0, u32(ctts.length), ctts.flatMap(([n, c]) => [u32(n), u32(c >>> 0)])) : null,
        sync ? completa('stss', 0, u32(sync.length), sync.map(u32)) : null,
        completa('stsc', 0, u32(stsc.length), stsc.flatMap(([c, n]) => [u32(c), u32(n), u32(1)])),
        completa('stsz', 0, u32(0), u32(am.length), am.map((a) => u32(a.tam))),
        completa('stco', 0, u32(t.pedacos.length), t.pedacos.map((p) => u32(p.pos))));
      const minfFilhos = filhos(v, minf).filter((x) => x.tipo !== 'stbl').map(copia);
      return caixa('trak', tkb, caixa('mdia', mdb, copia(hdlr), caixa('minf', ...minfFilhos, novoStbl)));
    });
    return caixa('moov', mv, ...traks);
  };
  const cab = ftyp ? bytes.slice(ftyp.ini, ftyp.ini + ftyp.tam) : new Uint8Array(0);
  const totalDados = pedacos.reduce((s, p) => s + p.amostras.reduce((x, a) => x + a.tam, 0), 0);
  if (totalDados + 8 > 0xffffffff) return null;
  let moovNovo = montarMoov(0);
  moovNovo = montarMoov(cab.length + moovNovo.length + 8); // o tamanho do moov não muda entre as duas montagens
  const saida = new Uint8Array(cab.length + moovNovo.length + 8 + totalDados);
  saida.set(cab, 0); saida.set(moovNovo, cab.length);
  let p = cab.length + moovNovo.length; new DataView(saida.buffer).setUint32(p, totalDados + 8); saida.set([109, 100, 97, 116], p + 4); p += 8;
  for (const pd of pedacos) for (const a of pd.amostras) { saida.set(bytes.subarray(a.pos, a.pos + a.tam), p); p += a.tam; }
  return saida;
}

/** Prepara o vídeo para tocar rápido em qualquer aparelho: desfragmenta se preciso, senão só põe o índice no começo. */
export function prepararVideo(buffer) {
  return desfragmentar(buffer) || inicioRapido(buffer);
}
