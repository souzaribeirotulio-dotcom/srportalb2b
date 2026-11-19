/* Exportar fotos (painel → Produtos): baixa as fotos da galeria do G360 deste ambiente num ou mais ZIPs,
 * no padrão do "Importar imagens" (CODIGO_capa.jpg, CODIGO_ambiente.jpg, CODIGO_uso.jpg).
 * Serve para levar as fotos da homologação para a produção: exporta aqui e importa lá.
 * Só lê: GET operadores/produtos/{id}/fotos e GET .../fotos/{item}. Nada é gravado no G360 nem no Supabase. */
import JSZip from 'jszip';
import { listarFotosOperador, obterFotoOperador, buscarProdutosOperador, listarVitrine, interpretarErro, ErroApi } from '../api/g360.js';
import { comEspera, produtosDosCodigos } from './lotesfotos.js';
import { $, esc, abrirModal, fecharModal } from './comum.js';

const TIPOS = ['capa', 'ambiente', 'uso']; // a ordem da galeria: capa primeiro, depois as outras
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const PARAR = new Set(['SESSAO_INVALIDA', 'SESSAO_EXPIRADA', 'LICENCA_OPERADOR_INDISPONIVEL', 'OPERADOR_SEM_ACESSO', 'ORIGEM_OPERADOR_NAO_PERMITIDA']);

let ctx = null;
let rodando = null; // { parar }

export function abrirExportacaoFotos(opcoes) {
  ctx = opcoes;
  abrirModal('mAdm');
  $('admBox').innerHTML = `<div class="fxh"><div><h3>⬇ Exportar fotos (ZIP)</h3><div class="sub">Baixa as fotos da galeria do G360 deste ambiente, no padrão do "Importar imagens". Use na homologação e importe os arquivos no painel de produção.</div></div><button class="fxx" id="exX" title="Fechar">×</button></div>
    <div class="fgrid">
      <div class="full"><label for="exModo">Quais produtos</label><select class="inp" id="exModo">
        <option value="visivel">Os que aparecem no portal (lista do botão "Atualizar produtos do portal")</option>
        <option value="todos">Todos os produtos do G360 (demora mais)</option></select></div>
    </div>
    <p class="hint">O painel lista só os produtos que têm foto (leva cerca de 1 minuto para os do portal); depois você escolhe quais baixar. Vão até 3 fotos por produto: a capa e as duas seguintes da galeria.</p>
    <div id="exMsg" aria-live="polite"></div>
    <div class="act"><button class="btn sec" id="exFechar" type="button">Fechar</button><button class="btn pri" id="exIr" type="button">Procurar produtos com foto</button></div>`;
  const fechar = () => { if (rodando) { rodando.parar = true; return; } fecharModal('mAdm'); };
  $('exX').onclick = fechar; $('exFechar').onclick = fechar;
  $('exIr').onclick = exportar;
}

function msg(html) { if ($('exMsg')) $('exMsg').innerHTML = html; }
const nomeArq = (c) => String(c).trim().replace(/[^A-Za-z0-9._-]/g, '-');

async function codigosDoPortal() {
  const vis = (await ctx.painel('visiveis_ler')).dados;
  return vis ? [...new Set([...(vis.visiveis || []), ...(vis.estoque_baixo || []), ...(vis.sem_estoque || [])].map(String))] : [];
}

/* 1) Procura os produtos que têm foto; 2) a equipe escolhe quais; 3) baixa os escolhidos em ZIP. */
let achados = []; // [{ p, ordem: [itens], marcado }]

