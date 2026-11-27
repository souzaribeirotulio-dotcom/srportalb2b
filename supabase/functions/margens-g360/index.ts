/* =====================================================================
   margens-g360 — margens automáticas da aba Margens do painel.

   De segunda a sexta, a partir das 18h (pg_cron, cabeçalho X-Agenda-Chave conferido no Vault pela RPC
   margens_agenda_confere), a função entra com o usuário técnico do G360 (G360_CADASTRO_USUARIO e
   G360_CADASTRO_SENHA, os mesmos do cadastro automático), percorre operadores/produtos/busca de 50 em 50
   e guarda em margens_produtos só os produtos com estoque DISPONÍVEL positivo (preço, custo, margem e
   origem do preço vêm do G360; nada é calculado aqui). Cada chamada trabalha até ~100 s e continua de
   onde parou na chamada seguinte (a agenda chama a cada 5 minutos até a rodada do dia terminar).
   Produto que zerou o estoque ou saiu do catálogo some da lista quando a rodada termina.

   Ações do painel (POST, só Content-Type, origens de PORTAL_ORIGENS, token do operador; permissão 'mrg'):
   - {"acao":"ler"}     → { rodada, produtos (todos os guardados), margem_minima }
   - {"acao":"rodar"}   → confere agora com o token do próprio operador (um lote; o painel chama até terminar)
   - {"acao":"marcar","produto_id":N,"status":"ajustar"|"ok"} / {"acao":"desmarcar","produto_id":N}
     → marca a margem baixa como conferida ("precisa ajustar" ou "margem ok"); vem junto em "ler" (marcas)
   Usuário, senha e tokens nunca vão para log nem para as tabelas.
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
const admin = createClient(obrigatoria("SUPABASE_URL"), chave, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const base = `${API}/b2b/v1/lojas/${LOJA}/`;
const LOTE_MS = 100_000;       // tempo de trabalho por chamada (a função tem até 150 s)
const RODADA_MAX_MS = 20 * 60_000; // rodada parada há mais tempo que isso recomeça do zero

/** Dia de hoje em Brasília (AAAA-MM-DD). */
const hojeBrasilia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

async function g360(caminho: string, init: RequestInit & { token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.body) headers["Content-Type"] = "application/json";
  if (init.token) headers["Authorization"] = `Bearer ${init.token}`;
  return await fetch(base + caminho, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(20_000) });
}

/** Sessão do usuário técnico (só para a agenda). */
async function entrarTecnico(): Promise<string | null> {
  const usuario = Deno.env.get("G360_CADASTRO_USUARIO")?.trim() ?? "";
  const senha = Deno.env.get("G360_CADASTRO_SENHA") ?? "";
  if (!usuario || !senha) return null;
  const r = await g360("operadores/sessoes", { method: "POST", body: JSON.stringify({ usuario, senha }) });
  const j = await r.json().catch(() => null);
  return r.status === 201 && typeof j?.dados?.token === "string" ? j.dados.token : null;
}
async function sairTecnico(token: string) { try { const r = await g360("operadores/sessao", { method: "DELETE", token }); await r.body?.cancel(); } catch { /* vence sozinha */ } }

type Rodada = { dia: string | null; pagina: number; paginas: number | null; produtos: number; iniciada_em: string | null; concluida_em: string | null; origem: string | null; erro: string | null };
async function lerRodada(): Promise<Rodada | null> {
  const { data, error } = await admin.from("margens_rodada").select("dia, pagina, paginas, produtos, iniciada_em, concluida_em, origem, erro").eq("loja", LOJA).maybeSingle();
  if (error) throw error;
  return data as Rodada | null;
}
const gravarRodada = async (m: Partial<Rodada>) => { const { error } = await admin.from("margens_rodada").upsert({ loja: LOJA, ...m }); if (error) throw error; };

