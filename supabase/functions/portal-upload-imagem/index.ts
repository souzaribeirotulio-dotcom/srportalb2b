import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Upload exclusivamente com sessão de administrador do Portal B2B.
// Credencial privilegiada permanece apenas no servidor.
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (body: Record<string, unknown>, status=200) =>
  new Response(JSON.stringify(body),{status,headers});

function secretKey(): string {
  try { const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
    if(typeof keys.default==="string"&&keys.default) return keys.default; }catch(_){}
  const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!legacy)throw new Error("Credencial de serviço não configurada.");
  return legacy;
}
const baseUrl=Deno.env.get("SUPABASE_URL")!;
const supabase=createClient(baseUrl,secretKey(),{
  auth:{persistSession:false,autoRefreshToken:false}
});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const codValido=/^[A-Za-z0-9_-]{1,60}$/;
const tipoExt: Record<string,string>={
  "image/jpeg":"jpg","image/png":"png","image/webp":"webp"
};
function assinaturaValida(d:Uint8Array,mime:string){
  if(mime==="image/jpeg")return d.length>=3&&d[0]===255&&d[1]===216&&d[2]===255;
  if(mime==="image/png")return d.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>d[i]===v);
  if(mime==="image/webp")return d.length>=12
    &&String.fromCharCode(...d.slice(0,4))==="RIFF"
    &&String.fromCharCode(...d.slice(8,12))==="WEBP";
  return false;
}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(req.method!=="POST")return json({erro:"Método não permitido"},405);
  if(Number(req.headers.get("content-length")||0)>3000000)return json({erro:"Imagem muito grande"},413);
  let dados:Record<string,unknown>;
  try{
    const body=await req.text();
    if(body.length>3000000)return json({erro:"Imagem muito grande"},413);
    dados=JSON.parse(body);
  }catch(_){return json({erro:"Envio inválido"},400);}
  const token=String(dados.token||""),cod=String(dados.cod||"");
  if(!uuid.test(token)||!codValido.test(cod))return json({erro:"Sessão ou produto inválido"},401);
  const sessao=await supabase.from("portal_sessoes").select("ref").eq("token",token)
    .eq("tipo","admin").gt("expira",new Date().toISOString()).maybeSingle();
  if(sessao.error)return json({erro:"Não foi possível verificar permissão"},503);
  if(!sessao.data)return json({erro:"Apenas administradores podem publicar imagens"},403);
  const imagem=String(dados.imagem||"");
  const m=imagem.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!m||!tipoExt[m[1]])return json({erro:"Envie uma imagem JPEG, PNG ou WebP"},400);
  if(m[2].length>2800000)return json({erro:"Imagem acima do limite de 2 MB"},413);
  let bin:string;
  try{bin=atob(m[2]);}catch(_){return json({erro:"Imagem inválida"},400);}
  if(bin.length<4||bin.length>2097152)return json({erro:"Imagem acima de 2 MB"},413);
  const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  if(!assinaturaValida(bytes,m[1]))return json({erro:"Formato da imagem não corresponde ao arquivo"},400);
  const path=cod+"/"+crypto.randomUUID()+"."+tipoExt[m[1]];
  const uploaded=await supabase.storage.from("portal-produtos").upload(
    path,new Blob([bytes],{type:m[1]}),
    {contentType:m[1],cacheControl:"31536000",upsert:false}
  );
  if(uploaded.error)return json({erro:"Falha ao armazenar foto: "+uploaded.error.message},502);
  const url=supabase.storage.from("portal-produtos").getPublicUrl(path).data.publicUrl;
  return json({url});
});