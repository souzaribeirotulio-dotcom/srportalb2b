/* push-g360 — avisos no celular (Web Push) do Portal B2B.
   Todas as ações: POST, só Content-Type, origens de PORTAL_ORIGENS. Token, senha e documento
   não são registrados. A chave privada VAPID nunca sai do servidor.

   Comprador (app do cliente):
   - {"acao":"chave"} → { chave }  chave pública VAPID.
   - {"acao":"teste","token":<comprador>} → aviso de teste só para os aparelhos desse comprador.

   Gestores (app da equipe, /painel; token do operador do G360, conferido com GET operadores/me):
   - {"acao":"painel_situacao","token":<operador>} → { gestor } e registra o operador em painel_operadores.
   - {"acao":"painel_inscrever","token","endpoint","p256dh","auth","aparelho"} → só gestor.
   - {"acao":"painel_desinscrever","token","endpoint"}
   - {"acao":"painel_teste","token"} → aviso de teste para os aparelhos desse gestor.

   Eventos (avisam TODOS os gestores; o conteúdo vem do banco/G360, nunca do navegador):
   - {"acao":"evento","tipo":"cadastro"} → cadastros pendentes dos últimos 30 min ainda não avisados.
   - {"acao":"evento","tipo":"negociacao"} → negociações abertas dos últimos 30 min ainda não avisadas.
   - {"acao":"evento","tipo":"pedido","pedido_id":N,"token":<comprador>} → confere o pedido com
     GET pedidos/{id} usando o token do próprio comprador; cada pedido é avisado uma vez só. */
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import webpush from "npm:web-push@3.6.7";

function obrigatoria(nome: string): string {
  const v = Deno.env.get(nome)?.trim();
  if (!v || v === "<preencha>") throw new Error(`Configure ${nome}`);
  return v;
}
const API = obrigatoria("G360_BASE_URL").replace(/\/$/, "");
const LOJA = obrigatoria("G360_LOJA");
const ORIGENS = new Set(obrigatoria("PORTAL_ORIGENS").split(",").map((o) => o.trim()));
const chaveAdmin = JSON.parse(obrigatoria("SUPABASE_SECRET_KEYS")).default as string;
const admin = createClient(obrigatoria("SUPABASE_URL"), chaveAdmin, { auth: { persistSession: false, autoRefreshToken: false } });
const CONTATO = "mailto:contato@souzaribeiro.net";
const JANELA_MS = 30 * 60_000;

let chaves: { publica: string; privada: string } | null = null;
async function obterChaves() {
  if (chaves) return chaves;
  const { data, error } = await admin.from("push_chaves").select("publica, privada").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (data) return (chaves = data);
  const novas = webpush.generateVAPIDKeys();
  const { error: e2 } = await admin.from("push_chaves").insert({ id: 1, publica: novas.publicKey, privada: novas.privateKey });
  if (e2) { // outra chamada gerou ao mesmo tempo: usa a que ficou gravada
    const { data: d2, error: e3 } = await admin.from("push_chaves").select("publica, privada").eq("id", 1).single();
    if (e3) throw e3;
    return (chaves = d2);
  }
  return (chaves = { publica: novas.publicKey, privada: novas.privateKey });
}

type Inscricao = { id: number; endpoint: string; p256dh: string; auth: string };
/** Envia um aviso para uma lista de aparelhos; apaga os que não existem mais. */
async function enviar(lista: Inscricao[], tabela: string, aviso: { titulo: string; texto: string; url: string; tag?: string }) {
  const k = await obterChaves();
  webpush.setVapidDetails(CONTATO, k.publica, k.privada);
  const corpo = JSON.stringify(aviso);
  let enviados = 0;
  for (const i of lista) {
    try {
      await webpush.sendNotification({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } }, corpo, { TTL: 3600, urgency: "high" });
      enviados++;
    } catch (e) {
      const st = (e as { statusCode?: number }).statusCode;
      if (st === 404 || st === 410) await admin.from(tabela).delete().eq("id", i.id);
      else console.error("push falhou", st ?? "sem status");
    }
  }
  return enviados;
}

async function apiGet(caminho: string, token: string) {
  return await fetch(`${API}/b2b/v1/lojas/${LOJA}/${caminho}`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(8000),
  });
}

