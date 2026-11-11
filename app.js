/* Souza Ribeiro · Portal B2B — aplicação (telas).
   Todos os dados vêm da camada de serviços (window.Servicos, ver servicos/).
   O catálogo é carregado pelo index.html antes deste arquivo e chega em window.__SR_BOOT. */
const SR_BOOT = window.__SR_BOOT || {produtos:[],unidades_alternativas:{}};
const P = SR_BOOT.produtos;
const ICON = {"Descartáveis":"🥤","Embalagens":"📦","Limpeza":"🧴","Higiene":"🧻","Copa & Alimentos":"☕","Utensílios & EPI":"🧤","Papelaria":"📄"};
const brl = v => v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const esc = s => s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function ph(p){
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" rx="16" fill="#f3f6ee"/><text x="100" y="105" font-size="64" text-anchor="middle">${ICON[p.c]||'📦'}</text><text x="100" y="155" font-size="15" font-family="Arial" font-weight="700" fill="#4e7a12" text-anchor="middle">${esc((p.m||'Souza Ribeiro').toUpperCase())}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}
const IMG0 = {}; // fotos sugeridas por produto: nenhuma (produtos fictícios usam a figura padrão)
const LS='sr_b2b_imagens';
/* Back-up legado: imagens editadas antes da sincronização continuam neste navegador.
   Nunca são aplicadas automaticamente aos demais clientes nem substituem a fonte remota. */
let FOTOS_LOCAIS={};
try{FOTOS_LOCAIS=JSON.parse(localStorage.getItem(LS)||'{}')||{}}catch(e){}
let OV={},FOTOS_REV=0,FOTOS_CARREGADAS=false;
function contaFotosLocais(){
  return Object.keys(FOTOS_LOCAIS).filter(c=>byCod[c]&&FOTOS_LOCAIS[c]&&
    (Array.isArray(FOTOS_LOCAIS[c])?FOTOS_LOCAIS[c].length>0:!!FOTOS_LOCAIS[c])).length;
}
function atualizarBotaoFotosLocais(){
  const b=document.getElementById('pubLocal');if(!b)return;
  const n=contaFotosLocais();
  b.hidden=false;
  b.textContent=n?'☁ Publicar fotos antigas ('+n+')':'☁ Fotos antigas (0)';
  b.title=n?'Publicar fotos salvas neste navegador para todos os clientes':'Nenhuma foto antiga encontrada neste navegador. Use Importar fotos se estiver em outro navegador ou domínio.';
}
function fotoHttpsValida(texto){
  if(typeof texto!=='string'||texto.length>2048||/[\s"'<>\\]/.test(texto))return false;
  try{const u=new URL(texto);return u.protocol==='https:'&&!!u.hostname;}catch(e){return false}
}
async function publicarFotosProduto(cod,fotos){
  if(!byCod[cod]||!Array.isArray(fotos)||fotos.length>8)throw new Error('Selecione até 8 fotos válidas para o produto.');
  let salvas;
  try{ salvas=await API.publicarFotos(cod,fotos); }
  catch(e){
    if(e.codigo!=='integracao')throw e;
    // Demonstração: sem armazenamento compartilhado, a foto fica só neste navegador.
    salvas=fotos.slice(); if(salvas.length)FOTOS_LOCAIS[cod]=salvas; else delete FOTOS_LOCAIS[cod];
    try{localStorage.setItem(LS,JSON.stringify(FOTOS_LOCAIS))}catch(_){}
    toast('Demonstração: fotos aplicadas só neste navegador. Publicar para todos depende de integração.');
  }
  FOTOS_REV++;
  if(salvas.length)OV[cod]=salvas;else delete OV[cod];
  atualizarBotaoFotosLocais();
  return salvas;
}
async function carregarFotosCompartilhadas(){
  const revisao=FOTOS_REV;
  const fotos=await API.fotosCatalogo();
  if(revisao!==FOTOS_REV)return;
  const remotas=Object.fromEntries(Object.entries(fotos||{}).filter(([cod,lista])=>byCod[cod]&&Array.isArray(lista)&&lista.length<=8&&lista.every(fotoHttpsValida)));
  const locais=Object.fromEntries(Object.entries(FOTOS_LOCAIS).filter(([cod,lista])=>byCod[cod]&&Array.isArray(lista)&&lista.length));
  OV={...remotas,...locais};
  FOTOS_CARREGADAS=true;
  render();updSem();
  if(typeof VIEW!=='undefined'&&VIEW==='lista'&&CLI)drawLista();
  if(typeof VIEW!=='undefined'&&VIEW==='adm'&&AT==='prod')drawAProd();
  atualizarBotaoFotosLocais();
}
const cosmos = p => p.e ? `https://cdn-cosmos.bluesoft.com.br/products/${p.e}` : '';
// ordem: imagem que você definiu → imagem do catálogo → foto pelo código de barras → figura padrão
const ovArr = c => { const v=OV[c]; return Array.isArray(v)?v:(v?[v]:null); };
const gal = p => { const o=ovArr(p.cod); return o&&o.length ? o : [...new Set([...(IMG0[p.cod]||[]), cosmos(p)].filter(Boolean))]; };
const chain = p => [...new Set([...gal(p), cosmos(p)].filter(Boolean))];
const imgUrl = p => chain(p)[0] || ph(p);
const SEM = new Set();
const CONF = new Set();
const precisa = p => SEM.has(p.cod) || !chain(p).length || (CONF.has(p.cod) && !ovArr(p.cod));
function imgErr(el){
  const p=P[el.dataset.i], c=chain(p), k=+(el.dataset.k||0)+1;
  if(k<c.length){el.dataset.k=k;el.src=c[k];return}
  el.onerror=null; el.src=ph(p); SEM.add(p.cod);
  updSem();
}
function imgOk(el){ if(!el.src.startsWith('data:image/svg')){if(SEM.delete(P[el.dataset.i].cod)) updSem();} }
const updSem=()=>{document.getElementById('nSem').textContent=P.filter(precisa).length; document.querySelectorAll('.card').forEach(c=>c.classList.toggle('noimg',precisa(P[c.dataset.i])))};
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),2600)}

let cat = '';
const cats = {}; P.forEach(p => cats[p.c]=(cats[p.c]||0)+1);
const elCats = document.getElementById('cats');
function drawCats(){
  elCats.innerHTML = [['',P.length], ...Object.entries(cats).sort((a,b)=>b[1]-a[1])]
    .map(([c,n])=>`<button class="chip ${c===cat?'on':''}" data-c="${c}">${c||'Todos'}<span>${n}</span></button>`).join('');
}
elCats.onclick = e => { const b=e.target.closest('.chip'); if(!b) return; cat=b.dataset.c; drawCats(); render(); };

const marcas = [...new Set(P.map(p=>p.m).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt'));
document.getElementById('marca').innerHTML += marcas.map(m=>`<option>${esc(m)}</option>`).join('');
document.getElementById('tot').textContent = P.length; document.getElementById('nMarcas').textContent = new Set(P.map(p=>p.m).filter(Boolean)).size;

/* Intenção de compra: termos conhecidos do cliente, não só a descrição fiscal.
   Metadados iniciais: altere os termos de cada item no editor do administrador.
   A Movimento deverá persistir as palavras-chave para todos os usuários via API. */
const BUSCA_PADRAO = {}; // termos de busca extras por código (os termos do produto vêm do serviço em tagsBusca)
const BUSCA_STOP = new Set(['a','o','as','os','de','da','do','das','dos','para','pra','por','com','sem','um','uma','e','em','no','na']);
/* Sinônimos: palavras equivalentes; situações específicas ficam em tags do produto. */
const SINONIMOS_PADRAO = 'marmita, marmitex, quentinha, marmitinha\nisopor, eps\nsacola, sacolinha\ninterfolha, interfolhado';
const formaTermo = w => {
  w=norm(String(w)).replace(/[\u0300-\u036f]/g,'');
  if(w.length>5 && w.endsWith('gens')) return w.replace(/gens$/,'gem');
  if(w.length>5 && w.endsWith('oes')) return w.replace(/oes$/,'ao');
  return w.length>3&&w.endsWith('s')?w.slice(0,-1):w;
};
const termosBusca = valor => norm(String(valor||'')).replace(/[\u0300-\u036f]/g,'')
  .split(/[^a-z0-9]+/).filter(Boolean).filter(w=>!BUSCA_STOP.has(w)).map(formaTermo);
let cacheSinonimos={texto:null,termos:new Map()};
function mapaSinonimos(){
  const texto=String(CFG.buscaSinonimos??SINONIMOS_PADRAO);
  if(cacheSinonimos.texto===texto)return cacheSinonimos.termos;
  const mapa=new Map();
  for(const linha of texto.split(/\r?\n/).slice(0,150)){
    const grupo=linha.split(/[,;]/).map(x=>termosBusca(x)).filter(a=>a.length===1).map(a=>a[0]).slice(0,20);
    if(grupo.length<2)continue;
    for(const termo of grupo)mapa.set(termo,grupo[0]);
  }
  cacheSinonimos={texto,termos:mapa};return mapa;
}
const buscaCanonica=(termo,mapa)=>mapa.get(termo)||termo;
const textoProdutoBusca=p=>[p.t,p.m,p.cod,p.c,p.d,p.ncm||'',BUSCA_PADRAO[p.cod]||'',p.tagsBusca||''].join(' ');
const cacheBuscaProdutos=new Map();
function indiceBusca(p,mapa){
  const texto=textoProdutoBusca(p),versao=cacheSinonimos.texto;
  const c=cacheBuscaProdutos.get(p.cod);
  if(c&&c.texto===texto&&c.versao===versao)return c;
  const palavras=termosBusca(texto),canonicas=palavras.map(w=>buscaCanonica(w,mapa));
  const idx={texto,versao,palavras,canonicas};cacheBuscaProdutos.set(p.cod,idx);return idx;
}
function buscaExata(p,termos,mapa){
  const idx=indiceBusca(p,mapa);
  return termos.every(t=>idx.canonicas.some(w=>w.includes(buscaCanonica(t,mapa))));
}
/* Corrige no máximo uma letra ou transposição, só se não houve resultado exato.
   A tolerância é aplicada ao termo real, nunca ao sinônimo expandido. */
function erroUm(a,b){
  if(a===b)return true;
  if(Math.abs(a.length-b.length)>1)return false;
  if(a.length===b.length){
    const dif=[];for(let i=0;i<a.length;i++)if(a[i]!==b[i])dif.push(i);
    return dif.length===1||(dif.length===2&&dif[1]===dif[0]+1&&a[dif[0]]===b[dif[1]]&&a[dif[1]]===b[dif[0]]);
  }
  const menor=a.length<b.length?a:b,maior=a.length<b.length?b:a;
  let i=0,j=0,erros=0;
  while(i<menor.length&&j<maior.length){
    if(menor[i]===maior[j]){i++;j++;}else{erros++;j++;if(erros>1)return false;}
  }
  return true;
}
function buscaComErro(p,termos,mapa){
  const idx=indiceBusca(p,mapa);
  let erros=0;
  for(const t of termos){
    if(idx.canonicas.some(w=>w.includes(buscaCanonica(t,mapa))))continue;
    if(t.length<5||!/^[a-z]+$/.test(t)||!idx.palavras.some(w=>w.length>=5&&erroUm(t,w)))return false;
    if(++erros>1)return false;
  }
  return erros===1;
}
const pontosBusca=(p,termos,mapa)=>{
  const nome=termosBusca(p.t),tags=termosBusca((BUSCA_PADRAO[p.cod]||'')+' '+(p.tagsBusca||'')),descricao=termosBusca(p.d||'');
  return termos.reduce((s,t)=>{
    const c=buscaCanonica(t,mapa);
    return s+(nome.includes(t)?12:nome.some(w=>buscaCanonica(w,mapa)===c)?8:0)
      +(tags.some(w=>buscaCanonica(w,mapa)===c)?4:0)
      +(descricao.some(w=>buscaCanonica(w,mapa)===c)?1:0);
  },0);
};
function render(){
  const q = norm(document.getElementById('q').value.trim());
  const termos = termosBusca(q);
  const mapa=mapaSinonimos();
  const m = document.getElementById('marca').value, o = document.getElementById('ord').value;
  const so=document.getElementById('soSem').checked && document.body.classList.contains('edit');
  const elegiveis=P.filter(p=>(ADM||visivel(p))&&(!cat||p.c===cat)&&(!m||p.m===m)&&(!so||precisa(p)));
  let L=termos.length?elegiveis.filter(p=>buscaExata(p,termos,mapa)):elegiveis;
  if(!L.length&&termos.length)L=elegiveis.filter(p=>buscaComErro(p,termos,mapa));
  if(o==='menor') L.sort((a,b)=>base(a)-base(b)); else if(o==='maior') L.sort((a,b)=>base(b)-base(a));
  else L.sort((a,b)=>(termos.length?pontosBusca(b,termos,mapa)-pontosBusca(a,termos,mapa):0)||a.t.localeCompare(b.t,'pt'));
  document.getElementById('cnt').innerHTML = `<b>${L.length}</b> produto${L.length!==1?'s':''}`;
  document.getElementById('grid').innerHTML = L.length ? L.map(p=>`
    <article class="card ${precisa(p)?'noimg':''}" data-i="${P.indexOf(p)}">
      <div class="img ${gal(p).length>1?'dupla':''}"><span class="cat">${p.c}</span><span class="nofoto">CONFERIR FOTO</span>
        <button class="eye" title="Ver detalhes"><svg class="ic" viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button>
        <img class="i1" loading="lazy" referrerpolicy="no-referrer" src="${imgUrl(p)}" alt="${esc(p.t)}" data-i="${P.indexOf(p)}" onerror="imgErr(this)" onload="imgOk(this)">
        ${gal(p).length>1?`<img class="i2" loading="lazy" referrerpolicy="no-referrer" src="${gal(p)[1]}" alt="" onerror="this.remove()"><div class="dots">${gal(p).slice(0,4).map(()=>'<i></i>').join('')}</div>`:''}
        <button class="edbtn">Trocar foto</button><button class="fav ${CLI&&CLI.lista.some(l=>l.cod===p.cod)?'on':''}" title="Minha Lista">${CLI&&CLI.lista.some(l=>l.cod===p.cod)?'⭐ Na lista':'☆ Lista'}</button></div>
      <div class="info">
        <div class="brand">${esc(p.m)}${ALT[p.cod]&&ALT[p.cod].length?'<span class="tagcx">'+esc(ALT[p.cod][0].nome)+' disponível</span>':''}</div>
        <div class="name" title="${esc(p.t)}">${esc(p.t)}</div>
        <div class="meta">Cód. ${esc(p.cod)} · ${p.u}</div>
        ${vePreco()?`<div class="price"><b>${brl(base(p))}</b><small>/ ${p.u.toLowerCase()}</small>${p.etiqueta_preco?'<span class="tagcg">'+esc(p.etiqueta_preco)+'</span>':''}</div>
        ${stkHtml(p)}
        <div class="ueq"></div>
        ${unselHtml(p,'')}
        <div class="buy"><div class="qty"><button data-d="-1">−</button><input type="number" min="1" value="1"><button data-d="1">+</button></div><button class="add"><svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Adicionar</button></div>`:`${stkHtml(p)}<button class="lockp" data-lock><svg class="ic" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Faça login para ver os preços</button>`}
      </div>
    </article>`).join('') : '<div class="empty">Nenhum produto encontrado.</div>';
}
['q','marca','ord','soSem'].forEach(id=>document.getElementById(id).addEventListener('input',render));
/* Quando o cliente inicia uma busca no catálogo, apresenta os resultados sem
   roubar o foco do campo de pesquisa. Executa apenas uma vez até limpar a busca. */
const buscaTopo = document.getElementById('q');
let buscaRolagemFeita = false, buscaRolagemTimer = null;
buscaTopo.addEventListener('input', () => {
  clearTimeout(buscaRolagemTimer);
  if (!buscaTopo.value.trim()) { buscaRolagemFeita = false; return; }
  if (buscaRolagemFeita) return;
  buscaRolagemTimer = setTimeout(() => {
    if (buscaRolagemFeita || !buscaTopo.value.trim() || document.getElementById('vCat').hidden) return;
    const gridResultados = document.getElementById('grid');
    const headerVisivel = document.querySelector('header');
    const distanciaTopo = (headerVisivel ? headerVisivel.getBoundingClientRect().height : 0) + 12;
    const destino = Math.max(0, window.scrollY + gridResultados.getBoundingClientRect().top - distanciaTopo);
    if (destino > window.scrollY + 40) {
      const movimentoReduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: destino, behavior: movimentoReduzido ? 'auto' : 'smooth' });
    }
    buscaRolagemFeita = true;
  }, 120);
});

document.getElementById('edt').onclick=e=>{ if(!ADM)return;document.body.classList.toggle('edit');e.target.classList.toggle('on');render();updSem()};
// modal de edição
let cur=null, tmp=null;
const $=id=>document.getElementById(id);
document.getElementById('grid').addEventListener('click',e=>{
  if(!document.body.classList.contains('edit')||!ADM){ cardClick(e); return; }
  const c=e.target.closest('.card'); if(!c)return; openMod(P[c.dataset.i]);
});
let FX=[], FI=0;
function openMod(p){ if(!ADM) return;
  cur=p; FX=[...gal(p)]; FI=0;
  $('mT').textContent=p.t; $('mS').textContent='Cód. '+p.cod+(p.e?' · EAN '+p.e:'');
  $('mUrl').value=''; $('mFile').value='';
  const q=p.t.replace(/\(.*?\)/g,' ').replace(/–/g,' ').replace(/\s+/g,' ').trim();
  $('gG').href='https://www.google.com/search?tbm=isch&q='+encodeURIComponent(q);
  $('gM').href='https://lista.mercadolivre.com.br/'+encodeURIComponent(norm(q).replace(/[^a-z0-9 ]/g,'').trim().replace(/ +/g,'-'));
  drawFx(); $('mod').classList.add('open');
}
function drawFx(){ const p=cur; FI=Math.min(FI,Math.max(0,FX.length-1));
  const im=$('mImg'); im.onerror=function(){this.onerror=null;this.src=ph(p)}; im.src=FX[FI]||ph(p);
  $('mTag').textContent=FX.length?(FI===0?'★ PRINCIPAL':`FOTO ${FI+1} DE ${FX.length}`):'SEM FOTO';
  document.querySelector('.fxpv').classList.toggle('multi',FX.length>1);
  $('fxTh').innerHTML=FX.length?FX.map((u,i)=>`<div class="fxt ${i===FI?'on':''}" data-i="${i}"><img src="${u}" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('bad')">${i===0?'<span class="n1">PRINCIPAL</span>':''}</div>`).join(''):'<div class="fxempty">Nenhuma foto. Adicione abaixo.</div>';
  $('fxAct').innerHTML=FX.length?`<button data-a="main" ${FI===0?'disabled':''}>★ Tornar principal</button><button data-a="left" ${FI===0?'disabled':''}>← Mover</button><button data-a="right" ${FI===FX.length-1?'disabled':''}>Mover →</button><button data-a="rm" class="rm">🗑 Remover esta foto</button>`:'';
  const sug=[...new Set([...(IMG0[p.cod]||[]),cosmos(p)].filter(u=>u&&!FX.includes(u)))], ob=$('opts');
  ob.className=sug.length?'opts':''; ob.innerHTML=sug.length?'<b>Fotos sugeridas (mesma marca e medida) — clique para adicionar:</b>'+sug.map(u=>`<img src="${u}" referrerpolicy="no-referrer" data-sug="${u}" onerror="this.remove()">`).join(''):'';
}
$('fxTh').onclick=e=>{const t=e.target.closest('.fxt');if(t){FI=+t.dataset.i;drawFx()}};
$('fxP').onclick=()=>{FI=(FI-1+FX.length)%FX.length;drawFx()}; $('fxN').onclick=()=>{FI=(FI+1)%FX.length;drawFx()};
$('fxAct').onclick=e=>{const a=e.target.dataset.a; if(!a)return; const sw=(i,j)=>{[FX[i],FX[j]]=[FX[j],FX[i]]};
  if(a==='main'){FX.unshift(FX.splice(FI,1)[0]);FI=0} if(a==='left'&&FI>0){sw(FI,FI-1);FI--} if(a==='right'&&FI<FX.length-1){sw(FI,FI+1);FI++}
  if(a==='rm'){FX.splice(FI,1);FI=Math.max(0,FI-1)} drawFx()};
