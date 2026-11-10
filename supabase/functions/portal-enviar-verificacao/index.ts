// SR Portal B2B - envio transacional do link de verificação.
// Segredos Supabase: RESEND_API_KEY, EMAIL_FROM="Souza Ribeiro <portalb2b@souzaribeiro.net>",
// PORTAL_PUBLIC_URL="https://sr-portal-b2b.vercel.app"
// IMPORTANTE: verifique o domínio souzaribeiro.net no provedor antes de ativar.
import { createClient } from "npm:@supabase/supabase-js@2";
const HEADERS = {
  "Access-Control-Allow-Origin": "https://sr-portal-b2b.vercel.app",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};
function json(body: unknown, status=200) {
  return new Response(JSON.stringify(body), {status, headers: HEADERS});
}
function validUrl(s: string) {
  try { const u=new URL(s); return u.protocol==="https:" && (u.hostname==="sr-portal-b2b.vercel.app" || u.hostname.endsWith(".souzaribeiro.net")); } catch { return false; }
}
async function sha256(text: string) {
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
const generic={ok:true,mensagem:"Se houver um cadastro pendente para esses dados, um link de confirmação será enviado ao e-mail informado."};
Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:HEADERS});
  if(req.method!=="POST") return json({erro:"Método inválido"},405);
  try {
    const cfg=Deno.env.get("RESEND_API_KEY");
    const from=Deno.env.get("EMAIL_FROM");
    const publicUrl=Deno.env.get("PORTAL_PUBLIC_URL")||"https://sr-portal-b2b.vercel.app";
    if(!cfg||!from||!validUrl(publicUrl))
      return json({erro:"A verificação por e-mail ainda não foi configurada."},503);
    const body=await req.json().catch(()=>({}));
    const cnpj=String(body.cnpj||"").replace(/\D/g,"");
    const email=String(body.email||"").trim().toLowerCase();
    if(!/^\d{14}$/.test(cnpj)||email.length>160||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return json({erro:"Informe um CNPJ e um e-mail válidos."},400);
    const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const bytes=crypto.getRandomValues(new Uint8Array(32));
    const token=[...bytes].map(x=>x.toString(16).padStart(2,"0")).join("");
    const {data,error}=await sb.rpc("portal_email_verificacao_preparar",{
      p_cnpj:cnpj,p_email:email,p_hash:await sha256(token)
    });
    if(error) {
      // Evitar informar a terceiros se o cadastro existe.
      if(/Aguarde antes de reenviar/i.test(error.message)) return json({erro:"Aguarde um minuto antes de solicitar outro link."},429);
      return json(generic);
    }
    const link=new URL(publicUrl);
    link.searchParams.set("verificar_email",token);
    const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
    const name=escapeHtml(String(data?.fantasia||"sua empresa"));
    const html='<div style="font-family:Arial,sans-serif;max-width:540px;margin:auto;color:#19301b">'
      +'<h2>Confirme o e-mail da sua empresa</h2>'
      +'<p>Recebemos um pedido de cadastro para <strong>'+name+'</strong> no Portal B2B Souza Ribeiro.</p>'
      +'<p>Para enviar seu cadastro à nossa equipe, confirme seu e-mail no botão abaixo:</p>'
      +'<p><a href="'+link.toString()+'" style="display:inline-block;background:#195d24;color:white;padding:14px 22px;border-radius:8px;text-decoration:none">Confirmar meu e-mail</a></p>'
      +'<p>O link vence em 24 horas. Se você não solicitou o cadastro, ignore esta mensagem.</p>'
      +'</div>';
    const result=await fetch("https://api.resend.com/emails",{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+cfg},
      body:JSON.stringify({from,to:[email],subject:"Confirme seu e-mail - Portal B2B Souza Ribeiro",html})
    });
    if(!result.ok){
      console.error("Falha Resend",result.status,(await result.text()).slice(0,500));
      return json({erro:"Não foi possível enviar o e-mail agora. Tente novamente."},503);
    }
    return json({ok:true,mensagem:"Enviamos um link de confirmação. Confira sua caixa de entrada e spam."});
  }catch(err){
    console.error("Falha na verificação de e-mail",err);
    return json({erro:"Não foi possível processar o pedido. Tente novamente."},500);
  }
});
