/* =====================================================================
   Função painel-g360: dados do Supabase para o painel do administrador,
   com o MESMO login do G360 (sem conta separada no Supabase).

   O navegador manda o token do operador (o da API, op_...). A função confere
   o token chamando a própria API do G360 (POST operadores/produtos/busca,
   limite 1). Token aceito -> lê/grava com a chave secreta, sempre recortado
   pela loja. Token recusado (401) -> 401, nada é lido.

   Usa os segredos que a ponte-g360 já tem no projeto (G360_BASE_URL, G360_LOJA,
   PORTAL_ORIGENS, SUPABASE_URL, SUPABASE_SECRET_KEYS). Não usa a chave de sistema.
   Nada do token é registrado em log.
   ===================================================================== */
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

function obrigatoria(nome: string): string {
  const v = Deno.env.get(nome)?.trim();
  if (!v || v === "<preencha>") throw new Error(`Configure ${nome}`);
  return v;
}
const api = new URL(obrigatoria("G360_BASE_URL"));
const loja = obrigatoria("G360_LOJA");
if (!/^[a-f0-9]{16}$/.test(loja)) throw new Error("Configure G360_LOJA");
const origens = new Set(obrigatoria("PORTAL_ORIGENS").split(",").map((o) => o.trim()));
const chave = JSON.parse(obrigatoria("SUPABASE_SECRET_KEYS")).default as string;
const admin = createClient(obrigatoria("SUPABASE_URL"), chave, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

const tokenOperador = /^op_[A-Za-z0-9_-]{43}$/;
// Conferência recente do token (resumo SHA-256 -> validade), para não chamar a API a cada clique.
const conferidos = new Map<string, number>();
const CONFERENCIA_MS = 60_000;

async function resumo(t: string): Promise<string> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))).toHex();
}

/** true = token do operador válido nesta loja; false = recusado; lança se a API não respondeu. */
async function conferir(token: string): Promise<boolean> {
  const h = await resumo(token);
  const ate = conferidos.get(h);
  if (ate && ate > Date.now()) return true;
  const r = await fetch(`${api.href.replace(/\/$/, "")}/b2b/v1/lojas/${loja}/operadores/produtos/busca`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ limite: 1 }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  let codigo = "";
  if (!r.ok) { try { codigo = String((await r.json())?.erro?.codigo ?? ""); } catch { /* sem corpo */ } } else await r.body?.cancel();
  // OPERADOR_SEM_ACESSO = sessão válida sem a permissão de produtos: o operador está autenticado.
  if (r.ok || (r.status === 403 && codigo === "OPERADOR_SEM_ACESSO")) {
    conferidos.set(h, Date.now() + CONFERENCIA_MS);
    if (conferidos.size > 500) for (const [k, v] of conferidos) if (v < Date.now()) conferidos.delete(k);
    return true;
  }
  if (r.status === 401) { conferidos.delete(h); return false; }
  throw new Error(`api ${r.status} ${codigo}`);
}

const SITUACOES = new Set(["pendente", "aprovado", "recusado"]);
const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function executar(acao: string, d: Record<string, unknown>): Promise<[number, unknown]> {
  if (acao === "cadastros_listar") {
    const { data, error } = await admin.from("portal_cadastros").select("*").eq("loja", loja)
      .order("criado_em", { ascending: false }).limit(300);
    if (error) throw error;
    return [200, { dados: data }];
  }
  if (acao === "cadastro_decidir") {
    const id = texto(d.id, 40); const status = texto(d.status, 12);
    if (!/^[0-9a-f-]{36}$/.test(id) || !SITUACOES.has(status)) return [400, { mensagem: "Dados inválidos." }];
    const { data, error } = await admin.from("portal_cadastros").update({
      status,
      observacao_equipe: texto(d.observacao, 500) || null,
      decidido_por: "Equipe (usuário do G360)",
      atualizado_em: new Date().toISOString(),
    }).eq("id", id).eq("loja", loja).select("id");
    if (error) throw error;
    if (!data?.length) return [404, { mensagem: "Cadastro não encontrado." }];
    return [200, { ok: true }];
  }
  if (acao === "ocorrencias_listar") {
    const { data, error } = await admin.from("ocorrencias_g360")
      .select("registrada_em, codigo, operacao, comprador_codigo, request_id").eq("loja", loja)
      .order("registrada_em", { ascending: false }).limit(200);
    if (error) throw error;
    return [200, { dados: data }];
  }
  return [400, { mensagem: "Ação desconhecida." }];
}

Deno.serve(async (req) => {
  const origem = req.headers.get("Origin") ?? "";
  if (!origens.has(origem)) return new Response(null, { status: 403 });
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
    if (t.length > 4096) return json(413, { mensagem: "Pedido grande demais." });
    corpo = JSON.parse(t);
  } catch { return json(400, { mensagem: "Pedido inválido." }); }
  const token = typeof corpo.token === "string" ? corpo.token : "";
  if (!tokenOperador.test(token)) return json(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." });
  try {
    if (!(await conferir(token))) return json(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." });
  } catch (e) {
    console.warn("painel-g360: conferência falhou:", String((e as Error)?.message ?? e).slice(0, 120));
    return json(503, { mensagem: "Não foi possível conferir o acesso agora. Tente de novo em instantes." });
  }
  try {
    const [s, b] = await executar(String(corpo.acao || ""), (corpo.dados ?? {}) as Record<string, unknown>);
    return json(s, b);
  } catch {
    console.warn("painel-g360: falha no banco", String(corpo.acao || ""));
    return json(500, { mensagem: "Não foi possível concluir agora. Tente de novo em instantes." });
  }
});