/* Caminho rápido: a vitrine (catálogo aberto) já diz, de 50 em 50, quais produtos têm foto (fotos[], capa primeiro).
   Respeita o limite da vitrine (30 consultas por minuto). Se a vitrine estiver fechada, volta para a conferência um por um. */
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function pelaVitrine(modo, est, mostrar) {
  const cods = modo === 'visivel' ? await codigosDoPortal() : null;
  if (cods && !cods.length) throw new Error('Ainda não há lista do que aparece no portal. Use "Atualizar produtos do portal" ou escolha "Todos os produtos".');
  const pedidos = [];
  if (cods) { est.total = cods.length; for (let i = 0; i < cods.length; i += 50) pedidos.push({ codigos: cods.slice(i, i + 50), limite: 50 }); }
  let ultimo = 0;
  const pedir = async (f) => { const espera = 2100 - (Date.now() - ultimo); if (espera > 0) await sleep(espera); ultimo = Date.now(); return comEspera(() => listarVitrine(f)); };
  const tratar = (dados) => {
    for (const p of dados) { est.conferidos++; if (Array.isArray(p.fotos) && p.fotos.length) achados.push({ p, ordem: p.fotos.map(Number), marcado: true }); }
    mostrar();
  };
  if (cods) { for (const f of pedidos) { if (rodando.parar) break; tratar((await pedir(f)).dados); } return; }
  const r = await pedir({ pagina: 1, limite: 50 });
  est.total = r.paginacao?.total || r.dados.length; tratar(r.dados);
  const paginas = Math.ceil(est.total / 50);
  for (let p = 2; p <= paginas && !rodando.parar; p++) tratar((await pedir({ pagina: p, limite: 50 })).dados);
}

async function exportar() {
  if (rodando) return;
  const modo = $('exModo').value;
  rodando = { parar: false };
  achados = [];
  {
    const est0 = { conferidos: 0, total: 0 };
    const mostrar0 = () => msg(`<div class="impprog"><div class="impbarra"><i style="width:${est0.total ? Math.round((est0.conferidos / est0.total) * 100) : 0}%"></i></div>
      <span class="hint" style="margin:0">Procurando produtos com foto… ${est0.conferidos} de ${est0.total || '…'} · <b>${achados.length} com foto</b></span></div>`);
    $('exIr').disabled = true; $('exIr').textContent = 'Procurando…'; $('exFechar').textContent = 'Parar';
    try {
      await pelaVitrine(modo, est0, mostrar0);
      rodando = null;
      $('exIr').disabled = false; $('exIr').textContent = 'Procurar de novo'; $('exFechar').textContent = 'Fechar';
      achados.sort((a, b) => String(a.p.codigo).localeCompare(String(b.p.codigo), 'pt', { numeric: true }));
      desenharEscolha('', 0);
      return;
    } catch (e) {
      if (!(e instanceof ErroApi)) { rodando = null; $('exIr').disabled = false; $('exIr').textContent = 'Procurar produtos com foto'; $('exFechar').textContent = 'Fechar'; msg(`<div class="rv-aviso bad">${esc(e.message)}</div>`); return; }
      achados = []; // vitrine fechada ou recusando: confere galeria por galeria
    }
  }
  $('exIr').disabled = true; $('exIr').textContent = 'Procurando…'; $('exFechar').textContent = 'Parar';
  const est = { conferidos: 0, total: 0, falhas: 0 };
  const mostrar = () => msg(`<div class="impprog"><div class="impbarra"><i style="width:${est.total ? Math.round((est.conferidos / est.total) * 100) : 0}%"></i></div>
    <span class="hint" style="margin:0">Procurando produtos com foto… ${est.conferidos} de ${est.total || '…'} conferidos · <b>${achados.length} com foto</b>${est.falhas ? ` · <span class="ruim">${est.falhas} sem resposta do G360</span>` : ''}</span></div>`);
  let fatal = null;
  try {
    const blocos = [];
    if (modo === 'visivel') {
      const cods = await codigosDoPortal();
      if (!cods.length) throw new Error('Ainda não há lista do que aparece no portal. Use "Atualizar produtos do portal" ou escolha "Todos os produtos".');
      est.total = cods.length;
      for (let i = 0; i < cods.length; i += 50) blocos.push(() => produtosDosCodigos(cods.slice(i, i + 50), ctx.token));
    } else {
      const r = await comEspera(() => buscarProdutosOperador(ctx.token(), { pagina: 1, limite: 50 }));
      est.total = r.paginacao?.total || r.dados.length;
      const paginas = Math.max(1, Math.ceil(est.total / 50));
      blocos.push(async () => r.dados);
      for (let p = 2; p <= paginas; p++) blocos.push(async () => (await comEspera(() => buscarProdutosOperador(ctx.token(), { pagina: p, limite: 50 }))).dados);
    }
    mostrar();
    for (const pegar of blocos) {
      if (rodando.parar || fatal) break;
      const produtos = await pegar();
      let i = 0;
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (!rodando.parar && !fatal && i < produtos.length) {
          const p = produtos[i++];
          try {
            const g = await comEspera(() => listarFotosOperador(ctx.token(), p.id));
            const fotos = g.fotos || [];
            if (fotos.length) achados.push({ p, ordem: [...fotos].sort((a, b) => (b.item === g.capa) - (a.item === g.capa)).map((f) => f.item), marcado: true });
          } catch (e) {
            if (e instanceof ErroApi && (e.status === 401 || e.status === 403 || e.status === 423 || PARAR.has(e.codigo) || e.tipo === 'rede')) { fatal = fatal || e; return; }
            est.falhas++;
          }
          est.conferidos++; mostrar();
        }
      }));
    }
  } catch (e) { fatal = e; }
  rodando = null;
  if (fatal instanceof ErroApi && fatal.status === 401) { fecharModal('mAdm'); ctx.aoSessaoEncerrada?.(fatal); return; }
  $('exIr').disabled = false; $('exIr').textContent = 'Procurar de novo'; $('exFechar').textContent = 'Fechar';
  achados.sort((a, b) => String(a.p.codigo).localeCompare(String(b.p.codigo), 'pt', { numeric: true }));
  desenharEscolha(fatal ? (fatal instanceof ErroApi ? interpretarErro(fatal).mensagem : fatal.message) : '', est.falhas);
}

