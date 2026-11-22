/* estoque-g360 — aviso de "estoque em queda" para quem tem a permissão 'estoque' no painel.
   O estoque só pode ser lido com o login de alguém da equipe: o painel (aberto por quem tem a
   permissão) pede a leitura página por página, no máximo a cada hora, e esta função busca no G360
   (operadores/produtos/busca, com o token do próprio operador) e guarda a quantidade DISPONÍVEL.
   Ações (POST, só Content-Type, origens de PORTAL_ORIGENS; token do operador no corpo):
   - {"acao":"status"}            → { precisa_ler, concluida_em, alertas }
   - {"acao":"ler","pagina":N}    → lê a página N (50 produtos) e devolve { pagina, paginas }
   - {"acao":"alertas"}           → queda ≥ 50% em 7 dias e disponível abaixo de 30 (sem os zerados)
   - {"acao":"visto","produto_id":N} → tira da lista até o produto ser reabastecido e cair de novo
   Nada do token é registrado. */
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

function obrigatoria(nome: string): string {
  const v = Deno.env.get(nome)?.trim();
  if (!v || v === "<preencha>") throw new Error(`Configure ${nome}`);
  return v;
}
const API = obrigatoria("G360_BASE_URL").replace(/\/$/, "");
const LOJA = obrigatoria("G360_LOJA");
const ORIGENS = new Set(obrigatoria("PORTAL_ORIGENS").split(",").map((o) => o.trim()));
const chave = JSON.parse(obrigatoria("SUPABASE_SECRET_KEYS")).default as string;
const admin = createClient(obrigatoria("SUPABASE_URL"), chave, { auth: { persistSession: false, autoRefreshToken: false } });
const base = `${API}/b2b/v1/lojas/${LOJA}/`;
const INTERVALO_MS = 60 * 60_000; // uma leitura por hora
const RODADA_MAX_MS = 15 * 60_000; // rodada parada há mais de 15 min pode recomeçar

