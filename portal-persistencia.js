/* Persistência compartilhada SR Portal B2B.
   Supabase = fonte da verdade. LocalStorage fica só como cache/back-up legado.
   Upload de vídeos: assinatura temporária gerada em Edge Function com sessão admin.
*/
(function(){
'use strict';
const BKT='portal-clips';
const localJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
const safeCopy=o=>JSON.parse(JSON.stringify(o));
const own=(obj)=>obj&&typeof obj==='object'&&!Array.isArray(obj);
const cloudCachePreviouslyInitialized=localStorage.getItem('sr_b2b_persistencia_sincronizada_v1')==='1';
const state={
 ready:{prod:false,cfg:false,clips:false},
 legacyProd:localJson('sr_b2b_admin_prod_pendente_nuvem',null),
 legacyCfg:localJson('sr_b2b_cfg_pendente_nuvem',null),
 legacyClips:localJson('sr_b2b_clips_pendente_nuvem',null),
 legacyDemo:localJson('sr_b2b_clips_demo_pendente_nuvem',null),
 remoteProd:{},remoteClips:[],
 saveConfigQueue:Promise.resolve()
};
function savePending(key,data){try{if(data) localStorage.setItem(key,JSON.stringify(data)); else localStorage.removeItem(key)}catch{}}
function isAdmin(){return !!ADM&&!!tokGet('sr_b2b_tokadm')}
function showControls(){
 const host=document.getElementById('aSair')?.parentElement;
 if(!host)return;
 if(!isAdmin()){const old=document.getElementById('pubPersistLocal');if(old)old.hidden=true;return}
 const nprod=Object.keys(state.legacyProd||{}).length;
 const nclips=(state.legacyClips||[]).length;
 const hasCfg=!!state.legacyCfg;
 const hasDemo=!!state.legacyDemo;
 let b=document.getElementById('pubPersistLocal');
 if(!b){b=document.createElement('button');b.id='pubPersistLocal';b.className='tool';b.type='button';b.addEventListener('click',publishLegacy);host.insertBefore(b,host.firstChild)}
 b.hidden=!nprod&&!hasCfg&&!nclips&&!hasDemo;
 b.textContent='☁ Publicar dados antigos ('+(nprod+(hasCfg?1:0)+(hasDemo?1:0)+nclips)+')';
 b.title='Publicar edições e clips que antes só existiam neste computador.';
}
async function refreshCatalog(){
 const d=await rpc('portal_catalogo_personalizacoes',{});
 if(!own(d))throw new Error('Catálogo não retornou dados válidos');
 const old=state.legacyProd||(!cloudCachePreviouslyInitialized?localJson('sr_b2b_admin_prod',{}):{});
 const pending={};
 if(own(old))for(const [cod,v] of Object.entries(old))if(byCod[cod]&&JSON.stringify(v)!==JSON.stringify(d[cod]))pending[cod]=v;
 if(Object.keys(pending).length){
  state.legacyProd=pending;
  savePending('sr_b2b_admin_prod_pendente_nuvem',pending);
 }
 state.remoteProd=safeCopy(d);
 PADM=safeCopy(d);
 P.forEach(p=>aplicaOv(p.cod));
 salvaPADM();
 state.ready.prod=true;
 render();updSem();if(VIEW==='adm'&&AT==='prod')drawAProd();
 showControls();
 return d;
}
async function refreshConfig(){
 const isAuthed=isAdmin();
 let result;
 try{result=await rpc(isAuthed?'portal_admin_config':'portal_config_publica',isAuthed?{p_token:tokGet('sr_b2b_tokadm')}:{})}
 catch(e){if(!isAuthed)throw e;result=await rpc('portal_config_publica',{})}
 if(!own(result))throw new Error('Configurações não retornaram dados válidos');
 const previous=cloudCachePreviouslyInitialized?null:localJson('sr_b2b_cfg',null);
 const prevPublic=own(previous)?{...previous}:null;if(prevPublic)delete prevPublic.margemMin;
 const publicCurrent=own(result)?{...result}:null;if(publicCurrent)delete publicCurrent.margemMin;
 if(own(previous)&&Object.keys(previous).length&&JSON.stringify(prevPublic)!==JSON.stringify(publicCurrent)){
  // As configurações locais anteriores são preservadas para migração autorizada.
  if(!state.legacyCfg){state.legacyCfg=previous;savePending('sr_b2b_cfg_pendente_nuvem',previous)}
 }
 if(Object.keys(result).length)Object.assign(CFG,result);
 salvaCfgLocal();
 state.ready.cfg=true;render();updSem();if(VIEW==='adm'&&AT==='cfg')drawCfg();
 showControls();
 return result;
}
function salvaCfgLocal(){try{localStorage.setItem('sr_b2b_cfg',JSON.stringify(CFG))}catch{}}
async function refreshClips(){
 const data=await rpc('portal_clips_catalogo',{});
 if(!data||!Array.isArray(data.clips)||!Array.isArray(data.demo_off)||!own(data.demo_tt))throw new Error('Clips inválidos recebidos do servidor');
 const oldDemo=state.legacyDemo||{off:cloudCachePreviouslyInitialized?[]:localJson('sr_b2b_clips_demo_off',[]),tt:cloudCachePreviouslyInitialized?{}:localJson('sr_b2b_clips_demo_tt',{})};
 if(!state.legacyDemo&&(oldDemo.off.length||Object.keys(oldDemo.tt||{}).length)&&(JSON.stringify(oldDemo.off)!==JSON.stringify(data.demo_off)||JSON.stringify(oldDemo.tt)!==JSON.stringify(data.demo_tt))){state.legacyDemo=oldDemo;savePending('sr_b2b_clips_demo_pendente_nuvem',oldDemo)}
 const prev=state.legacyClips||(!cloudCachePreviouslyInitialized?localJson('sr_b2b_clips',[]):[]);
 const pending=(Array.isArray(prev)?prev:[]).filter(c=>c&&c.id&&!data.clips.some(r=>r.id===c.id));
 if(pending.length){state.legacyClips=pending;savePending('sr_b2b_clips_pendente_nuvem',pending)}
 state.remoteClips=safeCopy(data.clips);
 CLIPS_U=safeCopy(data.clips);
 DEMO_OFF=safeCopy(data.demo_off);
 DEMO_TT=safeCopy(data.demo_tt);
 salvaClipsLocal();
 state.ready.clips=true;
 if(VIEW==='clips')drawClips();if(typeof AE!=='undefined'&&AE&&document.getElementById('eClips'))drawEClips();
 showControls();
 return data;
}
function salvaClipsLocal(){
 try{localStorage.setItem('sr_b2b_clips',JSON.stringify(CLIPS_U));localStorage.setItem('sr_b2b_clips_demo_off',JSON.stringify(DEMO_OFF));localStorage.setItem('sr_b2b_clips_demo_tt',JSON.stringify(DEMO_TT))}catch{}
}
async function saveProduct(cod,data){
 if(!isAdmin())throw new Error('Entre como administrador antes de editar produtos.');
 const r=await rpc('portal_admin_salvar_produto',{p_token:tokGet('sr_b2b_tokadm'),p_cod:cod,p_dados:data===undefined?null:data});
 if(!r?.salvo)throw new Error('O servidor não confirmou o produto');
 if(data==null)delete state.remoteProd[cod];else state.remoteProd[cod]=safeCopy(data);
 const pend=state.legacyProd||{};
 if(cod in pend){delete pend[cod];savePending('sr_b2b_admin_prod_pendente_nuvem',Object.keys(pend).length?pend:null)}
 showControls();
 return r;
}
function saveConfig(snapshot){
 if(!isAdmin())return Promise.reject(new Error('Entre como administrador para editar as configurações'));
 const args={p_token:tokGet('sr_b2b_tokadm'),p_dados:safeCopy(snapshot)};
 return state.saveConfigQueue=state.saveConfigQueue.catch(()=>{}).then(async()=>{
  const r=await rpc('portal_admin_salvar_config',args);
  if(!r?.salvo)throw new Error('O servidor não confirmou a configuração');
  state.legacyCfg=null;savePending('sr_b2b_cfg_pendente_nuvem',null);showControls();
  return r;
 });
}
async function saveClips(cod,list,demoOff,demoTitles){
 if(!isAdmin())throw new Error('Entre como administrador para publicar clips.');
 const r=await rpc('portal_admin_salvar_clips',{p_token:tokGet('sr_b2b_tokadm'),p_cod:cod,
  p_clips:list.map(x=>({id:String(x.id),cod:String(cod),titulo:String(x.titulo||'').slice(0,180),src:String(x.src)})),
  p_demo_off:demoOff.slice(0,100),p_demo_tt:safeCopy(demoTitles)});
 if(!r?.salvo)throw new Error('O servidor não confirmou os clips');
 state.remoteClips=state.remoteClips.filter(x=>x.cod!==cod).concat(list.map(x=>({...x,cod})));
 return r;
}
async function uploadClip(file,cod){
 if(!isAdmin())throw new Error('Apenas administradores podem enviar clips');
 if(!file||!['video/mp4','video/webm'].includes(file.type)||file.size<100||file.size>41943040)
  throw new Error('Envie um vídeo MP4 ou WebM de até 40 MB.');
 const res=await fetch(SB.url+'/functions/v1/portal-upload-clip-url',{
  method:'POST',headers:{'Content-Type':'application/json',apikey:SB.key,Authorization:'Bearer '+SB.key},
  body:JSON.stringify({token:tokGet('sr_b2b_tokadm'),cod,mime:file.type,size:file.size})});
 const data=await res.json().catch(()=>({}));
 if(!res.ok||!data.signedUrl)throw new Error(data.erro||'Falha ao autorizar upload do clip');
 const url=new URL(data.signedUrl);
 if(url.origin!==new URL(SB.url).origin||!url.pathname.startsWith('/storage/v1/object/upload/sign/'+BKT+'/'))
   throw new Error('Endereço de upload retornado não é confiável');
 const form=new FormData();
 form.append('cacheControl','3600');form.append('',file);
 const up=await fetch(url.toString(),{method:'PUT',body:form});
 if(!up.ok){const err=await up.json().catch(()=>({}));throw new Error(err.message||err.error||'Falha ao enviar vídeo à nuvem (HTTP '+up.status+')')}
 if(typeof data.publicUrl!=='string'||!data.publicUrl.startsWith(SB.url+'/storage/v1/object/public/'+BKT+'/'))
  throw new Error('O arquivo foi enviado, mas o endereço público não foi confirmado');
 return data.publicUrl;
}
function legacyClipCount(cod){
 return (state.legacyClips||[]).filter(x=>x.cod===cod).length;
}
async function publishLegacyClips(cod){
 if(!isAdmin())throw new Error('Acesso administrativo necessário');
 const list=(state.legacyClips||[]).filter(c=>c.cod===cod);
 if(!list.length)throw new Error('Não há clips antigos para publicar neste produto');
 const btn=document.getElementById('pubClipsLocais');if(btn)btn.disabled=true;
 try{
  const converted=[];
  for(const c of list){
   let src=c.src;
   if(src?.startsWith('idb:')){
    const f=await IDB.get(src.slice(4));
    if(!f)throw new Error('Arquivo de '+(c.titulo||c.id)+' não está mais no armazenamento deste navegador');
    src=await uploadClip(f,cod);
   }
   if(!/^https:\/\//i.test(src))throw new Error('Este clip antigo precisa ter um link HTTPS válido');
   converted.push({...c,src});
  }
  const originals=CLIPS_U.filter(x=>x.cod===cod);
  const merged=originals.concat(converted.filter(x=>!originals.some(y=>y.id===x.id)));
  await saveClips(cod,merged,DEMO_OFF,DEMO_TT);
  CLIPS_U=CLIPS_U.filter(x=>x.cod!==cod).concat(merged);
  const after=(state.legacyClips||[]).filter(x=>x.cod!==cod);
  state.legacyClips=after;savePending('sr_b2b_clips_pendente_nuvem',after.length?after:null);
  salvaClipsLocal();drawEClips();showControls();toast('Clips antigos publicados na nuvem ✓');
 }finally{if(btn)btn.disabled=false}
}
async function publishLegacy(){
 if(!isAdmin())return;
 const prod=state.legacyProd||{},cfg=state.legacyCfg;
 const n=Object.keys(prod).length;
 if(!n&&!cfg&&!legacyClipCountAll()&&!state.legacyDemo)return;
 const msg='Existem '+n+' edições de produtos'+(cfg?', configurações':'')+' e '+legacyClipCountAll()+
 ' clips antigos'+(state.legacyDemo?' e configurações de clips demonstrativos':'')+' salvos neste computador.\n\nPublicar os produtos/configurações pode substituir ajustes atuais desses campos no servidor. Continuar?';
 if(!confirm(msg))return;
 let successes=0,errors=[];
 for(const [cod,v] of Object.entries(prod)){
  if(!byCod[cod])continue;
  try{await saveProduct(cod,v);successes++}catch(e){errors.push(cod+': '+e.message)}
 }
 if(cfg){try{await saveConfig(cfg);Object.assign(CFG,cfg);salvaCfgLocal();successes++}catch(e){errors.push('Configuração: '+e.message)}}
 if(state.legacyDemo){try{const d=state.legacyDemo;const r=await rpc('portal_admin_salvar_clips_demo',{p_token:tokGet('sr_b2b_tokadm'),p_demo_off:d.off,p_demo_tt:d.tt});if(!r?.salvo)throw Error('Sem confirmação do servidor');state.legacyDemo=null;savePending('sr_b2b_clips_demo_pendente_nuvem',null);successes++}catch(e){errors.push('Clips demonstrativos: '+e.message)}}
 await Promise.allSettled([refreshCatalog(),refreshConfig()]);
 toast(errors.length?'Publicação parcial: '+errors[0]:successes+' alterações antigas publicadas ✓');
 if(legacyClipCountAll())alert('Os clips antigos podem ser publicados individualmente em Admin → Produtos → Editar → Clips.');
 showControls();
}
function legacyClipCountAll(){return (state.legacyClips||[]).length}
async function init(){
 if(typeof USA_SB!=='function'||!USA_SB())return;
 const results=await Promise.allSettled([refreshCatalog(),refreshConfig(),refreshClips()]);
 const labels=['produtos','configurações','clips'];
 for(let i=0;i<results.length;i++)if(results[i].status==='rejected')
  console.warn('Falha ao carregar '+labels[i]+' do Supabase:',results[i].reason?.message);
 if(results.every(x=>x.status==='fulfilled')){try{localStorage.setItem('sr_b2b_persistencia_sincronizada_v1','1')}catch{}}
 showControls();
}
window.SRPersistencia={init,refreshCatalog,refreshConfig,refreshClips,saveProduct,saveConfig,saveClips,uploadClip,
 legacyClipCount,publishLegacyClips,showControls,ready:state.ready,remoteProduct:cod=>state.remoteProd[cod]??null};
init().catch(e=>console.warn('Persistência não disponível',e.message));
})();