function desenharEscolha(erro, falhas) {
  const aviso = erro ? `<div class="rv-aviso bad">${esc(erro)} A lista abaixo tem o que deu para conferir.</div>` : '';
  if (!achados.length) { msg(`${aviso}<div class="rv-aviso">Nenhum produto com foto encontrado.</div>`); return; }
  msg(`${aviso}<div class="csec">Produtos com foto (${achados.length})${falhas ? ` · <span class="ruim">${falhas} sem resposta do G360 ficaram de fora</span>` : ''}</div>
    <div class="row" style="align-items:center;margin:6px 0"><input class="inp" id="exQ" type="search" placeholder="Filtrar por código ou nome" style="flex:1;min-width:180px">
      <button class="tool" id="exTodos" type="button">Marcar os da lista</button><button class="tool" id="exNenhum" type="button">Desmarcar os da lista</button></div>
    <div id="exLista" style="max-height:340px;overflow:auto;border:1px solid var(--linha2);border-radius:12px" data-rolar></div>
    <div class="row" style="align-items:center;margin-top:10px"><label for="exPorZip" style="margin:0">Produtos por arquivo</label><input class="inp" id="exPorZip" type="number" min="50" max="1000" value="300" style="width:110px">
      <span class="hint" id="exConta" style="margin:0;flex:1"></span><button class="btn pri" id="exBaixar" type="button">Baixar selecionados (ZIP)</button></div>
    <div id="exFim" aria-live="polite"></div>`);
  const visiveis = () => { const q = ($('exQ').value || '').trim().toLowerCase(); return achados.filter((a) => !q || String(a.p.codigo).toLowerCase().includes(q) || String(a.p.nome).toLowerCase().includes(q)); };
  const contar = () => { const n = achados.filter((a) => a.marcado).length; $('exConta').textContent = `${n} de ${achados.length} selecionados`; $('exBaixar').disabled = !n; };
  const desenhar = () => {
    $('exLista').innerHTML = visiveis().slice(0, 1500).map((a) => `<label class="crow" style="grid-template-columns:28px 90px 1fr 70px;cursor:pointer;margin:0">
      <input type="checkbox" data-c="${esc(a.p.codigo)}" ${a.marcado ? 'checked' : ''} style="width:18px;height:18px"><b>${esc(a.p.codigo)}</b><span class="nm">${esc(a.p.nome)}</span><small class="hint" style="margin:0">${a.ordem.length} foto${a.ordem.length === 1 ? '' : 's'}</small></label>`).join('');
    contar();
  };
  $('exLista').addEventListener('change', (e) => { const c = e.target.dataset.c; const a = achados.find((x) => String(x.p.codigo) === c); if (a) { a.marcado = e.target.checked; contar(); } });
  $('exQ').addEventListener('input', desenhar);
  $('exTodos').onclick = () => { visiveis().forEach((a) => { a.marcado = true; }); desenhar(); };
  $('exNenhum').onclick = () => { visiveis().forEach((a) => { a.marcado = false; }); desenhar(); };
  $('exBaixar').onclick = baixarSelecionados;
  desenhar();
}

