/** Prepara qualquer imagem para a galeria do G360: JPEG de até 2 MiB, até 4.096 px por lado e 16 milhões de pixels.
 *  JPEG que já cumpre os limites vai como está; o resto é redesenhado (máx. 1600 px, fundo branco). */
const MAX_BYTES = 2 * 1024 * 1024;

function lerDataUrl(blob) {
  return new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => falha(new Error('leitura')); r.readAsDataURL(blob); });
}

function carregar(blob) {
  return new Promise((ok, falha) => {
    const img = new Image(); const u = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(u); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(u); falha(new Error('formato')); };
    img.src = u;
  });
}

export async function paraJpeg(blob, tipo = blob.type) {
  const img = await carregar(blob);
  const w0 = img.naturalWidth; const h0 = img.naturalHeight;
  const cabe = Math.max(w0, h0) <= 4096 && w0 * h0 <= 16_000_000;
  if (tipo === 'image/jpeg' && blob.size <= MAX_BYTES && cabe) {
    const d = await lerDataUrl(blob);
    return d.replace(/^data:[^;]*;/, 'data:image/jpeg;');
  }
  let w = w0; let h = h0; const max = 1600;
  if (Math.max(w, h) > max) { const f = max / Math.max(w, h); w = Math.round(w * f); h = Math.round(h * f); }
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c2 = cv.getContext('2d'); c2.fillStyle = '#fff'; c2.fillRect(0, 0, w, h); c2.drawImage(img, 0, 0, w, h);
  for (const q of [0.88, 0.8, 0.7, 0.6, 0.5]) {
    const d = cv.toDataURL('image/jpeg', q);
    if ((d.length - 23) * 0.75 <= MAX_BYTES) return d;
  }
  throw new Error('grande');
}