/** Confere um lote de páginas. Devolve a rodada depois do lote. */
async function conferirLote(token: string, origem: "agenda" | "manual", recomecar: boolean): Promise<Rodada & { sem_custo_acesso?: boolean }> {
  const inicio = Date.now();
  let r: Rodada | null = await lerRodada();
  const dia = hojeBrasilia();
  const parada = r?.iniciada_em && !r.concluida_em && Date.now() - Date.parse(r.iniciada_em) > RODADA_MAX_MS;
  if (!r || recomecar || parada || (r.concluida_em && r.dia !== dia) || (!r.concluida_em && r.dia !== dia)) {
    r = { dia, pagina: 0, paginas: null, produtos: 0, iniciada_em: new Date().toISOString(), concluida_em: null, origem, erro: null };
    await gravarRodada(r);
  }
  if (r.concluida_em) return r; // a rodada de hoje já terminou
  let semCusto = false;
  while (Date.now() - inicio < LOTE_MS) {
    const pagina: number = r.pagina + 1;
    const resp = await g360("operadores/produtos/busca", { method: "POST", token, body: JSON.stringify({ pagina, limite: 50 }) });
    if (resp.status === 401) { await resp.body?.cancel(); throw Object.assign(new Error("sessao"), { status: 401 }); }
    if (resp.status === 429) { await resp.body?.cancel(); await gravarRodada({ ...r, erro: "O G360 pediu para esperar (muitas consultas). A conferência continua na próxima chamada." }); break; }
    if (!resp.ok) { await resp.body?.cancel(); await gravarRodada({ ...r, erro: `O G360 não respondeu (${resp.status}). A conferência continua na próxima chamada.` }); break; }
    const j = await resp.json();
    const lista = Array.isArray(j?.dados) ? j.dados as Record<string, unknown>[] : [];
    const total = Number(j?.paginacao?.total) || 0;
    const paginas = Math.max(1, Math.ceil(total / 50));
    const agora = new Date().toISOString();
    // Só estoque disponível positivo (decisão da Souza Ribeiro em 27/11/2026).
    const itens = lista.filter((p) => Number(p.quantidade_disponivel) > 0).map((p) => ({
      loja: LOJA, produto_id: Number(p.id), codigo: String(p.codigo ?? "").slice(0, 40), nome: String(p.nome ?? "").slice(0, 200),
      preco: typeof p.preco === "string" ? p.preco : null,
      custo: typeof p.custo === "number" ? p.custo : null,
      margem: typeof p.margem_percentual === "number" ? p.margem_percentual : null,
      origem_preco: typeof p.origem_preco === "string" ? p.origem_preco : null,
      disponivel: Number(p.quantidade_disponivel), custo_visivel: p.custo_visivel === true, verificado_em: agora,
    })).filter((i) => Number.isSafeInteger(i.produto_id) && i.produto_id > 0);
    if (lista.length && lista.every((p) => p.custo_visivel !== true)) semCusto = true;
    if (itens.length) { const { error } = await admin.from("margens_produtos").upsert(itens, { onConflict: "loja,produto_id" }); if (error) throw error; }
    r = { ...r, pagina, paginas, produtos: r.produtos + itens.length, erro: semCusto ? "O usuário do G360 usado na conferência não tem acesso a custo e margem (permissão 01110)." : null };
    if (pagina >= paginas || !lista.length) {
      // Terminou: tira quem não apareceu nesta rodada (zerou o estoque ou saiu do catálogo).
      const { error } = await admin.from("margens_produtos").delete().eq("loja", LOJA).lt("verificado_em", r.iniciada_em!);
      if (error) throw error;
      r = { ...r, concluida_em: new Date().toISOString() };
      await gravarRodada(r);
      break;
    }
    await gravarRodada(r);
  }
  return { ...r, sem_custo_acesso: semCusto };
}

