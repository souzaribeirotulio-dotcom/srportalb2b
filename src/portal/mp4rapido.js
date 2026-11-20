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
