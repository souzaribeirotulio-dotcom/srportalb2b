/* =====================================================================
   cadastro-g360 — cadastro automático do "Quero ser cliente" no G360,
   com o usuário técnico do G360 (segredos G360_CADASTRO_USUARIO e
   G360_CADASTRO_SENHA, que só esta função lê).

   Etapa 1 (esta versão): ação "testar" — confere se o usuário técnico entra,
   quais acessos ele tem e quais situações de cadastro o G360 oferece. Abre a
   sessão do operador, consulta, e encerra a sessão na hora (DELETE operadores/sessao),
   para não segurar a licença. No máximo um teste a cada 2 minutos.

   POST {"acao": "testar"} (só Content-Type; origens de PORTAL_ORIGENS).
   Nada de usuário, senha ou token vai para log ou para a resposta.
   ===================================================================== */
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

function obrigatoria(nome: string): string {
  const v = Deno.env.get(nome)?.trim();
  if (!v || v === "<preencha>") throw new Error(`Configure ${nome}`);
  return v;
}
const API = obrigatoria("G360_BASE_URL").replace(/\/$/, "");
const LOJA = obrigatoria("G360_LOJA");
if (!/^[a-f0-9]{16}$/.test(LOJA)) throw new Error("Configure G360_LOJA");
const ORIGENS = new Set(obrigatoria("PORTAL_ORIGENS").split(",").map((o) => o.trim()));
const chave = JSON.parse(obrigatoria("SUPABASE_SECRET_KEYS")).default as string;
const admin = createClient(obrigatoria("SUPABASE_URL"), chave, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const base = `${API}/b2b/v1/lojas/${LOJA}/`;

async function api(caminho: string, init: RequestInit & { token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.body) headers["Content-Type"] = "application/json";
  if (init.token) headers["Authorization"] = `Bearer ${init.token}`;
  const r = await fetch(base + caminho, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
  let corpo: Record<string, unknown> | null = null;
  if (r.status !== 204) { try { corpo = await r.json(); } catch { corpo = null; } }
  return { status: r.status, corpo, requestId: String(corpo?.request_id ?? ""), erro: (corpo?.erro ?? null) as Record<string, unknown> | null };
}

/** Abre a sessão do usuário técnico. null + motivo quando recusa. */
async function entrar(): Promise<{ token: string | null; motivo: string; codigo?: string; requestId?: string }> {
  const usuario = Deno.env.get("G360_CADASTRO_USUARIO")?.trim() ?? "";
  const senha = Deno.env.get("G360_CADASTRO_SENHA") ?? "";
  if (!usuario || !senha) return { token: null, motivo: "segredos_ausentes" };
  const r = await api("operadores/sessoes", { method: "POST", body: JSON.stringify({ usuario, senha }) });
  const token = (r.corpo?.dados as Record<string, unknown> | undefined)?.token;
  if (r.status === 201 && typeof token === "string") return { token, motivo: "ok" };
  return { token: null, motivo: r.status === 401 ? "recusado" : r.status === 429 ? "muitas_tentativas" : "indisponivel", codigo: String(r.erro?.codigo ?? ""), requestId: r.requestId };
}

async function sair(token: string) {
  try { await api("operadores/sessao", { method: "DELETE", token }); } catch { /* a sessão vence sozinha */ }
}

Deno.serve(async (req) => {
  const origem = req.headers.get("Origin") ?? "";
  if (!ORIGENS.has(origem)) return new Response(null, { status: 403 });
  const h = new Headers({ "Access-Control-Allow-Origin": origem, Vary: "Origin", "Content-Type": "application/json", "Cache-Control": "no-store" });
  if (req.method === "OPTIONS") {
    h.set("Access-Control-Allow-Headers", "Content-Type");
    h.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    return new Response(null, { status: 204, headers: h });
  }
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: h });
  if (req.method !== "POST") return json(405, { mensagem: "Método não permitido." });
  let corpo: Record<string, unknown>;
  try { const t = await req.text(); if (t.length > 20_000) return json(413, { mensagem: "Pedido grande demais." }); corpo = JSON.parse(t); }
  catch { return json(400, { mensagem: "Pedido inválido." }); }

  if (corpo.acao !== "testar") return json(400, { mensagem: "Ação desconhecida." });
  try {
    // Um teste a cada 2 minutos (cada teste é um login no G360; muitos seguidos travam o usuário).
    const desde = new Date(Date.now() - 2 * 60_000).toISOString();
    const { data: rec, error: e0 } = await admin.from("portal_cadastro_auto_log").select("id").eq("loja", LOJA).eq("acao", "testar").gte("em", desde).limit(1);
    if (e0) throw e0;
    if (rec?.length) return json(429, { mensagem: "Teste feito há menos de 2 minutos. Espere um pouco." });
    await admin.from("portal_cadastro_auto_log").insert({ loja: LOJA, acao: "testar" });

    const s = await entrar();
    if (!s.token) return json(200, { login: s.motivo, codigo: s.codigo || null, request_id: s.requestId || null });
    try {
      const me = await api("operadores/me", { token: s.token });
      const form = await api("operadores/cadastro/cliente", { token: s.token });
      const sit = await api("operadores/referencias?tipo=situacao", { token: s.token });
      const d = (me.corpo?.dados ?? {}) as Record<string, unknown>;
      const op = (d.operador ?? {}) as Record<string, unknown>;
      return json(200, {
        login: "ok",
        operador: { usuario: op.usuario ?? null, nome: op.nome ?? null },
        permissoes: d.permissoes ?? null,
        formulario: form.status === 200 ? form.corpo?.dados ?? null : { erro: form.erro?.codigo ?? form.status },
        situacoes: sit.status === 200 ? sit.corpo?.dados ?? [] : { erro: sit.erro?.codigo ?? sit.status, mensagem: sit.erro?.mensagem ?? null },
      });
    } finally { await sair(s.token); }
  } catch (e) {
    console.warn("cadastro-g360: falha", String((e as { code?: string })?.code ?? ""), String((e as Error)?.message ?? "").slice(0, 120));
    return json(500, { mensagem: "Não foi possível concluir agora. Tente de novo em instantes." });
  }
});