$('opts').onclick=e=>{const u=e.target.dataset.sug;if(!u)return;FX.push(u);FI=FX.length-1;drawFx()};
function addUrl(){const v=$('mUrl').value.trim(); if(!/^https:\/\//i.test(v)){toast('Use link HTTPS do vídeo (.mp4 ou .webm)');return} if(!FX.includes(v))FX.push(v); FI=FX.indexOf(v); $('mUrl').value=''; drawFx()}
$('fxAddUrl').onclick=addUrl; $('mUrl').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();addUrl()}};
function lerArquivos(files){ [...files].filter(f=>f.type.startsWith('image/')).forEach(f=>{const r=new FileReader();
  r.onload=()=>{const im=new Image(); im.onload=()=>{const s=Math.min(1,700/Math.max(im.width,im.height)),cv=document.createElement('canvas');
    cv.width=Math.round(im.width*s); cv.height=Math.round(im.height*s); const x=cv.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,cv.width,cv.height); x.drawImage(im,0,0,cv.width,cv.height);
    FX.push(cv.toDataURL('image/jpeg',.82)); FI=FX.length-1; drawFx()}; im.src=r.result}; r.readAsDataURL(f)}); }
$('mFile').onchange=()=>{lerArquivos($('mFile').files);$('mFile').value=''};
const dz=$('fxDrop'); ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('over')}));
['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('over')}));
dz.addEventListener('drop',e=>lerArquivos(e.dataTransfer.files));
const closeMod=()=>$('mod').classList.remove('open');
$('mCan').onclick=closeMod; $('mCan2').onclick=closeMod; $('mod').onclick=e=>{if(e.target.id==='mod')closeMod()};
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMod()});
$('mOk').onclick=async()=>{
  const botao=$('mOk'),codigo=cur.cod,imagens=[...FX];
  botao.disabled=true;botao.textContent='Publicando…';
  try{
    const salvas=await publicarFotosProduto(codigo,imagens);
    FX=[...salvas]; SEM.delete(codigo);closeMod();render();updSem();
    if(VIEW==='adm')drawAdm();
    toast(salvas.length?'Fotos publicadas para todos os clientes ✓':'Fotos originais restauradas para todos ✓');
  }catch(e){toast('Não foi possível publicar: '+e.message)}
  finally{botao.disabled=false;botao.textContent='Salvar fotos'}
};
$('mDel').onclick=async()=>{
  const botao=$('mDel'),codigo=cur.cod;
  botao.disabled=true;
  try{
    await publicarFotosProduto(codigo,[]);
    SEM.delete(codigo);closeMod();render();updSem();if(VIEW==='adm')drawAdm();
    toast('Fotos originais restauradas para todos ✓');
  }catch(e){toast('Não foi possível restaurar: '+e.message)}
  finally{botao.disabled=false}
};
// exportar / importar
$('exp').onclick=()=>{const all={...IMG0,...OV}; const b=new Blob([JSON.stringify(all,null,1)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='sr_portal_b2b_imagens.json'; a.click(); toast(Object.keys(all).length+' imagens exportadas')};
$('imp').onclick=()=>$('impF').click();
$('pubImportFotos').onclick=()=>$('impF').click();
async function importarFotosCompartilhadas(itens){
  const linhas=Object.entries(itens).filter(([cod,v])=>byCod[cod]&&(typeof v==='string'||Array.isArray(v)));
  let publicadas=0,erros=0;
  for(const [cod,valor] of linhas){
    const lista=typeof valor==='string'?[valor]:valor;
    try{
      if(!lista.length||lista.length>8)continue;
      await publicarFotosProduto(cod,lista);
      publicadas++;
    }catch(e){erros++;}
  }
  render();updSem();
  if(VIEW==='adm')drawAdm();
  toast(publicadas+' produto(s) com fotos publicadas'+(erros?' · '+erros+' falha(s)':'')+'.');
}
$('impF').onchange=async()=>{
  const f=$('impF').files[0];if(!f)return;
  $('impF').value='';
  try{
    const data=JSON.parse(await f.text());
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Arquivo inválido.');
    if(!window.confirm('Publicar as fotos do arquivo para todos os clientes?'))return;
    await importarFotosCompartilhadas(data);
  }catch(e){toast('Erro na importação: '+e.message)}
};
$('pubLocal').onclick=async()=>{
  const pendentes=Object.entries(FOTOS_LOCAIS).filter(([cod,v])=>byCod[cod]&&!OV[cod]&&
    (typeof v==='string'||Array.isArray(v)));
  const ignoradas=Object.keys(FOTOS_LOCAIS).filter(c=>!!OV[c]).length;
  if(!pendentes.length){
    toast(ignoradas?'As fotos destes produtos já estão publicadas. Nada foi substituído.':'Nenhuma foto antiga neste navegador. Se tiver um arquivo, use Importar fotos.');
    return;
  }
  if(!window.confirm('Publicar '+pendentes.length+' produto(s) deste navegador para todos? Produtos já publicados por outros administradores serão preservados.'))return;
  const b=$('pubLocal'),original=b.textContent;
  b.disabled=true;
  let sucesso=0,falhas=0;
  for(let i=0;i<pendentes.length;i++){
    const [cod,v]=pendentes[i],fotos=typeof v==='string'?[v]:v;
    b.textContent='Publicando '+(i+1)+'/'+pendentes.length+'…';
    try{
      if(!fotos.length)continue;
      await publicarFotosProduto(cod,fotos);
      sucesso++;
    }catch(e){falhas++;}
  }
  b.disabled=false;b.textContent=original;
  render();updSem();if(VIEW==='adm')drawAdm();
  toast(sucesso+' produtos publicados'+(falhas?' · '+falhas+' falharam':'')+'.');
};


/* =================== CLIENTES (demonstração) ===================
   Na versão integrada, estes dados vêm do Movimento G360 (via Supabase):
   - lista: produtos que o cliente já comprou (histórico de vendas)
   - pagamentos: condições liberadas no cadastro do cliente */
/* Clientes no painel do administrador: cache preenchido por API.listarClientes(). */
let CLIENTES = {};
const saveClientes=()=>{};

/* ======================================================================
   CAMADA DE SERVIÇOS
   As telas chamam somente API (= window.Servicos). O adaptador é escolhido
   em um único ponto: servicos/configuracao.js. A interface está descrita em
   servicos/contrato.js; o adaptador de demonstração é servicos/adaptador-mock.js.
   ====================================================================== */
const API = window.Servicos;
const DEMO = !!API.demonstracao;
/* Unidades alternativas (ex.: caixa) com preço já calculado pelo serviço: {cod:[{id, nome, fator, preco, etiqueta_preco}]} */
const ALT = SR_BOOT.unidades_alternativas || {};
const unidades = p => [{id:'',nome:p.u,fator:1}, ...(ALT[p.cod]||[])];
const unOf = (p,id) => unidades(p).find(u=>u.id===(id||'')) || unidades(p)[0];
const kOf = (cod,id) => id ? cod+'@'+id : cod;
/* CONFIGURAÇÕES e PREÇOS CONGELADOS (admin) — em produção vêm do backend */
const FERIADOS_PADRAO=[["2026-01-01","Confraternização Universal"],["2026-04-03","Sexta-feira Santa"],["2026-04-21","Tiradentes"],["2026-05-01","Dia do Trabalho"],["2026-06-04","Corpus Christi (Uberlândia)"],["2026-08-15","N. Sra. da Abadia (Uberlândia)"],["2026-08-31","Aniversário de Uberlândia"],["2026-09-07","Independência"],["2026-10-12","N. Sra. Aparecida"],["2026-11-02","Finados"],["2026-11-15","Proclamação da República"],["2026-11-20","Consciência Negra"],["2026-12-25","Natal"],
 ["2027-01-01","Confraternização Universal"],["2027-03-26","Sexta-feira Santa"],["2027-04-21","Tiradentes"],["2027-05-01","Dia do Trabalho"],["2027-05-27","Corpus Christi (Uberlândia)"],["2027-08-15","N. Sra. da Abadia (Uberlândia)"],["2027-08-31","Aniversário de Uberlândia"],["2027-09-07","Independência"],["2027-10-12","N. Sra. Aparecida"],["2027-11-02","Finados"],["2027-11-15","Proclamação da República"],["2027-11-20","Consciência Negra"],["2027-12-25","Natal"]];
const CFG = Object.assign({soEstoque:true, bloquear:true,
  formas:[{id:"pix",nome:"PIX",obs:"Pagamento à vista"},{id:"din",nome:"Dinheiro na entrega",obs:"Pagamento ao receber"},{id:"b14",nome:"Boleto 14 dias",obs:"Vencimento 14 dias após faturamento"},{id:"b28",nome:"Boleto 28 dias",obs:"Vencimento 28 dias após faturamento"},{id:"b2856",nome:"Boleto 28/56 dias",obs:"2 parcelas"}],
  vendedores:["Carlos","Ana"], feriados:FERIADOS_PADRAO, pagPadrao:["pix"], buscaSinonimos:SINONIMOS_PADRAO}, window.__SR_CONFIG || {});
let CONG = {}; // painel admin: preços especiais por cliente (cache de API.buscarCongeladosAdmin)
/* Preços chegam prontos do serviço (preço do cliente, unidade alternativa, especial ou negociado). */
const base = p => p.p;
const etiquetaPreco = (p,un) => (un&&un.id ? (un.etiqueta_preco||'') : (p.etiqueta_preco||''));

const pu = (p,un) => (un&&un.id ? un.preco : p.p);
const fmtQ = n => (+n).toLocaleString('pt-BR',{maximumFractionDigits:2});
const stkHtml = p => p.s<=0 ? '<div class="stk no">Sem estoque</div>' : p.s<10 ? `<div class="stk low">Últimas ${fmtQ(p.s)} ${p.u.toLowerCase()}${p.s>1?'s':''}</div>` : '<div class="stk ok">Em estoque</div>';
const vePreco = () => !!(typeof CLI!=='undefined'&&CLI) || (typeof ADM!=='undefined'&&ADM);
const visivel = p => !p.off && (!CFG.soEstoque || p.s>0);
const econ = (p,un) => { if(!un.id) return ''; const cheio=base(p)*un.fator, v=pu(p,un); return v<cheio-0.004
  ? `Sai ${brl(v/un.fator)} ${p.u.toLowerCase()==='unidade'?'a unidade':'o '+p.u.toLowerCase()} · economize <b>${brl(cheio-v)}</b>` : ''; };
const plur = (s,q) => q>1 ? s.replace(/^(\S+?)(ão)?$/i,(m,a,b)=>b?a+'ões':(/[aeiou]$/i.test(a)?a+'s':a+'es')) : s;
const unTxt = (p,un) => un.id ? `${un.nome} c/ ${un.fator} ${p.u.toLowerCase()}s` : p.u;
const fromK = k => { const [c,id]=k.split('@'); const p=byCod[c]; return p?{p,un:unOf(p,id),k}:null };
const itemsOf = o => Object.entries(o).filter(([k,q])=>q>0).map(([k,q])=>{const x=fromK(k);return x&&{...x,q}}).filter(Boolean);
const lineTot = i => pu(i.p,i.un)*i.q;
const unselHtml = (p,sel,cls='') => ALT[p.cod] ? `<div class="unsel ${cls}">${unidades(p).map(u=>`<button data-un="${u.id}" class="${u.id===(sel||'')?'on':''}">${u.id?`${u.nome} (${u.fator})`:p.u}</button>`).join('')}</div>` : '';
const byCod = Object.fromEntries(P.map(p=>[p.cod,p]));
/* Recarrega preços/estoques/unidades do serviço sem trocar os objetos já usados pelas telas. */
function aplicaCatalogo(cat){
  for(const n of (cat&&cat.produtos)||[]){ const p=byCod[n.cod]; if(!p)continue;
    for(const k of Object.keys(p)) if(!(k in n)) delete p[k];
    Object.assign(p,n);
    if(typeof ORIG!=='undefined')ORIG[p.cod]={t:p.t,m:p.m,c:p.c,u:p.u,p:p.p,d:p.d,ncm:p.ncm||'',tagsBusca:p.tagsBusca||'',alt:null}; }
  Object.keys(ALT).forEach(k=>delete ALT[k]); Object.assign(ALT,(cat&&cat.unidades_alternativas)||{});
  if(typeof ORIG!=='undefined')Object.keys(ALT).forEach(c=>{if(ORIG[c])ORIG[c].alt=JSON.parse(JSON.stringify(ALT[c]))});
}
let catalogoSeq=0;
async function recarregaCatalogo(){
  const seq=++catalogoSeq, cat=await API.catalogo();
  if(seq!==catalogoSeq)return;
  aplicaCatalogo(cat);
  render(); if(CLI)updCart(); if(VIEW==='lista'&&CLI)drawLista(); if(VIEW==='adm'&&ADM){if(AT==='prod')drawAProd();if(AT==='mrg')drawMrg()} updMrgBadge();
}
const LSG=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch(e){return d}};
const LSS=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
let CLI=null, CNPJ=null, CART={};
const fmtD=s=>s?new Date(s+'T12:00').toLocaleDateString('pt-BR'):'—';
const onlyD=s=>s.replace(/\D/g,'');

async function loadCli(c, info){
  CNPJ=c; info=info||{};
  const [rec,lista,pags]=await Promise.all([API.cliente(),API.lista(),API.pagamentos()]);
  CLI={nome:info.razao_social||rec.razao_social, fantasia:info.fantasia||rec.fantasia||rec.razao_social, vendedor:info.vendedor||rec.vendedor, rec,
    pagamentos:pags.map(f=>({id:f.id,nome:f.descricao,obs:f.observacao||''})),
    lista:(lista||[]).map(l=>({cod:l.cod,ult:l.ultima_qtd||0,dt:l.ultima_data||'',med:l.media_qtd||0,sug:l.qtd_sugerida||0})).filter(l=>byCod[l.cod])};
  CART=LSG('sr_b2b_cart_'+c,{}); LQ={}; CLI.lista.forEach(l=>{if(l.sug>0)LQ[kOf(l.cod,'')]=l.sug});
  document.body.classList.add('logged'); drawUser();
  await recarregaCatalogo(); updCart();
  window.SRNegociacao?.onLogin?.();
}
let srListaSync=Promise.resolve();
 const saveLista=()=>{
  if(!CLI||!CNPJ)return;
  const snapshot=CLI.lista.map(l=>({cod:l.cod,ultima_qtd:l.ult||0,ultima_data:l.dt||null,media_qtd:l.med||0,qtd_sugerida:l.sug||0}));
  srListaSync=srListaSync.catch(()=>{}).then(()=>API.salvarMinhaLista(snapshot)).catch(e=>toast('Falha ao salvar Minha Lista: '+e.message));
 };
const saveCart=()=>{LSS('sr_b2b_cart_'+CNPJ,CART);updCart();intelProgramarCarrinho()};
async function sairConta(){ const tarefas=[];
  if(CLI){tarefas.push(API.sairCliente());CLI=null;CNPJ=null;CART={};LQ={};document.body.classList.remove('logged');updCart()}
  if(ADM){tarefas.push(API.sairAdmin());setAdm(false)}
  $('mConta').classList.remove('open'); render(); drawUser(); go('cat'); toast('Você saiu da conta');
  await Promise.allSettled(tarefas); recarregaCatalogo().catch(()=>{}); }
function drawUser(){ saud(); const tc=document.getElementById('tbContaT'); if(tc) tc.textContent=CLI?CLI.fantasia.split(' ')[0]:(ADM?'Admin':'Entrar');
  $('user').innerHTML=(CLI||ADM)?`<b id="uName" style="cursor:pointer" title="Minha conta">${CLI?esc(CLI.fantasia):'Administrador'}</b><a id="sair">Sair</a>`:`<a id="entrar">Entrar</a>`;
  if(CLI||ADM)$('sair').onclick=sairConta; else $('entrar').onclick=()=>openLogin();
  if($('uName'))$('uName').onclick=()=>$('tbConta').click(); }
let afterLogin=null;
let LT='cli';
function setLT(m){LT=m;$('lgCli').hidden=m!=='cli';$('lgAdmT').hidden=m!=='adm';$('lgAdm').hidden=m!=='cli';$('lgEsqL').hidden=m!=='cli';$('lgVolta').hidden=m==='cli';$('lgEsq').hidden=m!=='esq';$('lgS').hidden=m==='esq';$('lgS').previousElementSibling.hidden=m==='esq';$('lgOk').textContent=m==='esq'?'Enviar senha nova':'Entrar';$('lgAdmT').innerHTML=m==='esq'?'<h3 style="margin:8px 0 2px">Recuperar senha</h3>':'<h3 style="margin:8px 0 2px">Acesso do administrador</h3>';if(m==='esq')$('lgAdmT').hidden=false;$('lgVolta').textContent='← Voltar para o login';$('lgL').textContent=m==='adm'?'Usuário':'CNPJ';$('lgC').placeholder=m==='adm'?'Usuário':'00.000.000/0000-00 (pode colar)';$('lgC').inputMode=m==='adm'?'text':'numeric';$('lgE').textContent=''}
$('lgAdm').onclick=()=>setLT('adm');
$('lgEsqL').onclick=()=>setLT('esq'); $('lgVolta').onclick=()=>setLT('cli'); $('lgCad').onclick=()=>{$('mLogin').classList.remove('open');openCad()};
function openLogin(next,modo){setLT(modo||'cli');afterLogin=next||null;$('lgE').textContent='';$('mLogin').classList.add('open');setTimeout(()=>$('lgC').focus(),50)}
$('lgC').addEventListener('input',()=>{if(LT==='adm')return;const dig=onlyD($('lgC').value).slice(0,14);$('lgC').value=dig.length===14?dig.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5'):dig});
 const need=fn=>CLI?fn():openLogin(fn);
$('lgX').onclick=()=>$('mLogin').classList.remove('open');
$('lgS').onkeydown=e=>{if(e.key==='Enter')$('lgOk').click()};
$('lgOk').onclick=async()=>{
  if(LT==='esq'){ const c=onlyD($('lgC').value), em=$('lgEm').value.trim(); if(c.length!==14||!em){$('lgE').textContent='Informe o CNPJ (com ou sem pontuação) e o e-mail do cadastro.';return}
    $('lgOk').disabled=true; $('lgE').textContent='';
    try{ const j=await API.recuperarSenha(c,em); $('lgEsqM').innerHTML='<b style="color:#8fd14f">✓ '+esc(j.mensagem||'Solicitação registrada.')+'</b>'; }
    catch(e){ $('lgE').textContent=e.message||'Não foi possível enviar agora.' } $('lgOk').disabled=false; return; }
  if(LT==='adm'){ try{ await API.loginAdmin($('lgC').value.trim(),$('lgS').value) }catch(e){ $('lgE').textContent=e.message; return }
    setAdm(true); $('mLogin').classList.remove('open'); $('lgS').value=''; carregaClientesAdm().catch(()=>{}); recarregaCatalogo().catch(()=>{}); toast('Modo administrador ativado'); const f=afterLogin; afterLogin=null; render(); if(f)f(); else go('adm'); return; }
  const c=onlyD($('lgC').value), s=$('lgS').value; let cl;
  try{ cl=await API.login(c,s) }catch(e){ $('lgE').textContent=e.message; return }
  await loadCli(cl.cnpj||c,cl); $('mLogin').classList.remove('open'); render(); toast('Bem-vindo, '+cl.fantasia+'!');
  const f=afterLogin; afterLogin=null; if(f)f(); };

/* ---------- navegação ---------- */
let VIEW='cat';
function go(v,arg){ if(v==='adm'&&!ADM){openLogin(()=>go(v),'adm');return}
  if((v==='lista'||v==='ped')&&!CLI){openLogin(()=>go(v));return}
  VIEW=v; document.querySelectorAll('.hb[data-v],.tabbar [data-v]').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  const map={cat:'vCat',lista:'vLista',ped:'vPed',adm:'vAdm',clips:'vClips'}; document.body.classList.toggle('clipsmode',v==='clips'); if(v!=='clips')pauseClips(); document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==map[v]);
  document.querySelector('header nav').style.display=v==='cat'?'':'none';
  if(v==='lista')drawLista(); if(v==='ped'){drawPed();window.SRNegociacao?.renderClient();} if(v==='adm')drawAdm(); window.scrollTo(0,0); if(v==='clips')drawClips(arg); }
document.querySelectorAll('.hb[data-v],.tabbar [data-v]').forEach(b=>b.onclick=()=>go(b.dataset.v));

/* ---------- catálogo: quantidade / adicionar / lista ---------- */
function cardClick(e){
  const card=e.target.closest('.card'); if(!card)return; const p=P[card.dataset.i];
  if(e.target.closest('[data-lock]')){openLogin();return}
  if(e.target.closest('.eye')||((e.target.closest('.img')||e.target.closest('.name'))&&!e.target.closest('.fav'))){openDet(p);return}
  if(e.target.dataset.un!==undefined){ const un=unOf(p,e.target.dataset.un); card.dataset.un=un.id;
    card.querySelectorAll('.unsel button').forEach(b=>b.classList.toggle('on',b===e.target));
    card.querySelector('.price').innerHTML=`<b>${brl(pu(p,un))}</b><small>/ ${unTxt(p,un).toLowerCase()}</small>${etiquetaPreco(p,un)?'<span class="tagcg">'+esc(etiquetaPreco(p,un))+'</span>':''}`; card.querySelector('.ueq').innerHTML=econ(p,un); return }
  const d=e.target.dataset.d; if(d){const i=card.querySelector('.qty input'); i.value=Math.max(1,(+i.value||1)+(+d)); return}
  if(e.target.closest('.add')){ need(()=>{const q=Math.max(1,+card.querySelector('.qty input').value||1); addCart(p.cod,q,card.dataset.un||''); card.querySelector('.qty input').value=1}); return }
  if(e.target.classList.contains('fav')){ need(()=>{toggleLista(p.cod); render()}); return }
}
function toggleLista(cod){const i=CLI.lista.findIndex(l=>l.cod===cod);
  if(i>=0){CLI.lista.splice(i,1);toast('Removido da Minha Lista')} else {CLI.lista.push({cod,ult:0,dt:'',med:0});toast('Adicionado à Minha Lista ⭐')} saveLista();}
const qtdBase = (obj,cod) => itemsOf(obj).filter(i=>i.p.cod===cod).reduce((s,i)=>s+i.q*i.un.fator,0);
function avisoEst(p,qb){ if(qb<=p.s) return ''; return `<div class="warn ${CFG.bloquear?'bad':''}">⚠ Disponível: <b>${fmtQ(p.s)} ${p.u.toLowerCase()}${p.s>1?'s':''}</b> — você pediu ${fmtQ(qb)}</div>`; }
const excede = obj => [...new Set(itemsOf(obj).map(i=>i.p.cod))].map(c=>byCod[c]).filter(p=>qtdBase(obj,p.cod)>p.s);
function addCart(cod,q,un=''){const k=kOf(cod,un);CART[k]=(CART[k]||0)+q;saveCart();intelEvento('adicionado',cod);const p=byCod[cod];
  if(qtdBase(CART,cod)>p.s){toast(`⚠ Só temos ${fmtQ(p.s)} ${p.u.toLowerCase()}(s) de ${p.t.slice(0,30)}… disponíveis`);return}
  toast(`${q} ${unTxt(p,unOf(p,un)).toLowerCase()} · ${p.t.slice(0,34)}… no carrinho`)}

/* ---------- carrinho ---------- */
const cartItems=()=>itemsOf(CART);
const cartTot=()=>cartItems().reduce((s,i)=>s+lineTot(i),0);
function updCart(){const n=cartItems().length;$('cartN').textContent=n||'';drawCart()}
function drawCart(){const it=cartItems();
  $('dBody').innerHTML=it.length?it.map(({p,q,un,k})=>`<div class="ci" data-c="${k}"><img src="${imgUrl(p)}" referrerpolicy="no-referrer" onerror="this.src=ph(byCod['${p.cod}'])">
    <div class="n">${esc(p.t)}<small>${brl(pu(p,un))} / ${unTxt(p,un).toLowerCase()}${etiquetaPreco(p,un)?` <span class="neg-tag">${esc(etiquetaPreco(p,un))}</span>`:''}</small>
    <div class="qty" style="margin-top:6px;width:max-content"><button data-d="-1">−</button><input type="number" min="0" value="${q}"><button data-d="1">+</button></div></div>
    ${avisoEst(p,qtdBase(CART,p.cod))}
    <div class="r">${brl(pu(p,un)*q)}<br><button class="x">Remover</button></div></div>`).join(''):'<div class="empty2">Seu carrinho está vazio.</div>';
  $('dTot').textContent=brl(cartTot()); $('dGo').disabled=!it.length;
  $('dGo').textContent='Revisar pedido';
  $('dNeg').disabled=!it.length;}
$('dBody').addEventListener('click',e=>{const r=e.target.closest('.ci');if(!r)return;const c=r.dataset.c;
  if(e.target.dataset.d){CART[c]=Math.max(0,(CART[c]||0)+(+e.target.dataset.d));if(!CART[c])delete CART[c];saveCart()}
  if(e.target.classList.contains('x')){delete CART[c];saveCart()}});
$('dBody').addEventListener('change',e=>{const r=e.target.closest('.ci');if(!r)return;const v=Math.max(0,+e.target.value||0);if(v)CART[r.dataset.c]=v;else delete CART[r.dataset.c];saveCart()});
const openCart=()=>need(()=>{drawCart();$('drawer').classList.add('open');$('shade').classList.add('open')});
const closeCart=()=>{$('drawer').classList.remove('open');$('shade').classList.remove('open')};
$('cartBtn').onclick=openCart; $('dClose').onclick=closeCart; $('shade').onclick=closeCart;
$('dGo').onclick=()=>{closeCart();checkout(cartItems(),'carrinho')};
 $('dNeg').onclick=()=>{closeCart();window.SRNegociacao?.openFrom('carrinho')};

/* ---------- Minha Lista ---------- */
let LQ={}, LU={}; // quantidades e unidade escolhida na lista
function drawLista(){
  const L=CLI.lista.map(l=>({...l,p:byCod[l.cod]})).filter(x=>x.p&&!x.p.off).sort((a,b)=>a.p.t.localeCompare(b.p.t,'pt'));
  $('lSub').textContent=`${CLI.nome} · ${L.length} produtos que você já compra. Informe as quantidades e adicione ao carrinho ou feche o pedido direto daqui.`;
  if(!L.length){$('lPanel').innerHTML='<div class="empty2">Sua lista está vazia. No catálogo, clique em ☆ Lista para adicionar produtos.</div>';return}
  $('lPanel').innerHTML=`<div class="lrow h"><div></div><div>Produto</div><div>Histórico</div><div>Preço</div><div>Quantidade</div><div style="text-align:right">Subtotal</div></div>`+
   L.map(x=>{const un=unOf(x.p,LU[x.cod]), q=LQ[kOf(x.cod,un.id)]||0;return `<div class="lrow ${q?'sel':''}" data-c="${x.cod}"><img src="${imgUrl(x.p)}" referrerpolicy="no-referrer" onerror="this.src=ph(byCod['${x.cod}'])">
     <div class="nm">${esc(x.p.t)}<small>Cód. ${esc(x.cod)} · ${esc(x.p.m||'')}</small>${stkHtml(x.p)}${unselHtml(x.p,un.id,'sm')}<div class="lw">${avisoEst(x.p,qtdBase(LQ,x.cod))}</div></div>
     <div class="hist">${x.dt?`Última compra: <b>${x.ult}</b> em ${fmtD(x.dt)}<br>Média: ${x.med} ${x.p.u.toLowerCase()}${x.med>1?'s':''}/pedido`:'Adicionado por você'}${x.sug?'<br>Quantidade sugerida: <b>'+x.sug+'</b>':''}</div>
     <div class="pr">${brl(pu(x.p,un))}<small>/ ${unTxt(x.p,un).toLowerCase()}</small>${econ(x.p,un)?`<div class="ueq">${econ(x.p,un).replace(' · ','<br>')}</div>`:''}</div>
     <div class="qty"><button data-d="-1">−</button><input type="number" min="0" value="${q||''}" placeholder="0"><button data-d="1">+</button></div>
     <div class="sub2">${q?brl(q*pu(x.p,un)):'—'}</div></div>`}).join('')+
   `<div class="sticky"><div class="tt"><span id="lN"></span> Total:<b id="lT"></b></div>
     <button class="btn out" id="lClr">Limpar</button><button class="btn out" id="lAdd">Adicionar ao carrinho</button><button class="btn out" id="lNeg">🤝 Negociar valores</button><button class="btn pri" id="lBuy">Fechar pedido agora</button></div>`;
  updLista();
  $('lClr').onclick=()=>{LQ={};drawLista()};
  $('lAdd').onclick=()=>{const it=listaItems(); it.forEach(i=>CART[i.k]=(CART[i.k]||0)+i.q); saveCart(); LQ={}; drawLista(); toast(it.length+' produtos adicionados ao carrinho'); openCart()};
  $('lBuy').onclick=()=>checkout(listaItems(),'lista');
   $('lNeg').onclick=()=>window.SRNegociacao?.openFrom('lista');
}
const listaItems=()=>itemsOf(LQ);
function updLista(){const it=listaItems(),tot=it.reduce((s,i)=>s+lineTot(i),0);
  $('lN').textContent=it.length?it.length+' itens ·':'Nenhum item ·'; $('lT').textContent=brl(tot); $('lAdd').disabled=$('lBuy').disabled=!it.length; $('lNeg').disabled=!it.length;}
const rowK=row=>{const c=row.dataset.c;return kOf(c,unOf(byCod[c],LU[c]).id)};
function setLQ(row,v){const c=row.dataset.c,un=unOf(byCod[c],LU[c]),k=kOf(c,un.id);v=Math.max(0,v|0);if(v)LQ[k]=v;else delete LQ[k];
  row.querySelector('.qty input').value=v||'';row.querySelector('.lw').innerHTML=avisoEst(byCod[c],qtdBase(LQ,c));row.querySelector('.sub2').textContent=v?brl(v*pu(byCod[c],un)):'—';row.classList.toggle('sel',!!v);updLista()}
$('lPanel').addEventListener('click',e=>{const r=e.target.closest('.lrow[data-c]');if(r&&e.target.tagName==='IMG'){openDet(byCod[r.dataset.c]);return}if(r&&e.target.dataset.un!==undefined){const c=r.dataset.c,old=rowK(r),q=LQ[old]||0;delete LQ[old];LU[c]=e.target.dataset.un;if(q)LQ[rowK(r)]=q;drawLista();return}
  if(r&&e.target.dataset.d)setLQ(r,(LQ[rowK(r)]||0)+(+e.target.dataset.d))});
$('lPanel').addEventListener('input',e=>{const r=e.target.closest('.lrow[data-c]');if(r)setLQ(r,+e.target.value||0)});
$('lRep').onclick=async()=>{let peds=[];try{peds=await API.pedidos()}catch(e){} LQ={};
  if(peds.length) peds[0].itens.forEach(i=>{LU[i.cod]=i.un_id||'';LQ[kOf(i.cod,i.un_id)]=i.q}); else CLI.lista.forEach(l=>{if(l.ult)LQ[l.cod]=l.ult});
  drawLista(); toast('Quantidades do último pedido preenchidas — confira e feche o pedido')};

/* ---------- revisão e envio do pedido ----------
   A tela envia ao serviço SOMENTE as escolhas do comprador (itens, unidade, quantidade,
   endereço, condição de pagamento e observação) e exibe preços, conversões, totais,
   condições e prazo exatamente como o serviço devolver. */
let CHK=null;
const escolhasItens=itens=>itens.map(i=>({cod:i.p.cod,unidade:i.un.id||'',quantidade:i.q}));
const ends=()=>[{id:'cad',apelido:'Endereço do cadastro',...CLI.rec},...(CLI.rec.enderecos||[])];
const demoTag=t=>DEMO?`<span class="demo-tag">${t||'Demonstração'}</span>`:'';
function checkout(itens,origem){ if(!itens.length)return;
  CHK={itens,origem,endereco_id:'cad',pagamento_id:null,observacao:'',revisao:null,carregando:false,erroEnvio:null};
  intelIniciarCheckout(itens,origem);
  $('mChk').classList.add('open'); revisar();
}
async function revisar(){
  if(!CHK)return; const atual=CHK; atual.carregando=true; atual.revisao=null; atual.erroEnvio=null; drawRevisao();
  try{ const r=await API.revisarPedido({origem:atual.origem,itens:escolhasItens(atual.itens),endereco_id:atual.endereco_id});
    if(CHK!==atual)return; atual.revisao=r; atual.endereco_id=(r.entrega&&r.entrega.endereco_id)||atual.endereco_id;
    if(!(r.condicoes_pagamento||[]).some(c=>c.id===atual.pagamento_id))atual.pagamento_id=(r.condicoes_pagamento||[]).length===1?r.condicoes_pagamento[0].id:null; }
  catch(e){ if(CHK!==atual)return; atual.erroRevisao=e.message; }
  atual.carregando=false; if(CHK===atual)drawRevisao();
}
function guardaCamposRevisao(){ if(!CHK)return; const o=$('cObs'); if(o)CHK.observacao=o.value; const pg=document.querySelector('input[name=pg]:checked'); if(pg)CHK.pagamento_id=pg.value; }
function drawRevisao(){ const c=CHK, r=c.revisao, cab=`<h3>Revisar pedido ${demoTag()}</h3><div class="sub">${esc(CLI.nome)} · CNPJ ${fmtCNPJ(CNPJ)}</div>`;
  if(c.carregando){ $('chkBox').innerHTML=cab+'<div class="empty2">Calculando valores com o serviço…</div><div class="act"><button class="btn sec" id="cX">Voltar</button></div>'; $('cX').onclick=fechaChk; return }
  if(!r){ $('chkBox').innerHTML=cab+`<div class="err">Não foi possível revisar o pedido: ${esc(c.erroRevisao||'erro desconhecido')}</div><div class="act"><button class="btn sec" id="cX">Voltar</button><button class="btn pri" id="cRt">Tentar novamente</button></div>`; $('cX').onclick=fechaChk; $('cRt').onclick=revisar; return }
  const E=ends(), conds=r.condicoes_pagamento||[], ent=r.entrega||{};
  $('chkBox').innerHTML=cab+
   (r.avisos||[]).map(a=>`<div class="rv-aviso ${a.tipo==='erro'?'bad':''}">${esc(a.texto)}</div>`).join('')+
   `<div class="rv">${(r.itens||[]).map(i=>`<div class="rvl"><span>${esc(i.quantidade_texto||String(i.quantidade))} · ${esc(i.descricao)}
      <small>${brl(i.preco_unitario)} por ${esc((i.unidade||'').toLowerCase())}${i.conversao?' · '+esc(i.conversao):''}${i.etiqueta_preco?' · <b class="rv-et">'+esc(i.etiqueta_preco)+'</b>':''}</small>
      ${i.aviso?`<small class="rv-av">⚠ ${esc(i.aviso)}</small>`:''}</span><b>${brl(i.total)}</b></div>`).join('')}</div>
   <div class="rv-tot">${(r.totais||[]).map(t=>`<div><span>${esc(t.rotulo)}</span><span>${brl(t.valor)}</span></div>`).join('')}
     <div class="rv-final"><span>${(r.itens||[]).length} itens</span><span>Total <b>${brl(r.total)}</b></span></div></div>
   <label>Endereço de entrega</label><div id="cEnd">${E.map(x=>`<label class="addr"><input type="radio" name="en" value="${x.id}" ${x.id===c.endereco_id?'checked':''}><span><b>${esc(x.apelido||'Endereço')}</b><small>${esc(endTxt(x))}</small></span></label>`).join('')}
     <button class="addu" id="qAdd" style="margin-bottom:6px">+ Entregar em outro endereço</button></div>
   <div class="prev ${ent.previsao?'':'out'}"><svg class="ic" viewBox="0 0 24 24"><path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg><div><b>${esc(ent.previsao||'Prazo a confirmar')}</b><small>${esc(ent.observacao||'')}</small></div></div>
   <label>Condição de pagamento</label>
   <div class="pay">${!conds.length?'<div class="err">Nenhuma condição de pagamento disponível para sua empresa. Fale com seu vendedor.</div>':''}${conds.map(f=>`<label><input type="radio" name="pg" value="${esc(f.id)}" ${f.id===c.pagamento_id?'checked':''}><span>${esc(f.descricao)}<small>${esc(f.observacao||'')}</small></span></label>`).join('')}</div>
   <label>Observação (opcional)</label><textarea id="cObs" rows="2" maxlength="500" placeholder="Ex.: entregar pela manhã, falar com João">${esc(c.observacao||'')}</textarea>
   ${DEMO&&API.demo?`<div class="demo-box"><b>Cenário da demonstração</b><select id="cCen">${API.demo.cenariosEnvio.map(x=>`<option value="${x.id}" ${x.id===API.demo.cenarioEnvio()?'selected':''}>${esc(x.nome)}</option>`).join('')}</select><small>Escolha o resultado do envio simulado.</small></div>`:''}
   ${c.erroEnvio?`<div class="rv-falha"><b>Não foi possível enviar o pedido</b><span>${esc(c.erroEnvio)}</span><small>Seus itens continuam no ${c.origem==='carrinho'?'carrinho':'Minha Lista'}.</small></div>`:''}
   <div class="err" id="cErr"></div>
   <div class="act"><button class="btn sec" id="cX">Voltar</button><button class="btn pri" id="cOk" ${r.pode_enviar?'':'disabled'}>${c.erroEnvio?'Tentar novamente':'Confirmar pedido'}</button></div>`;
  $('cX').onclick=fechaChk; $('cOk').onclick=confirmar;
  document.querySelectorAll('input[name=en]').forEach(x=>x.onchange=()=>{guardaCamposRevisao();CHK.endereco_id=x.value;revisar()});
  document.querySelectorAll('input[name=pg]').forEach(x=>x.onchange=()=>{CHK.pagamento_id=x.value;$('cErr').textContent=''});
  if($('cCen'))$('cCen').onchange=e=>API.demo.definirCenarioEnvio(e.target.value);
  $('qAdd').onclick=()=>{guardaCamposRevisao();drawNovoEndChk()};
}
function drawNovoEndChk(){
  $('cEnd').innerHTML=`<div class="panel" style="padding:12px 14px;margin-bottom:8px"><label style="margin-top:0">Nome do endereço</label><input class="inp" id="qAp" placeholder="Ex.: Filial Centro">${addrFields('q')}<div class="err" id="qE"></div><div class="act" style="margin-top:10px"><button class="btn sec" id="qC">Cancelar</button><button class="btn pri" id="qOk">Salvar e usar</button></div></div>`;
  bindCep('q'); $('qC').onclick=drawRevisao; $('qOk').onclick=()=>salvarNovoEnd('q',$('qAp').value,id=>{CHK.endereco_id=id;revisar()});
}
const fechaChk=()=>{$('mChk').classList.remove('open');CHK=null};
async function confirmar(){
  const c=CHK; if(!c||!c.revisao)return; guardaCamposRevisao();
  if(!c.pagamento_id){$('cErr').textContent='Selecione a condição de pagamento.';return}
  $('cOk').disabled=true; $('cOk').textContent='Enviando…'; $('cErr').textContent='';
  let r;
  try{ r=await API.criarPedido({revisao_id:c.revisao.revisao_id,origem:c.origem,itens:escolhasItens(c.itens),endereco_id:c.endereco_id,pagamento_id:c.pagamento_id,observacao:(c.observacao||'').trim()}); }
  catch(e){ if(CHK!==c)return; c.erroEnvio=e.message||'Falha no envio.';
    if(e.codigo==='revisao'){ toast(c.erroEnvio); revisar(); return }
    drawRevisao(); return }
  if(CHK!==c)return;
  if(c.origem==='carrinho'){CART={};saveCart()} else LQ={};
  intelConcluirSimulacao();
  try{ const l=await API.lista(); CLI.lista=(l||[]).map(x=>({cod:x.cod,ult:x.ultima_qtd||0,dt:x.ultima_data||'',med:x.media_qtd||0,sug:x.qtd_sugerida||0})).filter(x=>byCod[x.cod]); }catch(e){}
  const end=r.endereco||{};
  $('chkBox').innerHTML=`<div class="ok"><div class="ic2">✓</div><h3>${esc(r.mensagem||'Pedido enviado')}</h3>${demoTag('Demonstração · nenhum pedido real foi enviado')}
    <p>Número ${DEMO?'simulado':''}: <b>${esc(r.numero)}</b><br>Total de <b>${brl(r.total)}</b>${r.pagamento?' · '+esc(r.pagamento):''}<br>${r.previsao?'Entrega: <b>'+esc(r.previsao)+'</b>':''}${end.apelido?' · '+esc(end.apelido):''}</p></div>
    <div class="act" style="justify-content:center"><button class="btn sec" id="okP">Ver meus pedidos</button><button class="btn pri" id="okC">Continuar comprando</button></div>`;
  $('okP').onclick=()=>{fechaChk();go('ped')}; $('okC').onclick=()=>{fechaChk();go('cat')};
  if(!$('vLista').hidden)drawLista();
}

/* ---------- Meus Pedidos (histórico) ---------- */
let PEDS=[];
async function drawPed(){ $('pPanel').innerHTML='<div class="empty2">Carregando pedidos…</div>';
  try{ PEDS=await API.pedidos(); }catch(e){ $('pPanel').innerHTML=`<div class="empty2">Não foi possível carregar os pedidos: ${esc(e.message)}</div>`; return }
  $('pPanel').innerHTML=(DEMO?'<div class="rv-aviso">Histórico de demonstração: pedidos simulados, gravados só neste navegador.</div>':'')+(PEDS.length?PEDS.map(p=>`<div class="ped"><div><b>${esc(p.numero)}</b> <span class="st">${esc(p.status)}</span>${p.demonstracao?' '+demoTag():''}
    <div class="m">${new Date(p.criado_em).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})} · ${p.itens.length} itens · ${esc((p.pagamento||{}).descricao||'')}</div></div>
    <div class="v">${brl(p.total)}</div>
    <details><summary>Ver itens</summary><div class="rv">${p.itens.map(i=>`<div><span>${i.q} ${esc((i.unidade||'').toLowerCase())} · ${esc(i.descricao)}</span><b>${brl(i.total)}</b></div>`).join('')}</div>
    ${p.endereco?`<div class="m">Entrega: ${esc(p.endereco.apelido||'')} · ${esc(endTxt(p.endereco))}${p.previsao?' · '+esc(p.previsao):''}</div>`:''}${p.observacao?`<div class="m">Obs.: ${esc(p.observacao)}</div>`:''}<button class="tool" data-rep="${esc(p.numero)}" style="margin-top:8px">↻ Comprar de novo</button></details></div>`).join('')
    :'<div class="empty2">Você ainda não fez pedidos pelo portal.</div>');}
$('pPanel').addEventListener('click',e=>{const n=e.target.dataset.rep;if(!n)return;const p=PEDS.find(x=>x.numero===n);if(!p)return;
  LQ={};p.itens.forEach(i=>{if(!byCod[i.cod])return;LU[i.cod]=i.un_id||'';LQ[kOf(i.cod,i.un_id)]=i.q});go('lista');toast('Itens do pedido '+n+' preenchidos na Minha Lista')});

/* =================== ADMINISTRADOR =================== */
let ADM = !!window.__SR_SESSAO_ADMIN; // sessão do admin informada pelo serviço
const ORIG = Object.fromEntries(P.map(p=>[p.cod,{t:p.t,m:p.m,c:p.c,u:p.u,p:p.p,d:p.d,ncm:p.ncm||'',tagsBusca:p.tagsBusca||'',alt:ALT[p.cod]?JSON.parse(JSON.stringify(ALT[p.cod])):null}]));
let PADM = {}; // alterações do admin ainda não confirmadas pelo serviço
function aplicaOv(cod){ const p=byCod[cod], o=ORIG[cod], v=PADM[cod]||{};
  ['t','m','c','u','p','d','ncm','tagsBusca'].forEach(k=>p[k]=v[k]??o[k]); p.off=!!v.off;
  const alt=v.alt!==undefined?v.alt:o.alt; if(alt&&alt.length)ALT[cod]=alt; else delete ALT[cod];
  p.f=p.f.map(([k,x])=>[k, k==='Marca'?p.m : k==='Vendido por'?p.u : k==='Categoria'?p.c : x]); }

const salvaPADM=()=>{};
const salvaCfg=()=>API.salvarConfig(CFG).then(()=>true).catch(e=>{toast('Configuração não salva: '+e.message);return false});
const salvaCong=()=>{};
async function sincronizaCongeladosCliente(){ if(CLI)await recarregaCatalogo(); }
let cargaCongAdmin=0;
async function sincronizaCongeladosAdmin(cnpj){
  if(!cnpj)return;
  const chave=++cargaCongAdmin;
  $('cgPanel').innerHTML='<div class="empty2">Carregando preços personalizados…</div>';
  try{
    const dados=await API.buscarCongeladosAdmin(cnpj);
    if(chave!==cargaCongAdmin||$('cgCli').value!==cnpj)return;
    CONG[cnpj]=dados||{};drawCong();
  }catch(e){
    if(chave!==cargaCongAdmin)return;
    $('cgPanel').innerHTML='<div class="empty2">Não foi possível carregar os preços personalizados: '+esc(e.message)+'</div>';
  }
}
let gravandoCongelado=false;
async function alterarCongelado(cnpj,cod,preco){
  if(gravandoCongelado)return;
  gravandoCongelado=true;
  const a=$('cgAdd');if(a)a.disabled=true;
  try{
    const dados=await API.salvarPrecoCongelado(cnpj,cod,preco);
    CONG[cnpj]=dados||{};salvaCong();
    drawCong();updMrgBadge();render();
    if(CNPJ===cnpj&&CLI)await recarregaCatalogo();
    toast(preco===null?'Preço congelado removido ✓':'Preço congelado salvo para o cliente ✓');
    return true;
  }catch(e){toast('Erro ao salvar no servidor: '+e.message);await sincronizaCongeladosAdmin(cnpj);return false}
  finally{gravandoCongelado=false;if(a)a.disabled=false}
}
const margem=(preco,custo)=>preco>0&&custo>0?(preco-custo)/preco*100:null;
const mgCls=m=>m==null?'':m<CFG.margemMin?'bad':m<CFG.margemMin+10?'mid':'ok';
if(CFG.margemMin==null)CFG.margemMin=25;
function setAdm(on){ ADM=on; document.body.classList.toggle('admin',on);
  if(!on){ document.body.classList.remove('edit'); $('edt').classList.remove('on'); $('mod').classList.remove('open'); $('mAdm').classList.remove('open'); render(); } drawUser(); if(on)setTimeout(()=>window.SRNegociacao?.carregaAdmin?.(),300) }
function alertasMargem(){ const L=[], lim=CFG.margemMin;
  P.forEach(p=>{ if(!(p.k>0))return;
    const m=margem(p.p,p.k); L.push({p,src:'Preço de tabela',tipo:'tab',preco:p.p,custo:p.k,m});
    (ALT[p.cod]||[]).forEach(u=>{const pr=u.preco??p.p*u.fator; L.push({p,src:`${u.nome} c/ ${u.fator}`,tipo:'alt',preco:pr,custo:p.k*u.fator,m:margem(pr,p.k*u.fator)})});
    Object.entries(CONG).forEach(([cn,o])=>{ if(o[p.cod]!=null){const cl=CLIENTES[cn]; L.push({p,src:'Congelado · '+(cl?cl.fantasia:cn),tipo:'cg',preco:o[p.cod],custo:p.k,m:margem(o[p.cod],p.k)})} });
  });
  return {todos:L, baixo:L.filter(x=>x.m!=null&&x.m<lim).sort((a,b)=>a.m-b.m)}; }
function updMrgBadge(){ const pend=Object.values(CLIENTES).filter(c=>c.status==='pendente').length, n=alertasMargem().baixo.length+pend; $('mrgN').textContent=alertasMargem().baixo.length||''; $('cliN').textContent=pend||''; document.querySelectorAll('[data-v=adm]').forEach(b=>{let s=b.querySelector('.bdg2'); if(!s){s=document.createElement('b');s.className='bdg bdg2';b.style.position='relative';b.appendChild(s)} s.textContent=n||''}); }
let AT='prod';
function drawAdm(){ document.querySelectorAll('[data-at]').forEach(b=>b.classList.toggle('on',b.dataset.at===AT));
  $('atCli').hidden=AT!=='cli'; $('atProd').hidden=AT!=='prod'; $('atCong').hidden=AT!=='cong'; $('atMrg').hidden=AT!=='mrg'; $('atIntel').hidden=AT!=='intel'; $('atNeg').hidden=AT!=='neg'; $('atSouzinha').hidden=AT!=='souzinha'; $('atCfg').hidden=AT!=='cfg';
  if(AT==='cli')drawCli(); if(AT==='prod')drawAProd(); if(AT==='cong')sincronizaCongeladosAdmin($('cgCli').value); if(AT==='mrg')drawMrg(); if(AT==='intel')drawIntel(); if(AT==='neg')window.SRNegociacao?.renderAdmin(); if(AT==='souzinha')window.SouzinhaEscola?.load(); if(AT==='cfg')drawCfg(); updMrgBadge(); }
document.querySelectorAll('[data-at]').forEach(b=>b.onclick=()=>{AT=b.dataset.at;drawAdm()});
$('aCat').innerHTML+=Object.keys(cats).sort().map(c=>`<option>${c}</option>`).join('');
['aQ','aCat','aSt'].forEach(id=>$(id).addEventListener('input',drawAProd));
function drawAProd(){ const q=norm($('aQ').value.trim()), c=$('aCat').value, st=$('aSt').value;
  const L=P.filter(p=>(!c||p.c===c)&&(!q||q.split(/\s+/).every(w=>norm(p.t+' '+p.m+' '+p.cod).includes(w)))&&
    (!st||(st==='alt'&&ALT[p.cod])||(st==='mod'&&PADM[p.cod])||(st==='off'&&p.off))).sort((a,b)=>a.t.localeCompare(b.t,'pt'));
  $('aPanel').innerHTML=`<div class="arow h"><div></div><div>Produto (${L.length})</div><div>Preço</div><div>Unid. alternativa</div><div>No catálogo</div><div></div></div>`+
   L.map(p=>{const m=margem(p.p,p.k);return `<div class="arow ${p.off?'off':''}" data-c="${p.cod}"><img src="${imgUrl(p)}" referrerpolicy="no-referrer" onerror="this.src=ph(byCod['${p.cod}'])">
    <div class="nm">${esc(p.t)}${PADM[p.cod]?'<span class="mk">alterado</span>':''}<small>Cód. ${esc(p.cod)} · ${esc(p.u)} · estoque ${fmtQ(p.s)} · <span class="mg ${mgCls(m)}" style="font-size:11px">${m==null?'sem custo':'margem '+m.toFixed(1)+'%'}</span></small></div>
    <div class="pin"><span>R$</span><input type="number" step="0.01" value="${p.p.toFixed(2)}" data-pr></div>
    <div class="uns">${(ALT[p.cod]||[]).map(u=>`<b>${esc(u.nome)}</b> c/ ${u.fator}${u.preco?' · '+brl(u.preco):''}`).join('<br>')||'—'}</div>
    <div class="tgw"><button class="tg ${p.off?'':'on'}" data-tg title="Mostrar no catálogo"></button></div>
    <button class="tool ab" data-ed>Editar</button></div>`}).join('');
}
$('aPanel').addEventListener('click',async e=>{const r=e.target.closest('.arow[data-c]');if(!r)return;const cod=r.dataset.c;
  if(e.target.closest('[data-ed]')||e.target.tagName==='IMG'){openAdmEd(cod);return}
  if(e.target.closest('[data-tg]')){PADM[cod]={...(PADM[cod]||{}),off:!byCod[cod].off};const ok=await salvaAdm(cod);drawAProd();if(ok)toast('Visibilidade salva para todos ✓')}});
$('aPanel').addEventListener('change',async e=>{if(!e.target.matches('[data-pr]'))return;const cod=e.target.closest('.arow').dataset.c,v=+e.target.value;
  if(v>0){PADM[cod]={...(PADM[cod]||{}),p:+v.toFixed(2)};const ok=await salvaAdm(cod);if(ok)toast('Preço publicado: '+brl(v));drawAProd()}});
async function salvaAdm(cod){
  try{
    await API.salvarProduto(cod,PADM[cod]??{});
    delete PADM[cod]; await recarregaCatalogo();
    return true;
  }catch(e){
    delete PADM[cod]; aplicaOv(cod);
    toast('Não foi salvo: '+e.message);render();updMrgBadge();
    return false;
  }
}
/* edição completa */
let AE=null;
function openAdmEd(cod){ const p=byCod[cod]; AE={cod,alt:JSON.parse(JSON.stringify(ALT[cod]||[]))};
  $('admBox').innerHTML=`<h3>Editar produto</h3><div class="sub">Cód. ${esc(cod)}${p.e?' · EAN '+p.e:''} · custo ${p.k>0?brl(p.k):'não informado'} · estoque ${fmtQ(p.s)}</div>
   <div class="fgrid"><div class="full"><label>Nome no portal</label><input class="inp" id="eT" value="${esc(p.t)}"></div>
    <div><label>Marca</label><input class="inp" id="eM" value="${esc(p.m||'')}"></div>
    <div><label>Categoria</label><select class="inp" id="eC">${Object.keys(cats).sort().map(c=>`<option ${c===p.c?'selected':''}>${c}</option>`).join('')}</select></div>
    <div><label>Unidade padrão</label><input class="inp" id="eU" value="${esc(p.u)}"></div>
    <div><label>NCM (8 dígitos)</label><input class="inp" id="eNcm" inputmode="numeric" maxlength="10" placeholder="0000.00.00" value="${esc(p.ncm||'')}"><small>Conforme cadastro fiscal do produto.</small></div>
    <div><label>Preço (R$)</label><input class="inp" id="eP" type="number" step="0.01" value="${p.p.toFixed(2)}"><div class="uprev" id="ePm"></div></div>
    <div class="full"><label>Descrição</label><textarea id="eD" rows="4">${esc(p.d||'')}</textarea></div>
    <div class="full"><label>Palavras-chave para busca</label><input class="inp" id="eBusca" placeholder="Ex.: açaí, copo para sobremesa, milkshake" value="${esc(p.tagsBusca||'')}"><small>Termos pelos quais o cliente procura o produto, separados por vírgula. Não alteram o nome nem a descrição.</small></div></div>
   <label>Unidades alternativas</label>
   <div class="uhd"><span>Nome</span><span>Sigla</span><span>Fator</span><span>Preço (opcional)</span><span></span></div>
   <div id="eAlt"></div><button class="addu" id="eAddU">+ Adicionar unidade (ex.: Caixa)</button>
   <label>Clips (vídeos do produto)</label>
   <div class="eclips" id="eClips"></div>
   <div class="cadd"><label class="drop" id="cDrop"><input type="file" id="cFile" accept="video/*" multiple hidden>
     <svg class="ic" viewBox="0 0 24 24"><rect x="5" y="2.5" width="14" height="19" rx="3"/><path d="m10.5 9.2 4 2.8-4 2.8z" fill="currentColor"/></svg>
     <span><b>Enviar vídeo</b><small>MP4 na vertical · clique ou arraste</small></span></label>
     <div class="fxurl"><input type="url" id="cUrl" placeholder="Ou link do vídeo .mp4 (https://…)"><button class="btn sec" id="cAddUrl">Adicionar</button></div></div>
   <div class="row" style="margin-top:14px"><button class="tool" id="eFoto">🖼 Editar fotos</button><label style="display:flex;align-items:center;gap:8px;margin:0;text-transform:none;letter-spacing:0;font-size:13px;color:var(--tx2)"><input type="checkbox" id="eOff" ${p.off?'':'checked'} style="accent-color:var(--lima);width:17px;height:17px"> Mostrar no catálogo</label></div>
   <div class="act"><button class="btn del" id="eRst">Restaurar original</button><button class="btn sec" id="eX">Cancelar</button><button class="btn pri" id="eOk">Salvar</button></div>`;
  drawAlt(); prevMg(); drawEClips(); $('mAdm').classList.add('open');
  $('eP').oninput=prevMg; $('eAddU').onclick=()=>{AE.alt.push({id:'CX',nome:'Caixa',fator:'',preco:null});drawAlt()};
  $('eX').onclick=()=>$('mAdm').classList.remove('open');
  $('eFoto').onclick=()=>{$('mAdm').classList.remove('open');openMod(p)};
  $('eRst').onclick=()=>toast('Restaurar o cadastro original depende de integração com o ERP.');
  $('eOk').onclick=async()=>{ const ncm=$('eNcm').value.replace(/\D/g,'');if(ncm.length&&ncm.length!==8){toast('Informe um NCM válido com 8 dígitos.');$('eNcm').focus();return;}const alt=AE.alt.filter(u=>u.nome&&+u.fator>0).map(u=>({id:(u.id||u.nome.slice(0,2)).toUpperCase(),nome:u.nome,fator:+u.fator,...(+u.preco>0?{preco:+(+u.preco).toFixed(2)}:{})}));
    PADM[cod]={...(PADM[cod]||{}),t:$('eT').value.trim()||p.t,m:$('eM').value.trim(),c:$('eC').value,u:$('eU').value.trim()||p.u,p:+(+$('eP').value).toFixed(2)||p.p,d:$('eD').value.trim(),ncm,tagsBusca:$('eBusca').value.trim(),alt,off:!$('eOff').checked};
    const ok=await salvaAdm(cod);if(!ok)return;$('mAdm').classList.remove('open');drawAdm();toast('Produto salvo no servidor ✓'); };
}
function prevMg(){const p=byCod[AE.cod],v=+$('eP').value,m=margem(v,p.k);$('ePm').innerHTML=m==null?'':`Margem bruta: <b class="mg ${mgCls(m)}" style="font-size:12px">${m.toFixed(1)}%</b>`;drawAltPrev()}
function drawAlt(){ $('eAlt').innerHTML=AE.alt.map((u,i)=>`<div class="urow" data-i="${i}"><input data-f="nome" value="${esc(u.nome||'')}" placeholder="Caixa"><input data-f="id" value="${esc(u.id||'')}" placeholder="CX"><input data-f="fator" type="number" value="${u.fator||''}" placeholder="25"><input data-f="preco" type="number" step="0.01" value="${u.preco??''}" placeholder="auto"><button class="rm" data-rm>×</button></div><div class="uprev" data-pv="${i}"></div>`).join('');
  $('eAlt').oninput=e=>{const r=e.target.closest('.urow');AE.alt[r.dataset.i][e.target.dataset.f]=e.target.value;drawAltPrev()};
  $('eAlt').onclick=e=>{if(e.target.dataset.rm!==undefined){AE.alt.splice(+e.target.closest('.urow').dataset.i,1);drawAlt()}}; drawAltPrev(); }
function drawAltPrev(){ if(!AE)return; const p=byCod[AE.cod], bp=+$('eP').value||p.p, un=$('eU').value||p.u;
  AE.alt.forEach((u,i)=>{const el=document.querySelector(`[data-pv="${i}"]`); if(!el)return; const f=+u.fator; if(!f){el.textContent='';return}
    const cheio=bp*f, pr=+u.preco>0?+u.preco:cheio, m=margem(pr,p.k*f);
    el.innerHTML=`1 ${esc(u.nome||'unidade')} = ${f} ${esc(un.toLowerCase())}(s) · ${brl(pr)}${pr<cheio?` (desconto de ${brl(cheio-pr)} · sai ${brl(pr/f)} cada)`:''}${m!=null?` · margem <b class="mg ${mgCls(m)}" style="font-size:12px">${m.toFixed(1)}%</b>`:''}`;}); }
/* preços congelados */
const fillCgCli=()=>$('cgCli').innerHTML=Object.entries(CLIENTES).filter(([c,x])=>x.status==='aprovado').map(([c,x])=>`<option value="${c}">${esc(x.fantasia)} — ${c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5')}</option>`).join('');
fillCgCli();
$('cgList').innerHTML=P.map(p=>`<option value="${esc(p.cod)} · ${esc(p.t)}">`).join('');
$('cgCli').onchange=()=>sincronizaCongeladosAdmin($('cgCli').value);
function drawCong(){ if(!$('cgCli').options.length)fillCgCli(); const cn=$('cgCli').value, o=CONG[cn]||{}, L=Object.keys(o).map(c=>byCod[c]).filter(Boolean);
  $('cgPanel').innerHTML=L.length?L.map(p=>{const v=o[p.cod],m=margem(v,p.k),d=v-p.p;return `<div class="crow" data-c="${p.cod}"><img src="${imgUrl(p)}" referrerpolicy="no-referrer" onerror="this.src=ph(byCod['${p.cod}'])">
    <div class="nm">${esc(p.t)}<small>Cód. ${esc(p.cod)} · ${esc(p.u)}</small></div>
    <div class="g">Preço atual<b>${brl(p.p)}</b></div>
    <div class="pin"><span>R$</span><input type="number" step="0.01" value="${v.toFixed(2)}" data-cg></div>
    <div class="df2"><span style="color:${d<0?'#8fd14f':d>0?'#ffd45c':'var(--tx3)'}">${d===0?'igual':(d<0?'−':'+')+brl(Math.abs(d))}</span><br><span class="mg ${mgCls(m)}" style="font-size:12px">${m==null?'sem custo':'margem '+m.toFixed(1)+'%'}</span></div>
    <button class="rm" data-rm title="Remover">×</button></div>`}).join(''):'<div class="empty2">Nenhum preço congelado para este cliente. Busque um produto acima e informe o preço.</div>'; }
$('cgQ').onchange=()=>{const cod=$('cgQ').value.split(' · ')[0], p=byCod[cod]; if(p&&!$('cgP').value)$('cgP').value=p.p.toFixed(2)};
$('cgAdd').onclick=async()=>{const cn=$('cgCli').value,cod=$('cgQ').value.split(' · ')[0],v=+$('cgP').value;
  if(!cn||!CLIENTES[cn]){toast('Selecione um cliente válido');return}
  if(!byCod[cod]){toast('Escolha um produto da lista');return}
  if(!(v>0)||!Number.isFinite(v)){toast('Informe um preço válido');return}
  if(await alterarCongelado(cn,cod,+v.toFixed(2))){$('cgQ').value='';$('cgP').value='';}
};
$('cgPanel').addEventListener('click',async e=>{
  if(e.target.dataset.rm===undefined)return;
  const cn=$('cgCli').value,r=e.target.closest('.crow[data-c]');
  if(!cn||!r)return;await alterarCongelado(cn,r.dataset.c,null);
});
$('cgPanel').addEventListener('change',async e=>{
  if(!e.target.matches('[data-cg]'))return;
  const cn=$('cgCli').value,r=e.target.closest('.crow[data-c]'),v=+e.target.value;
  if(!cn||!r)return;
  if(!(v>0)||!Number.isFinite(v)){toast('Informe um preço válido');drawCong();return}
  await alterarCongelado(cn,r.dataset.c,+v.toFixed(2));
});
/* margens */
$('mgLim').oninput=()=>{CFG.margemMin=+$('mgLim').value||0;drawMrg();updMrgBadge()}; $('mgLim').onchange=()=>salvaCfg(); $('mgTipo').onchange=drawMrg;
function drawMrg(){ $('mgLim').value=CFG.margemMin; const A=alertasMargem(), tp=$('mgTipo').value, L=A.baixo.filter(x=>!tp||x.tipo===tp);
  const sem=P.filter(p=>!(p.k>0));
  $('mgPanel').innerHTML=`<div style="padding:16px 18px 0" class="mgsum"><div class="stat bad"><b>${A.baixo.length}</b><span>Abaixo de ${CFG.margemMin}%</span></div><div class="stat"><b>${A.todos.length}</b><span>Preços verificados</span></div><div class="stat"><b>${sem.length}</b><span>Sem custo</span></div></div>`+
   (L.length?`<div class="mrow h"><div></div><div>Produto</div><div>Origem do preço</div><div style="text-align:right">Preço</div><div style="text-align:right">Custo</div><div style="text-align:right">Margem</div><div></div></div>`+
   L.map(x=>`<div class="mrow" data-c="${x.p.cod}" data-t="${x.tipo}"><img src="${imgUrl(x.p)}" referrerpolicy="no-referrer" onerror="this.src=ph(byCod['${x.p.cod}'])">
     <div class="nm">${esc(x.p.t)}<small>Cód. ${esc(x.p.cod)}</small></div><div class="src">${esc(x.src)}</div>
     <div class="num">${brl(x.preco)}</div><div class="num">${brl(x.custo)}</div><div class="mg bad">${x.m.toFixed(1)}%</div>
     <div class="nums" style="display:none"></div><button class="tool ab" data-ed>${x.tipo==='cg'?'Ver':'Ajustar'}</button></div>`).join('')
   :`<div class="empty2">✓ Nenhum preço abaixo de ${CFG.margemMin}% de margem bruta.</div>`)+
   (sem.length?`<div style="padding:12px 18px;font-size:12px;color:var(--tx3)">Sem custo cadastrado: ${sem.map(p=>esc(p.cod)).join(', ')}</div>`:'');
  document.querySelectorAll('.mrow .nums').forEach((el,i)=>{const x=L[i]; if(window.innerWidth<=640){el.style.display='block';el.textContent=`Preço ${brl(x.preco)} · custo ${brl(x.custo)}`}}); }
$('mgPanel').addEventListener('click',e=>{const r=e.target.closest('.mrow[data-c]');if(!r||!e.target.closest('[data-ed]'))return;
  if(r.dataset.t==='cg'){AT='cong';drawAdm();return} openAdmEd(r.dataset.c)});
/* configurações */
function drawCfg(){ $('cfgPanel').innerHTML=[['soEstoque','Mostrar somente produtos com estoque disponível','Produtos com estoque zerado ou negativo somem do catálogo e da Minha Lista dos clientes.'],
  ['bloquear','Bloquear pedido acima do estoque','Ligado: o cliente não consegue fechar o pedido com quantidade maior que o disponível. Desligado: o portal só avisa.']]
  .map(([k,a,b])=>`<div class="ci2"><div><b>${a}</b><small>${b}</small></div><button class="tg ${CFG[k]?'on':''}" data-k="${k}"></button></div>`).join('')+
  `<div class="ci2"><div><b>Margem bruta mínima</b><small>Preços abaixo deste valor aparecem na aba Margens.</small></div><div class="pin" style="width:110px"><input type="number" value="${CFG.margemMin}" id="cfMg" style="text-align:right"><span>%</span></div></div>`; 
  $('cfgPanel').innerHTML+=`
   <div class="ci2" style="display:block"><b>Formas de pagamento</b><small>Lista geral. Você libera quais cada cliente pode usar em Admin → Clientes → Editar.</small>
     <div style="margin-top:10px">${CFG.formas.map(f=>`<span class="tagl">${esc(f.nome)} <button data-rmf="${f.id}" title="Remover">×</button></span>`).join('')}</div>
     <div class="fxurl" style="margin-top:6px"><input id="cfFN" placeholder="Nova forma (ex.: Boleto 21 dias)"><input id="cfFO" placeholder="Observação (opcional)"><button class="btn sec" id="cfFA">Adicionar</button></div>
     <div style="margin-top:12px;font-size:12px;color:var(--tx2)">Liberadas automaticamente para cadastros novos:</div>
     <div class="chks" style="margin-top:6px">${CFG.formas.map(f=>`<label><input type="checkbox" data-pp="${f.id}" ${CFG.pagPadrao.includes(f.id)?'checked':''}>${esc(f.nome)}</label>`).join('')}</div></div>
   <div class="ci2" style="display:block"><b>Sinônimos do motor de busca</b>
     <small>Uma linha por grupo de palavras equivalentes, separadas por vírgula. Ex.: marmita, marmitex, quentinha. Para aplicações específicas, use as palavras-chave na edição de cada produto.</small>
     <textarea class="inp" id="cfBuscaSinonimos" rows="5" style="width:100%;margin-top:10px" spellcheck="false">${esc(CFG.buscaSinonimos??SINONIMOS_PADRAO)}</textarea>
     <div class="row" style="margin-top:8px"><button class="btn sec" id="cfBuscaSalvar">Salvar sinônimos</button></div>
     <small style="margin-top:8px">As configurações são salvas no Supabase e compartilhadas com os clientes do portal. A integração com a Movimento ainda será configurada.</small></div>
   <div class="ci2" style="display:block"><b>Vendedores</b><small>Aparecem no cadastro em "Como conheceu a Souza Ribeiro?" e no cadastro do cliente.</small>
     <div style="margin-top:10px">${CFG.vendedores.map(v=>`<span class="tagl">${esc(v)} <button data-rmv="${esc(v)}">×</button></span>`).join('')}</div>
     <div class="fxurl" style="margin-top:6px"><input id="cfVN" placeholder="Nome do vendedor"><button class="btn sec" id="cfVA">Adicionar</button></div></div>
   <div class="ci2" style="display:block"><b>Entrega em Uberlândia</b><small>Pedido em dia útil até 10h → entrega no mesmo dia até 18h. Depois das 10h → próximo dia útil até 18h. Fim de semana ou feriado → próximo dia útil até 18h. Outras cidades: regras a definir.</small>
     <div style="margin-top:10px;font-size:12px;color:var(--tx2)">Feriados considerados (não são dias úteis):</div>
     <div style="margin-top:6px;max-height:170px;overflow:auto">${[...CFG.feriados].sort().map(([d,n])=>`<span class="tagl">${d.split('-').reverse().join('/')} · ${esc(n)} <button data-rmh="${d}">×</button></span>`).join('')}</div>
     <div class="fxurl" style="margin-top:6px"><input id="cfHD" type="date"><input id="cfHN" placeholder="Nome do feriado"><button class="btn sec" id="cfHA">Adicionar</button></div></div>`;
  { $('cfgPanel').insertAdjacentHTML('afterbegin',`<div class="ci2" style="display:block"><b>Administradores do portal</b><small>Quem pode entrar no painel do administrador. Cada um entra com o próprio usuário e senha.</small><div id="cfAdm" style="margin-top:10px">Carregando…</div>
     <div class="fgrid" style="margin-top:8px"><div><label>Usuário</label><input class="inp" id="cfAU" placeholder="ex.: carlos"></div><div><label>Nome</label><input class="inp" id="cfAN" placeholder="Nome da pessoa"></div>
     <div class="full"><label>Senha (mín. 6 caracteres)</label><div class="fxurl"><input class="inp" id="cfAS" type="text" placeholder="Para usuário existente, digite só se quiser trocar"><button class="btn sec" id="cfAA">Salvar usuário</button></div></div></div><div class="err" id="cfAE"></div></div>`); drawAdmins(); }
  $('cfBuscaSalvar').onclick=async()=>{CFG.buscaSinonimos=$('cfBuscaSinonimos').value.trim();const ok=await salvaCfg();render();if(ok)toast('Sinônimos publicados para todos ✓')};
  $('cfMg').onchange=()=>{CFG.margemMin=+$('cfMg').value||0;salvaCfg();updMrgBadge()};
  $('cfFA').onclick=()=>{const n=$('cfFN').value.trim(); if(!n)return; CFG.formas.push({id:'f'+Date.now().toString(36),nome:n,obs:$('cfFO').value.trim()}); salvaCfg(); drawCfg()};
  $('cfVA').onclick=()=>{const n=$('cfVN').value.trim(); if(!n||CFG.vendedores.includes(n))return; CFG.vendedores.push(n); salvaCfg(); drawCfg()};
  $('cfHA').onclick=()=>{const d=$('cfHD').value,n=$('cfHN').value.trim()||'Feriado'; if(!d)return; CFG.feriados=CFG.feriados.filter(x=>x[0]!==d).concat([[d,n]]); salvaCfg(); drawCfg()}; }
async function drawAdmins(){ const el=$('cfAdm'); if(!el)return; try{ const L=await API.adminUsuarios();
    el.innerHTML=L.map(a=>`<span class="tagl"><b>${esc(a.usuario)}</b>${a.nome?' · '+esc(a.nome):''} <button data-edu="${esc(a.usuario)}" data-nm="${esc(a.nome||'')}" title="Trocar senha" style="color:var(--lima)">✎</button><button data-rmu="${esc(a.usuario)}" title="Remover">×</button></span>`).join(''); }
  catch(e){ el.textContent=e.message } }
$('cfgPanel').addEventListener('click',async e=>{const d=e.target.dataset;
  if(e.target.id==='cfAA'){ $('cfAE').textContent=''; try{ await API.salvarAdminUsuario($('cfAU').value,$('cfAN').value.trim(),$('cfAS').value); toast('Administrador salvo ✓'); $('cfAU').value=$('cfAN').value=$('cfAS').value=''; drawAdmins(); }catch(err){ $('cfAE').textContent=err.message } return }
  if(d.edu){ $('cfAU').value=d.edu; $('cfAN').value=d.nm; $('cfAS').value=''; $('cfAS').focus(); toast('Digite a nova senha e clique em Salvar usuário'); return }
  if(d.rmu){ if(!e.target.dataset.ok){ e.target.dataset.ok=1; e.target.textContent='remover?'; return } try{ await API.removerAdminUsuario(d.rmu); toast('Administrador removido'); drawAdmins(); }catch(err){ toast(err.message) } return }
});
$('cfgPanel').addEventListener('click',e=>{const d=e.target.dataset;
  if(d.rmf){CFG.formas=CFG.formas.filter(f=>f.id!==d.rmf);CFG.pagPadrao=CFG.pagPadrao.filter(x=>x!==d.rmf);salvaCfg();drawCfg()}
  if(d.rmv){CFG.vendedores=CFG.vendedores.filter(v=>v!==d.rmv);salvaCfg();drawCfg()}
  if(d.rmh){CFG.feriados=CFG.feriados.filter(x=>x[0]!==d.rmh);salvaCfg();drawCfg()}});
$('cfgPanel').addEventListener('change',e=>{const id=e.target.dataset.pp; if(!id)return; CFG.pagPadrao=e.target.checked?[...new Set([...CFG.pagPadrao,id])]:CFG.pagPadrao.filter(x=>x!==id); salvaCfg();});
$('cfgPanel').addEventListener('click',e=>{const k=e.target.dataset.k;if(!k)return;CFG[k]=!CFG[k];salvaCfg();drawCfg();render()});
/* exportar / importar / sair */
$('aExp').onclick=()=>{const b=new Blob([JSON.stringify({produtos:PADM,imagens:OV,congelados:CONG,config:CFG},null,1)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='sr_portal_b2b_admin.json';a.click();toast('Alterações exportadas')};
$('aImp').onclick=()=>$('aImpF').click();
$('aImpF').onchange=async()=>{
  const f=$('aImpF').files[0];if(!f)return;$('aImpF').value='';
  try{
    const o=JSON.parse(await f.text());
    if(!o||typeof o!=='object'||Array.isArray(o))throw new Error('Arquivo inválido');
    if(o.imagens&&typeof o.imagens==='object'){
      if(!window.confirm('Publicar as imagens importadas para todos os clientes?'))return;
      await importarFotosCompartilhadas(o.imagens);
    }
    if(o.produtos){
      if(typeof o.produtos!=='object'||Array.isArray(o.produtos))throw new Error('Produtos importados inválidos');
      const entries=Object.entries(o.produtos).filter(([cod])=>!!byCod[cod]);
      if(entries.length&&!confirm('Salvar '+entries.length+' edições de produtos do arquivo?'))return;
      for(const [cod,v] of entries)await API.salvarProduto(cod,v);
      await recarregaCatalogo();
    }
    if(o.congelados){
      if(typeof o.congelados!=='object'||Array.isArray(o.congelados))throw new Error('Preços importados inválidos');
      const list=Object.entries(o.congelados).flatMap(([cn,precos])=>CLIENTES[cn]&&precos&&typeof precos==='object'?Object.entries(precos).map(([cod,preco])=>({cn,cod,preco})):[]);
      if(list.length&&!confirm('Aplicar '+list.length+' preços especiais do arquivo aos clientes cadastrados?'))return;
      for(const item of list){if(!byCod[item.cod]||!(Number(item.preco)>0))continue;await API.salvarPrecoCongelado(item.cn,item.cod,Number(item.preco))}
      for(const cn of Object.keys(o.congelados))if(CLIENTES[cn])CONG[cn]=await API.buscarCongeladosAdmin(cn);
    }
    if(o.config){Object.assign(CFG,o.config);if(!await salvaCfg())throw new Error('Configurações importadas não foram confirmadas pelo servidor')}
    render();drawAdm();toast('Importação publicada ✓ — confira o resultado em outro navegador');
  }catch(e){toast('Falha ao importar: '+e.message)}
};
$('aSair').onclick=sairConta;

/* =================== CLIPS =================== */
const DEMO_CLIPS = []; // clips de exemplo removidos: na demonstração o feed mostra fotos dos produtos e vídeos enviados pelo admin
let CLIPS_U = LSG('sr_b2b_clips',[]), DEMO_OFF = LSG('sr_b2b_clips_demo_off',[]), DEMO_TT = LSG('sr_b2b_clips_demo_tt',{});
const salvaClips=async(cod)=>{
 LSS('sr_b2b_clips',CLIPS_U);LSS('sr_b2b_clips_demo_off',DEMO_OFF);LSS('sr_b2b_clips_demo_tt',DEMO_TT);
 await API.salvarClips(cod,CLIPS_U.filter(c=>c.cod===cod&&!c.demo).map(c=>({id:c.id,titulo:c.titulo,src:c.src})));
}
const todosClips=()=>[...CLIPS_U,...DEMO_CLIPS.filter(d=>!DEMO_OFF.includes(d.id)).map(d=>({...d,titulo:DEMO_TT[d.id]??d.titulo,demo:true}))];
const clipsVis=()=>todosClips().filter(c=>byCod[c.cod]&&(ADM||visivel(byCod[c.cod])));
const clipsDe=cod=>clipsVis().filter(c=>c.cod===cod);
const feedItens=()=>{ const v=clipsVis(), com=new Set(v.map(c=>c.cod));
  const fotos=P.filter(p=>(ADM||visivel(p))&&!com.has(p.cod)).sort((a,b)=>a.t.localeCompare(b.t,'pt')).map(p=>({id:'p:'+p.cod,cod:p.cod,foto:true}));
  return [...v,...fotos]; };
/* vídeos enviados ficam no IndexedDB do navegador (em produção: armazenamento na nuvem) */
const IDB=(()=>{let db;const op=()=>db?Promise.resolve(db):new Promise((res,rej)=>{const r=indexedDB.open('sr_b2b',1);r.onupgradeneeded=()=>r.result.createObjectStore('videos');r.onsuccess=()=>res(db=r.result);r.onerror=()=>rej(r.error)});
  const tx=(m,f)=>op().then(d=>new Promise((res,rej)=>{const t=d.transaction('videos',m),q=f(t.objectStore('videos'));t.oncomplete=()=>res(q&&q.result);t.onerror=()=>rej(t.error)}));
  return {put:(k,v)=>tx('readwrite',s=>s.put(v,k)),get:k=>tx('readonly',s=>s.get(k)),del:k=>tx('readwrite',s=>s.delete(k))}})();
const URLC={};
async function srcClip(c){ if(!c.src.startsWith('idb:'))return c.src; if(URLC[c.src])return URLC[c.src];
  const b=await IDB.get(c.src.slice(4)); return b?(URLC[c.src]=URL.createObjectURL(b)):''; }
let MUTED=true, CIO=null;
function sizeClips(){ const h=window.innerHeight-document.querySelector('header').offsetHeight-(getComputedStyle(document.querySelector('.tabbar')).display!=='none'?document.querySelector('.tabbar').offsetHeight:0)-(window.innerWidth>640?24:0);
  $('clipsFeed').style.setProperty('--ch',Math.max(420,h)+'px'); }
window.addEventListener('resize',()=>{if(VIEW==='clips')sizeClips()});
function pauseClips(){ document.querySelectorAll('#clipsFeed video').forEach(v=>v.pause()); stopFotos(); }
const FT=new Map(), FDUR=3500;
function startFoto(s){ stopFoto(s); const p=byCod[s.dataset.c], G=gal(p).length?gal(p):[ph(p)], ci=s.querySelector('.cimg'), bg=s.querySelector('.cbg'), bar=s.querySelector('.cbar i');
  let i=+(s.dataset.fi||0), t0=performance.now()-(+s.dataset.fe||0);
  const show=k=>{ i=k%G.length; s.dataset.fi=i; ci.classList.remove('kb'); void ci.offsetWidth; ci.src=G[i]; bg.src=G[i]; ci.classList.add('kb'); };
  if(!ci.src)show(i); else ci.classList.add('kb');
  s.classList.remove('paused');
  const tick=now=>{ const el=now-t0; s.dataset.fe=el; bar.style.width=Math.min(100,(i*FDUR+el)/(G.length*FDUR)*100)+'%';
    if(el>=FDUR){ t0=now; s.dataset.fe=0; show(i+1); }
    FT.set(s,requestAnimationFrame(tick)); };
  FT.set(s,requestAnimationFrame(tick)); }
function stopFoto(s){ if(FT.has(s)){cancelAnimationFrame(FT.get(s));FT.delete(s)} s.querySelector('.cimg')?.classList.remove('kb'); s.classList.add('paused'); }
function stopFotos(){ [...FT.keys()].forEach(stopFoto); }
function drawClips(startId){ sizeClips(); const L=feedItens(), f=$('clipsFeed'); stopFotos();
  if(CIO)CIO.disconnect();
  if(!L.length){f.innerHTML='<div class="cempty"><div><b style="font-size:18px;color:var(--tx)">Nenhum clip ainda</b><br>Os vídeos dos produtos aparecem aqui.</div></div>';return}
  f.innerHTML=L.map((c,idx)=>{const p=byCod[c.cod];return `<section class="clip paused" data-id="${c.id}" data-c="${p.cod}">
    ${c.foto?`<div class="cfoto"><img class="cbg" referrerpolicy="no-referrer" alt=""><img class="cimg" referrerpolicy="no-referrer" alt=""></div>`:'<video playsinline loop muted preload="none"></video>'}<div class="grad"></div><div class="cbar"><i></i></div>
    <div class="cpause"><span>▶</span></div>
    <div class="ctop"><b>Clips <em>SR</em> <small style="font-size:11px;font-weight:600;color:var(--tx2)">${idx+1}/${L.length}</small></b>${c.foto?`<span class="cfn">${gal(p).length>1?gal(p).length+' fotos':'foto'}</span>`:`<button class="cbtn" data-a="mute" title="Som">${MUTED?'🔇':'🔊'}</button>`}</div>
    <div class="cside"><div><button class="cbtn ${CLI&&CLI.lista.some(l=>l.cod===p.cod)?'on':''}" data-a="fav">★</button><small>Lista</small></div>
      <div><button class="cbtn" data-a="ver">👁</button><small>Detalhes</small></div></div>
    ${c.titulo?`<div class="cttl">${esc(c.titulo)}</div>`:''}
    <div class="ccard"><img src="${imgUrl(p)}" referrerpolicy="no-referrer" onerror="this.src=ph(byCod['${p.cod}'])" data-a="ver">
      <div><div class="cn" data-a="ver">${esc(p.t)}</div>${vePreco()?`<div class="cp"><b>${brl(base(p))}</b><small>/ ${p.u.toLowerCase()}</small></div>`:''}${stkHtml(p)}</div>
      ${vePreco()?`<div class="cb"><div class="qty"><button data-d="-1">−</button><input type="number" min="1" value="1"><button data-d="1">+</button></div>
        <button class="add" data-a="add"><svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Adicionar</button></div>`:`<div class="cb"><button class="lockp" style="margin:0" data-lock><svg class="ic" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Faça login para ver os preços</button></div>`}</div>
  </section>`}).join('');
  CIO=new IntersectionObserver(es=>es.forEach(async en=>{const s=en.target,v=s.querySelector('video');
    if(s.dataset.id.startsWith('p:')){ if(en.isIntersecting)startFoto(s); else stopFoto(s); return; }
    if(en.isIntersecting){ if(!v.src){const c=todosClips().find(x=>x.id===s.dataset.id); v.src=await srcClip(c)} v.muted=MUTED; v.play().then(()=>s.classList.remove('paused')).catch(()=>s.classList.add('paused')); }
    else { v.pause(); }
  }),{root:f,threshold:.65});
  /* pré-carrega as fotos dos próximos itens */
  const PIO=new IntersectionObserver(es=>es.forEach(en=>{ if(!en.isIntersecting)return; const s=en.target; const ci=s.querySelector('.cimg'); if(ci&&!ci.src){const p=byCod[s.dataset.c],u=gal(p)[0]||ph(p); ci.src=u; s.querySelector('.cbg').src=u; ci.onerror=function(){this.onerror=null;this.src=ph(p)}} PIO.unobserve(s); }),{root:f,rootMargin:'200% 0px'});
  f.querySelectorAll('.clip').forEach(s=>{CIO.observe(s); PIO.observe(s); const v=s.querySelector('video'), bar=s.querySelector('.cbar i'); if(!v)return;
    v.ontimeupdate=()=>{bar.style.width=(v.currentTime/(v.duration||1)*100)+'%'}; v.onpause=()=>s.classList.add('paused'); v.onplay=()=>s.classList.remove('paused');});
  const alvo=startId&&f.querySelector(`.clip[data-id="${startId}"]`); f.scrollTop=alvo?alvo.offsetTop:0;
}
$('clipsFeed').addEventListener('click',e=>{const s=e.target.closest('.clip');if(!s)return; if(e.target.closest('[data-lock]')){openLogin(()=>drawClips(s.dataset.id));return}const p=byCod[s.dataset.c],v=s.querySelector('video'),a=e.target.closest('[data-a]')?.dataset.a;
  if(e.target.dataset.d){const i=s.querySelector('.qty input');i.value=Math.max(1,(+i.value||1)+(+e.target.dataset.d));return}
  if(e.target.closest('.qty'))return;
  if(a==='mute'){MUTED=!MUTED;document.querySelectorAll('#clipsFeed video').forEach(x=>x.muted=MUTED);document.querySelectorAll('[data-a=mute]').forEach(b=>b.textContent=MUTED?'🔇':'🔊');return}
  if(a==='ver'){if(v)v.pause();else stopFoto(s);openDet(p);return}
  if(a==='fav'){need(()=>{toggleLista(p.cod);e.target.closest('.cbtn').classList.toggle('on')});return}
  if(a==='add'){need(()=>{addCart(p.cod,Math.max(1,+s.querySelector('.qty input').value||1))});return}
  if(e.target.closest('.ccard'))return;
  if(!v){ if(FT.has(s))stopFoto(s); else startFoto(s); return; }
  if(v.paused)v.play();else v.pause();});
const cstep=d=>{const f=$('clipsFeed');f.scrollBy({top:d*f.clientHeight,behavior:'smooth'})};
$('cUp').onclick=()=>cstep(-1); $('cDn').onclick=()=>cstep(1);
document.addEventListener('keydown',e=>{if(VIEW!=='clips'||document.querySelector('.mod.open'))return;if(e.key==='ArrowDown'){e.preventDefault();cstep(1)}if(e.key==='ArrowUp'){e.preventDefault();cstep(-1)}});
/* admin: clips do produto */
function drawEClips(){ const cod=AE.cod, L=todosClips().filter(c=>c.cod===cod);
  $('eClips').innerHTML=L.length?L.map(c=>`<div class="eclip" data-id="${c.id}"><video muted playsinline preload="metadata"></video>
    <div><input value="${esc(c.titulo||'')}" placeholder="Título do clip (opcional)" data-tt><small>${c.demo?'Clip de demonstração':c.src.startsWith('idb:')?'Vídeo enviado':'Link'}</small></div>
    <button class="tool" data-pv>▶ Ver</button><button class="rm" data-rm title="Remover">×</button></div>`).join(''):'<div class="fxempty">Nenhum clip neste produto.</div>';
  $('eClips').querySelectorAll('.eclip').forEach(async el=>{const c=todosClips().find(x=>x.id===el.dataset.id); const v=el.querySelector('video'); v.src=await srcClip(c); v.currentTime=.5;});
}
$('mAdm').addEventListener('change',async e=>{
 if(!e.target.matches('[data-tt]'))return;
 const id=e.target.closest('.eclip').dataset.id,u=CLIPS_U.find(c=>c.id===id);
 if(u)u.titulo=e.target.value; else DEMO_TT[id]=e.target.value;
 try{await salvaClips(AE.cod);toast('Título do clip publicado ✓')}
 catch(err){toast('Clip não salvo: '+err.message)}
});
$('mAdm').addEventListener('click',async e=>{const el=e.target.closest('.eclip'); if(!el)return; const id=el.dataset.id;
  if(e.target.matches('[data-pv]')){$('mAdm').classList.remove('open');go('clips',id);return}
  if(e.target.matches('[data-rm]')){ const i=CLIPS_U.findIndex(c=>c.id===id);
    if(i>=0){const c=CLIPS_U[i]; CLIPS_U.splice(i,1)} else DEMO_OFF.push(id);
    try{await salvaClips(AE.cod);drawEClips();toast('Clip removido para todos ✓')}catch(err){toast('Falha ao remover: '+err.message)} }});
async function addClipFiles(files){
 if(!AE?.cod)return;
 const cod=AE.cod;let added=0;
 for(const file of [...files]){
  if(!['video/mp4','video/webm'].includes(file.type)||file.size>41943040||file.size<100){toast('Use MP4 ou WebM até 40 MB.');continue}
  try{
   let src=null;
   try{ src=await API.enviarVideo(file,cod); }catch(e){ if(e.codigo!=='integracao')throw e; } // demonstração: vídeo fica neste navegador
   const id='c'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
   if(src)CLIPS_U.unshift({id,cod,titulo:'',src});
   else{await IDB.put(id,file);CLIPS_U.unshift({id,cod,titulo:'',src:'idb:'+id})}
   added++;
  }catch(err){toast('Falha ao enviar vídeo: '+err.message)}
 }
 if(!added)return;
 try{await salvaClips(cod);drawEClips();toast(added+' vídeo(s) publicados ✓')}
 catch(err){toast('Falha ao salvar clips: '+err.message)}
}
$('mAdm').addEventListener('change',e=>{if(e.target.id==='cFile'){addClipFiles(e.target.files);e.target.value=''}});
$('mAdm').addEventListener('click',async e=>{if(e.target.id!=='cAddUrl')return;const v=$('cUrl').value.trim();
  if(!/^https?:\/\//i.test(v)){toast('Cole um link que comece com https://');return}
  CLIPS_U.unshift({id:'c'+Date.now().toString(36),cod:AE.cod,titulo:'',src:v});try{await salvaClips(AE.cod);$('cUrl').value='';drawEClips();toast('Link do clip publicado ✓')}catch(err){toast('Clip não salvo: '+err.message)}});
['dragenter','dragover'].forEach(ev=>$('mAdm').addEventListener(ev,e=>{const d=e.target.closest('#cDrop');if(d){e.preventDefault();d.classList.add('over')}}));
['dragleave','drop'].forEach(ev=>$('mAdm').addEventListener(ev,e=>{const d=e.target.closest('#cDrop');if(d){e.preventDefault();d.classList.remove('over');if(ev==='drop')addClipFiles(e.dataTransfer.files)}}));

/* ---------- detalhe do produto ---------- */
let DP=null, DI=0, DU='';
function openDet(p){ DP=p; DI=0; DU=''; drawDet(); $('mDet').classList.add('open'); intelEvento('produto_visto',p.cod); }
function drawDet(){ const p=DP, G=gal(p).length?gal(p):[ph(p)], naLista=CLI&&CLI.lista.some(l=>l.cod===p.cod);
  $('detBox').innerHTML=`<div class="gal">
      <div class="gmain"><img id="gImg" src="${G[DI]}" referrerpolicy="no-referrer" alt="${esc(p.t)}" onerror="this.onerror=null;this.src=ph(DP)">
        ${G.length>1?`<button class="gnav p" data-g="-1">‹</button><button class="gnav n" data-g="1">›</button>`:''}</div>
      ${G.length>1?`<div class="gthumbs">${G.map((u,k)=>`<img src="${u}" referrerpolicy="no-referrer" class="${k===DI?'on':''}" data-k="${k}" onerror="this.remove()">`).join('')}</div>`:''}
    </div>
    <div class="dinfo"><button class="x" id="dX">×</button>
      <div class="brand">${esc(p.m||'')}</div>
      <h2>${esc(p.t)}</h2>
      <div class="meta">Cód. ${esc(p.cod)}${p.e?' · EAN '+p.e:''}</div>
      ${vePreco()?`<div class="dprice"><b>${brl(pu(p,unOf(p,DU)))}</b><small>/ ${unTxt(p,unOf(p,DU)).toLowerCase()}</small></div>
      ${stkHtml(p).replace('class="stk','style="margin-top:8px" class="stk')}
      <div class="ueq" style="margin-top:6px">${econ(p,unOf(p,DU))}</div>
      ${unselHtml(p,DU,'lg')}
      <div class="dbuy"><div class="qty"><button data-d="-1">−</button><input id="dQ" type="number" min="1" value="1"><button data-d="1">+</button></div>
        <button class="add" id="dAdd"><svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Adicionar ao carrinho</button>
        <button class="dfav ${naLista?'on':''}" id="dFav" title="Minha Lista">${naLista?'★':'☆'}</button></div>`:`${stkHtml(p).replace('class="stk','style="margin-top:8px" class="stk')}<button class="lockp" data-lock id="dLock"><svg class="ic" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Faça login para ver os preços</button>`}
      ${clipsDe(p.cod).length?`<button class="dclip" id="dClip">▶ Ver clip deste produto</button>`:''}
      ${p.d?`<div class="dsec"><h4>Descrição</h4><p>${esc(p.d)}</p></div>`:''}
      <div class="dsec"><h4>Características</h4><table class="ftab">${p.f.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}<tr><td>NCM</td><td>${p.ncm?esc(p.ncm.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1.$2.$3')):'Não informado'}</td></tr></table></div>
    </div>`;
}
$('mDet').addEventListener('click',e=>{
  if(e.target.id==='mDet'||e.target.id==='dX'){$('mDet').classList.remove('open');return}
  const g=e.target.dataset.g, k=e.target.dataset.k, d=e.target.dataset.d, G=gal(DP).length?gal(DP):[ph(DP)];
  if(e.target.dataset.un!==undefined){const q=$('dQ').value;DU=e.target.dataset.un;drawDet();$('dQ').value=q;return}
  if(g){DI=(DI+(+g)+G.length)%G.length;drawDet();return}
  if(k!==undefined){DI=+k;drawDet();return}
  if(d){const i=$('dQ');i.value=Math.max(1,(+i.value||1)+(+d));return}
  if(e.target.closest('#dAdd')){need(()=>{addCart(DP.cod,Math.max(1,+$('dQ').value||1),DU);if(qtdBase(CART,DP.cod)<=DP.s)$('mDet').classList.remove('open')});return}
  if(e.target.closest('#dLock')){$('mDet').classList.remove('open');openLogin(()=>openDet(DP));return}
  if(e.target.closest('#dClip')){$('mDet').classList.remove('open');go('clips',clipsDe(DP.cod)[0].id);return}
  if(e.target.closest('#dFav')){need(()=>{toggleLista(DP.cod);drawDet();render()});return}
});
document.addEventListener('keydown',e=>{if(!$('mDet').classList.contains('open'))return;
  if(e.key==='Escape')$('mDet').classList.remove('open');
  const G=gal(DP); if(G.length>1&&(e.key==='ArrowRight'||e.key==='ArrowLeft')){DI=(DI+(e.key==='ArrowRight'?1:-1)+G.length)%G.length;drawDet()}});

/* ---------- saudação ---------- */
function saud(){const h=new Date().getHours(), s=h<12?'Bom dia':h<18?'Boa tarde':'Boa noite';
  $('hi').innerHTML=`${s}${CLI?', '+esc(CLI.fantasia):''}.<em>Seus suprimentos</em>num só lugar.`;}

/* =================== CADASTRO, CONTA, ENDEREÇOS, ENTREGA =================== */
const fmtCNPJ=c=>(c||'').replace(/\D/g,'').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');
const fmtCEP=c=>(c||'').replace(/\D/g,'').replace(/^(\d{5})(\d{3})$/,'$1-$2');
const fmtTel=c=>{c=(c||'').replace(/\D/g,'');return c.length===11?c.replace(/^(\d{2})(\d{5})(\d{4})$/,'($1) $2-$3'):c.length===10?c.replace(/^(\d{2})(\d{4})(\d{4})$/,'($1) $2-$3'):c};
function cnpjOk(c){c=(c||'').replace(/\D/g,''); if(c.length!==14||/^(\d)\1+$/.test(c))return false;
  const dv=n=>{let s=0,p=n-7;for(let i=0;i<n;i++){s+=+c[i]*p--;if(p<2)p=9}const r=s%11;return r<2?0:11-r}; return dv(12)===+c[12]&&dv(13)===+c[13];}
/* Consultas de CNPJ (dados da empresa + inscrição estadual) e de CEP: feitas pelo serviço. */
const buscaCEP = c => API.consultarCEP(c);
const endTxt=e=>`${e.logradouro||''}${e.numero?', '+e.numero:''}${e.complemento?' – '+e.complemento:''} · ${e.bairro||''} · ${e.cidade||''}/${e.uf||''} · CEP ${fmtCEP(e.cep)}`;
/* campos de endereço reutilizáveis (prefixo k) */
const addrFields=(k,d={})=>`<div class="fgrid">
  <div><label>CEP <span class="req">*</span></label><input class="inp" id="${k}Cep" inputmode="numeric" maxlength="8" value="${esc((d.cep||'').replace(/\D/g,''))}" placeholder="Apenas números"><div class="okmsg" id="${k}CepM"></div></div>
  <div><label>Número <span class="req">*</span></label><input class="inp" id="${k}Num" value="${esc(d.numero||'')}"></div>
  <div class="full"><label>Rua / Avenida <span class="req">*</span></label><input class="inp" id="${k}Log" value="${esc(d.logradouro||'')}"></div>
  <div><label>Complemento</label><input class="inp" id="${k}Com" value="${esc(d.complemento||'')}"></div>
  <div><label>Bairro <span class="req">*</span></label><input class="inp" id="${k}Bai" value="${esc(d.bairro||'')}"></div>
  <div><label>Cidade <span class="req">*</span></label><input class="inp" id="${k}Cid" value="${esc(d.cidade||'')}"></div>
  <div><label>UF <span class="req">*</span></label><input class="inp" id="${k}Uf" maxlength="2" value="${esc(d.uf||'')}" style="text-transform:uppercase"></div></div>`;
function bindCep(k){ $(k+'Cep').addEventListener('input',async e=>{const c=e.target.value.replace(/\D/g,'').slice(0,8); e.target.value=c; if(c.length!==8)return;
  $(k+'CepM').className='okmsg'; $(k+'CepM').textContent='Buscando CEP…';
  try{const r=await buscaCEP(c); if(r.logradouro)$(k+'Log').value=r.logradouro; if(r.bairro)$(k+'Bai').value=r.bairro; $(k+'Cid').value=r.cidade; $(k+'Uf').value=r.uf; $(k+'CepM').textContent='✓ Endereço encontrado'; $(k+'Num').focus();}
  catch(err){$(k+'CepM').className='okmsg bad';$(k+'CepM').textContent=err.message||'Não foi possível buscar o CEP.'}}); }
const readAddr=k=>({cep:$(k+'Cep').value.replace(/\D/g,''),numero:$(k+'Num').value.trim(),logradouro:$(k+'Log').value.trim(),complemento:$(k+'Com').value.trim(),bairro:$(k+'Bai').value.trim(),cidade:$(k+'Cid').value.trim(),uf:$(k+'Uf').value.trim().toUpperCase()});
const addrOk=a=>a.cep.length===8&&a.numero&&a.logradouro&&a.bairro&&a.cidade&&a.uf.length===2;
const origens=()=>[...CFG.vendedores.map(v=>'Vendedor: '+v),'Instagram','Google','Indicação de outro cliente','Outro'];
/* formulário de cliente — cadastro público ou admin */
function cliForm(d={},admin=false){ return `
  <div class="csec">Empresa</div>
  <label>CNPJ <span class="req">*</span></label>
  <div class="cnpjrow"><input class="inp" id="kCnpj" inputmode="numeric" maxlength="18" placeholder="00.000.000/0000-00" value="${esc(fmtCNPJ(d.cnpj||''))}" ${admin&&d.cnpj?'readonly':''}><button class="btn sec" id="kBusca" type="button">Buscar dados</button></div>
  <div class="okmsg" id="kCnpjM">${d.cnpj?'':'Digite ou cole o CNPJ com ou sem pontuação. Os dados da empresa serão preenchidos automaticamente.'}</div>
  <div class="fgrid"><div class="full"><label>Razão social <span class="req">*</span></label><input class="inp" id="kRaz" value="${esc(d.nome||d.razao_social||'')}"></div>
   <div class="full"><label>Nome fantasia</label><input class="inp" id="kFan" value="${esc(d.fantasia||'')}"></div>
   <div class="full"><label>Inscrição estadual <span class="req">*</span></label>
     <div class="cnpjrow"><input class="inp" id="kIE" inputmode="numeric" placeholder="Buscada automaticamente pelo CNPJ" value="${esc(d.inscricao_estadual&&d.inscricao_estadual!=='ISENTO'?d.inscricao_estadual:'')}" ${d.inscricao_estadual==='ISENTO'?'disabled':''}>
       <label class="isen"><input type="checkbox" id="kIsento" ${d.inscricao_estadual==='ISENTO'?'checked':''}> Isento</label></div>
     <div class="okmsg" id="kIEM"></div></div></div>
  <div class="csec">Endereço da empresa (também usado para entrega)</div>${addrFields('k',d)}
  <div class="csec">Contato</div>
  <div class="fgrid"><div class="full"><label>Nome do responsável pelas compras <span class="req">*</span></label><input class="inp" id="kResp" value="${esc(d.responsavel||'')}"></div>
   <div><label>WhatsApp <span class="req">*</span></label><input class="inp" id="kWa" inputmode="numeric" maxlength="11" placeholder="DDD + número, só números" value="${esc((d.whats||'').replace(/\D/g,''))}"></div>
   <div><label>Telefone da empresa</label><input class="inp" id="kTel" inputmode="numeric" maxlength="11" placeholder="Só números" value="${esc((d.telefone||'').replace(/\D/g,''))}"></div>
   <div class="full"><label>E-mail <span class="req">*</span></label><input class="inp" id="kEm" type="email" placeholder="Usado para recuperar a senha" value="${esc(d.email||'')}"></div>
   <div class="full"><label>Como conheceu a Souza Ribeiro? <span class="req">*</span></label><select class="inp" id="kOri"><option value="">Selecione…</option>${origens().map(o=>`<option ${o===d.origem?'selected':''}>${esc(o)}</option>`).join('')}</select></div></div>
  ${admin?`<div class="csec">Liberação (admin)</div>
  <div class="fgrid"><div><label>Código do cliente no G360</label><input class="inp" id="kCod" value="${esc(d.codigo||'')}" placeholder="Ex.: 1045"></div>
   <div><label>Situação</label><select class="inp" id="kSt">${['pendente','aprovado','reprovado','bloqueado'].map(s=>`<option value="${s}" ${s===(d.status||'aprovado')?'selected':''}>${{pendente:'Aguardando aprovação',aprovado:'Aprovado',reprovado:'Reprovado',bloqueado:'Bloqueado'}[s]}</option>`).join('')}</select></div>
   <div class="full"><label>Vendedor responsável</label><select class="inp" id="kVend"><option value="">—</option>${CFG.vendedores.map(v=>`<option ${v===d.vendedor?'selected':''}>${esc(v)}</option>`).join('')}</select></div></div>
  <label>Formas de pagamento liberadas</label><div class="chks">${CFG.formas.map(f=>`<label><input type="checkbox" data-fp="${f.id}" ${(d.pagamentos||CFG.pagPadrao).includes(f.id)?'checked':''}>${esc(f.nome)}</label>`).join('')}</div>
  ${(d.enderecos||[]).length?`<label>Outros endereços de entrega</label><div class="elist">${d.enderecos.map(x=>`<div class="eitem"><div><b>${esc(x.apelido||'Endereço')}</b><small>${esc(endTxt(x))}</small></div></div>`).join('')}</div>`:''}
  <div class="csec">Acesso</div><div class="fgrid"><div class="full"><label>${d.senha?'Nova senha (deixe em branco para manter)':'Senha de acesso'}</label><input class="inp" id="kSen" type="text" placeholder="${d.senha?'••••':'Defina uma senha'}"></div></div>`
  :`<div class="csec">Acesso</div><div class="fgrid"><div><label>Crie uma senha <span class="req">*</span></label><input class="inp" id="kSen" type="password" placeholder="Mínimo 6 caracteres"></div>
   <div><label>Repita a senha <span class="req">*</span></label><input class="inp" id="kSen2" type="password"></div></div>`}`; }
function bindCliForm(){ bindCep('k');
  const mk=()=>{const i=$('kCnpj'),c=i.value.replace(/\D/g,'').slice(0,14); i.value=fmtCNPJ(c); return c};
  $('kCnpj').addEventListener('input',()=>{const c=mk(); if(c.length===14&&!$('kCnpj').readOnly)$('kBusca').click()});
  $('kIsento').onchange=()=>{ $('kIE').disabled=$('kIsento').checked; if($('kIsento').checked){$('kIE').value='';$('kIEM').textContent=''} };
  $('kIE').addEventListener('input',e=>e.target.value=e.target.value.replace(/[^0-9A-Za-z]/g,'').slice(0,20));
  ['kWa','kTel'].forEach(id=>$(id).addEventListener('input',e=>e.target.value=e.target.value.replace(/\D/g,'').slice(0,11)));
  $('kBusca').onclick=async()=>{ const c=$('kCnpj').value.replace(/\D/g,''), m=$('kCnpjM');
    if(!cnpjOk(c)){m.className='okmsg bad';m.textContent='CNPJ inválido. Confira os números.';return}
    m.className='okmsg';m.textContent='Consultando dados da empresa…';
    try{ const j=await API.consultarCNPJ(c); $('kRaz').value=j.razao_social||''; $('kFan').value=j.fantasia||'';
      $('kCep').value=(j.cep||'').replace(/\D/g,''); $('kLog').value=j.logradouro||''; $('kNum').value=j.numero||''; $('kCom').value=j.complemento||''; $('kBai').value=j.bairro||''; $('kCid').value=j.cidade||''; $('kUf').value=j.uf||'';
      if(j.telefone)$('kTel').value=String(j.telefone).replace(/\D/g,'');
      if(j.email&&!$('kEm').value)$('kEm').value=String(j.email).toLowerCase();
      if(j.inscricao_estadual==='ISENTO'){ $('kIsento').checked=true; $('kIE').disabled=true; $('kIE').value=''; $('kIEM').className='okmsg'; $('kIEM').textContent='Empresa isenta de inscrição estadual.'; }
      else if(j.inscricao_estadual){ $('kIsento').checked=false; $('kIE').disabled=false; $('kIE').value=j.inscricao_estadual; $('kIEM').className='okmsg'; $('kIEM').textContent='✓ Inscrição estadual preenchida pela consulta'+(j.simulado?' (simulada)':'')+'.'; }
      else { $('kIEM').className='okmsg bad'; $('kIEM').textContent='Inscrição estadual não informada pela consulta. Digite ou marque "Isento".'; }
      m.textContent=`✓ ${j.situacao?'Situação: '+j.situacao:'Dados encontrados'}${j.simulado?' (consulta simulada)':''} — confira e complete.`;
      if(j.situacao&&j.situacao!=='ATIVA'){m.className='okmsg bad'}
    }catch(err){m.className='okmsg bad';m.textContent=err.message||'Não foi possível consultar. Preencha manualmente.'} };
}
function lerCliForm(admin){ const a=readAddr('k'), c=$('kCnpj').value.replace(/\D/g,'');
  const d={cnpj:c,razao_social:$('kRaz').value.trim(),fantasia:$('kFan').value.trim()||$('kRaz').value.trim(),inscricao_estadual:$('kIsento').checked?'ISENTO':$('kIE').value.trim(),...a,responsavel:$('kResp').value.trim(),whats:$('kWa').value.replace(/\D/g,''),telefone:$('kTel').value.replace(/\D/g,''),email:$('kEm').value.trim(),origem:$('kOri').value};
  const falta=[]; if(!cnpjOk(c))falta.push('CNPJ válido'); if(!d.razao_social)falta.push('razão social'); if(!d.inscricao_estadual)falta.push('inscrição estadual (ou marque Isento)'); if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email))falta.push('e-mail válido'); if(!addrOk(a))falta.push('endereço completo'); if(!d.responsavel)falta.push('responsável'); if(d.whats.length<10)falta.push('WhatsApp com DDD'); if(!d.origem)falta.push('como nos conheceu');
  if(!admin){const s=$('kSen').value; if(s.length<6)falta.push('senha com 6+ caracteres'); else if(s!==$('kSen2').value)falta.push('senhas iguais'); d.senha=s;}
  return {d,falta}; }
/* cadastro público */
function openCad(){ $('admBox').innerHTML=''; $('mAdm').classList.remove('open'); $('cadBox').innerHTML=`<div class="fxh"><div><h3>Criar cadastro</h3><div class="sub">Preencha os dados da sua empresa. Após a aprovação você recebe a liberação pelo WhatsApp e já pode comprar.</div></div><button class="fxx" id="kX">×</button></div>
  ${cliForm({},false)}<div class="err" id="kE"></div>
  <div class="act"><button class="btn sec" id="kV">Já tenho cadastro</button><button class="btn pri" id="kOk">Enviar cadastro</button></div>`;
  bindCliForm(); $('mCad').classList.add('open'); setTimeout(()=>$('kCnpj').focus(),60);
  $('kX').onclick=()=>$('mCad').classList.remove('open'); $('kV').onclick=()=>{$('mCad').classList.remove('open');openLogin()};
  $('kOk').onclick=async()=>{ const {d,falta}=lerCliForm(false); if(falta.length){$('kE').textContent='Falta preencher: '+falta.join(', ')+'.';return}
    $('kOk').disabled=true; $('kOk').textContent='Enviando…';
    try{ await API.cadastrar(d); }catch(e){ $('kE').textContent=e.message; $('kOk').disabled=false; $('kOk').textContent='Enviar cadastro'; return }
    $('cadBox').innerHTML=`<div class="ok"><div class="ic2">✓</div><h3>Cadastro enviado!</h3><p>Recebemos os dados da <b>${esc(d.fantasia)}</b>. Nossa equipe vai analisar e você recebe a liberação pelo WhatsApp <b>${esc(fmtTel(d.whats))}</b>.</p></div><div class="act" style="justify-content:center"><button class="btn pri" id="kF">Voltar ao catálogo</button></div>`;
    $('kF').onclick=()=>$('mCad').classList.remove('open'); if(ADM)updMrgBadge(); };
}
$('mCad').onclick=e=>{if(e.target.id==='mCad')$('mCad').classList.remove('open')};
/* admin: clientes */
['clQ','clSt'].forEach(id=>$(id).addEventListener('input',()=>drawCli(false)));
async function carregaClientesAdm(){ try{ CLIENTES=await API.listarClientes(); }catch(e){ if(/Sessão/i.test(e.message)){ toast('Sessão do admin expirou. Entre novamente.'); setAdm(false); openLogin(()=>go('adm'),'adm'); } else toast(e.message); throw e; } fillCgCli(); updMrgBadge(); }


async function drawCli(refetch=true){ if(refetch){ $('clPanel').innerHTML='<div class="empty2">Carregando clientes…</div>'; try{ await carregaClientesAdm(); }catch(e){ $('clPanel').innerHTML=`<div class="empty2">${esc(e.message)}</div>`; return } } const q=norm($('clQ').value.trim()), st=$('clSt').value;
  const L=Object.entries(CLIENTES).map(([cnpj,c])=>({cnpj,...c})).filter(c=>(!st||c.status===st)&&(!q||norm([c.nome,c.fantasia,c.cnpj,c.codigo,c.cidade].join(' ')).includes(q)))
    .sort((a,b)=>(a.status==='pendente'?0:1)-(b.status==='pendente'?0:1)||(b.criado_em||'').localeCompare(a.criado_em||''));
  $('clPanel').innerHTML=`<div class="crow2 h"><div>Cliente (${L.length})</div><div>Cód. G360</div><div>Cidade</div><div>Situação</div><div></div></div>`+(L.length?L.map(c=>`<div class="crow2" data-c="${c.cnpj}">
    <div class="nm"><b>${esc(c.fantasia||c.nome)}</b><small>${fmtCNPJ(c.cnpj)} · ${esc(c.nome||'')}</small><small>IE: ${esc(c.inscricao_estadual||'não informada')}${c.email?' · '+esc(c.email):''}</small><small>${esc(c.origem||'')}${c.whats?' · '+fmtTel(c.whats):''}</small></div>
    <div class="sm sm2">${c.codigo?esc(c.codigo):'<span style="color:var(--tx3)">—</span>'}</div><div class="sm">${esc(c.cidade||'')}${c.uf?'/'+c.uf:''}${c.codigo?'<span class="som"> · cód. '+esc(c.codigo)+'</span>':''}</div>
    <div class="stw"><span class="stt ${c.status}">${{pendente:'Aguardando',aprovado:'Aprovado',reprovado:'Reprovado',bloqueado:'Bloqueado'}[c.status]||c.status}</span></div>
    <div class="ab2">${c.status==='pendente'?'<button class="ap" data-ap>Aprovar</button><button class="rp" data-rp>Reprovar</button>':''}<button data-lista>⭐ Minha Lista</button><button data-ed>Editar</button></div></div>`).join(''):'<div class="empty2">Nenhum cliente encontrado.</div>'); }
$('clPanel').addEventListener('click',async e=>{const r=e.target.closest('.crow2[data-c]');if(!r)return;const cn=r.dataset.c;
  if(e.target.matches('[data-ap]')){await API.salvarClienteAdmin(cn,{status:'aprovado'});drawCli();updMrgBadge();toast('Cliente aprovado ✓ — avise pelo WhatsApp '+fmtTel(CLIENTES[cn].whats));return}
  if(e.target.matches('[data-rp]')){await API.salvarClienteAdmin(cn,{status:'reprovado'});drawCli();updMrgBadge();toast('Cadastro reprovado');return}
  if(e.target.matches('[data-lista]')){window.SRListaAdmin?.open(cn);return}
  if(e.target.matches('[data-ed]'))openCliAdm(cn);});
$('clNovo').onclick=()=>openCliAdm(null);
function openCliAdm(cn){ $('cadBox').innerHTML=''; $('mCad').classList.remove('open'); const d=cn?{cnpj:cn,...CLIENTES[cn]}:{status:'aprovado'};
  $('admBox').innerHTML=`<div class="fxh"><div><h3>${cn?'Editar cliente':'Novo cliente'}</h3><div class="sub">${cn?'Cadastrado em '+(d.criado_em||'').split('-').reverse().join('/'):'Cadastro feito pelo admin já entra aprovado.'}</div></div><button class="fxx" id="kX">×</button></div>
   ${cliForm(d,true)}<div class="err" id="kE"></div><div class="act"><button class="btn sec" id="kC">Cancelar</button><button class="btn pri" id="kOk">Salvar cliente</button></div>`;
  bindCliForm(); $('mAdm').classList.add('open'); const cl=()=>$('mAdm').classList.remove('open'); $('kX').onclick=cl; $('kC').onclick=cl;
  $('kOk').onclick=async()=>{ const {d:n,falta}=lerCliForm(true); if(falta.length){$('kE').textContent='Falta preencher: '+falta.join(', ')+'.';return}
    if(!cn&&CLIENTES[n.cnpj]){$('kE').textContent='Já existe um cliente com este CNPJ.';return}
    const pags=[...document.querySelectorAll('[data-fp]:checked')].map(x=>x.dataset.fp);
    const dados={...n,nome:n.razao_social,codigo:$('kCod').value.trim(),status:$('kSt').value,vendedor:$('kVend').value,pagamentos:pags};
    if($('kSen').value)dados.senha=$('kSen').value; else if(!cn){$('kE').textContent='Defina uma senha de acesso para o cliente.';return}
    if(!cn){dados.criado_em=new Date().toISOString().slice(0,10);dados.enderecos=[];dados.lista=[]}
    delete dados.razao_social; await API.salvarClienteAdmin(n.cnpj,dados); cl(); drawCli(); updMrgBadge(); fillCgCli(); toast('Cliente salvo ✓');
    if(CNPJ===n.cnpj){await loadCli(CNPJ,null);} };
}
/* conta do cliente */
$('tbConta').onclick=()=>{ if(!CLI&&!ADM){openLogin();return} drawConta(); $('mConta').classList.add('open'); };
function drawConta(addForm){ const cl=()=>$('mConta').classList.remove('open'), r=CLI?CLI.rec:null;
  $('contaBox').innerHTML=`<div class="conta"><div class="av">${CLI?esc(CLI.fantasia[0]):'A'}</div><h3>${CLI?esc(CLI.fantasia):'Administrador'}</h3><div class="sub">${CLI?esc(CLI.nome)+'<br>CNPJ '+fmtCNPJ(CNPJ)+(CLI.vendedor?' · Vendedor: '+esc(CLI.vendedor):''):'Modo administrador ativo'}</div></div>
   ${CLI?`<label>Endereços de entrega</label><div class="elist"><div class="eitem"><div><b>Endereço do cadastro</b><small>${esc(endTxt(r))}</small></div></div>
     ${(r.enderecos||[]).map(x=>`<div class="eitem"><div><b>${esc(x.apelido||'Endereço')}</b><small>${esc(endTxt(x))}</small></div><button data-rme="${x.id}">Remover</button></div>`).join('')}</div>
     ${addForm?`<div class="panel" style="padding:12px 14px;margin-bottom:8px"><label style="margin-top:0">Nome do endereço</label><input class="inp" id="nAp" placeholder="Ex.: Filial Centro, Depósito">${addrFields('n')}<div class="err" id="nE"></div><div class="act" style="margin-top:10px"><button class="btn sec" id="nC">Cancelar</button><button class="btn pri" id="nOk">Salvar endereço</button></div></div>`:'<button class="addu" id="nAdd">+ Cadastrar outro endereço de entrega</button>'}`:''}
   <div class="act" style="flex-direction:column">${CLI?'<button class="btn sec" id="cnP">Meus pedidos</button>':''}${ADM?'<button class="btn sec" id="cnA">Painel admin</button><button class="btn sec" id="cnSA">Sair do admin</button>':''}${CLI?'':'<button class="btn pri" id="cnL">Entrar como cliente</button>'}<button class="btn del" id="cnS" style="margin:0">Sair da conta</button><button class="btn sec" id="cnX">Fechar</button></div>`;
  $('cnX').onclick=cl; if($('cnP'))$('cnP').onclick=()=>{cl();go('ped')}; if($('cnA'))$('cnA').onclick=()=>{cl();go('adm')};
  if($('cnSA'))$('cnSA').onclick=()=>{cl();setAdm(false);go('cat')}; if($('cnS'))$('cnS').onclick=sairConta; if($('cnL'))$('cnL').onclick=()=>{cl();openLogin()};
  if($('nAdd'))$('nAdd').onclick=()=>drawConta(true);
  if($('nC'))$('nC').onclick=()=>drawConta(false);
  if(addForm){bindCep('n'); $('nOk').onclick=()=>salvarNovoEnd('n',$('nAp').value,()=>drawConta(false))}
}
async function salvarNovoEnd(k,apelido,depois){ const a=readAddr(k); if(!addrOk(a)){$(k+'E').textContent='Preencha o endereço completo.';return}
  const lista=[...(CLI.rec.enderecos||[]),{id:'e'+Date.now().toString(36),apelido:(apelido||'').trim()||'Entrega '+((CLI.rec.enderecos||[]).length+2),...a}];
  await API.salvarEnderecos(CNPJ,lista); CLI.rec.enderecos=lista; toast('Endereço salvo ✓'); depois&&depois(lista[lista.length-1].id); }
$('contaBox').addEventListener('click',async e=>{const id=e.target.dataset.rme; if(!id)return; const lista=CLI.rec.enderecos.filter(x=>x.id!==id); await API.salvarEnderecos(CNPJ,lista); CLI.rec.enderecos=lista; drawConta(false); toast('Endereço removido')});
$('mConta').onclick=e=>{if(e.target.id==='mConta')$('mConta').classList.remove('open')};
document.body.classList.toggle('admin',ADM);
/* ---------- início ---------- */
{const sc=window.__SR_SESSAO_CLIENTE;
 if(sc)loadCli(sc.cnpj,sc).then(render).catch(()=>{CLI=null;CNPJ=null;document.body.classList.remove('logged');drawUser();render()}); else drawUser();
 if(ADM) carregaClientesAdm().catch(()=>{});
 if(DEMO)document.body.classList.add('modo-demo');}

/* Ponte segura: só produtos cadastrados podem aparecer em cards ou nas ações. */
window.SouzinhaPortal={
 navigate:function(v){go(v)},
 search:function(query){
  cat='';const m=document.getElementById('marca');if(m)m.value='';
  const q=document.getElementById('q');q.value=String(query||'').slice(0,100);go('cat');render();
  q.dispatchEvent(new Event('input',{bubbles:true}));
 },
 candidates:function(phrase){
  const text=norm(String(phrase||''));
  const bySeg=[
   {re:/academia|fitness|pilates|estudio de treino|box de cross|vestiario/,codes:['124514','000308','22','06050','2KP100','775','100119','53235','001482','1KP60','100039','4200']},
   {re:/clinica|consultorio|hospital|odontol/,codes:['124514','100039','22','000308','1KP60','06050','100119','53235','12036ST']},
   {re:/restaurante|lanchonete|delivery|cafeteria/,codes:['002525','775','100293','001482','1KP60','10032','000859','2651','4200']},
   {re:/escola|colegio|creche/,codes:['124514','000308','22','06050','1KP60','775','53235','001482']},
   {re:/escritorio|condominio|empresa|escritorios/,codes:['124514','000308','22','06050','1KP60','775','100119','001482']}
  ];
  const preset=bySeg.find(x=>x.re.test(text));
  const result=[],seen=new Set();
  const add=p=>{if(p&&!p.off&&!seen.has(p.cod)){seen.add(p.cod);result.push(p)}};
  if(preset)preset.codes.forEach(c=>add(byCod[c]));
  const stop=new Set(['quero','preciso','procurando','procuro','comprar','para','uma','uns','das','dos','que','tem','com','qual','algum','alguma','favor','voce','voces','souzinha','ola','oi','bom','dia','boa','tarde','noite','empresa','ajuda','itens','produtos','produto','precisando','saber','consegue','poderia','gostaria','meu','minha','seria','mais','montar','lista','minhas','monte','pode']);
  const terms=termosBusca(text).filter(x=>x.length>2&&!stop.has(x)).slice(0,8),map=mapaSinonimos();
  if(terms.length){
   const weighted=P.filter(p=>!p.off).map(p=>{
    const idx=indiceBusca(p,map);let score=0;
    for(const t of terms){const c=buscaCanonica(t,map);
     if(idx.canonicas.some(w=>w===c))score+=6;
     else if(idx.canonicas.some(w=>w.includes(c)||(c.includes(w)&&w.length>3)))score+=3;
    }
    return {p,score};
   }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.p.t.localeCompare(b.p.t,'pt'));
   weighted.forEach(x=>{if(result.length<24)add(x.p)});
  }
  return result.slice(0,24).map(p=>({cod:p.cod,name:p.t,category:p.c,unit:p.u}));
 },
 product:function(code){
  const p=byCod[String(code)];if(!p||p.off)return null;
  return {code:p.cod,name:p.t,category:p.c,unit:p.u,image:imgUrl(p),price:vePreco()?brl(base(p)):null,listed:!!(CLI&&CLI.lista.some(x=>x.cod===p.cod))};
 },
 addCart:function(code){
  const p=byCod[String(code)];if(!p||p.off)return;
  need(()=>{addCart(p.cod,1);render()});
 },
 addList:function(code){
  const p=byCod[String(code)];if(!p||p.off)return;
  need(()=>{
   if(!CLI.lista.some(x=>x.cod===p.cod)){CLI.lista.push({cod:p.cod,ult:0,dt:'',med:0});saveLista();toast('Produto adicionado à Minha Lista ⭐')}
   else toast('Este produto já está na Minha Lista');
   render();
  });
 },
 addMany:function(codes){
  const items=[...new Set(codes)].map(c=>byCod[c]).filter(p=>p&&!p.off);
  if(!items.length)return;
  need(()=>{
   let n=0;for(const p of items)if(!CLI.lista.some(x=>x.cod===p.cod)){CLI.lista.push({cod:p.cod,ult:0,dt:'',med:0});n++;}
   if(n)saveLista();
   toast(n?n+' produtos adicionados à Minha Lista ⭐':'Todos os produtos já estão na Minha Lista');
   render();
  });
 },
 view:function(code){const p=byCod[String(code)];if(p&&!p.off)openDet(p)}
};



/* Interfaces mínimas para as funcionalidades adicionais, sem expor tokens admin ao cliente. */
window.SRListaAdminBridge={
 isAdmin:()=>!!ADM,
 clientName:cn=>{const c=CLIENTES[cn];return (c?.fantasia||c?.nome||c?.razao_social||cn)+' · '+fmtCNPJ(cn)},
 catalog:()=>P.filter(p=>!p.off).map(p=>({cod:p.cod,name:p.t,unit:p.u,category:p.c,brand:p.m,price:p.p,image:imgUrl(p)})),
 product:cod=>{const p=byCod[cod];return p&&!p.off?{cod:p.cod,name:p.t,unit:p.u,category:p.c,brand:p.m,price:p.p,image:imgUrl(p)}:null},
 seed:cn=>(CLIENTES[cn]?.lista||[]).map(v=>Array.isArray(v)?{cod:v[0],ultima_qtd:v[1]||0,ultima_data:v[2]||null,media_qtd:v[3]||0,qtd_sugerida:0}:v),
 get:async cn=>API.listaClienteAdmin(cn),
 save:async(cn,itens)=>API.salvarListaClienteAdmin(cn,itens),
 refresh:async cn=>{
  CONG[cn]=await API.buscarCongeladosAdmin(cn);
  if(CNPJ===cn&&CLI)await loadCli(cn,null);
  if(VIEW==='adm'&&AT==='cong')drawCong();
 }
};
window.SRNegociacaoBridge={
 api:()=>API,
 produto:cod=>{const p=byCod[cod];return p?{cod:p.cod,nome:p.t,preco:p.p,custo:p.k,unidade:p.u,estoque:p.s}:null},
 margemMin:()=>Number(CFG.margemMin)||25,
 atualizarPrecos:()=>recarregaCatalogo(),
 addCart:itens=>{itens.forEach(i=>{if(byCod[i.cod]){const k=kOf(i.cod,i.un_id||'');CART[k]=(CART[k]||0)+Number(i.q)}});saveCart();openCart()},
 toast:m=>toast(m),
 irPedidos:()=>go('ped'),
 customer:()=>CLI?{cnpj:CNPJ,nome:CLI.fantasia||CLI.nome,vendedor:CLI.vendedor}:null,
 isAdmin:()=>!!ADM,
 items:source=>(source==='lista'?listaItems():cartItems()).map(i=>({cod:i.p.cod,nome:i.p.t,q:i.q,preco:pu(i.p,i.un),unidade:unTxt(i.p,i.un),un_id:i.un.id||'',fator:i.un.id?i.un.fator:1}))
};

drawCats(); render(); updSem();
carregarFotosCompartilhadas().catch(e=>console.warn('Fotos:',e.message));
atualizarBotaoFotosLocais();