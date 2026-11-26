/* =====================================================================
   whatsapp-g360 — remarketing do Portal B2B pelo WhatsApp.

   Gatilhos (cada um liga e desliga no painel, com prazo e texto próprios):
   - cadastro_sem_senha: ficha criada (aprovado com código do G360) e o cliente ainda não entrou.
   - sem_primeira_compra: já entrou no portal e ainda não fez pedido.
   - carrinho_abandonado: deixou itens no carrinho e não finalizou.
   Só recebe quem marcou "Aceito receber pelo WhatsApp" no Quero ser cliente (LGPD), não está na
   lista de saída e não recebeu nada nos últimos N dias (intervalo do painel).

   Envio de verdade só com os três: segredos WHATSAPP_ENDPOINT e WHATSAPP_CHAVE (API do parceiro),
   e "Envio ligado" no painel. Sem isso, tudo roda em MODO SIMULAÇÃO: escolhe quem receberia e
   registra em whatsapp_envios (modo "simulado"), sem mandar nada.

   Ações (POST, só Content-Type, origens de PORTAL_ORIGENS, token do operador do G360):
   - config_ler, config_salvar {envio_ligado, intervalo_dias, gatilhos}
   - rodar {simular?}  → roda os gatilhos agora
   - envios_listar     → últimos 100 envios (empresa, gatilho, final do telefone, modo)
   - saida_adicionar {telefone, motivo} / saidas_listar → quem pediu para não receber
   Agendado (sem navegador): POST com o cabeçalho X-Agenda-Chave = segredo WHATSAPP_AGENDA_CHAVE.

   Telefone completo, token e chaves não vão para log nem para as tabelas de envio
   (lá ficam só os 4 últimos dígitos e um resumo).
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
const chaveAdmin = JSON.parse(obrigatoria("SUPABASE_SECRET_KEYS")).default as string;
const admin = createClient(obrigatoria("SUPABASE_URL"), chaveAdmin, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const PORTAL = [...ORIGENS].find((o) => o.startsWith("https://")) ?? "";

const segredo = (n: string) => { const v = Deno.env.get(n)?.trim() ?? ""; return v === "<preencha>" ? "" : v; };
const ENDPOINT = segredo("WHATSAPP_ENDPOINT");
const CHAVE_WPP = segredo("WHATSAPP_CHAVE");
const CHAVE_AGENDA = segredo("WHATSAPP_AGENDA_CHAVE");
const provedorPronto = () => /^https:\/\/[^\s]+$/.test(ENDPOINT) && CHAVE_WPP.length >= 10;
const MAX_POR_RODADA = 50;

type Gatilho = { ativo: boolean; espera: number; modelo: string; texto: string };
const DEF: Record<string, { rotulo: string; unidade: "horas" | "dias"; min: number; max: number; padrao: Gatilho }> = {
  cadastro_sem_senha: {
    rotulo: "Cadastrou e não criou a senha", unidade: "horas", min: 1, max: 168,
    padrao: { ativo: false, espera: 24, modelo: "", texto: "Olá, {nome}! Seu acesso ao Portal B2B da Souza Ribeiro já está pronto. Crie a sua senha pelo link que mandamos no seu e-mail e veja os seus preços: {portal}" },
  },
  sem_primeira_compra: {
    rotulo: "Entrou e ainda não comprou", unidade: "dias", min: 1, max: 30,
    padrao: { ativo: false, espera: 3, modelo: "", texto: "Olá, {nome}! Os seus preços na Souza Ribeiro já estão liberados no portal. Que tal fazer o primeiro pedido? {portal}" },
  },
  carrinho_abandonado: {
    rotulo: "Deixou itens no carrinho", unidade: "horas", min: 1, max: 72,
    padrao: { ativo: false, espera: 4, modelo: "", texto: "Olá, {nome}! Você deixou itens no carrinho do Portal B2B. É só entrar e finalizar: {portal}" },
  },
};

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
async function resumo(t: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))), (b) => b.toString(16).padStart(2, "0")).join("");
}
/** Celular brasileiro → 55DDDNÚMERO, ou null. */
function telefone(v: unknown): string | null {
  let x = String(v ?? "").replace(/\D/g, "");
  if ((x.length === 12 || x.length === 13) && x.startsWith("55")) x = x.slice(2);
  if ((x.length === 11 || x.length === 12) && x.startsWith("0")) x = x.slice(1);
  return /^[1-9][0-9]{9,10}$/.test(x) ? `55${x}` : null;
}
const destino = (fone: string) => resumo(`${LOJA}|${fone}`);
const primeiroNome = (v: unknown) => texto(v, 60).split(/\s+/)[0] || "";

