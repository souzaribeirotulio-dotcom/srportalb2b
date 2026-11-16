/* Minha Lista por cliente, feita pelo administrador; Supabase é a fonte oficial. */
(function(){
'use strict';
const api=()=>window.SRListaAdminBridge;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\u0027':'&#39;'}[c]));
const money=n=>Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
let customer=null,items=[],frozen={},saving=false,backFocus=null;
const modal=document.createElement('div');
modal.id='srListaAdminModal';modal.className='srla-layer';modal.hidden=true;modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Criar Minha Lista do cliente');
modal.innerHTML='<section class="srla-dialog" tabindex="-1"><header class="srla-head"><div><small>ADMINISTRADOR · SOUZA RIBEIRO</small><h2>Montar Minha Lista</h2><p id="srlaCliente"></p></div><button type="button" id="srlaClose" aria-label="Fechar">×</button></header><div class="srla-intro">Escolha os produtos, defina quantidades sugeridas e, se desejar, congele um preço unitário exclusivo para este cliente.</div><div class="srla-toolbar"><input id="srlaBusca" type="search" placeholder="Pesquisar por produto, marca ou código…" autocomplete="off" aria-label="Pesquisar produtos para Minha Lista"><span id="srlaCount">0 itens</span></div><div id="srlaResults" class="srla-results" hidden></div><div id="srlaSelected" class="srla-selected"></div><p class="srla-hint">Os preços congelados são opcionais e específicos deste cliente. Se um item já tiver preço congelado, desmarcar a opção remove esse congelamento ao salvar. Excluir um produto da lista não apaga seu preço personalizado anterior.</p><p id="srlaMessage" role="status" aria-live="polite"></p><footer class="srla-footer"><button type="button" id="srlaCancel" class="srla-btn ghost">Cancelar</button><button type="button" id="srlaSave" class="srla-btn primary">Salvar Minha Lista</button></footer></section>';
document.body.appendChild(modal);
const $=id=>document.getElementById(id);
function showMsg(t,error=false){$('srlaMessage').textContent=t;$('srlaMessage').style.color=error?'#ffb3ad':'#b2e04a'}
function close(){modal.hidden=true;document.body.classList.remove('srla-open');customer=null;items=[];$('srlaResults').hidden=true;if(backFocus?.isConnected)backFocus.focus({preventScroll:true})}
function elProduct(p){return '<b>'+esc(p.name)+'</b><small>Cód. '+esc(p.cod)+' · '+esc(p.unit)+' · tabela '+money(p.price)+'</small>'}
function catalogResults(){
 const q=norm($('srlaBusca').value.trim()),list=$('srlaResults');
 if(!q){list.hidden=true;list.innerHTML='';return}
 const ts=q.split(/\s+/).filter(Boolean);
 const found=(api()?.catalog?.()||[]).filter(p=>!items.some(i=>i.cod===p.cod)&&ts.every(t=>norm([p.cod,p.name,p.category,p.brand].join(' ')).includes(t))).slice(0,18);
 list.innerHTML=found.length?found.map(p=>'<button type="button" class="srla-result" data-add="'+esc(p.cod)+'"><span>'+elProduct(p)+'</span><span class="srla-plus">+ Adicionar</span></button>').join(''):'<p class="srla-empty">Nenhum produto disponível encontrado para essa busca.</p>';
 list.hidden=false;
}
function add(code){
 const p=api()?.product?.(code);if(!p||items.some(i=>i.cod===code))return;
 const old=frozen[p.cod];
 items.push({cod:p.cod,qtd_sugerida:0,ultima_qtd:0,media_qtd:0,ultima_data:null,freeze:old!==undefined&&old!==null,price:old===undefined?'':String(old),wasFrozen:old!==undefined&&old!==null});
 $('srlaBusca').value='';catalogResults();selected();showMsg('');
}
function selected(){
 $('srlaCount').textContent=items.length+' produto'+(items.length===1?'':'s')+' selecionado'+(items.length===1?'':'s');
 $('srlaSelected').innerHTML=items.length?items.map((i,index)=>{
 const p=api()?.product?.(i.cod);if(!p)return '';
 return '<article class="srla-item" data-code="'+esc(i.cod)+'">'+
 '<div class="srla-item-row"><img src="'+esc(p.image)+'" alt="" loading="lazy" referrerpolicy="no-referrer"><div class="srla-item-main">'+elProduct(p)+'</div><button type="button" data-remove="'+esc(i.cod)+'" class="srla-rem">Remover</button></div>'+
 '<div class="srla-item-controls"><label>Quantidade sugerida <input type="number" min="0" max="1000000" step="1" inputmode="numeric" data-qty="'+esc(i.cod)+'" value="'+Number(i.qtd_sugerida||0)+'" aria-label="Quantidade sugerida de '+esc(p.name)+'"></label>'+
 '<label class="srla-check"><input type="checkbox" data-freeze="'+esc(i.cod)+'" '+(i.freeze?'checked':'')+'> Congelar preço para este cliente</label>'+
 '<label class="srla-price" data-price-row="'+esc(i.cod)+'" '+(i.freeze?'':'hidden')+'>Preço congelado unitário (R$)<input type="number" min="0.01" max="99999999" step="0.01" inputmode="decimal" data-price="'+esc(i.cod)+'" value="'+esc(i.price)+'" placeholder="Ex.: 12,90"></label>'+
 '</div></article>';
 }).join(''):'<p class="srla-empty">A lista está vazia. Pesquise um produto no campo acima para começar.</p>';
}
async function open(cnpj){
 if(!api()?.isAdmin?.())return;
 backFocus=document.activeElement;customer=String(cnpj||'');items=[];frozen={};
 modal.hidden=false;document.body.classList.add('srla-open');
 $('srlaCliente').textContent=api()?.clientName?.(customer)||customer;
 $('srlaBusca').value='';$('srlaResults').hidden=true;$('srlaSelected').innerHTML='<p class="srla-empty">Carregando lista e preços do cliente…</p>';
 showMsg('');
 $('srlaSave').disabled=true;
 try{
  const response=await api().get(customer);
  if(customer!==cnpj||modal.hidden)return;
  frozen=response.congelados||{};
  let source=(response.configurada?response.lista:api().seed(customer))||[];
  if(!Array.isArray(source))source=[];
  items=source.filter(x=>api()?.product?.(x.cod)).map(x=>{
   const f=frozen[x.cod];
   return {cod:x.cod,qtd_sugerida:Number(x.qtd_sugerida)||0,ultima_qtd:Number(x.ultima_qtd)||0,media_qtd:Number(x.media_qtd)||0,ultima_data:x.ultima_data||null,
    freeze:f!==undefined&&f!==null,wasFrozen:f!==undefined&&f!==null,price:f===undefined?'':String(f)};
  });
  selected();
  $('srlaSave').disabled=false;
  $('srlaBusca').focus({preventScroll:true});
 }catch(e){showMsg('Falha ao abrir a lista do cliente: '+e.message,true);$('srlaSelected').innerHTML=''}
}
async function save(){
 if(!customer||saving||!api()?.isAdmin?.())return;
 const payload=[];
 for(const item of items){
  const quantity=Number(item.qtd_sugerida);
  if(!Number.isInteger(quantity)||quantity<0||quantity>1000000){showMsg('Informe quantidades inteiras entre 0 e 1.000.000.',true);return}
  const cur={cod:item.cod,qtd_sugerida:quantity,ultima_qtd:item.ultima_qtd||0,ultima_data:item.ultima_data||null,media_qtd:item.media_qtd||0,preco_modo:'manter'};
  if(item.freeze){
   const price=Number(item.price);
   if(!Number.isFinite(price)||price<=0||price>99999999||!Number.isInteger(Math.round(price*10000)/100)){showMsg('Confira os preços congelados: devem ser valores positivos com até duas casas decimais.',true);return}
   cur.preco_modo='congelar';cur.preco=+price.toFixed(2);
  }else if(item.wasFrozen)cur.preco_modo='remover';
  payload.push(cur);
 }
 const cn=customer;saving=true;$('srlaSave').disabled=true;showMsg('Salvando lista do cliente…');
 try{
  await api().save(cn,payload);
  showMsg('✓ Minha Lista salva no Supabase! O cliente verá as alterações ao atualizar o portal.');
  if(api()?.refresh)await api().refresh(cn);
  setTimeout(()=>{if(customer===cn&&!modal.hidden)close()},800);
 }catch(e){showMsg('Não foi possível salvar: '+e.message,true)}
 finally{saving=false;$('srlaSave').disabled=false}
}
$('srlaClose').onclick=close;$('srlaCancel').onclick=close;$('srlaSave').onclick=save;
$('srlaBusca').addEventListener('input',catalogResults);
$('srlaResults').addEventListener('click',e=>{const b=e.target.closest('[data-add]');if(b)add(b.dataset.add)});
$('srlaSelected').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(!b)return;items=items.filter(x=>x.cod!==b.dataset.remove);selected();catalogResults()});
$('srlaSelected').addEventListener('input',e=>{
 const code=e.target.dataset.qty||e.target.dataset.price;
 if(!code)return;
 const i=items.find(x=>x.cod===code);if(!i)return;
 if(e.target.dataset.qty)i.qtd_sugerida=e.target.value===''?0:Number(e.target.value);
 else i.price=e.target.value;
});
$('srlaSelected').addEventListener('change',e=>{
 if(!e.target.matches('[data-freeze]'))return;
 const code=e.target.dataset.freeze,i=items.find(x=>x.cod===code);if(!i)return;
 i.freeze=e.target.checked;
 if(i.freeze&&!i.price){const p=api()?.product?.(code);i.price=String(p?.price||'')}
 const label=$('srlaSelected').querySelector('[data-price-row="'+code+'"]');
 if(label){label.hidden=!i.freeze;const input=label.querySelector('[data-price]');if(input){input.value=i.price;if(i.freeze)input.focus({preventScroll:true})}}
});
modal.addEventListener('click',e=>{if(e.target===modal&&!saving)close()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.hidden&&!saving)close()});
window.SRListaAdmin={open};
})();