async function baixarSelecionados() {
  if (rodando) return;
  const escolhidos = achados.filter((a) => a.marcado);
  const porZip = Math.max(50, Math.min(1000, Math.round(Number($('exPorZip').value) || 300)));
  rodando = { parar: false };
  const b = $('exBaixar'); b.disabled = true; b.textContent = 'Baixando…'; $('exFechar').textContent = 'Parar';
  const est = { feitos: 0, fotos: 0, falhas: 0, mais3: 0, arquivos: 0 };
  let zip = new JSZip(); let noZip = 0;
  const fim = (html) => { if ($('exFim')) $('exFim').innerHTML = html; };
  const mostrar = () => fim(`<div class="impprog"><div class="impbarra"><i style="width:${Math.round((est.feitos / escolhidos.length) * 100)}%"></i></div>
    <span class="hint" style="margin:0">${est.feitos} de ${escolhidos.length} produtos · ${est.fotos} fotos · ${est.arquivos} arquivo${est.arquivos === 1 ? '' : 's'} baixado${est.arquivos === 1 ? '' : 's'}${est.falhas ? ` · <span class="ruim">${est.falhas} com erro</span>` : ''}</span></div>`);
  const baixarZip = async () => {
    if (!noZip) return;
    est.arquivos++;
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `fotos-${location.hostname.split('.')[0]}-parte-${est.arquivos}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    zip = new JSZip(); noZip = 0; mostrar();
  };
  let fatal = null; let i = 0;
  mostrar();
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (!rodando.parar && !fatal && i < escolhidos.length) {
      const a = escolhidos[i++];
      try {
        if (a.ordem.length > 3) est.mais3++;
        const arquivos = [];
        for (const [j, item] of a.ordem.slice(0, 3).entries()) {
          const blob = await comEspera(() => obterFotoOperador(ctx.token(), a.p.id, item));
          arquivos.push([`${nomeArq(a.p.codigo)}_${TIPOS[j]}.${EXT[blob.type] || 'jpg'}`, blob]);
        }
        arquivos.forEach(([n, bl]) => zip.file(n, bl)); est.fotos += arquivos.length; noZip++;
      } catch (e) {
        if (e instanceof ErroApi && (e.status === 401 || e.status === 403 || e.status === 423 || PARAR.has(e.codigo) || e.tipo === 'rede')) { fatal = fatal || e; return; }
        est.falhas++;
      }
      est.feitos++; mostrar();
      if (noZip >= porZip) await baixarZip();
    }
  }));
  await baixarZip().catch(() => {});
  const parou = rodando.parar; rodando = null;
  if (fatal instanceof ErroApi && fatal.status === 401) { fecharModal('mAdm'); ctx.aoSessaoEncerrada?.(fatal); return; }
  fim(`<div class="${fatal ? 'rv-aviso bad' : 'okmsg'}">${fatal ? `${esc(fatal instanceof ErroApi ? interpretarErro(fatal).mensagem : fatal.message)} O que já tinha sido baixado foi salvo.` : parou ? 'Parado. O que já tinha sido baixado foi salvo.' : '✓ Pronto.'}
    ${est.feitos - est.falhas} produtos, ${est.fotos} fotos em ${est.arquivos} arquivo${est.arquivos === 1 ? '' : 's'}.${est.mais3 ? ` ${est.mais3} produto${est.mais3 === 1 ? ' tinha' : 's tinham'} mais de 3 fotos: foram as 3 primeiras (capa primeiro).` : ''}${est.falhas ? ` ${est.falhas} com erro ficaram de fora.` : ''}</div>
    <p class="hint">Agora entre no <b>painel de produção</b> → Produtos → <b>📦 Importar imagens</b>, escolha os arquivos e deixe "pular quem já tem foto".</p>`);
  if ($('exBaixar')) { $('exBaixar').disabled = false; $('exBaixar').textContent = 'Baixar selecionados (ZIP)'; }
  if ($('exFechar')) $('exFechar').textContent = 'Fechar';
}