/* ---------- operador do G360 ---------- */
const conferidos = new Map<string, { ate: number; nome: string }>();
async function operador(token: string): Promise<{ nome: string } | null> {
  if (!/^op_[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const h = await resumo(token);
  const c = conferidos.get(h);
  if (c && c.ate > Date.now()) return { nome: c.nome };
  const r = await fetch(`${API}/b2b/v1/lojas/${LOJA}/operadores/me`, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (r.status === 401) { conferidos.delete(h); await r.body?.cancel(); return null; }
  if (!r.ok) { await r.body?.cancel(); throw new Error(`operadores/me ${r.status}`); }
  const o = (await r.json())?.dados?.operador ?? {};
  const nome = texto(o.nome || o.usuario, 80) || "Equipe";
  conferidos.set(h, { ate: Date.now() + 60_000, nome });
  if (conferidos.size > 300) for (const [k, v] of conferidos) if (v.ate < Date.now()) conferidos.delete(k);
  return { nome };
}

/* ---------- configuração ---------- */
async function lerConfig() {
  const { data, error } = await admin.from("whatsapp_config").select("envio_ligado, intervalo_dias, gatilhos, atualizado_em, atualizado_por").eq("loja", LOJA).maybeSingle();
  if (error) throw error;
  const g = (data?.gatilhos ?? {}) as Record<string, Partial<Gatilho>>;
  const gatilhos: Record<string, Gatilho> = {};
  for (const [k, d] of Object.entries(DEF)) gatilhos[k] = { ...d.padrao, ...(g[k] ?? {}) };
  return { envio_ligado: data?.envio_ligado === true, intervalo_dias: data?.intervalo_dias ?? 3, gatilhos, atualizado_em: data?.atualizado_em ?? null, atualizado_por: data?.atualizado_por ?? null };
}

function validarGatilhos(entrada: unknown): Record<string, Gatilho> | string {
  const g = (entrada ?? {}) as Record<string, Record<string, unknown>>;
  const saida: Record<string, Gatilho> = {};
  for (const [k, d] of Object.entries(DEF)) {
    const x = g[k] ?? {};
    const espera = Number(x.espera);
    if (!Number.isInteger(espera) || espera < d.min || espera > d.max) return `${d.rotulo}: o prazo vai de ${d.min} a ${d.max} ${d.unidade}.`;
    const t = texto(x.texto, 700);
    if (t.length < 10) return `${d.rotulo}: escreva a mensagem.`;
    const modelo = texto(x.modelo, 80);
    if (modelo && !/^[a-z0-9_]{1,80}$/.test(modelo)) return `${d.rotulo}: o nome do modelo usa só letras minúsculas, números e _ (como está aprovado na Meta).`;
    saida[k] = { ativo: x.ativo === true, espera, modelo, texto: t };
  }
  return saida;
}

/* ---------- candidatos de cada gatilho ---------- */
type Cand = { gatilho: string; ref: string; empresa: string; nome: string; fone: string };
const horasAtras = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

/** Cadastros com aceite, por código do G360 (o mais recente de cada cliente). */
async function cadastrosComAceite(codigos?: number[]) {
  let q = admin.from("portal_cadastros").select("id, codigo_g360, razao_social, fantasia, responsavel, whats, criado_em, status")
    .eq("loja", LOJA).eq("aceita_whatsapp", true).not("codigo_g360", "is", null).order("criado_em", { ascending: false }).limit(1000);
  if (codigos) { if (!codigos.length) return new Map(); q = q.in("codigo_g360", codigos.slice(0, 500)); }
  const { data, error } = await q;
  if (error) throw error;
  const m = new Map<number, NonNullable<typeof data>[number]>();
  for (const c of data ?? []) if (!m.has(c.codigo_g360)) m.set(c.codigo_g360, c);
  return m;
}

async function compradoresComPedido(codigos: number[], desde?: Map<number, string>) {
  if (!codigos.length) return new Set<number>();
  const { data, error } = await admin.from("portal_eventos").select("comprador_codigo, criado_em").eq("loja", LOJA).eq("tipo", "pedido").in("comprador_codigo", codigos.slice(0, 500));
  if (error) throw error;
  const s = new Set<number>();
  for (const e of data ?? []) { const d = desde?.get(e.comprador_codigo); if (!d || e.criado_em >= d) s.add(e.comprador_codigo); }
  return s;
}

async function candidatos(cfg: Awaited<ReturnType<typeof lerConfig>>): Promise<Cand[]> {
  const lista: Cand[] = [];
  const add = (gatilho: string, ref: string, c: { razao_social?: string | null; fantasia?: string | null; responsavel?: string | null; whats?: string | null }) => {
    const fone = telefone(c.whats);
    if (fone) lista.push({ gatilho, ref, empresa: texto(c.fantasia || c.razao_social, 200), nome: primeiroNome(c.responsavel) || texto(c.fantasia || c.razao_social, 60), fone });
  };
  const g = cfg.gatilhos;

  if (g.cadastro_sem_senha.ativo) {
    const { data, error } = await admin.from("portal_cadastros").select("id, codigo_g360, razao_social, fantasia, responsavel, whats")
      .eq("loja", LOJA).eq("aceita_whatsapp", true).eq("status", "aprovado").not("codigo_g360", "is", null)
      .lte("criado_em", horasAtras(g.cadastro_sem_senha.espera)).gte("criado_em", horasAtras(24 * 7)).limit(500);
    if (error) throw error;
    const cods = (data ?? []).map((c) => c.codigo_g360 as number);
    const { data: ac, error: e2 } = cods.length ? await admin.from("portal_acessos").select("comprador_codigo").eq("loja", LOJA).in("comprador_codigo", cods) : { data: [], error: null };
    if (e2) throw e2;
    const entrou = new Set((ac ?? []).map((a) => a.comprador_codigo));
    for (const c of data ?? []) if (!entrou.has(c.codigo_g360)) add("cadastro_sem_senha", `cad:${c.id}`, c);
  }

  if (g.sem_primeira_compra.ativo) {
    const { data, error } = await admin.from("portal_acessos").select("comprador_codigo")
      .eq("loja", LOJA).lte("primeiro_em", horasAtras(24 * g.sem_primeira_compra.espera)).gte("primeiro_em", horasAtras(24 * 60)).limit(500);
    if (error) throw error;
    const cods = (data ?? []).map((a) => a.comprador_codigo as number);
    const [cads, compraram] = await Promise.all([cadastrosComAceite(cods), compradoresComPedido(cods)]);
    for (const cod of cods) { const c = cads.get(cod); if (c && !compraram.has(cod)) add("sem_primeira_compra", `cli:${cod}`, c); }
  }

  if (g.carrinho_abandonado.ativo) {
    const { data, error } = await admin.from("portal_carrinhos").select("comprador_codigo, linhas, atualizado_em")
      .eq("loja", LOJA).lte("atualizado_em", horasAtras(g.carrinho_abandonado.espera)).gte("atualizado_em", horasAtras(72)).limit(500);
    if (error) throw error;
    const cheios = (data ?? []).filter((c) => Array.isArray(c.linhas) && c.linhas.length > 0);
    const cods = cheios.map((c) => c.comprador_codigo as number);
    const desde = new Map(cheios.map((c) => [c.comprador_codigo as number, c.atualizado_em as string]));
    const [cads, compraram] = await Promise.all([cadastrosComAceite(cods), compradoresComPedido(cods, desde)]);
    for (const c of cheios) {
      const cad = cads.get(c.comprador_codigo);
      if (cad && !compraram.has(c.comprador_codigo)) add("carrinho_abandonado", `car:${c.comprador_codigo}:${Date.parse(c.atualizado_em)}`, cad);
    }
  }
  return lista;
}

/* ---------- envio ---------- */
function montarTexto(t: string, c: Cand) {
  return t.replaceAll("{nome}", c.nome || "tudo bem").replaceAll("{empresa}", c.empresa || "").replaceAll("{portal}", PORTAL).slice(0, 1000);
}

/** API do parceiro. Formato provisório (genérico): ajustar à documentação do parceiro antes de ligar o envio. */
async function enviarParceiro(fone: string, modelo: string, mensagem: string, c: Cand): Promise<{ ok: boolean; detalhe: string }> {
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${CHAVE_WPP}` },
      body: JSON.stringify({ telefone: fone, modelo: modelo || null, variaveis: [c.nome, PORTAL], texto: mensagem }),
      redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    await r.body?.cancel();
    return { ok: r.ok, detalhe: r.ok ? "Enviado ao parceiro." : `Parceiro recusou (${r.status}).` };
  } catch (e) {
    return { ok: false, detalhe: `Sem resposta do parceiro (${(e as Error)?.name ?? "erro"}).` };
  }
}

async function rodar(forcarSimulacao: boolean) {
  const cfg = await lerConfig();
  const real = !forcarSimulacao && cfg.envio_ligado && provedorPronto();
  const lista = await candidatos(cfg);
  const res = { modo: real ? "real" : "simulacao", candidatos: lista.length, enviados: 0, simulados: 0, erros: 0, pulados: 0 };
  if (!lista.length) return res;

  const limiteDias = new Date(Date.now() - cfg.intervalo_dias * 86_400_000).toISOString();
  const dia = new Date(Date.now() - 86_400_000).toISOString();
  const { data: saidas } = await admin.from("whatsapp_saidas").select("destinatario").eq("loja", LOJA);
  const fora = new Set((saidas ?? []).map((s) => s.destinatario));
  const { data: recentes } = await admin.from("whatsapp_envios").select("gatilho, ref, destinatario, modo, criado_em").eq("loja", LOJA).gte("criado_em", horasAtras(24 * 60)).limit(5000);
  const jaReal = new Set((recentes ?? []).filter((e) => e.modo !== "simulado").map((e) => `${e.gatilho}|${e.ref}`));
  const simHoje = new Set((recentes ?? []).filter((e) => e.modo === "simulado" && e.criado_em >= dia).map((e) => `${e.gatilho}|${e.ref}`));
  // Intervalo entre mensagens: na simulação conta o que foi simulado; no real, só o que saiu de verdade.
  const ultimo = new Map<string, string>();
  for (const e of recentes ?? []) if ((real ? e.modo === "enviado" : e.modo !== "erro") && (!ultimo.has(e.destinatario) || e.criado_em > ultimo.get(e.destinatario)!)) ultimo.set(e.destinatario, e.criado_em);

  let feitos = 0;
  for (const c of lista) {
    if (feitos >= MAX_POR_RODADA) { res.pulados++; continue; }
    const dest = await destino(c.fone);
    const chave = `${c.gatilho}|${c.ref}`;
    if (fora.has(dest) || jaReal.has(chave) || (!real && simHoje.has(chave)) || (ultimo.get(dest) ?? "") >= limiteDias) { res.pulados++; continue; }
    const g = cfg.gatilhos[c.gatilho];
    const mensagem = montarTexto(g.texto, c);
    let modo: "simulado" | "enviado" | "erro" = "simulado"; let detalhe = "Simulação: nada foi enviado.";
    if (real) { const r = await enviarParceiro(c.fone, g.modelo, mensagem, c); modo = r.ok ? "enviado" : "erro"; detalhe = r.detalhe; }
    const { error } = await admin.from("whatsapp_envios").insert({ loja: LOJA, gatilho: c.gatilho, ref: c.ref, empresa: c.empresa || null, telefone_final: c.fone.slice(-4), destinatario: dest, modo, detalhe });
    if (error && error.code !== "23505") throw error;
    ultimo.set(dest, new Date().toISOString()); feitos++;
    if (modo === "enviado") res.enviados++; else if (modo === "erro") res.erros++; else res.simulados++;
  }
  return res;
}

/* ---------- servidor ---------- */
Deno.serve(async (req) => {
  // Rodada agendada (sem navegador): só com a chave da agenda.
  const agenda = req.headers.get("X-Agenda-Chave") ?? "";
  if (agenda) {
    if (CHAVE_AGENDA.length < 20 || agenda !== CHAVE_AGENDA || req.method !== "POST") return new Response(null, { status: 403 });
    try { return Response.json({ dados: await rodar(false) }); }
    catch (e) { console.warn("whatsapp-g360 agenda", String((e as Error)?.message ?? "").slice(0, 120)); return Response.json({ mensagem: "Falhou." }, { status: 500 }); }
  }

  const origem = req.headers.get("Origin") ?? "";
  if (!ORIGENS.has(origem)) return new Response(null, { status: 403 });
  const h = new Headers({ "Access-Control-Allow-Origin": origem, Vary: "Origin", "Content-Type": "application/json", "Cache-Control": "no-store" });
  if (req.method === "OPTIONS") {
    h.set("Access-Control-Allow-Headers", "Content-Type"); h.set("Access-Control-Allow-Methods", "POST, OPTIONS"); h.set("Access-Control-Max-Age", "600");
    return new Response(null, { status: 204, headers: h });
  }
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: h });
  if (req.method !== "POST") return json(405, { mensagem: "Use POST." });
  let corpo: Record<string, unknown>;
  try { const t = await req.text(); if (t.length > 20_000) return json(413, { mensagem: "Pedido grande demais." }); corpo = JSON.parse(t); }
  catch { return json(400, { mensagem: "Pedido inválido." }); }

  try {
    const op = await operador(typeof corpo.token === "string" ? corpo.token : "");
    if (!op) return json(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." });
    const d = (corpo.dados ?? {}) as Record<string, unknown>;

    if (corpo.acao === "config_ler") {
      const cfg = await lerConfig();
      const { count } = await admin.from("portal_cadastros").select("id", { count: "exact", head: true }).eq("loja", LOJA).eq("aceita_whatsapp", true);
      const definicoes = Object.fromEntries(Object.entries(DEF).map(([k, v]) => [k, { rotulo: v.rotulo, unidade: v.unidade, min: v.min, max: v.max }]));
      return json(200, { dados: { ...cfg, definicoes, provedor_pronto: provedorPronto(), agenda_pronta: CHAVE_AGENDA.length >= 20, com_aceite: count ?? 0 } });
    }
    if (corpo.acao === "config_salvar") {
      const gatilhos = validarGatilhos(d.gatilhos);
      if (typeof gatilhos === "string") return json(400, { mensagem: gatilhos });
      const intervalo = Number(d.intervalo_dias);
      if (!Number.isInteger(intervalo) || intervalo < 1 || intervalo > 30) return json(400, { mensagem: "O intervalo entre mensagens vai de 1 a 30 dias." });
      const ligado = d.envio_ligado === true;
      if (ligado && !provedorPronto()) return json(400, { mensagem: "Cadastre a API do parceiro antes de ligar o envio. Até lá, tudo roda em simulação." });
      const { error } = await admin.from("whatsapp_config").upsert({ loja: LOJA, envio_ligado: ligado, intervalo_dias: intervalo, gatilhos, atualizado_em: new Date().toISOString(), atualizado_por: op.nome }, { onConflict: "loja" });
      if (error) throw error;
      return json(200, { dados: await lerConfig() });
    }
    if (corpo.acao === "rodar") return json(200, { dados: await rodar(d.simular === true) });
    if (corpo.acao === "envios_listar") {
      const { data, error } = await admin.from("whatsapp_envios").select("id, gatilho, empresa, telefone_final, modo, detalhe, criado_em").eq("loja", LOJA).order("criado_em", { ascending: false }).limit(100);
      if (error) throw error;
      return json(200, { dados: data ?? [] });
    }
    if (corpo.acao === "saida_adicionar") {
      const fone = telefone(d.telefone);
      if (!fone) return json(400, { mensagem: "Digite o celular com DDD." });
      const { error } = await admin.from("whatsapp_saidas").upsert({ loja: LOJA, destinatario: await destino(fone), telefone_final: fone.slice(-4), motivo: texto(d.motivo, 120) || `Incluído por ${op.nome}` }, { onConflict: "loja,destinatario" });
      if (error) throw error;
      return json(200, { ok: true });
    }
    if (corpo.acao === "saidas_listar") {
      const { data, error } = await admin.from("whatsapp_saidas").select("telefone_final, motivo, criado_em").eq("loja", LOJA).order("criado_em", { ascending: false }).limit(200);
      if (error) throw error;
      return json(200, { dados: data ?? [] });
    }
    return json(400, { mensagem: "Ação desconhecida." });
  } catch (e) {
    console.warn("whatsapp-g360", String((e as Error)?.message ?? "").slice(0, 120));
    return json(503, { mensagem: "Não foi possível concluir agora. Tente de novo em instantes." });
  }
});
