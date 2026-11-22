/* dashboard-g360 — números de vendas do portal para o painel dos GESTORES.
   POST {"token": <operador do G360>, "dias": 1|7|30|90} (só Content-Type; origens de PORTAL_ORIGENS).
   - Confere o operador com GET operadores/me e exige a permissão 'vendas' do painel.
   - Vendas: pedidos feitos pelo portal (portal_eventos, tipo 'pedido'), período atual e o anterior
     (para a comparação), por dia, por produto e por cliente.
   - Margem bruta: (venda − custo) ÷ venda, com o CUSTO ATUAL do G360 (operadores/produtos/busca com o
     token do próprio gestor; só vem com o acesso 01110). Itens vendidos em caixa/pacote (unidade
     alternativa) entram nas vendas mas ficam fora da margem, porque a API não informa a conversão.
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
const diaBR = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }); // AAAA-MM-DD em Brasília
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

type Item = { produto_id?: number; codigo?: string; nome?: string; quantidade?: string; total?: string; unidade_id?: string | null };
type Ev = { comprador_codigo: number; valor: string | null; itens: Item[] | null; criado_em: string; pedido_numero: string | null };

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
  const dias = [1, 7, 30, 90].includes(Number(corpo.dias)) ? Number(corpo.dias) : 30;

  try {
    // Operador e gestor
    const me = await fetch(base + "operadores/me", { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(8000) });
    if (me.status === 401) return res(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." });
    if (me.status !== 200) return res(503, { mensagem: "Não foi possível conferir a sessão. Tente de novo." });
    const codigoOp = (await me.json())?.dados?.operador?.codigo;
    const { data: perms } = await admin.rpc("painel_permissoes_efetivas", { p_loja: LOJA, p_codigo: codigoOp });
    if (!(perms || []).includes("vendas")) return res(403, { mensagem: "Você não tem acesso ao painel de vendas." });

    // Períodos (dias corridos, horário de Brasília): atual e o anterior de mesmo tamanho
    const agora = new Date();
    const hojeBR = diaBR(agora);
    const inicio = new Date(`${hojeBR}T00:00:00-03:00`); inicio.setDate(inicio.getDate() - (dias - 1));
    const inicioAnt = new Date(inicio); inicioAnt.setDate(inicioAnt.getDate() - dias);
    const { data: ev, error } = await admin.from("portal_eventos").select("comprador_codigo, valor, itens, criado_em, pedido_numero")
      .eq("loja", LOJA).eq("tipo", "pedido").gte("criado_em", inicioAnt.toISOString()).order("criado_em", { ascending: false }).limit(20000);
    if (error) throw error;
    const atual = (ev as Ev[] || []).filter((e) => new Date(e.criado_em) >= inicio);
    const anterior = (ev as Ev[] || []).filter((e) => new Date(e.criado_em) < inicio);

    // Custos atuais do G360 para os produtos vendidos no período
    const ids = [...new Set(atual.flatMap((p) => (p.itens || []).map((i) => Number(i.produto_id)).filter((n) => Number.isSafeInteger(n) && n > 0)))].slice(0, 500);
    const custo = new Map<number, { custo: number | null; preco: number }>();
    let custoVisivel = true;
    for (let pagina = 1; ids.length && pagina <= 10; pagina++) {
      const r = await fetch(base + "operadores/produtos/busca", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids, pagina, limite: 50 }), redirect: "error", signal: AbortSignal.timeout(10000),
      });
      if (r.status === 401) return res(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." });
      if (!r.ok) { custoVisivel = false; break; }
      const j = await r.json();
      for (const p of j?.dados || []) {
        if (p.custo_visivel !== true) custoVisivel = false;
        custo.set(Number(p.id), { custo: p.custo === null || p.custo === undefined ? null : num(p.custo), preco: num(p.preco) });
      }
      const total = num(j?.paginacao?.total);
      if (pagina * 50 >= total) break;
    }

    const { data: acessos } = await admin.from("portal_acessos").select("comprador_codigo, nome, ultimo_em").eq("loja", LOJA);
    const nomes = new Map<number, string | null>((acessos ?? []).map((a) => [Number(a.comprador_codigo), (a.nome as string) ?? null]));

    // Agregações
    let valor = 0, custoTot = 0, vendaComCusto = 0;
    const porDia = new Map<string, { valor: number; pedidos: number }>();
    const prod = new Map<string, { codigo: string; nome: string; quantidade: number; pedidos: number; total: number; custo: number; venda_custo: number }>();
    const cli = new Map<number, { codigo: number; nome: string | null; pedidos: number; total: number; ultima: string }>();
    for (const p of atual) {
      const v = num(p.valor); valor += v;
      const dia = diaBR(new Date(p.criado_em));
      const d = porDia.get(dia) ?? { valor: 0, pedidos: 0 }; d.valor += v; d.pedidos += 1; porDia.set(dia, d);
      const c = cli.get(p.comprador_codigo) ?? { codigo: p.comprador_codigo, nome: nomes.get(p.comprador_codigo) ?? null, pedidos: 0, total: 0, ultima: p.criado_em };
      c.pedidos += 1; c.total += v; if (p.criado_em > c.ultima) c.ultima = p.criado_em; cli.set(p.comprador_codigo, c);
      for (const i of p.itens || []) {
        const k = String(i.codigo ?? i.produto_id); const t = num(i.total); const q = num(i.quantidade);
        const r = prod.get(k) ?? { codigo: k, nome: String(i.nome ?? ""), quantidade: 0, pedidos: 0, total: 0, custo: 0, venda_custo: 0 };
        r.pedidos += 1; r.total += t; r.quantidade += q;
        const cu = custo.get(Number(i.produto_id));
        // Só itens na unidade principal: com a unidade gravada (pedidos novos) ou, nos antigos, preço pago perto do de tabela.
        const unitPago = q > 0 ? t / q : 0;
        const basePrincipal = i.unidade_id === undefined ? (cu && cu.preco > 0 ? unitPago <= cu.preco * 2.2 : false) : !i.unidade_id;
        if (cu && cu.custo !== null && q > 0 && basePrincipal) { r.custo += cu.custo * q; r.venda_custo += t; custoTot += cu.custo * q; vendaComCusto += t; }
        prod.set(k, r);
      }
    }
    const valorAnt = anterior.reduce((s, p) => s + num(p.valor), 0);
    const clientesAnt = new Set(anterior.map((p) => p.comprador_codigo)).size;

    // Série diária completa (dias sem venda = 0)
    const serie: { dia: string; valor: number; pedidos: number }[] = [];
    for (let i = 0; i < dias; i++) {
      const k = diaBR(new Date(inicio.getTime() + i * 86400_000 + 12 * 3600_000));
      const d = porDia.get(k) ?? { valor: 0, pedidos: 0 };
      serie.push({ dia: k, valor: r2(d.valor), pedidos: d.pedidos });
    }

    return res(200, { dados: {
      dias, inicio: inicio.toISOString(),
      valor: r2(valor), pedidos: atual.length, ticket: atual.length ? r2(valor / atual.length) : 0,
      clientes: cli.size,
      clientes_entraram: (acessos ?? []).filter((a) => a.ultimo_em >= inicio.toISOString()).length,
      anterior: { valor: r2(valorAnt), pedidos: anterior.length, clientes: clientesAnt },
      margem: custoVisivel && vendaComCusto > 0 ? { percentual: r2((1 - custoTot / vendaComCusto) * 100), valor: r2(vendaComCusto - custoTot), cobertura: valor > 0 ? r2((vendaComCusto / valor) * 100) : 0 } : null,
      custo_visivel: custoVisivel,
      por_dia: serie,
      produtos: [...prod.values()].sort((a, b) => b.total - a.total).slice(0, 10).map((p) => ({
        codigo: p.codigo, nome: p.nome, quantidade: r2(p.quantidade), pedidos: p.pedidos, total: r2(p.total),
        margem: custoVisivel && p.venda_custo > 0 ? r2((1 - p.custo / p.venda_custo) * 100) : null,
      })),
      clientes_lista: [...cli.values()].sort((a, b) => b.total - a.total).slice(0, 10).map((c) => ({ ...c, total: r2(c.total), ticket: r2(c.total / c.pedidos) })),
      ultimos: atual.slice(0, 8).map((p) => ({ quando: p.criado_em, cliente: nomes.get(p.comprador_codigo) ?? `Cliente ${p.comprador_codigo}`, numero: p.pedido_numero, valor: r2(num(p.valor)) })),
    } });
  } catch (e) {
    console.error("dashboard-g360", (e as Error)?.message ?? "erro");
    return res(503, { mensagem: "Não foi possível montar o painel de vendas agora. Tente de novo." });
  }
});
