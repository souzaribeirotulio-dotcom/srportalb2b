/* =====================================================================
   Função precadastro-g360: pré-cadastro em lote do portal (decisão da Souza Ribeiro em 27/11/2026),
   para a aba Clientes → Carteira do portal do painel, com o MESMO login do G360.

   Igual à painel-g360: o navegador manda o token do operador (op_...), a função confere o token
   na própria API do G360 (POST operadores/produtos/busca, limite 1) e só então lê/grava com a
   chave secreta, sempre recortada pela loja. Os preços NÃO são gravados aqui: o painel grava cada
   um no G360 com o login do operador e esta função só guarda o andamento.

   Tabelas: portal_pre_cadastro, portal_pre_congelados, minha_lista, view portal_pre_resumo e
   portal_config.pre_conferir_contato. Segredos: os mesmos da painel-g360.
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
const conferidos = new Map<string, number>();
const CONFERENCIA_MS = 60_000;

async function resumo(t: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))), (b) => b.toString(16).padStart(2, "0")).join("");
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
  if (r.ok || (r.status === 403 && codigo === "OPERADOR_SEM_ACESSO")) {
    conferidos.set(h, Date.now() + CONFERENCIA_MS);
    if (conferidos.size > 500) for (const [k, v] of conferidos) if (v < Date.now()) conferidos.delete(k);
    return true;
  }
  if (r.status === 401) { conferidos.delete(h); return false; }
  throw new Error(`api ${r.status} ${codigo}`);
}

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function executar(acao: string, d: Record<string, unknown>): Promise<[number, unknown]> {
  if (acao === "pre_config_ler") {
    const { data, error } = await admin.from("portal_config").select("pre_conferir_contato").eq("loja", loja).maybeSingle();
    if (error) throw error;
    return [200, { dados: { pre_conferir_contato: data?.pre_conferir_contato === true } }];
  }
  if (acao === "pre_config_salvar") {
    const { data, error } = await admin.from("portal_config").upsert({ loja, pre_conferir_contato: d.pre_conferir_contato === true, atualizado_em: new Date().toISOString() }, { onConflict: "loja" }).select("pre_conferir_contato");
    if (error) throw error;
    return [200, { dados: { pre_conferir_contato: data?.[0]?.pre_conferir_contato === true } }];
  }
  /* ---------- Pré-cadastro em lote (27/11/2026) ----------
     A equipe importa no painel os arquivos do lote (clientes + Minha Lista e preços a congelar).
     Os preços são gravados no G360 pelo próprio painel (login do operador), item por item; aqui só fica o andamento. */
  if (acao === "pre_importar_clientes") {
    const lote = texto(d.lote, 60);
    const lista = Array.isArray(d.clientes) ? d.clientes.slice(0, 1000) as Array<Record<string, unknown>> : [];
    if (!lote || !lista.length) return [400, { mensagem: "Nada para importar." }];
    const linhas = [];
    for (const c of lista) {
      const codigo = Number(c.codigo); const documento = texto(c.documento, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!Number.isSafeInteger(codigo) || codigo <= 0 || !/^[A-Z0-9]{11,14}$/.test(documento)) return [400, { mensagem: `Cliente inválido no arquivo (código ${texto(c.codigo, 12) || "?"}).` }];
      const ultima = texto(c.ultima_compra, 10);
      linhas.push({ loja, comprador_codigo: codigo, documento, nome: texto(c.nome, 120) || `Cliente ${codigo}`, cidade: texto(c.cidade, 60) || null, bairro: texto(c.bairro, 60) || null,
        vendedores: texto(c.vendedores, 120) || null, ultima_compra: /^\d{4}-\d{2}-\d{2}$/.test(ultima) ? ultima : null,
        itens_lista: Math.max(0, Math.trunc(Number(c.itens_lista) || 0)), itens_congelados: Math.max(0, Math.trunc(Number(c.itens_congelados) || 0)), lote });
    }
    // Reimportar o mesmo cliente atualiza os dados, mas não apaga o andamento (acesso e senha).
    const { error } = await admin.from("portal_pre_cadastro").upsert(linhas, { onConflict: "loja,comprador_codigo" });
    if (error) throw error;
    return [200, { gravados: linhas.length }];
  }
  if (acao === "pre_importar_itens") {
    const inicio = texto(d.inicio, 10); const fim = texto(d.fim, 10);
    const lista = Array.isArray(d.itens) ? d.itens.slice(0, 1500) as Array<Record<string, unknown>> : [];
    if (!lista.length) return [400, { mensagem: "Nada para importar." }];
    const data = /^\d{4}-\d{2}-\d{2}$/;
    const valorOk = /^(?:0|[1-9][0-9]{0,10})(?:\.[0-9]{1,7})?$/;
    const naLista = new Map<string, { loja: string; comprador_codigo: number; produto_id: number }>();
    const congelar = new Map<string, Record<string, unknown>>();
    for (const i of lista) {
      const comprador = Number(i.codigo); const produto = Number(i.produto_id);
      if (!Number.isSafeInteger(comprador) || comprador <= 0 || !Number.isSafeInteger(produto) || produto <= 0) continue;
      const k = `${comprador}|${produto}`;
      naLista.set(k, { loja, comprador_codigo: comprador, produto_id: produto });
      if (i.congelar === true) {
        const valor = texto(i.valor, 20);
        if (!valorOk.test(valor) || /^0(?:\.0+)?$/.test(valor) || !data.test(inicio) || !data.test(fim) || fim < inicio) continue;
        const dv = texto(i.data, 10);
        congelar.set(k, { loja, comprador_codigo: comprador, produto_id: produto, sku: texto(i.sku, 30) || String(produto), unidade_venda: texto(i.unidade, 6).toUpperCase() || "UN",
          valor, inicio, fim, nf_origem: texto(i.nf, 20) || null, data_venda: data.test(dv) ? dv : null });
      }
    }
    if (naLista.size) {
      const { error } = await admin.from("minha_lista").upsert([...naLista.values()], { onConflict: "loja,comprador_codigo,produto_id", ignoreDuplicates: true });
      if (error) throw error;
    }
    if (congelar.size) {
      // ignoreDuplicates: reimportar não volta para "pendente" o que já foi gravado no G360.
      const { error } = await admin.from("portal_pre_congelados").upsert([...congelar.values()], { onConflict: "loja,comprador_codigo,produto_id", ignoreDuplicates: true });
      if (error) throw error;
    }
    return [200, { lista: naLista.size, congelados: congelar.size }];
  }
  if (acao === "pre_listar") {
    const linhas: Record<string, unknown>[] = [];
    for (let de = 0; de < 20000; de += 1000) {
      const { data, error } = await admin.from("portal_pre_resumo").select("*").eq("loja", loja).order("nome").range(de, de + 999);
      if (error) throw error;
      linhas.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    const { data: peds } = await admin.from("portal_eventos").select("comprador_codigo, valor").eq("loja", loja).eq("tipo", "pedido").limit(20000);
    const porCod = new Map<number, { pedidos: number; valor: number }>();
    for (const p of peds ?? []) { const c = Number(p.comprador_codigo); const r = porCod.get(c) ?? { pedidos: 0, valor: 0 }; r.pedidos++; r.valor = Math.round((r.valor + Number(p.valor || 0)) * 100) / 100; porCod.set(c, r); }
    return [200, { dados: linhas.map((l) => ({ ...l, tipo: String(l.documento ?? "").length === 11 ? "CPF" : "CNPJ", ...(porCod.get(Number(l.comprador_codigo)) ?? { pedidos: 0, valor: 0 }) })) }];
  }
  if (acao === "pre_congelados_pendentes") {
    const limite = Math.min(500, Math.max(1, Math.trunc(Number(d.limite) || 200)));
    const comprador = Number(d.comprador);
    let q = admin.from("portal_pre_congelados").select("comprador_codigo, produto_id, sku, unidade_venda, valor, inicio, fim").eq("loja", loja).eq("situacao", "pendente");
    if (Number.isSafeInteger(comprador) && comprador > 0) q = q.eq("comprador_codigo", comprador);
    const de = Math.max(0, Math.trunc(Number(d.de) || 0));
    const { data, error } = await q.order("comprador_codigo").order("produto_id").range(de, de + limite - 1);
    if (error) throw error;
    const { count } = await admin.from("portal_pre_congelados").select("produto_id", { count: "exact", head: true }).eq("loja", loja).eq("situacao", "pendente");
    return [200, { dados: data ?? [], restantes: count ?? 0 }];
  }
  if (acao === "pre_congelados_produtos") {
    // Produtos distintos ainda pendentes (para conferir unidade e margem antes de gravar).
    const ids = new Set<number>();
    for (let de = 0; de < 50000; de += 1000) {
      const { data, error } = await admin.from("portal_pre_congelados").select("produto_id").eq("loja", loja).eq("situacao", "pendente").order("produto_id").range(de, de + 999);
      if (error) throw error;
      (data ?? []).forEach((r) => ids.add(Number(r.produto_id)));
      if ((data ?? []).length < 1000) break;
    }
    return [200, { dados: [...ids] }];
  }
  if (acao === "pre_congelados_marcar") {
    const lista = Array.isArray(d.itens) ? d.itens.slice(0, 200) as Array<Record<string, unknown>> : [];
    const sits = new Set(["gravado", "recusado", "ignorado", "pendente"]);
    let n = 0;
    for (const i of lista) {
      const comprador = Number(i.comprador); const produto = Number(i.produto_id); const situacao = texto(i.situacao, 12);
      if (!Number.isSafeInteger(comprador) || !Number.isSafeInteger(produto) || !sits.has(situacao)) continue;
      const precoId = Number(i.preco_id);
      const { error } = await admin.from("portal_pre_congelados").update({ situacao, preco_id: Number.isSafeInteger(precoId) && precoId > 0 ? precoId : null, obs: texto(i.obs, 300) || null, atualizado_em: new Date().toISOString() })
        .eq("loja", loja).eq("comprador_codigo", comprador).eq("produto_id", produto);
      if (error) throw error;
      n++;
    }
    return [200, { marcados: n }];
  }
  if (acao === "pre_congelados_cliente") {
    const comprador = Number(d.comprador);
    if (!Number.isSafeInteger(comprador) || comprador <= 0) return [400, { mensagem: "Cliente inválido." }];
    const { data, error } = await admin.from("portal_pre_congelados").select("produto_id, sku, unidade_venda, valor, inicio, fim, data_venda, nf_origem, situacao, obs").eq("loja", loja).eq("comprador_codigo", comprador).order("sku").limit(2000);
    if (error) throw error;
    return [200, { dados: data ?? [] }];
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
    if (t.length > 400_000) return json(413, { mensagem: "Pedido grande demais." });
    corpo = JSON.parse(t);
  } catch { return json(400, { mensagem: "Pedido inválido." }); }
  const token = typeof corpo.token === "string" ? corpo.token : "";
  if (!tokenOperador.test(token)) return json(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." });
  try {
    if (!(await conferir(token))) return json(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." });
  } catch (e) {
    console.warn("precadastro-g360: conferência falhou:", String((e as Error)?.message ?? e).slice(0, 120));
    return json(503, { mensagem: "Não foi possível conferir o acesso agora. Tente de novo em instantes." });
  }
  try {
    const [s, b] = await executar(String(corpo.acao || ""), (corpo.dados ?? {}) as Record<string, unknown>);
    return json(s, b);
  } catch (e) {
    console.warn("precadastro-g360: falha no banco", String(corpo.acao || ""), String((e as { code?: string })?.code ?? ""), String((e as Error)?.message ?? "").slice(0, 160));
    return json(500, { mensagem: "Não foi possível concluir agora. Tente de novo em instantes." });
  }
});