Deno.serve(async (req) => {
  // Agenda (pg_cron, sem navegador): só com a chave guardada no Vault.
  const agenda = req.headers.get("X-Agenda-Chave") ?? "";
  if (agenda) {
    if (req.method !== "POST") return new Response(null, { status: 405 });
    const { data: ok } = await admin.rpc("margens_agenda_confere", { p_chave: agenda });
    if (ok !== true) return new Response(null, { status: 403 });
    const atual = await lerRodada().catch(() => null);
    // Já conferido hoje depois das 18h: nada a fazer. Conferido hoje antes das 18h (no painel): confere de novo.
    const horaBr = (iso: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(new Date(iso)));
    const hojeConcluida = !!atual?.concluida_em && atual.dia === hojeBrasilia();
    if (hojeConcluida && horaBr(atual!.concluida_em!) >= 18) return Response.json({ dados: { feito: true } });
    const token = await entrarTecnico();
    if (!token) {
      await gravarRodada({ ...(atual ?? { pagina: 0, produtos: 0 }), erro: "O usuário técnico do G360 não entrou (confira G360_CADASTRO_USUARIO e G360_CADASTRO_SENHA)." }).catch(() => {});
      return Response.json({ mensagem: "Sem login no G360." }, { status: 503 });
    }
    try { const r = await conferirLote(token, "agenda", hojeConcluida); return Response.json({ dados: { pagina: r.pagina, paginas: r.paginas, concluida: !!r.concluida_em } }); }
    catch (e) { console.warn("margens-g360 agenda", String((e as Error)?.message ?? "").slice(0, 120)); return Response.json({ mensagem: "Falhou." }, { status: 500 }); }
    finally { await sairTecnico(token); }
  }

  const origem = req.headers.get("Origin") ?? "";
  if (!ORIGENS.has(origem)) return new Response(null, { status: 403 });
  const h = new Headers({ "Access-Control-Allow-Origin": origem, Vary: "Origin", "Content-Type": "application/json", "Cache-Control": "no-store" });
  if (req.method === "OPTIONS") {
    h.set("Access-Control-Allow-Headers", "Content-Type"); h.set("Access-Control-Allow-Methods", "POST, OPTIONS"); h.set("Access-Control-Max-Age", "600");
    return new Response(null, { status: 204, headers: h });
  }
  const res = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: h });
  if (req.method !== "POST") return res(405, { mensagem: "Use POST." });
  let corpo: Record<string, unknown>;
  try { const t = await req.text(); if (t.length > 5000) return res(413, { mensagem: "Pedido grande demais." }); corpo = JSON.parse(t); }
  catch { return res(400, { mensagem: "Pedido inválido." }); }
  const token = typeof corpo.token === "string" ? corpo.token : "";
  if (!/^op_[A-Za-z0-9_-]{20,80}$/.test(token)) return res(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." });

  try {
    const me = await g360("operadores/me", { token });
    if (me.status === 401) { await me.body?.cancel(); return res(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." }); }
    if (!me.ok) { await me.body?.cancel(); return res(503, { mensagem: "Não foi possível conferir a sessão. Tente de novo." }); }
    const opMe = (await me.json())?.dados?.operador ?? {};
    const codigoOp = opMe.codigo;
    const nomeOp = String(opMe.nome || opMe.usuario || "Equipe").slice(0, 80);
    const { data: perms } = await admin.rpc("painel_permissoes_efetivas", { p_loja: LOJA, p_codigo: codigoOp });
    if (!(perms || []).includes("mrg")) return res(403, { mensagem: "Você não tem acesso às margens." });

    if (corpo.acao === "ler") {
      const [rodada, cfg] = await Promise.all([lerRodada(), admin.from("portal_config").select("margem_minima").eq("loja", LOJA).maybeSingle()]);
      // O banco devolve no máximo 1000 linhas por leitura: lê em partes.
      const produtos: unknown[] = [];
      for (let de = 0; de < 20000; de += 1000) {
        const { data, error } = await admin.from("margens_produtos").select("produto_id, codigo, nome, preco, custo, margem, origem_preco, disponivel, custo_visivel, verificado_em")
          .eq("loja", LOJA).order("produto_id").range(de, de + 999);
        if (error) throw error;
        produtos.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      const { data: marcas, error: em } = await admin.from("margens_marcas").select("produto_id, status, margem_marcada, marcado_por, marcado_em").eq("loja", LOJA).limit(10000);
      if (em) throw em;
      return res(200, { dados: { rodada, margem_minima: Number(cfg.data?.margem_minima ?? 15), produtos, marcas: marcas ?? [] } });
    }
    if (corpo.acao === "marcar" || corpo.acao === "desmarcar") {
      const id = Number(corpo.produto_id);
      if (!Number.isSafeInteger(id) || id < 1) return res(400, { mensagem: "Produto inválido." });
      if (corpo.acao === "desmarcar") {
        const { error } = await admin.from("margens_marcas").delete().eq("loja", LOJA).eq("produto_id", id);
        if (error) throw error;
        return res(200, { ok: true });
      }
      const status = corpo.status === "ok" ? "ok" : corpo.status === "ajustar" ? "ajustar" : null;
      if (!status) return res(400, { mensagem: "Escolha: precisa ajustar ou margem ok." });
      const { data: p } = await admin.from("margens_produtos").select("margem").eq("loja", LOJA).eq("produto_id", id).maybeSingle();
      const { error } = await admin.from("margens_marcas").upsert({ loja: LOJA, produto_id: id, status, margem_marcada: p?.margem ?? null, marcado_por: nomeOp, marcado_em: new Date().toISOString() }, { onConflict: "loja,produto_id" });
      if (error) throw error;
      return res(200, { ok: true });
    }
    if (corpo.acao === "rodar") {
      try { const r = await conferirLote(token, "manual", corpo.recomecar === true); return res(200, { dados: r }); }
      catch (e) { if ((e as { status?: number }).status === 401) return res(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." }); throw e; }
    }
    return res(400, { mensagem: "Ação desconhecida." });
  } catch (e) {
    console.warn("margens-g360", String((e as Error)?.message ?? "").slice(0, 120));
    return res(503, { mensagem: "Não foi possível conferir as margens agora. Tente de novo em instantes." });
  }
});
