/* Souza Ribeiro · Negociacao B2B · Demonstracao visual
   Propostas persistem APENAS na aba atual (sessionStorage).
   Nenhuma requisicao e enviada ao vendedor / ERP / Supabase.
   Contrato futuro: POST /negociacoes, GET /minhas-negociacoes,
   GET /admin/negociacoes, PATCH /admin/negociacoes/:id (autenticacao no servidor).
*/
(function(){
'use strict';
const bridge=()=>window.SRNegociacaoBridge;
const KEY='sr_b2b_negociacoes_apresentacao_v1';
const LABELS={solicitada:'Aguardando análise',analise:'Em análise',proposta:'Proposta disponível',aceita:'Aceite demonstrativo',recusada:'Não aprovada'};
const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\u0027':'&#39;'}[ch]));
const money=v=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=v=>{try{return new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}catch{return '—'}};
let draft=null,focusBack=null;
let quotes=[];
try{const data=JSON.parse(sessionStorage.getItem(KEY)||'[]');if(Array.isArray(data))quotes=data.filter(x=>x&&x.id&&Array.isArray(x.items)).slice(0,40)}catch{}
const modal=document.createElement('div');
modal.className='neg-layer';modal.id='negModal';modal.hidden=true;
modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Negociação de preços');
modal.innerHTML='<section class="neg-dialog" tabindex="-1"><div id="negBody"></div></section>';
document.body.appendChild(modal);
const body=modal.querySelector('#negBody');
const btn=(label,action,klass='')=>'<button type="button" data-neg="'+action+'" class="neg-btn '+klass+'">'+label+'</button>';
const banner='<div class="neg-demo"><strong>Prévia para apresentação</strong> · Esta versão simula o processo apenas nesta aba. Não envia propostas à equipe nem altera preços do catálogo.</div>';
function store(){try{sessionStorage.setItem(KEY,JSON.stringify(quotes.slice(0,40)))}catch{}}
function show(markup){
 focusBack=document.activeElement;
 body.innerHTML=markup;modal.hidden=false;document.body.classList.add('neg-dialog-open');
 const dialog=modal.querySelector('.neg-dialog');if(dialog)dialog.scrollTop=0;
 dialog?.focus({preventScroll:true});
}
function close(){
 modal.hidden=true;document.body.classList.remove('neg-dialog-open');draft=null;
 if(focusBack?.isConnected)focusBack.focus({preventScroll:true});
}
function header(title,sub){
 return '<header class="neg-head"><div><span class="neg-eyebrow">SOUZA RIBEIRO · NEGOCIAÇÃO B2B</span><h2>'+esc(title)+'</h2><p>'+esc(sub)+'</p></div><button type="button" data-neg="close" class="neg-x" aria-label="Fechar">×</button></header>';
}
function row(i,index,admin=false){
 const orig=Number(i.preco)||0,subtotal=orig*Number(i.q||0);
 return '<div class="neg-item">'+
  '<div class="neg-item-title"><b>'+esc(i.nome)+'</b><small>Cód. '+esc(i.cod)+' · '+esc(i.unidade)+' · Quantidade: '+Number(i.q)+'</small></div>'+
  '<div class="neg-item-values"><div><span>Preço atual</span><strong>'+money(orig)+'</strong></div>'+
  '<div><span>Subtotal</span><strong>'+money(subtotal)+'</strong></div></div>'+
  (admin?
    '<div class="neg-item-values"><div><span>Valor solicitado</span><strong>'+(Number(i.desejado)>0?money(i.desejado):'Não informado')+'</strong></div>'+
    '<label><span>Preço oferecido (unitário)</span><input data-oferta="'+index+'" type="number" inputmode="decimal" min="0.01" max="99999999" step="0.01" value="'+(Number(i.oferta)>0?Number(i.oferta).toFixed(2):'')+'" placeholder="Opcional"></label></div>':
    '<label class="neg-target"><span>Preço unitário que gostaria de negociar <em>(opcional)</em></span>'+
    '<input data-desejado="'+index+'" type="number" inputmode="decimal" min="0.01" max="99999999" step="0.01" placeholder="Ex.: 12,50"></label>')+
 '</div>';
}
function openFrom(origin){
 const b=bridge(),customer=b?.customer?.();if(!customer)return;
 const raw=b?.items?.(origin)||[];
 const items=raw.filter(x=>Number(x.q)>0&&Number.isFinite(Number(x.preco))&&Number(x.preco)>=0).slice(0,100);
 if(!items.length){alert('Selecione pelo menos um produto e informe as quantidades antes de solicitar negociação.');return}
 draft={cliente:customer,origem:origin,itens:items.map(i=>({
  cod:String(i.cod),nome:String(i.nome),unidade:String(i.unidade),un_id:String(i.un_id||''),
  q:Math.max(1,Math.round(Number(i.q))),preco:Number(i.preco),desejado:null,oferta:null
 }))};
 const total=draft.itens.reduce((v,i)=>v+i.q*i.preco,0);
 show(header('Solicitar negociação','Converse com nossa equipe comercial sobre os preços dos itens selecionados.')+
 '<div class="neg-summary"><span>'+draft.itens.length+' produtos selecionados</span><b>Total atual: '+money(total)+'</b></div>'+
 '<div class="neg-section-title">Produtos e valores</div><div class="neg-list">'+draft.itens.map((i,n)=>row(i,n)).join('')+'</div>'+
 '<div class="neg-fields"><label>Qual é o motivo da negociação?<select id="negMotivo">'+
 '<option value="volume">Compra em volume</option><option value="recorrente">Compra recorrente / contrato</option><option value="concorrencia">Cotação de outro fornecedor</option><option value="outro">Outra condição comercial</option></select></label>'+
 '<label>Explique sua necessidade <em>(opcional)</em><textarea id="negObs" maxlength="500" rows="3" placeholder="Ex.: Tenho consumo mensal desses itens e gostaria de avaliar melhores condições."></textarea></label></div>'+
 '<p class="neg-warning">O envio de uma solicitação não garante desconto. Condições dependem de análise e aprovação comercial.</p>'+banner+
 '<div id="negError" class="neg-error" role="status"></div>'+
 '<div class="neg-footer">'+btn('Cancelar','close','ghost')+btn('Simular solicitação','submit','primary')+'</div>');
}
function submit(){
 if(!draft)return;const items=draft.itens;
 for(const [index,i] of items.entries()){
  const field=body.querySelector('[data-desejado="'+index+'"]');
  const val=field?.value?.trim()||'';
  if(val){
   const v=Number(val);
   if(!Number.isFinite(v)||v<=0||v>99999999){body.querySelector('#negError').textContent='Informe preços válidos e positivos.';return}
   i.desejado=+v.toFixed(2);
  }
 }
 const id='NEG-'+String(Date.now()).slice(-8)+'-'+String(quotes.length+1).padStart(2,'0');
 const now=new Date().toISOString();
 const q={id,cliente:draft.cliente,origem:draft.origem,itens:items,criado_em:now,atualizado_em:now,motivo:body.querySelector('#negMotivo').value,
 observacao:body.querySelector('#negObs').value.trim().slice(0,500),resposta:'',status:'solicitada'};
 quotes.unshift(q);quotes=quotes.slice(0,40);store();renderAdmin();renderClient();
 show(header('Solicitação simulada','Assim será a confirmação exibida ao cliente após a integração.')+
 '<div class="neg-success"><span class="neg-success-icon">✓</span><h3>Negociação registrada na demonstração</h3>'+
 '<p>Número de referência: <b>'+esc(q.id)+'</b></p>'+
 '<p>Numa versão integrada, o time comercial receberá a solicitação e poderá responder por aqui.</p></div>'+banner+
 '<div class="neg-footer">'+btn('Fechar','close','primary')+'</div>');
}
function byId(id){return quotes.find(q=>q.id===id)}
function stageBadge(status){return '<span class="neg-stage s-'+esc(status)+'">'+esc(LABELS[status]||status)+'</span>'}
function previewQuote(q){
 const total=q.itens.reduce((sum,i)=>sum+Number(i.preco)*Number(i.q),0);
 return '<article class="neg-quote" data-ref="'+esc(q.id)+'"><div class="neg-quote-head"><strong>'+esc(q.id)+'</strong>'+stageBadge(q.status)+'</div>'+
 '<div class="neg-quote-detail">'+esc(q.cliente.nome||'Empresa')+' · '+date(q.criado_em)+' · '+q.itens.length+' produto(s) · '+money(total)+'</div>'+
 '<div class="neg-quote-buttons">'+btn('Ver detalhes','view','outline')+'</div></article>';
}
function renderClient(){
 const el=document.getElementById('negClientView'),c=bridge()?.customer?.();if(!el)return;
 if(!c){el.innerHTML='';return}
 const mine=quotes.filter(x=>x.cliente.cnpj===c.cnpj);
 el.innerHTML='<div class="neg-outside-title"><h3>Minhas negociações <small>(demonstração)</small></h3><p>Prévia do acompanhamento de condições comerciais solicitadas pelo portal.</p></div>'+
 (mine.length?mine.map(previewQuote).join(''):'<p class="neg-empty">Você ainda não simulou nenhuma negociação nesta aba. Escolha produtos no carrinho ou na Minha Lista e clique em “Solicitar negociação”.</p>');
}
function renderAdmin(){
 const el=document.getElementById('negAdminView');if(!el||!bridge()?.isAdmin?.())return;
 el.innerHTML='<div class="neg-admin-head"><div><h3>Central de negociações <small>(demonstração)</small></h3>'+
 '<p>Visualização comercial, aprovação e contrapropostas. O sistema não aplica descontos automaticamente.</p></div>'+
 btn('Gerar exemplo','example','outline')+'</div>'+banner+
 '<div class="neg-admin-metrics"><div><small>Solicitações</small><b>'+quotes.length+'</b></div>'+
 '<div><small>Aguardando análise</small><b>'+quotes.filter(q=>q.status==='solicitada').length+'</b></div>'+
 '<div><small>Em análise</small><b>'+quotes.filter(q=>q.status==='analise').length+'</b></div>'+
 '<div><small>Propostas</small><b>'+quotes.filter(q=>q.status==='proposta').length+'</b></div></div>'+
 '<div class="neg-admin-list">'+(quotes.length?quotes.map(previewQuote).join(''):'<p class="neg-empty">Nenhuma solicitação nesta aba. Clique em “Gerar exemplo” para mostrar a experiência na reunião.</p>')+'</div>';
}
function sample(){
 const seed=bridge()?.sample?.()||[];
 if(!seed.length)return;
 const now=new Date().toISOString();
 const q={id:'NEG-DEMO-'+String(quotes.length+1).padStart(2,'0'),cliente:{cnpj:'CLIENTE-EXEMPLO',nome:'Academia Exemplo · demonstração',vendedor:'Equipe Comercial'},
 origem:'exemplo',itens:seed.map(i=>({...i,desejado:null,oferta:null})),motivo:'recorrente',observacao:'Gostaria de avaliar uma condição para reposição mensal.',resposta:'',status:'solicitada',criado_em:now,atualizado_em:now};
 quotes.unshift(q);store();renderAdmin();renderClient();viewAdmin(q.id);
}
function viewAdmin(id){
 const q=byId(id);if(!q)return;
 show(header('Analisar negociação',q.id+' · '+q.cliente.nome)+
 '<div class="neg-summary"><span>Solicitação: '+date(q.criado_em)+'</span>'+stageBadge(q.status)+'</div>'+
 '<p class="neg-note"><b>Motivo:</b> '+esc(({volume:'Compra em volume',recorrente:'Compra recorrente',concorrencia:'Cotação de outro fornecedor',outro:'Outra condição'})[q.motivo]||q.motivo)+'<br>'+
 '<b>Observação:</b> '+esc(q.observacao||'Não informada')+'</p>'+
 '<div class="neg-list">'+q.itens.map((i,n)=>row(i,n,true)).join('')+'</div>'+
 '<div class="neg-fields"><label>Resposta comercial <em>(opcional)</em><textarea id="negResposta" maxlength="500" rows="3" placeholder="Ex.: Podemos revisar as condições conforme o volume mensal.">'+esc(q.resposta||'')+'</textarea></label></div>'+banner+
 '<div class="neg-footer neg-footer-admin">'+btn('Em análise','analysis','outline')+btn('Não aprovar','reject','ghost')+
 btn('Enviar contraproposta','counter','primary')+'</div><div id="negError" class="neg-error"></div>');
 body.dataset.ref=id;
}
function updateAdmin(action){
 if(!bridge()?.isAdmin?.())return;
 const q=byId(body.dataset.ref);if(!q)return;
 const reply=body.querySelector('#negResposta')?.value?.trim().slice(0,500)||'';
 const offers=[];
 for(let n=0;n<q.itens.length;n++){
  const val=body.querySelector('[data-oferta="'+n+'"]')?.value?.trim()||'';
  const v=val?Number(val):null;
  if(v!==null&&(!Number.isFinite(v)||v<=0||v>99999999)){body.querySelector('#negError').textContent='Preencha valores positivos para a contraproposta.';return}
  offers.push(v===null?null:+v.toFixed(2));
 }
 if(action==='counter'&&!offers.some(v=>v!==null)&&!reply){
  body.querySelector('#negError').textContent='Informe pelo menos um preço oferecido ou uma resposta comercial.';return;
 }
 q.itens.forEach((i,n)=>i.oferta=offers[n]);
 q.resposta=reply;
 q.status=action==='analysis'?'analise':action==='reject'?'recusada':'proposta';
 q.atualizado_em=new Date().toISOString();
 store();renderAdmin();renderClient();close();
}
function viewClient(id){
 const c=bridge()?.customer?.(),q=byId(id);
 if(!q||!c||q.cliente.cnpj!==c.cnpj)return;
 show(header('Minha negociação',q.id+' · '+date(q.criado_em))+
 '<div class="neg-summary"><b>'+stageBadge(q.status)+'</b><span>'+q.itens.length+' itens</span></div>'+
 '<div class="neg-list">'+q.itens.map(i=>
 '<div class="neg-item"><div class="neg-item-title"><b>'+esc(i.nome)+'</b><small>'+i.q+' '+esc(i.unidade)+' · cód. '+esc(i.cod)+'</small></div>'+
 '<div class="neg-item-values"><div><span>Preço atual</span><strong>'+money(i.preco)+'</strong></div>'+
 '<div><span>Preço solicitado</span><strong>'+(i.desejado?money(i.desejado):'—')+'</strong></div>'+
 '<div><span>Contraproposta</span><strong>'+(i.oferta?money(i.oferta):'—')+'</strong></div></div></div>').join('')+'</div>'+
 (q.resposta?'<p class="neg-note"><b>Resposta comercial:</b> '+esc(q.resposta)+'</p>':'')+
 banner+'<div class="neg-footer">'+btn('Voltar','close','ghost')+
 (q.status==='proposta'?btn('Simular aceite da proposta','accept','primary'):'')+'</div>');
 body.dataset.ref=id;
}
function accept(){
 const q=byId(body.dataset.ref),c=bridge()?.customer?.();
 if(!q||!c||c.cnpj!==q.cliente.cnpj||q.status!=='proposta')return;
 q.status='aceita';q.atualizado_em=new Date().toISOString();store();renderClient();renderAdmin();
 show(header('Aceite demonstrativo','Esta simulação não gera pedido nem modifica seus preços.')+
 '<div class="neg-success"><span class="neg-success-icon">✓</span><h3>Aceite registrado nesta apresentação</h3>'+
 '<p>A integração futura deverá validar preços, condições e aprovação comercial antes de disponibilizar o checkout.</p></div>'+
 banner+'<div class="neg-footer">'+btn('Fechar','close','primary')+'</div>');
}
modal.addEventListener('click',e=>{
 if(e.target===modal)return close();
 const b=e.target.closest('[data-neg]');if(!b)return;
 const action=b.dataset.neg;
 if(action==='close')return close();
 if(action==='submit')return submit();
 if(action==='analysis'||action==='counter'||action==='reject')return updateAdmin(action);
 if(action==='accept')return accept();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.hidden)close()});
function onListClick(e){
 const b=e.target.closest('[data-neg="view"]');if(!b)return;
 const quote=b.closest('[data-ref]');if(!quote)return;
 const inAdmin=!!b.closest('#negAdminView');
 if(inAdmin&&bridge()?.isAdmin?.())viewAdmin(quote.dataset.ref);
 else viewClient(quote.dataset.ref);
}
document.getElementById('negAdminView')?.addEventListener('click',e=>{
 const b=e.target.closest('[data-neg]');
 if(b?.dataset.neg==='example'){sample();return}
 onListClick(e);
});
document.getElementById('negClientView')?.addEventListener('click',onListClick);
window.SRNegociacao={openFrom,renderClient,renderAdmin};
})();
