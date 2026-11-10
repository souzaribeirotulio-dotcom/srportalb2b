/* Souzinha — conversa de verdade via endpoint seguro; sem pesquisa automática */
(function(){
'use strict';
if(document.getElementById('souzinha-widget'))return;
const root=document.createElement('div');root.id='souzinha-widget';
root.innerHTML=[
 '<button type="button" class="sz-fab" aria-label="Conversar com a Souzinha" aria-expanded="false" aria-controls="sz-panel">',
 '<span class="sz-tip">Posso ajudar com suas compras?</span>',
 '<img src="/assets/souzinha-sac.svg" alt="" loading="lazy"><span class="sz-online" aria-hidden="true"></span></button>',
 '<section id="sz-panel" class="sz-panel" role="dialog" aria-label="Conversa com a Souzinha" aria-modal="false">',
 '<div class="sz-head"><span class="sz-avatar"><img src="/assets/souzinha-sac.svg" alt=""></span><div class="sz-head-txt"><strong>Souzinha</strong><small>Assistente virtual · Souza Ribeiro</small></div><button type="button" class="sz-close" aria-label="Fechar conversa">×</button></div>',
 '<div class="sz-messages" role="log" aria-live="polite" aria-relevant="additions text"></div>',
 '<div class="sz-actions" aria-label="Acessos rápidos"><button type="button" class="sz-chip" data-sz="buscar">🔎 Buscar produto</button><button type="button" class="sz-chip" data-sz="lista">📋 Minha Lista</button><button type="button" class="sz-chip" data-sz="pedidos">🧾 Meus pedidos</button><button type="button" class="sz-chip" data-sz="ajuda">💬 Como comprar</button></div>',
 '<form class="sz-form"><input class="sz-input" type="text" maxlength="600" autocomplete="off" placeholder="Converse com a Souzinha..." aria-label="Escreva para a Souzinha"><button class="sz-send" type="submit" aria-label="Enviar mensagem">➤</button></form>',
 '<div class="sz-footnote">A Souzinha orienta sua compra. Preços e estoque são confirmados no portal.</div>',
 '</section>'
].join('');
document.body.appendChild(root);
const fab=root.querySelector('.sz-fab'),panel=root.querySelector('.sz-panel'),closeBtn=root.querySelector('.sz-close'),messages=root.querySelector('.sz-messages');
const form=root.querySelector('.sz-form'),input=root.querySelector('.sz-input'),sendBtn=root.querySelector('.sz-send');
const history=[];
let opened=false,busy=false,formerFocus=null;

function say(text,me){
 const el=document.createElement('div');
 el.className='sz-msg'+(me?' sz-me':'');
 el.textContent=text;
 messages.appendChild(el);
 scroll();
 return el;
}
function scroll(){requestAnimationFrame(()=>{messages.scrollTop=messages.scrollHeight})}
function open(){
 formerFocus=document.activeElement;
 root.classList.add('sz-open');
 document.body.classList.add('sz-chat-open');
 fab.setAttribute('aria-expanded','true');
 panel.setAttribute('aria-modal',matchMedia('(max-width:700px)').matches?'true':'false');
 if(!opened){
  say('Olá! 😊 Sou a Souzinha, assistente virtual da Souza Ribeiro. Me conta o que você precisa comprar ou como posso facilitar seu pedido.');
  opened=true;
 }
 // No celular, não levantar o teclado antes de o comprador pedir.
 if(!matchMedia('(max-width:700px)').matches)input.focus({preventScroll:true});
 scroll();
}
function close(){
 root.classList.remove('sz-open');
 document.body.classList.remove('sz-chat-open');
 fab.setAttribute('aria-expanded','false');
 (formerFocus&&formerFocus.isConnected?formerFocus:fab).focus({preventScroll:true});
}
function navigate(section){
 close();
 if(window.SouzinhaPortal?.navigate)window.SouzinhaPortal.navigate(section);
 else document.querySelector('[data-v="'+section+'"]')?.click();
}
function search(q){
 close();
 if(window.SouzinhaPortal?.search)window.SouzinhaPortal.search(q);
 else{
  const inputSearch=document.getElementById('q');
  document.querySelector('[data-v="cat"]')?.click();
  if(inputSearch){inputSearch.value=q;inputSearch.dispatchEvent(new Event('input',{bubbles:true}));}
 }
}
function suggest(query){
 if(!query||typeof query!=='string')return;
 const b=document.createElement('button');
 b.type='button';b.className='sz-suggestion';b.textContent='🔎 Ver no catálogo: '+query.slice(0,65);
 b.addEventListener('click',()=>search(query));
 messages.appendChild(b);scroll();
}
function setBusy(v){
 busy=v;sendBtn.disabled=v;input.disabled=v;
 root.classList.toggle('sz-busy',v);
}
async function chat(text){
 if(busy)return;
 const message=text.trim().slice(0,600);
 if(!message)return;
 say(message,true);
 input.value='';
 const oldHistory=history.slice(-12);
 const typing=say('Souzinha está escrevendo…');
 typing.classList.add('sz-typing');
 setBusy(true);
 try{
  const candidates=window.SouzinhaPortal?.candidates?.(message)||[];
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),19000);
  let response;
  try{
   response=await fetch('/api/souzinha',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({message,history:oldHistory,candidates}),
    signal:ctrl.signal
   });
  }finally{clearTimeout(timer)}
  let data={};
  try{data=await response.json()}catch(e){}
  typing.classList.remove('sz-typing');
  if(!response.ok||!data.reply){
   typing.textContent=data.error||'Não consegui responder agora. Tente novamente em instantes.';
   typing.classList.add('sz-error');
   return;
  }
  typing.textContent=data.reply;
  history.push({role:'user',content:message},{role:'assistant',content:data.reply});
  if(history.length>16)history.splice(0,history.length-16);
  if(data.search_query)suggest(data.search_query);
 }catch(e){
  typing.classList.remove('sz-typing');
  typing.classList.add('sz-error');
  typing.textContent=e?.name==='AbortError'?'A resposta demorou mais que o esperado. Pode tentar de novo?':'Não consegui conectar com a IA agora. Pode tentar novamente?';
 }finally{setBusy(false);scroll()}
}
fab.addEventListener('click',open);
closeBtn.addEventListener('click',close);
form.addEventListener('submit',e=>{e.preventDefault();chat(input.value)});
root.querySelectorAll('[data-sz]').forEach(b=>b.addEventListener('click',()=>{
 const a=b.dataset.sz;
 if(a==='lista')return navigate('lista');
 if(a==='pedidos')return navigate('ped');
 if(a==='buscar'){input.focus({preventScroll:true});return chat('Você pode me ajudar a encontrar um produto?');}
 if(a==='ajuda')return chat('Como faço para comprar pelo portal?');
}));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&root.classList.contains('sz-open'))close()});
document.addEventListener('focusin',e=>{
 if(!root.classList.contains('sz-open')||!matchMedia('(max-width:700px)').matches)return;
 if(!panel.contains(e.target))closeBtn.focus({preventScroll:true});
});
})();
