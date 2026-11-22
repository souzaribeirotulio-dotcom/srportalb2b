/* permissoes-g360 — permissões próprias do painel (o que cada usuário do G360 vê no painel do portal).
   Desenho do CLAUDE.md (seção 11): a tabela painel_operadores não tem política para o navegador;
   quem lê e grava é esta função, que confere o token do operador com GET operadores/me e usa o
   operador.codigo dessa resposta (nunca um código vindo do navegador). Só restringe: o que o G360
   nega continua negado. Gerenciar exige a permissão 'permissoes'.
   Ações (POST, só Content-Type, origens de PORTAL_ORIGENS; token do operador no corpo):
   - {"acao":"minhas"}  → { permissoes: [...], codigo, nome }   (também registra o operador)
   - {"acao":"listar"}  → { operadores: [{ codigo, usuario, nome, permissoes, definidas, visto_em }], chaves }
   - {"acao":"salvar","codigo":N,"permissoes":[...]} → grava as permissões de N */
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
const CHAVES = ["visita", "cli", "neg", "prod", "cong", "mrg", "intel", "souzinha", "cfg", "ocor", "vendas", "estoque", "avisos", "permissoes"];

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
    const me = await fetch(`${API}/b2b/v1/lojas/${LOJA}/operadores/me`, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(8000) });
    if (me.status === 401) return res(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." });
    if (me.status !== 200) return res(503, { mensagem: "Não foi possível conferir a sessão. Tente de novo." });
    const o = (await me.json())?.dados?.operador;
    if (!Number.isSafeInteger(o?.codigo)) return res(503, { mensagem: "Não foi possível conferir a sessão. Tente de novo." });
    const codigo = o.codigo as number;
    await admin.from("painel_operadores").upsert({ loja: LOJA, codigo, usuario: String(o.usuario ?? "").slice(0, 60), nome: String(o.nome ?? "").slice(0, 120), visto_em: new Date().toISOString() }, { onConflict: "loja,codigo" });
    const { data: ef, error: e0 } = await admin.rpc("painel_permissoes_efetivas", { p_loja: LOJA, p_codigo: codigo });
    if (e0) throw e0;
    const minhas: string[] = ef || [];

    if (corpo.acao === "minhas") return res(200, { permissoes: minhas, codigo, nome: o.nome ?? o.usuario ?? "" });

    if (!minhas.includes("permissoes")) return res(403, { mensagem: "Só quem gerencia as permissões pode ver esta tela." });

    if (corpo.acao === "listar") {
      const { data, error } = await admin.from("painel_operadores").select("codigo, usuario, nome, permissoes, permissoes_definidas, visto_em").eq("loja", LOJA).order("visto_em", { ascending: false });
      if (error) throw error;
      const { data: pad } = await admin.rpc("painel_permissoes_padrao");
      return res(200, {
        chaves: CHAVES, padrao: pad || [], eu: codigo,
        operadores: (data || []).map((x) => ({ codigo: x.codigo, usuario: x.usuario, nome: x.nome, definidas: x.permissoes_definidas, permissoes: x.permissoes_definidas ? x.permissoes : (pad || []), visto_em: x.visto_em })),
      });
    }

    if (corpo.acao === "salvar") {
      const alvo = Number(corpo.codigo);
      const lista = Array.isArray(corpo.permissoes) ? [...new Set((corpo.permissoes as unknown[]).map(String).filter((k) => CHAVES.includes(k)))] : null;
      if (!Number.isSafeInteger(alvo) || !lista) return res(400, { mensagem: "Pedido inválido." });
      if (alvo === codigo && !lista.includes("permissoes")) return res(400, { mensagem: "Você não pode tirar de si mesmo o acesso às permissões." });
      const { data: existe } = await admin.from("painel_operadores").select("codigo").eq("loja", LOJA).eq("codigo", alvo).maybeSingle();
      if (!existe) return res(404, { mensagem: "Usuário não encontrado. Ele precisa entrar no painel uma vez." });
      // "gestor" (usado pelos avisos no celular) acompanha a permissão 'avisos'.
      const { error } = await admin.from("painel_operadores").update({ permissoes: lista, permissoes_definidas: true, gestor: lista.includes("avisos") }).eq("loja", LOJA).eq("codigo", alvo);
      if (error) throw error;
      return res(200, { ok: true, permissoes: lista });
    }

    return res(400, { mensagem: "Ação desconhecida." });
  } catch (e) {
    console.error("permissoes-g360", (e as Error)?.message ?? "erro");
    return res(503, { mensagem: "Não foi possível concluir agora. Tente de novo." });
  }
});
