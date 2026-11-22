/* push-g360 — avisos no celular (Web Push) do Portal B2B.
   Ações (POST, só Content-Type, origens de PORTAL_ORIGENS):
   - {"acao":"chave"} → { chave }  chave pública VAPID (gerada na 1ª vez e guardada em push_chaves).
   - {"acao":"teste","token":"<token do comprador>"} → confere o token com GET me na API do G360
     e manda UM aviso de teste só para os aparelhos desse mesmo comprador. Ninguém consegue
     mandar aviso para outra pessoa por aqui.
   A chave privada nunca sai do servidor. Token, senha e documento não são registrados. */
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import webpush from "npm:web-push@3.6.7";

function obrigatoria(nome: string): string {
  const v = Deno.env.get(nome)?.trim();
  if (!v || v === "<preencha>") throw new Error(`Configure ${nome}`);
  return v;
}
const API = obrigatoria("G360_BASE_URL").replace(/\/$/, "");
const LOJA = obrigatoria("G360_LOJA");
const ORIGENS = new Set(obrigatoria("PORTAL_ORIGENS").split(",").map((o) => o.trim()));
const chaveAdmin = JSON.parse(obrigatoria("SUPABASE_SECRET_KEYS")).default as string;
const admin = createClient(obrigatoria("SUPABASE_URL"), chaveAdmin, { auth: { persistSession: false, autoRefreshToken: false } });
const CONTATO = "mailto:contato@souzaribeiro.net";

let chaves: { publica: string; privada: string } | null = null;
async function obterChaves() {
  if (chaves) return chaves;
  const { data, error } = await admin.from("push_chaves").select("publica, privada").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (data) return (chaves = data);
  const novas = webpush.generateVAPIDKeys();
  const { error: e2 } = await admin.from("push_chaves").insert({ id: 1, publica: novas.publicKey, privada: novas.privateKey });
  if (e2) { // outra chamada gerou ao mesmo tempo: usa a que ficou gravada
    const { data: d2, error: e3 } = await admin.from("push_chaves").select("publica, privada").eq("id", 1).single();
    if (e3) throw e3;
    return (chaves = d2);
  }
  return (chaves = { publica: novas.publicKey, privada: novas.privateKey });
}

Deno.serve(async (req) => {
  const origem = req.headers.get("Origin");
  const headers = new Headers({ "Content-Type": "application/json", "Vary": "Origin", "Cache-Control": "no-store" });
  if (!origem || !ORIGENS.has(origem)) return new Response(JSON.stringify({ mensagem: "Origem não permitida." }), { status: 403, headers });
  headers.set("Access-Control-Allow-Origin", origem);
  if (req.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Max-Age", "600");
    return new Response(null, { status: 204, headers });
  }
  const responder = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers });
  if (req.method !== "POST") return responder(405, { mensagem: "Use POST." });

  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return responder(400, { mensagem: "Pedido inválido." }); }

  try {
    if (corpo.acao === "chave") {
      const { publica } = await obterChaves();
      return responder(200, { chave: publica });
    }

    if (corpo.acao === "teste") {
      const token = typeof corpo.token === "string" ? corpo.token : "";
      if (!token || token.length > 512) return responder(401, { mensagem: "Entre novamente." });
      const me = await fetch(`${API}/b2b/v1/lojas/${LOJA}/me`, {
        headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(8000),
      });
      if (me.status === 401) return responder(401, { mensagem: "Sua sessão terminou. Entre novamente." });
      if (me.status !== 200) return responder(503, { mensagem: "Não foi possível conferir a sessão. Tente de novo." });
      const codigo = (await me.json())?.dados?.comprador?.codigo;
      if (!Number.isSafeInteger(codigo) || codigo < 1) return responder(503, { mensagem: "Não foi possível conferir a sessão. Tente de novo." });

      const { data: inscricoes, error } = await admin.from("push_inscricoes")
        .select("id, endpoint, p256dh, auth").eq("loja", LOJA).eq("comprador_codigo", codigo);
      if (error) throw error;
      if (!inscricoes?.length) return responder(404, { mensagem: "Nenhum celular com avisos ativados nesta conta." });

      const k = await obterChaves();
      webpush.setVapidDetails(CONTATO, k.publica, k.privada);
      const aviso = JSON.stringify({
        titulo: "Souza Ribeiro",
        texto: "🚚 Sua entrega saiu e está a caminho! (aviso de teste)",
        url: "/pedidos",
      });
      let enviados = 0;
      for (const i of inscricoes) {
        try {
          await webpush.sendNotification({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } }, aviso, { TTL: 3600, urgency: "normal" });
          enviados++;
        } catch (e) {
          const st = (e as { statusCode?: number }).statusCode;
          if (st === 404 || st === 410) await admin.from("push_inscricoes").delete().eq("id", i.id); // aparelho desativou
          else console.error("push falhou", st ?? "sem status");
        }
      }
      return responder(200, { enviados, aparelhos: inscricoes.length });
    }

    return responder(400, { mensagem: "Ação desconhecida." });
  } catch (e) {
    console.error("push-g360", (e as Error)?.message ?? "erro");
    return responder(503, { mensagem: "Serviço de avisos indisponível. Tente de novo." });
  }
});
