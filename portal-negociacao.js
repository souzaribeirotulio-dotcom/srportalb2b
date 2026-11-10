/* Souza Ribeiro · Negociação B2B
   Cliente solicita pelo carrinho ou pela Minha Lista → cai na aba Negociações do admin (Supabase).
   Admin analisa, envia contraproposta (com validade) ou recusa → cliente vê em Pedidos › Minhas negociações
   e aceita: os preços valem no carrinho até a validade (ou viram preço congelado, se o admin marcar).
   RPCs: portal_negociacao_criar, portal_minhas_negociacoes, portal_negociacao_aceitar, portal_negociacao_cancelar,
         portal_admin_negociacoes, portal_admin_responder_negociacao.
*/
(function(){
'use strict';
const B=()=>window.SRNegociacaoBridge;
const LABELS={solicitada:'Aguardando análise',analise:'Em análise',proposta:'Proposta disponível',aceita:'Aceita',recusada:'Não aprovada',cancelada:'Cancelada',expirada:'Proposta expirada'};
const MOTIVOS={volume:'Compra em volume',recorrente:'Compra recorrente / contrato',concorrencia:'Cotação de outro fornecedor',outro:'Outra condição comercial'};
const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=v=>{try{return v?new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—'}catch{return '—'}};
const dia=v=>v?new Date(String(v).slice(0,10)+'T12:00').toLocaleDateString('pt-BR'):'—';
const hoje=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'America/Sao_Paulo'});
const num=v=>{const s=String(v??'').trim().replace(/\s/g,'');if(!s)return null;const n=Number(s.includes(',')?s.replace(/\./g,'').replace(',','.'):s);return Number.isFinite(n)?n:NaN};
const tot=(itens,campo)=>itens.reduce((v,i)=>v+(Number(campo?(i[campo]??i.preco):i.preco)||0)*Number(i.q||0),0);
let draft=null,focusBack=null,MINE=[],ALL=[],FILTRO='abertas',timer=null;

const modal=document.createElement('div');
modal.className='neg-layer';modal.id='negModal';modal.hidden=true;
modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Negociação de preços');
modal.innerHTML='<section class="neg-dialog" tabindex="-1"><div id="negBody"></div></section>';
document.body.appendChild(modal);
const body=modal.querySelector('#negBody');
const btn=(label,action,klass='',extra='')=>'<button type="button" data-neg="'+action+'" class="neg-btn '+klass+'" '+extra+'>'+label+'</button>';
const err=m=>{const e=body.querySelector('#negError');if(e)e.textContent=m||''};
const busy=(on)=>body.querySelectorAll('.neg-footer button').forEach(b=>b.disabled=on);

function show(markup){
 if(modal.hidden)focusBack=document.activeElement;
 body.innerHTML=markup;modal.hidden=false;document.body.classList.add('neg-dialog-open');
 const d=modal.querySelector('.neg-dialog');if(d){d.scrollTop=0;d.focus({preventScroll:true})}
}
function close(){modal.hidden=true;document.body.classList.remove('neg-dialog-open');draft=null;if(focusBack?.isConnected)focusBack.focus({preventScroll:true})}
function header(t,sub){return '<header class="neg-head"><div><span class="neg-eyebrow">SOUZA RIBEIRO · NEGOCIAÇÃO B2B</span><h2>'+esc(t)+'</h2><p>'+esc(sub)+'</p></div><button type="button" data-neg="close" class="neg-x" aria-label="Fechar">×</button></header>'}
function badge(st){return '<span class="neg-stage s-'+esc(st)+'">'+esc(LABELS[st]||st)+'</span>'}
const online=()=>!!B()?.online?.();

/* ---------- Cliente: solicitar ---------- */
function openFrom(origin){
 const b=B(),c=b?.customer?.();if(!c)return;
 if(!online()){b?.toast?.('Negociação disponível apenas com o portal conectado.');return}
 const items=(b.items(origin)||[]).filter(x=>Number(x.q)>0&&Number(x.preco)>=0).slice(0,100);
 if(!items.length){b.toast('Coloque produtos e quantidades antes de solicitar negociação.');return}
 draft={origem:origin,itens:items.map(i=>({cod:String(i.cod),nome:String(i.nome),unidade:String(i.unidade),un_id:String(i.un_id||''),fator:Number(i.fator)||1,q:Number(i.q),preco:Number(i.preco)}))};
 show(header('Solicitar negociação','Diga quanto gostaria de pagar. Nossa equipe comercial analisa e responde por aqui.')+
 '<div class="neg-summary"><span>'+draft.itens.length+' produto(s) · '+(origin==='lista'?'Minha Lista':'Carrinho')+'</span><b>Total atual: '+money(tot(draft.itens))+'</b></div>'+
 '<div class="neg-quick"><label><span>Desconto desejado em todos os itens</span><div class="neg-pct"><input id="negPct" type="text" inputmode="decimal" placeholder="Ex.: 5"><b>%</b></div></label>'+btn('Aplicar','pct','outline')+'</div>'+
 '<div class="neg-section-title">Preço que gostaria de pagar <em>(opcional por item)</em></div><div class="neg-list">'+draft.itens.map((i,n)=>
  '<div class="neg-item"><div class="neg-item-title"><b>'+esc(i.nome)+'</b><small>Cód. '+esc(i.cod)+' · '+esc(i.unidade)+' · Qtd: '+i.q+'</small></div>'+
  '<div class="neg-item-values"><div><span>Preço atual</span><strong>'+money(i.preco)+'</strong></div><div><span>Subtotal</span><strong>'+money(i.preco*i.q)+'</strong></div>'+
  '<label><span>Preço desejado (unitário)</span><input data-desejado="'+n+'" type="text" inputmode="decimal" placeholder="R$"></label></div></div>').join('')+'</div>'+
 '<div class="neg-summary neg-sum2"><span>Total com os preços desejados</span><b id="negTotDes">'+money(tot(draft.itens))+'</b></div>'+
 '<div class="neg-fields"><label>Motivo<select id="negMotivo">'+Object.entries(MOTIVOS).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select></label>'+
 '<label>Explique sua necessidade <em>(opcional)</em><textarea id="negObs" maxlength="500" rows="3" placeholder="Ex.: compro esses itens todo mês; o fornecedor X me passou R$ 10,90 no copo."></textarea></label></div>'+
 '<p class="neg-warning">A solicitação não garante desconto. Seu carrinho continua salvo; se a proposta for aprovada, os preços negociados entram nele.</p>'+
 '<div id="negError" class="neg-error" role="status"></div>'+
 '<div class="neg-footer">'+btn('Cancelar','close','ghost')+btn('Enviar solicitação','submit','primary')+'</div>');
}
function lerDesejados(){
 let bad=false;
 draft.itens.forEach((i,n)=>{const v=num(body.querySelector('[data-desejado="'+n+'"]')?.value);if(v===null)i.desejado=null;else if(!(v>0)||v>99999999)bad=true;else i.desejado=+v.toFixed(2)});
 return !bad;
}
function atualizaTotDes(){if(!draft)return;lerDesejados();const t=body.querySelector('#negTotDes');if(t)t.textContent=money(draft.itens.reduce((v,i)=>v+(i.desejado||i.preco)*i.q,0))}
function aplicaPct(){
 const p=num(body.querySelector('#negPct')?.value);if(!(p>0&&p<100)){err('Informe um percentual entre 0 e 100.');return}
 err('');draft.itens.forEach((i,n)=>{const f=body.querySelector('[data-desejado="'+n+'"]');if(f)f.value=(i.preco*(1-p/100)).toFixed(2).replace('.',',')});atualizaTotDes();
}
async function submit(){
 if(!draft)return;
 if(!lerDesejados()){err('Confira os preços desejados: use valores positivos.');return}
 const obs=body.querySelector('#negObs').value.trim();
 if(!draft.itens.some(i=>i.desejado)&&!obs){err('Informe o preço desejado em algum item ou explique sua necessidade.');return}
 busy(true);err('');
 try{
  const q=await B().rpc('portal_negociacao_criar',{p_token:B().tokCli(),p_origem:draft.origem,p_itens:draft.itens,p_motivo:body.querySelector('#negMotivo').value,p_obs:obs});
  MINE.unshift(q);renderClient();
  show(header('Solicitação enviada','Nossa equipe comercial já recebeu seu pedido de negociação.')+
  '<div class="neg-success"><span class="neg-success-icon">✓</span><h3>Negociação '+esc(q.id)+'</h3>'+
  '<p>Você vai ver a resposta em <b>Pedidos › Minhas negociações</b>. Quando a proposta chegar, é só aceitar e os preços entram no carrinho.</p></div>'+
  '<div class="neg-footer">'+btn('Ver minhas negociações','meus','outline')+btn('Fechar','close','primary')+'</div>');
 }catch(e){busy(false);err(e.message||'Não foi possível enviar.')}
}

/* ---------- Cliente: acompanhar ---------- */
function aplicaPrecos(){
 const h=hoje(),o={};
 MINE.filter(q=>q.status==='aceita'&&!q.congelar&&q.validade&&q.validade>=h).slice().reverse()
  .forEach(q=>q.itens.forEach(i=>{if(Number(i.oferta)>0)o[i.un_id?i.cod+'@'+i.un_id:i.cod]={preco:Number(i.oferta),id:q.id,validade:q.validade}}));
 B()?.setPrecos?.(o);
}
async function carregaCliente(avisar){
 const b=B();if(!b?.customer?.()||!online()||!b.tokCli())return;
 try{
  const antes=new Set(MINE.filter(q=>q.status==='proposta').map(q=>q.id));
  MINE=await b.rpc('portal_minhas_negociacoes',{p_token:b.tokCli()})||[];
  aplicaPrecos();renderClient();
  const novas=MINE.filter(q=>q.status==='proposta'&&!antes.has(q.id));
  if(novas.length&&(avisar||antes.size||MINE.length))b.toast(novas.length===1?'🤝 Você recebeu uma proposta de negociação ('+novas[0].id+')':'🤝 Você tem '+novas.length+' propostas de negociação');
 }catch(e){console.warn('Negociações:',e.message)}
}
function cardCliente(q){
 const des=q.itens.reduce((v,i)=>v+(i.oferta||i.preco)*i.q,0);
 return '<article class="neg-quote'+(q.status==='proposta'?' hot':'')+'" data-ref="'+esc(q.id)+'"><div class="neg-quote-head"><strong>'+esc(q.id)+'</strong>'+badge(q.status)+'</div>'+
 '<div class="neg-quote-detail">'+date(q.criado_em)+' · '+q.itens.length+' produto(s) · '+money(tot(q.itens))+
 (q.status==='proposta'||q.status==='aceita'?' → <b>'+money(des)+'</b>'+(q.validade?' · válida até '+dia(q.validade):''):'')+'</div>'+
 '<div class="neg-quote-buttons">'+btn(q.status==='proposta'?'Ver proposta':'Ver detalhes','view',q.status==='proposta'?'primary':'outline')+'</div></article>';
}
function renderClient(){
 const el=document.getElementById('negClientView');if(!el)return;
 if(!B()?.customer?.()){el.innerHTML='';return}
 el.innerHTML='<div class="neg-outside-title"><h3>Minhas negociações</h3><p>Peça condições especiais pelo carrinho ou pela Minha Lista (botão 🤝 Solicitar negociação).</p></div>'+
 (MINE.length?MINE.map(cardCliente).join(''):'<p class="neg-empty">Nenhuma negociação ainda.</p>');
}
function viewClient(id){
 const q=MINE.find(x=>x.id===id);if(!q)return;
 const temOferta=q.itens.some(i=>i.oferta);
 const novo=q.itens.reduce((v,i)=>v+(i.oferta||i.preco)*i.q,0),eco=tot(q.itens)-novo;
 const valida=q.status==='aceita'&&q.validade&&q.validade>=hoje();
 show(header('Negociação '+q.id,'Solicitada em '+date(q.criado_em))+
 '<div class="neg-summary"><span>'+badge(q.status)+'</span>'+(q.validade&&(q.status==='proposta'||q.status==='aceita')?'<span>Válida até <b class="neg-b">'+dia(q.validade)+'</b></span>':'')+'</div>'+
 '<div class="neg-list">'+q.itens.map(i=>
  '<div class="neg-item"><div class="neg-item-title"><b>'+esc(i.nome)+'</b><small>'+i.q+' × '+esc(i.unidade)+' · cód. '+esc(i.cod)+'</small></div>'+
  '<div class="neg-item-values"><div><span>Preço atual</span><strong>'+money(i.preco)+'</strong></div>'+
  '<div><span>Você pediu</span><strong>'+(i.desejado?money(i.desejado):'—')+'</strong></div>'+
  '<div><span>Proposta</span><strong class="'+(i.oferta?'neg-ok':'')+'">'+(i.oferta?money(i.oferta):(temOferta?'sem alteração':'—'))+'</strong></div></div></div>').join('')+'</div>'+
 (temOferta?'<div class="neg-summary neg-sum2"><span>Total com a proposta</span><b>'+money(novo)+(eco>0.004?' <small>economia de '+money(eco)+'</small>':'')+'</b></div>':'')+
 (q.resposta?'<p class="neg-note"><b>Resposta da equipe comercial:</b> '+esc(q.resposta)+'</p>':'')+
 (q.status==='proposta'?'<p class="neg-warning">Ao aceitar, os preços da proposta entram no seu carrinho'+(q.congelar?' e ficam fixos para as próximas compras':' e valem até '+dia(q.validade))+'.</p>':'')+
 '<div id="negError" class="neg-error" role="status"></div>'+
 '<div class="neg-footer">'+btn('Voltar','close','ghost')+
 (['solicitada','analise'].includes(q.status)?btn('Cancelar solicitação','cancel','ghost'):'')+
 (q.status==='proposta'?btn('Recusar','cancel','ghost')+btn('Aceitar e adicionar ao carrinho','accept','primary'):'')+
 (valida||(q.status==='aceita'&&q.congelar)?btn('Adicionar ao carrinho','tocart','primary'):'')+'</div>');
 body.dataset.ref=id;
}
async function acaoCliente(acao){
 const b=B(),q=MINE.find(x=>x.id===body.dataset.ref);if(!q)return;
 if(acao==='tocart'){b.addCart(q.itens);close();return}
 if(acao==='cancel'&&!body.dataset.conf){body.dataset.conf='1';err('Clique de novo para confirmar.');return}
 busy(true);err('');
 try{
  const r=await b.rpc(acao==='accept'?'portal_negociacao_aceitar':'portal_negociacao_cancelar',{p_token:b.tokCli(),p_id:q.id});
  Object.assign(q,r);aplicaPrecos();renderClient();delete body.dataset.conf;
  if(acao==='accept'){if(q.congelar)await b.refreshCong?.();b.addCart(q.itens);close();b.toast('Proposta aceita ✓ preços negociados aplicados no carrinho')}
  else{close();b.toast('Negociação cancelada')}
 }catch(e){busy(false);err(e.message);delete body.dataset.conf}
}

/* ---------- Admin ---------- */
const abertas=q=>q.status==='solicitada'||q.status==='analise';
function badgeAdmin(){const el=document.getElementById('negN');if(el){const n=ALL.filter(abertas).length;el.textContent=n||''}}
async function carregaAdmin(){
 const b=B();if(!b?.isAdmin?.()||!online()||!b.tokAdm())return;
 try{ALL=await b.rpc('portal_admin_negociacoes',{p_token:b.tokAdm()})||[];badgeAdmin();renderAdminList()}
 catch(e){const el=document.getElementById('negAdminView');if(el&&!ALL.length)el.innerHTML='<p class="neg-empty">'+esc(e.message)+'</p>'}
}
function renderAdmin(){renderAdminList();carregaAdmin()}
function renderAdminList(){
 const el=document.getElementById('negAdminView');if(!el||!B()?.isAdmin?.())return;
 if(!online()){el.innerHTML='<p class="neg-empty">As negociações precisam do portal conectado ao Supabase.</p>';return}
 const F={abertas:ALL.filter(abertas),proposta:ALL.filter(q=>q.status==='proposta'),aceita:ALL.filter(q=>q.status==='aceita'),todas:ALL};
 const L=F[FILTRO]||ALL;
 el.innerHTML='<div class="neg-admin-head"><div><h3>Central de negociações</h3><p>Solicitações dos clientes pelo carrinho e pela Minha Lista. Nada muda no preço até o cliente aceitar sua proposta.</p></div>'+btn('↻ Atualizar','reload','outline')+'</div>'+
 '<div class="neg-admin-metrics"><div><small>Aguardando resposta</small><b>'+F.abertas.length+'</b></div><div><small>Propostas enviadas</small><b>'+F.proposta.length+'</b></div>'+
 '<div><small>Aceitas</small><b>'+F.aceita.length+'</b></div><div><small>Total</small><b>'+ALL.length+'</b></div></div>'+
 '<div class="neg-filtros">'+[['abertas','Aguardando'],['proposta','Propostas'],['aceita','Aceitas'],['todas','Todas']].map(([k,t])=>'<button type="button" data-negf="'+k+'" class="'+(FILTRO===k?'on':'')+'">'+t+'</button>').join('')+'</div>'+
 '<div class="neg-admin-list">'+(L.length?L.map(q=>{const c=q.cliente||{};const des=q.itens.reduce((v,i)=>v+(i.desejado||i.preco)*i.q,0);
  return '<article class="neg-quote'+(abertas(q)?' hot':'')+'" data-ref="'+esc(q.id)+'"><div class="neg-quote-head"><strong>'+esc(c.nome||q.cnpj)+'</strong>'+badge(q.status)+'</div>'+
  '<div class="neg-quote-detail">'+esc(q.id)+' · '+(c.codigo?'cód. '+esc(c.codigo)+' · ':'')+esc(c.cidade||'')+(c.uf?'/'+esc(c.uf):'')+' · '+date(q.criado_em)+'<br>'+
  q.itens.length+' produto(s) · '+money(tot(q.itens))+(des<tot(q.itens)-0.004?' → pediu <b>'+money(des)+'</b>':'')+' · '+esc(MOTIVOS[q.motivo]||q.motivo)+'</div>'+
  '<div class="neg-quote-buttons">'+btn(abertas(q)?'Analisar':'Ver','view',abertas(q)?'primary':'outline')+'</div></article>'}).join(''):'<p class="neg-empty">Nada por aqui.</p>')+'</div>';
}
function margem(preco,custo){return preco>0&&custo>0?(preco-custo)/preco*100:null}
function mTxt(m){const min=B().margemMin();return m==null?'':'<em class="'+(m<min?'neg-bad':'neg-ok')+'">margem '+m.toFixed(1).replace('.',',')+'%</em>'}
function viewAdmin(id){
 const q=ALL.find(x=>x.id===id);if(!q)return;const c=q.cliente||{},b=B();
 const fechada=q.status==='aceita'||q.status==='cancelada';
 const wa=String(c.whats||'').replace(/\D/g,'');
 show(header('Negociação '+q.id,(c.nome||q.cnpj)+(c.codigo?' · cód. '+c.codigo:'')+' · '+date(q.criado_em))+
 '<div class="neg-summary"><span>'+badge(q.status)+' · '+esc(MOTIVOS[q.motivo]||q.motivo)+' · via '+(q.origem==='lista'?'Minha Lista':'carrinho')+'</span>'+(wa?'<a class="neg-wa" target="_blank" rel="noopener" href="https://wa.me/'+(wa.length<=11?'55':'')+wa+'">WhatsApp do cliente</a>':'')+'</div>'+
 (q.observacao?'<p class="neg-note"><b>Cliente escreveu:</b> '+esc(q.observacao)+'</p>':'')+
 (fechada?'':'<div class="neg-quick">'+btn('Usar preços pedidos','usedes','outline')+'<label><span>ou desconto em todos</span><div class="neg-pct"><input id="negPctA" type="text" inputmode="decimal" placeholder="Ex.: 3"><b>%</b></div></label>'+btn('Aplicar','pcta','outline')+'</div>')+
 '<div class="neg-list">'+q.itens.map((i,n)=>{const p=b.produto(i.cod)||{};const custo=(Number(p.custo)||0)*(Number(i.fator)||1);
  return '<div class="neg-item"><div class="neg-item-title"><b>'+esc(i.nome)+'</b><small>Cód. '+esc(i.cod)+' · '+esc(i.unidade)+' · Qtd: '+i.q+(p.estoque!=null?' · estoque '+p.estoque:'')+'</small></div>'+
  '<div class="neg-item-values"><div><span>Preço atual</span><strong>'+money(i.preco)+'</strong>'+mTxt(margem(i.preco,custo))+'</div>'+
  '<div><span>Custo</span><strong>'+(custo?money(custo):'—')+'</strong></div>'+
  '<div><span>Cliente pediu</span><strong>'+(i.desejado?money(i.desejado):'—')+'</strong>'+mTxt(i.desejado?margem(i.desejado,custo):null)+'</div>'+
  (fechada?'<div><span>Proposta</span><strong>'+(i.oferta?money(i.oferta):'—')+'</strong></div>':
  '<label><span>Sua proposta (unit.)</span><input data-oferta="'+n+'" data-custo="'+custo+'" type="text" inputmode="decimal" value="'+(i.oferta?String(i.oferta.toFixed(2)).replace('.',','):'')+'" placeholder="manter"><i class="neg-mg" data-mg="'+n+'"></i></label>')+'</div></div>'}).join('')+'</div>'+
 '<div class="neg-summary neg-sum2"><span>Atual '+money(tot(q.itens))+'</span><b id="negTotOf">'+money(q.itens.reduce((v,i)=>v+(i.oferta||i.preco)*i.q,0))+'</b></div>'+
 (fechada?(q.resposta?'<p class="neg-note"><b>Resposta enviada:</b> '+esc(q.resposta)+'</p>':'')+'<p class="neg-warning">'+(q.status==='aceita'?'Aceita pelo cliente em '+date(q.aceito_em)+(q.congelar?' · preços congelados para o cliente.':' · válida até '+dia(q.validade)+'.'):'Cancelada pelo cliente.')+'</p>':
 '<div class="neg-fields neg-fields2"><label>Validade da proposta<select id="negVal"><option value="3">3 dias</option><option value="7" selected>7 dias</option><option value="15">15 dias</option><option value="30">30 dias</option></select></label>'+
 '<label class="neg-chk"><input type="checkbox" id="negCong"'+(q.congelar?' checked':'')+'> Ao aceitar, congelar esses preços para o cliente</label></div>'+
 '<div class="neg-fields"><label>Mensagem ao cliente <em>(opcional)</em><textarea id="negResposta" maxlength="500" rows="3" placeholder="Ex.: Conseguimos esse valor para compra mensal de 10 caixas.">'+esc(q.resposta||'')+'</textarea></label></div>')+
 '<div id="negError" class="neg-error" role="status"></div>'+
 '<div class="neg-footer neg-footer-admin">'+btn('Fechar','close','ghost')+(fechada?'':(q.status==='solicitada'?btn('Marcar em análise','analise','outline'):'')+btn('Não aprovar','recusada','ghost')+btn('Enviar proposta','proposta','primary'))+'</div>');
 body.dataset.ref=id;atualizaMargens();
}
function atualizaMargens(){
 const q=ALL.find(x=>x.id===body.dataset.ref);if(!q)return;let t=0;
 q.itens.forEach((i,n)=>{const f=body.querySelector('[data-oferta="'+n+'"]');if(!f){t+=(i.oferta||i.preco)*i.q;return}
  const v=num(f.value),c=Number(f.dataset.custo)||0,mg=body.querySelector('[data-mg="'+n+'"]');
  t+=(v>0?v:i.preco)*i.q;if(mg)mg.innerHTML=v>0?mTxt(margem(v,c)):''});
 const el=body.querySelector('#negTotOf');if(el)el.textContent=money(t);
}
function preencheAdmin(fn){const q=ALL.find(x=>x.id===body.dataset.ref);if(!q)return;q.itens.forEach((i,n)=>{const f=body.querySelector('[data-oferta="'+n+'"]'),v=fn(i);if(f&&v)f.value=v.toFixed(2).replace('.',',')});atualizaMargens()}
async function responder(acao){
 const b=B(),q=ALL.find(x=>x.id===body.dataset.ref);if(!q||!b.isAdmin())return;
 const ofertas=[];
 for(let n=0;n<q.itens.length;n++){const f=body.querySelector('[data-oferta="'+n+'"]');const v=num(f?.value);if(v!==null&&!(v>0)){err('Use preços positivos na proposta.');return}ofertas.push(v===null?null:+v.toFixed(2))}
 if(acao==='proposta'&&!ofertas.some(v=>v)){err('Informe o preço da proposta em pelo menos um produto.');return}
 if(acao==='proposta'){const min=b.margemMin();const baixos=q.itens.filter((i,n)=>{const p=b.produto(i.cod);const c=(Number(p?.custo)||0)*(Number(i.fator)||1);const m=margem(ofertas[n],c);return ofertas[n]&&m!=null&&m<min});
  if(baixos.length&&!body.dataset.conf){body.dataset.conf='1';err(baixos.length+' item(ns) ficam abaixo de '+min+'% de margem. Clique de novo em “Enviar proposta” para confirmar.');return}}
 busy(true);err('');
 try{
  const r=await b.rpc('portal_admin_responder_negociacao',{p_token:b.tokAdm(),p_id:q.id,p_acao:acao,p_ofertas:ofertas,p_resposta:body.querySelector('#negResposta')?.value||'',
   p_validade_dias:Number(body.querySelector('#negVal')?.value||7),p_congelar:!!body.querySelector('#negCong')?.checked});
  Object.assign(q,r);delete body.dataset.conf;badgeAdmin();renderAdminList();close();
  b.toast(acao==='proposta'?'Proposta enviada ao cliente ✓':acao==='recusada'?'Negociação não aprovada':'Marcada em análise');
 }catch(e){busy(false);delete body.dataset.conf;err(e.message)}
}

/* ---------- Eventos ---------- */
modal.addEventListener('click',e=>{
 if(e.target===modal)return close();
 const t=e.target.closest('[data-neg]');if(!t)return;const a=t.dataset.neg;
 if(a==='close')return close();
 if(a==='submit')return submit();
 if(a==='pct')return aplicaPct();
 if(a==='meus'){close();B()?.irPedidos?.();return}
 if(a==='accept'||a==='cancel'||a==='tocart')return acaoCliente(a);
 if(a==='usedes')return preencheAdmin(i=>i.desejado);
 if(a==='pcta'){const p=num(body.querySelector('#negPctA')?.value);if(!(p>0&&p<100)){err('Percentual entre 0 e 100.');return}err('');return preencheAdmin(i=>i.preco*(1-p/100))}
 if(a==='analise'||a==='proposta'||a==='recusada')return responder(a);
});
modal.addEventListener('input',e=>{if(e.target.matches('[data-desejado]'))atualizaTotDes();if(e.target.matches('[data-oferta]')){delete body.dataset.conf;atualizaMargens()}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.hidden)close()});
document.getElementById('negAdminView')?.addEventListener('click',e=>{
 const f=e.target.closest('[data-negf]');if(f){FILTRO=f.dataset.negf;renderAdminList();return}
 const t=e.target.closest('[data-neg]');if(!t)return;
 if(t.dataset.neg==='reload'){carregaAdmin();return}
 const r=t.closest('[data-ref]');if(r&&B()?.isAdmin?.())viewAdmin(r.dataset.ref);
});
document.getElementById('negClientView')?.addEventListener('click',e=>{const t=e.target.closest('[data-neg="view"]');const r=t?.closest('[data-ref]');if(r)viewClient(r.dataset.ref)});

function onLogin(){MINE=[];B()?.setPrecos?.({});carregaCliente(true)}
function tick(){if(document.hidden)return;if(B()?.isAdmin?.())carregaAdmin();if(B()?.customer?.())carregaCliente(false)}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick()});
timer=setInterval(tick,90000);
setTimeout(()=>{if(B()?.customer?.()&&!MINE.length)carregaCliente(true);if(B()?.isAdmin?.())carregaAdmin()},1500);
window.SRNegociacao={openFrom,renderClient:()=>{renderClient();carregaCliente(false)},renderAdmin,onLogin,carregaAdmin};
})();
