/* =====================================================================
   cadastro-g360 — cadastro automático do "Quero ser cliente" no G360,
   com o usuário técnico do G360 (segredos G360_CADASTRO_USUARIO e
   G360_CADASTRO_SENHA, que só esta função lê).

   Ações (POST, só Content-Type, origens de PORTAL_ORIGENS):
   - testar → confere se o usuário técnico entra, os acessos e as situações de
     cadastro do G360. No máximo um teste a cada 2 minutos.
   - cadastrar {documento} → para um "Quero ser cliente" enviado há menos de 30 minutos
     e ainda não processado: confere o CNPJ (operadores/cadastro/cnpj), cria a ficha
     (POST operadores/clientes, categoria PORTAL, situação LIBERADO, limite R$ 500,00),
     libera o acesso (PUT .../acesso) e pede o link de senha pela ponte-g360. O pedido
     já fica aprovado: o cliente cria a senha e vê preço e compra na hora.
     CNPJ já cadastrado, CPF, situação irregular na Receita ou qualquer recusa da API:
     não cria nada e deixa o pedido para a equipe (auto_status ja_existe/revisar/erro).
   Cada ação abre a sessão do usuário técnico e encerra na hora (DELETE operadores/sessao).
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

// Padrões da ficha criada pelo portal (decisão da Souza Ribeiro em 25/11/2026).
const CATEGORIA = (Deno.env.get("G360_CADASTRO_CATEGORIA") ?? "PORTAL").trim().toUpperCase();
const SITUACAO = (Deno.env.get("G360_CADASTRO_SITUACAO") ?? "LIBERADO").trim().toUpperCase();
const LIMITE = (Deno.env.get("G360_CADASTRO_LIMITE") ?? "500.00").trim();
const POR_HORA = 20;
const SUPABASE_URL = obrigatoria("SUPABASE_URL").replace(/\/$/, "");

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

  if (corpo.acao === "cadastrar") {
    try { return json(200, await cadastrar(String(corpo.documento ?? ""), origem)); }
    catch (e) {
      console.warn("cadastro-g360: falha no cadastro", String((e as Error)?.message ?? "").slice(0, 120));
      return json(200, { resultado: "analise" });
    }
  }
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

const docLimpo = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const so = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const curto = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

/** Marca o resultado no pedido do portal (sem documento, senha ou e-mail na observação). */
async function marcar(id: string, mud: Record<string, unknown>) {
  await admin.from("portal_cadastros").update({ ...mud, auto_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq("id", id).eq("loja", LOJA);
}

async function cadastrar(documentoBruto: string, origem: string): Promise<Record<string, unknown>> {
  const doc = docLimpo(documentoBruto);
  // Resposta para o navegador: "criado" (link enviado) ou "analise" (a equipe segue). Nunca diz se o CNPJ já é cliente.
  const analise = { resultado: "analise" };
  if (!/^[A-Z0-9]{11,14}$/.test(doc)) return analise;
  const desde = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: rows, error: e0 } = await admin.from("portal_cadastros").update({ auto_status: "processando", auto_em: new Date().toISOString() })
    .eq("loja", LOJA).eq("documento", doc).gte("criado_em", desde).is("auto_status", null).is("codigo_g360", null).eq("status", "pendente").select("*");
  if (e0) throw e0;
  const k = rows?.[0] as Record<string, unknown> | undefined;
  if (!k) return analise;
  const id = String(k.id);
  const registrar = (resultado: string) => admin.from("portal_cadastro_auto_log").insert({ loja: LOJA, acao: "cadastrar", resultado: resultado.slice(0, 60) });
  try {
  return await processar(id, k, doc, origem, registrar);
  } catch (e) {
    await marcar(id, { auto_status: "erro", auto_obs: `Falha inesperada no cadastro automático: ${String((e as Error)?.message ?? "").slice(0, 120)}` });
    throw e;
  }
}

/** Link de senha pela ponte, igual ao "esqueci minha senha": vai para o e-mail da ficha no G360
 *  (e só sai se o acesso estiver liberado lá). A resposta da ponte é sempre a mesma. */
async function pedirLink(doc: string, origem: string) {
  const p = await fetch(`${SUPABASE_URL}/functions/v1/ponte-g360`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origem },
    body: JSON.stringify({ acao: "pedir_link", documento: doc }), redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  await p.body?.cancel();
  return p;
}

async function processar(id: string, k: Record<string, unknown>, doc: string, origem: string, registrar: (r: string) => PromiseLike<unknown>): Promise<Record<string, unknown>> {
  const analise = { resultado: "analise" };
  // Pedido de "Já sou cliente": é cliente antigo, a equipe libera.
  if (String(k.origem ?? "").toLowerCase().includes("já é cliente") || String(k.origem ?? "").toLowerCase().includes("ja e cliente")) {
    await marcar(id, { auto_status: "ja_existe", auto_obs: "Pedido de quem já é cliente: a equipe confere e libera o acesso." }); await registrar("ja_cliente"); return analise;
  }
  if (doc.length !== 14) { await marcar(id, { auto_status: "revisar", auto_obs: "CPF: o cadastro automático vale só para CNPJ." }); await registrar("cpf"); return analise; }
  const { count } = await admin.from("portal_cadastro_auto_log").select("id", { count: "exact", head: true }).eq("loja", LOJA).eq("acao", "cadastrar").gte("em", new Date(Date.now() - 3600_000).toISOString());
  if ((count ?? 0) >= POR_HORA) { await marcar(id, { auto_status: "revisar", auto_obs: "Muitos cadastros nesta hora: este ficou para a equipe." }); await registrar("limite_hora"); return analise; }

  const s = await entrar();
  if (!s.token) { await marcar(id, { auto_status: "erro", auto_obs: `Usuário técnico não entrou no G360 (${s.motivo}${s.codigo ? ` ${s.codigo}` : ""}).` }); await registrar(`login_${s.motivo}`); return analise; }
  const token = s.token;
  try {
    // 1. CNPJ na Receita (e se já existe no G360)
    const c = await api("operadores/cadastro/cnpj", { method: "POST", token, body: JSON.stringify({ cnpj: doc }) });
    const sug = (c.corpo?.dados ?? {}) as Record<string, unknown>;
    if (c.status !== 200 && c.status !== 201) {
      await marcar(id, { auto_status: "revisar", auto_obs: `Consulta do CNPJ recusada (${c.erro?.codigo ?? c.status}${c.requestId ? `, ${c.requestId}` : ""}).` }); await registrar("cnpj_erro"); return analise;
    }
    if (sug.ja_existe === true) {
      await marcar(id, { auto_status: "ja_existe", auto_obs: sug.cliente_id ? `Já existe no G360 (código ${sug.cliente_id}). Link de senha pedido para o e-mail do G360; vincule o pedido a esse cliente.` : "Já existe no G360, fora do recorte ou em mais de um cadastro. Confira no G360." });
      // Já é cliente: pede o link de senha para o e-mail do cadastro no G360 (o navegador não fica sabendo).
      try { await pedirLink(doc, origem); } catch { /* a equipe segue pelo painel */ }
      await registrar("ja_existe"); return analise;
    }
    if (sug.situacao_irregular === true) {
      await marcar(id, { auto_status: "revisar", auto_obs: `Situação na Receita: ${curto(sug.situacao_receita, 60) || "irregular"}. Ficou para a equipe.` }); await registrar("irregular"); return analise;
    }
    // 2. Categoria e situação pelo nome
    const ref = async (tipo: string, nome: string) => {
      const r = await api(`operadores/referencias?tipo=${tipo}`, { token });
      const l = Array.isArray(r.corpo?.dados) ? r.corpo!.dados as Array<{ id: number | null; nome: string }> : [];
      return l.find((x) => String(x.nome).trim().toUpperCase() === nome)?.id ?? null;
    };
    const categoria_id = await ref("categoria", CATEGORIA);
    const situacao_id = await ref("situacao", SITUACAO);
    if (!categoria_id || !situacao_id) {
      await marcar(id, { auto_status: "revisar", auto_obs: `Não achei no G360 ${!categoria_id ? `a categoria ${CATEGORIA}` : `a situação ${SITUACAO}`}.` }); await registrar("referencia"); return analise;
    }
    // 3. Ficha
    const end = (sug.endereco ?? {}) as Record<string, unknown>;
    const cep = so(k.cep) || so(end.cep);
    const fone = so(k.whats) || so(k.telefone) || so(sug.telefone1);
    const corpoFicha: Record<string, unknown> = {
      documento: doc,
      nome: curto(sug.nome || sug.razao_social || k.razao_social, 90),
      ie_rg: curto(String(k.inscricao_estadual || sug.ie_rg || "NAO CONTRIBUINTE").toUpperCase(), 26),
      email: curto(k.email, 200) || null,
      telefone1: fone ? curto(fone, 60) : null,
      contato: curto(k.responsavel, 50) || null,
      categoria_id, situacao_id, limite_credito_mensal: LIMITE,
      endereco: { cep, numero: curto(k.numero || end.numero, 10), complemento: curto(k.complemento || end.complemento, 60) || null, logradouro: curto(k.logradouro || end.logradouro, 90) || null },
    };
    const fantasia = curto(k.fantasia || sug.fantasia, 90); if (fantasia) corpoFicha.fantasia = fantasia;
    if (!fone || cep.length !== 8 || !(corpoFicha.endereco as Record<string, unknown>).numero || !corpoFicha.email) {
      await marcar(id, { auto_status: "revisar", auto_obs: "Faltou telefone, CEP, número ou e-mail para criar a ficha." }); await registrar("dados"); return analise;
    }
    const chave = `portal-${id.replace(/-/g, "")}`;
    const f = await fetch(base + "operadores/clientes", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": chave },
      body: JSON.stringify(corpoFicha), redirect: "error", signal: AbortSignal.timeout(20_000),
    });
    const fc = await f.json().catch(() => null) as Record<string, unknown> | null;
    const ficha = (fc?.dados ?? null) as Record<string, unknown> | null;
    if ((f.status !== 201 && f.status !== 200) || !ficha || !Number.isSafeInteger(ficha.id)) {
      const er = (fc?.erro ?? {}) as Record<string, unknown>;
      const campos = er.campos && typeof er.campos === "object" ? Object.keys(er.campos as object).slice(0, 6).join(", ") : "";
      const repetido = /DOCUMENTO_(E_IE_)?REPETIDO/.test(String(er.codigo ?? ""));
      await marcar(id, { auto_status: repetido ? "ja_existe" : "revisar", auto_obs: `${repetido ? "Documento já tem cadastro no G360" : "O G360 recusou a ficha"} (${er.codigo ?? f.status}${campos ? `: ${campos}` : ""}${fc?.request_id ? `, ${fc.request_id}` : ""}).` });
      if (repetido) { try { await pedirLink(doc, origem); } catch { /* a equipe segue pelo painel */ } }
      await registrar(repetido ? "repetido" : `ficha_${er.codigo ?? f.status}`); return analise;
    }
    const codigo = ficha.id as number;
    // 4. Acesso ao portal
    const a = await api(`operadores/clientes/${codigo}/acesso`, { method: "PUT", token, body: JSON.stringify({ liberado: true, revisao: Number(ficha.revisao ?? 0) }) });
    if (a.status !== 200) {
      await marcar(id, { codigo_g360: codigo, auto_status: "revisar", auto_obs: `Ficha criada (código ${codigo}), mas o acesso não foi liberado (${a.erro?.codigo ?? a.status}). Libere pela ficha.` });
      await registrar("acesso"); return analise;
    }
    // CNPJ novo (decisão da Souza Ribeiro em 25/11/2026): aprovado na hora, já vê preço e compra.
    await marcar(id, { codigo_g360: codigo, em_analise: false, status: "aprovado", decidido_por: "Portal (cadastro automático)", auto_status: "criado", auto_obs: `Ficha ${codigo} criada pelo portal com acesso liberado.` });
    // Indicado por executivo: o vínculo começa a contar (cliente novo), pela mesma regra do painel.
    try {
      const v = await fetch(`${SUPABASE_URL}/functions/v1/executivos-g360`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: origem },
        body: JSON.stringify({ acao: "vinculo_ativar", token, dados: { cadastro_id: id, cliente_codigo: codigo, novo: true } }), redirect: "error", signal: AbortSignal.timeout(15_000),
      });
      await v.body?.cancel();
    } catch { /* sem executivo ou função fora: a equipe confere no painel */ }
    // 5. Link de senha (mesmo caminho do "esqueci minha senha": vai para o e-mail da ficha)
    const p = await pedirLink(doc, origem);
    if (p.status !== 202) await marcar(id, { auto_obs: `Ficha ${codigo} criada com acesso liberado, mas o link de senha não saiu (${p.status}). Gere pela ficha.` });
    await registrar("criado");
    return { resultado: "criado" };
  } finally { await sair(token); }
}