Deno.serve(async (req) => {
  const origem = req.headers.get("Origin");
  const headers = new Headers({ "Content-Type": "application/json", "Vary": "Origin", "Cache-Control": "no-store" });
  if (!origem || !ORIGENS.has(origem)) return new Response(JSON.stringify({ mensagem: "Origem não permitida." }), { status: 403, headers });
  headers.set("Access-Control-Allow-Origin", origem);
  if (req.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Headers", "Content-Type"); headers.set("Access-Control-Allow-Methods", "POST, OPTIONS"); headers.set("Access-Control-Max-Age", "600");
    return new Response(null, { status: 204, headers });
  }
  const res = (s: number, c: unknown) => new Response(JSON.stringify(c), { status: s, headers });
  if (req.method !== "POST") return res(405, { mensagem: "Use POST." });
  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return res(400, { mensagem: "Pedido inválido." }); }
  const token = typeof corpo.token === "string" ? corpo.token : "";
  if (!/^op_[A-Za-z0-9_-]{20,80}$/.test(token)) return res(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." });

  try {
    const me = await fetch(base + "operadores/me", { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(8000) });
    if (me.status === 401) return res(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." });
    if (me.status !== 200) return res(503, { mensagem: "Não foi possível conferir a sessão. Tente de novo." });
    const codigoOp = (await me.json())?.dados?.operador?.codigo;
    const { data: op } = await admin.from("painel_operadores").select("permissoes").eq("loja", LOJA).eq("codigo", codigoOp).maybeSingle();
    if (!(op?.permissoes || []).includes("estoque")) return res(403, { mensagem: "Você não tem acesso ao aviso de estoque." });

    if (corpo.acao === "status") {
      const { data: l } = await admin.from("estoque_leitura").select("iniciada_em, concluida_em").eq("loja", LOJA).maybeSingle();
      const agora = Date.now();
      const concl = l?.concluida_em ? Date.parse(l.concluida_em) : 0;
      const ini = l?.iniciada_em ? Date.parse(l.iniciada_em) : 0;
      const emAndamento = ini > concl && agora - ini < RODADA_MAX_MS;
      const { data: al, error } = await admin.rpc("estoque_alertas", { p_loja: LOJA });
      if (error) throw error;
      return res(200, { precisa_ler: !emAndamento && agora - concl > INTERVALO_MS, concluida_em: l?.concluida_em ?? null, alertas: (al || []).length });
    }

    if (corpo.acao === "ler") {
      const pagina = Number(corpo.pagina);
      if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 400) return res(400, { mensagem: "Página inválida." });
      if (pagina === 1) await admin.from("estoque_leitura").upsert({ loja: LOJA, iniciada_em: new Date().toISOString(), paginas: 0 });
      const r = await fetch(base + "operadores/produtos/busca", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pagina, limite: 50 }), redirect: "error", signal: AbortSignal.timeout(15000),
      });
      if (r.status === 401) return res(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." });
      if (r.status === 429) return res(429, { mensagem: "Muitas consultas ao G360. A leitura continua daqui a pouco." });
      if (!r.ok) return res(503, { mensagem: "O G360 não respondeu à leitura de estoque." });
      const j = await r.json();
      const agora = new Date().toISOString();
      const itens = (j?.dados || [])
        .filter((p: Record<string, unknown>) => p.quantidade_disponivel !== null && p.quantidade_disponivel !== undefined && Number.isFinite(Number(p.quantidade_disponivel)))
        .map((p: Record<string, unknown>) => ({ loja: LOJA, produto_id: Number(p.id), codigo: String(p.codigo ?? ""), nome: String(p.nome ?? "").slice(0, 200), disponivel: Number(p.quantidade_disponivel), lido_em: agora }));
      if (itens.length) {
        const { error: e1 } = await admin.from("estoque_atual").upsert(itens, { onConflict: "loja,produto_id" });
        if (e1) throw e1;
        const { error: e2 } = await admin.rpc("estoque_registrar_dia", { p_loja: LOJA, p_itens: itens.map((i: { produto_id: number; disponivel: number }) => ({ produto_id: i.produto_id, disponivel: i.disponivel })) });
        if (e2) throw e2;
      }
      const total = Number(j?.paginacao?.total) || 0;
      const paginas = Math.max(1, Math.ceil(total / 50));
      if (pagina >= paginas) {
        await admin.from("estoque_leitura").upsert({ loja: LOJA, concluida_em: agora, paginas });
        // Guarda só 30 dias de histórico.
        await admin.from("estoque_dia").delete().eq("loja", LOJA).lt("dia", new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
      }
      return res(200, { pagina, paginas });
    }

    if (corpo.acao === "alertas") {
      const { data, error } = await admin.rpc("estoque_alertas", { p_loja: LOJA });
      if (error) throw error;
      const { data: l } = await admin.from("estoque_leitura").select("concluida_em").eq("loja", LOJA).maybeSingle();
      return res(200, { alertas: data || [], concluida_em: l?.concluida_em ?? null });
    }

    if (corpo.acao === "visto") {
      const id = Number(corpo.produto_id);
      if (!Number.isSafeInteger(id)) return res(400, { mensagem: "Produto inválido." });
      const { data } = await admin.rpc("estoque_alertas", { p_loja: LOJA });
      const a = (data || []).find((x: { produto_id: number }) => Number(x.produto_id) === id);
      if (a) await admin.from("estoque_vistos").upsert({ loja: LOJA, produto_id: id, pico: a.pico, visto_em: new Date().toISOString(), visto_por: codigoOp });
      return res(200, { ok: true });
    }

    return res(400, { mensagem: "Ação desconhecida." });
  } catch (e) {
    console.error("estoque-g360", (e as Error)?.message ?? "erro");
    return res(503, { mensagem: "Não foi possível consultar o estoque agora. Tente de novo." });
  }
});