/** Confere o token do operador: { codigo, usuario, nome } ou null (401). Lança se a API não respondeu. */
async function operador(token: string) {
  if (!/^op_[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const r = await apiGet("operadores/me", token);
  if (r.status === 401) return null;
  if (r.status !== 200) throw new Error(`operadores/me ${r.status}`);
  const d = (await r.json())?.dados?.operador;
  if (!Number.isSafeInteger(d?.codigo)) throw new Error("operadores/me sem código");
  return { codigo: d.codigo as number, usuario: String(d.usuario ?? "").slice(0, 60), nome: String(d.nome ?? "").slice(0, 120) };
}

async function ehGestor(codigo: number) {
  const { data } = await admin.from("painel_operadores").select("gestor").eq("loja", LOJA).eq("codigo", codigo).maybeSingle();
  return data?.gestor === true;
}

async function aparelhosDosGestores(): Promise<Inscricao[]> {
  const { data: g, error } = await admin.from("painel_operadores").select("codigo").eq("loja", LOJA).eq("gestor", true);
  if (error) throw error;
  if (!g?.length) return [];
  const { data, error: e2 } = await admin.from("painel_push_inscricoes").select("id, endpoint, p256dh, auth")
    .eq("loja", LOJA).in("operador_codigo", g.map((x) => x.codigo));
  if (e2) throw e2;
  return data || [];
}

/** Marca como avisado; devolve false se já tinha sido (outra chamada chegou antes). */
async function marcar(tipo: string, ref: string) {
  const { error } = await admin.from("push_avisos_enviados").insert({ loja: LOJA, tipo, ref });
  return !error;
}

const dinheiro = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "";
};
const curto = (t: unknown, max = 60) => { const s = String(t ?? "").trim(); return s.length > max ? s.slice(0, max - 1) + "…" : s; };

Deno.serve(async (req) => {
  const origem = req.headers.get("Origin");
  const headers = new Headers({ "Content-Type": "application/json", "Vary": "Origin", "Cache-Control": "no-store" });
  if (!origem || !ORIGENS.has(origem)) return new Response(JSON.stringify({ mensagem: "Origem não permitida." }), { status: 403, headers });
  headers.set("Access-Control-Allow-Origin", origem);
  if (req.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Max-Age", "600");
    return new Response(null, { status: 204, headers });
  }
  const responder = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers });
  if (req.method !== "POST") return responder(405, { mensagem: "Use POST." });

  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return responder(400, { mensagem: "Pedido inválido." }); }
  const token = typeof corpo.token === "string" && corpo.token.length <= 512 ? corpo.token : "";

  try {
    /* ---------- comprador ---------- */
    if (corpo.acao === "chave") return responder(200, { chave: (await obterChaves()).publica });

    if (corpo.acao === "teste") {
      if (!token) return responder(401, { mensagem: "Entre novamente." });
      const me = await apiGet("me", token);
      if (me.status === 401) return responder(401, { mensagem: "Sua sessão terminou. Entre novamente." });
      if (me.status !== 200) return responder(503, { mensagem: "Não foi possível conferir a sessão. Tente de novo." });
      const codigo = (await me.json())?.dados?.comprador?.codigo;
      if (!Number.isSafeInteger(codigo) || codigo < 1) return responder(503, { mensagem: "Não foi possível conferir a sessão. Tente de novo." });
      const { data: lista, error } = await admin.from("push_inscricoes").select("id, endpoint, p256dh, auth").eq("loja", LOJA).eq("comprador_codigo", codigo);
      if (error) throw error;
      if (!lista?.length) return responder(404, { mensagem: "Nenhum celular com avisos ativados nesta conta." });
      const enviados = await enviar(lista, "push_inscricoes", { titulo: "Souza Ribeiro", texto: "🚚 Sua entrega saiu e está a caminho! (aviso de teste)", url: "/pedidos" });
      return responder(200, { enviados, aparelhos: lista.length });
    }

    /* ---------- gestores (painel) ---------- */
    if (typeof corpo.acao === "string" && corpo.acao.startsWith("painel_")) {
      const op = token ? await operador(token) : null;
      if (!op) return responder(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." });

      if (corpo.acao === "painel_situacao") {
        await admin.from("painel_operadores").upsert({ loja: LOJA, codigo: op.codigo, usuario: op.usuario, nome: op.nome, visto_em: new Date().toISOString() }, { onConflict: "loja,codigo", ignoreDuplicates: false });
        return responder(200, { gestor: await ehGestor(op.codigo) });
      }
      if (!(await ehGestor(op.codigo))) return responder(403, { mensagem: "Os avisos do painel são só para os gestores." });

      if (corpo.acao === "painel_inscrever") {
        const endpoint = String(corpo.endpoint ?? ""), p256dh = String(corpo.p256dh ?? ""), auth = String(corpo.auth ?? "");
        if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || p256dh.length > 200 || !auth || auth.length > 100) return responder(400, { mensagem: "Pedido inválido." });
        const { error } = await admin.from("painel_push_inscricoes").upsert({ loja: LOJA, operador_codigo: op.codigo, endpoint, p256dh, auth, aparelho: curto(corpo.aparelho, 60) }, { onConflict: "loja,operador_codigo,endpoint" });
        if (error) throw error;
        return responder(200, { ok: true });
      }
      if (corpo.acao === "painel_desinscrever") {
        await admin.from("painel_push_inscricoes").delete().eq("loja", LOJA).eq("operador_codigo", op.codigo).eq("endpoint", String(corpo.endpoint ?? ""));
        return responder(200, { ok: true });
      }
      if (corpo.acao === "painel_teste") {
        const { data: lista, error } = await admin.from("painel_push_inscricoes").select("id, endpoint, p256dh, auth").eq("loja", LOJA).eq("operador_codigo", op.codigo);
        if (error) throw error;
        if (!lista?.length) return responder(404, { mensagem: "Nenhum celular com avisos ativados para você." });
        const enviados = await enviar(lista, "painel_push_inscricoes", { titulo: "SR Equipe", texto: "🛒 Novo pedido pelo portal: Cliente Exemplo — R$ 1.250,00 (aviso de teste)", url: "/painel" });
        return responder(200, { enviados, aparelhos: lista.length });
      }
      return responder(400, { mensagem: "Ação desconhecida." });
    }

    /* ---------- eventos → todos os gestores ---------- */
    if (corpo.acao === "evento") {
      const desde = new Date(Date.now() - JANELA_MS).toISOString();

      if (corpo.tipo === "cadastro") {
        const { data, error } = await admin.from("portal_cadastros").select("id, razao_social, fantasia, cidade")
          .eq("loja", LOJA).eq("status", "pendente").gte("criado_em", desde).order("criado_em").limit(10);
        if (error) throw error;
        const lista = await aparelhosDosGestores();
        let avisados = 0;
        for (const c of data || []) {
          if (!(await marcar("cadastro", c.id))) continue;
          avisados++;
          if (lista.length) await enviar(lista, "painel_push_inscricoes", {
            titulo: "Novo cadastro para aprovar",
            texto: `${curto(c.fantasia || c.razao_social)}${c.cidade ? ` · ${curto(c.cidade, 30)}` : ""} quer ser cliente.`,
            url: "/painel?aba=cli", tag: `cad-${c.id}`,
          });
        }
        return responder(200, { avisados });
      }

      if (corpo.tipo === "negociacao") {
        const { data, error } = await admin.from("portal_negociacoes").select("id, comprador_codigo, comprador_nome, produto_nome")
          .eq("loja", LOJA).eq("status", "aberta").gte("criado_em", desde).order("criado_em").limit(100);
        if (error) throw error;
        const novos: typeof data = [];
        for (const n of data || []) if (await marcar("negociacao", n.id)) novos.push(n);
        const porCliente = new Map<number, typeof novos>();
        for (const n of novos) porCliente.set(n.comprador_codigo, [...(porCliente.get(n.comprador_codigo) || []), n]);
        const lista = porCliente.size ? await aparelhosDosGestores() : [];
        for (const [cod, itens] of porCliente) {
          if (!lista.length) break;
          const qtd = itens.length;
          await enviar(lista, "painel_push_inscricoes", {
            titulo: "Pedido de negociação",
            texto: `${curto(itens[0].comprador_nome || `Cliente ${cod}`)} pediu preço especial ${qtd === 1 ? `em ${curto(itens[0].produto_nome, 50)}` : `em ${qtd} produtos`}.`,
            url: "/painel?aba=neg", tag: `neg-${cod}`,
          });
        }
        return responder(200, { avisados: novos.length });
      }

      if (corpo.tipo === "pedido") {
        const id = Number(corpo.pedido_id);
        if (!token || !Number.isSafeInteger(id) || id < 1) return responder(400, { mensagem: "Pedido inválido." });
        const [rp, rm] = await Promise.all([apiGet(`pedidos/${id}`, token), apiGet("me", token)]);
        if (rp.status === 401 || rm.status === 401) return responder(401, { mensagem: "Sua sessão terminou." });
        if (rp.status !== 200 || rm.status !== 200) return responder(404, { mensagem: "Pedido não encontrado." });
        const p = (await rp.json())?.dados; const c = (await rm.json())?.dados?.comprador;
        const quando = Date.parse(`${p?.data}T${p?.hora || "00:00"}:00-03:00`);
        if (!p || (Number.isFinite(quando) && Date.now() - quando > 6 * 3600_000)) return responder(200, { avisados: 0 }); // pedido antigo: não avisa
        if (!(await marcar("pedido", String(id)))) return responder(200, { avisados: 0 });
        const lista = await aparelhosDosGestores();
        if (lista.length) await enviar(lista, "painel_push_inscricoes", {
          titulo: "🛒 Novo pedido pelo portal",
          texto: `${curto(c?.fantasia || c?.nome || "Cliente")} — ${dinheiro(p.total)}${p.numero ? ` · nº ${p.numero}` : " · aguardando aprovação"}`,
          url: "/painel", tag: `ped-${id}`,
        });
        return responder(200, { avisados: 1 });
      }
      return responder(400, { mensagem: "Tipo desconhecido." });
    }

    return responder(400, { mensagem: "Ação desconhecida." });
  } catch (e) {
    console.error("push-g360", (e as Error)?.message ?? "erro");
    return responder(503, { mensagem: "Serviço de avisos indisponível. Tente de novo." });
  }
});
