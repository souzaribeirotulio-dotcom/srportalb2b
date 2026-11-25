/* =====================================================================
   executivo-link — o executivo de contas pede o link de acesso (definir senha)
   para um cliente indicado por ele.

   POST {"token": <sessão do Supabase do executivo>, "vinculo_id": <uuid>}
   (só Content-Type; origens de PORTAL_ORIGENS).
   - A sessão do Supabase identifica o executivo (auth.getUser). Nunca vale um
     código de executivo ou documento vindo do navegador.
   - O vínculo tem de ser DESSE executivo, aprovado (ativo ou sem_comissao) e com
     código de cliente. O documento é lido aqui, com a chave secreta, e não volta
     para o navegador.
   - O pedido vai para a ponte-g360 (pedir_link), igual ao "esqueci minha senha":
     o link segue para o e-mail do cadastro no G360, vale 30 minutos e uma vez só.
     A chave de sistema continua só na ponte.
   - Limite próprio: 1 pedido a cada 2 minutos e 3 a cada 15 minutos por cliente
     (o mesmo teto da API), registrados em executivo_links (sem documento, sem e-mail).
   Nada do token ou do documento vai para log.
   ===================================================================== */
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

function obrigatoria(nome: string): string {
  const v = Deno.env.get(nome)?.trim();
  if (!v || v === "<preencha>") throw new Error(`Configure ${nome}`);
  return v;
}
const LOJA = obrigatoria("G360_LOJA");
if (!/^[a-f0-9]{16}$/.test(LOJA)) throw new Error("Configure G360_LOJA");
const ORIGENS = new Set(obrigatoria("PORTAL_ORIGENS").split(",").map((o) => o.trim()));
const SUPABASE_URL = obrigatoria("SUPABASE_URL").replace(/\/$/, "");
const chave = JSON.parse(obrigatoria("SUPABASE_SECRET_KEYS")).default as string;
const admin = createClient(SUPABASE_URL, chave, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const jwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

Deno.serve(async (req) => {
  const origem = req.headers.get("Origin") ?? "";
  if (!ORIGENS.has(origem)) return new Response(null, { status: 403 });
  const h = new Headers({ "Access-Control-Allow-Origin": origem, Vary: "Origin", "Content-Type": "application/json", "Cache-Control": "no-store" });
  if (req.method === "OPTIONS") {
    h.set("Access-Control-Allow-Headers", "Content-Type");
    h.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    h.set("Access-Control-Max-Age", "600");
    return new Response(null, { status: 204, headers: h });
  }
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: h });
  if (req.method !== "POST") return json(405, { mensagem: "Método não permitido." });
  let corpo: Record<string, unknown>;
  try {
    const t = await req.text();
    if (t.length > 8000) return json(413, { mensagem: "Pedido grande demais." });
    corpo = JSON.parse(t);
  } catch { return json(400, { mensagem: "Pedido inválido." }); }
  const encerrada = () => json(401, { mensagem: "Sua sessão terminou. Entre novamente." });
  const token = typeof corpo.token === "string" ? corpo.token : "";
  const vinculoId = typeof corpo.vinculo_id === "string" ? corpo.vinculo_id : "";
  if (!jwt.test(token) || token.length > 4000) return encerrada();
  if (!uuid.test(vinculoId)) return json(400, { mensagem: "Cliente inválido." });
  try {
    const { data: u, error: eu } = await admin.auth.getUser(token);
    if (eu || !u?.user?.id) return encerrada();
    const { data: e, error: ee } = await admin.from("executivos").select("id").eq("loja", LOJA).eq("user_id", u.user.id).eq("ativo", true).maybeSingle();
    if (ee) throw ee;
    if (!e) return json(403, { mensagem: "Este acesso não está ativo. Fale com a equipe da Souza Ribeiro." });
    const { data: v, error: ev } = await admin.from("executivo_clientes").select("id, documento, situacao, cliente_codigo")
      .eq("id", vinculoId).eq("loja", LOJA).eq("executivo_id", e.id).maybeSingle();
    if (ev) throw ev;
    // Cliente de outro executivo, ainda não aprovado ou sem documento: a mesma resposta.
    if (!v || !["ativo", "sem_comissao"].includes(v.situacao) || !v.cliente_codigo || !/^[A-Za-z0-9./-]{1,32}$/.test(String(v.documento ?? ""))) {
      return json(404, { mensagem: "Este cliente não está na sua lista de clientes aprovados." });
    }
    const { data: envios, error: el } = await admin.from("executivo_links").select("enviado_em").eq("vinculo_id", v.id)
      .gte("enviado_em", new Date(Date.now() - 15 * 60_000).toISOString()).order("enviado_em", { ascending: false });
    if (el) throw el;
    const ultimo = envios?.[0] ? Date.parse(envios[0].enviado_em) : 0;
    if (ultimo && Date.now() - ultimo < 2 * 60_000) {
      return json(429, { mensagem: "O link acabou de ser enviado. Peça ao cliente para olhar o e-mail (e a caixa de spam) antes de pedir outro." });
    }
    if ((envios?.length ?? 0) >= 3) return json(429, { mensagem: "Já foram pedidos 3 links nos últimos 15 minutos para este cliente. Espere um pouco e tente de novo." });
    const r = await fetch(`${SUPABASE_URL}/functions/v1/ponte-g360`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origem },
      body: JSON.stringify({ acao: "pedir_link", documento: v.documento }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    await r.body?.cancel();
    if (r.status !== 202) {
      console.warn("executivo-link: ponte respondeu", r.status);
      return json(503, { mensagem: "Não foi possível pedir o link agora. Tente de novo em instantes." });
    }
    const agora = new Date().toISOString();
    const { error: ei } = await admin.from("executivo_links").insert({ loja: LOJA, executivo_id: e.id, vinculo_id: v.id, enviado_em: agora });
    if (ei) console.warn("executivo-link: registro do envio falhou", String(ei.code ?? ""));
    return json(200, { dados: { link_em: agora }, mensagem: "Pedido enviado. Se o acesso do cliente estiver liberado no G360, ele recebe o link no e-mail do cadastro. O link vale 30 minutos e serve uma vez só." });
  } catch (err) {
    console.warn("executivo-link: falha", String((err as { code?: string })?.code ?? ""), String((err as Error)?.message ?? "").slice(0, 120));
    return json(500, { mensagem: "Não foi possível concluir agora. Tente de novo em instantes." });
  }
});
