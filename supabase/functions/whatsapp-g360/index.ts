/* =====================================================================
   whatsapp-g360 — remarketing do Portal B2B pelo WhatsApp e por e-mail (Resend).

   Gatilhos (cada um liga e desliga no painel, com prazo e texto próprios):
   - cadastro_sem_senha: ficha criada (aprovado com código do G360) e o cliente ainda não entrou.
   - sem_primeira_compra: já entrou no portal e ainda não fez pedido.
   - carrinho_abandonado: deixou itens no carrinho e não finalizou.
   Só recebe quem marcou "Aceito receber pelo WhatsApp" no Quero ser cliente (LGPD), não está na
   lista de saída e não recebeu nada nos últimos N dias (intervalo do painel).

   Cada gatilho escolhe os canais (WhatsApp, e-mail ou os dois).
   WhatsApp de verdade: segredos WHATSAPP_ENDPOINT e WHATSAPP_CHAVE (API do parceiro) + "WhatsApp ligado".
   E-mail de verdade: os mesmos segredos do Resend da ponte (EMAIL_ENDPOINT, EMAIL_CHAVE) + "E-mail ligado";
   remetente em REMARKETING_REMETENTE (padrão "Souza Ribeiro <ofertas@souzaribeiro.net>").
   Fora disso, o canal roda em MODO SIMULAÇÃO: escolhe quem receberia e registra (modo "simulado").
   Todo e-mail leva "Não quero mais receber" (página /sair-emails do portal) e List-Unsubscribe de um clique.

   Ações (POST, só Content-Type, origens de PORTAL_ORIGENS, token do operador do G360):
   - config_ler, config_salvar {envio_ligado, intervalo_dias, gatilhos}
   - rodar {simular?}  → roda os gatilhos agora
   - envios_listar     → últimos 100 envios (empresa, gatilho, final do telefone, modo)
   - saida_adicionar {contato, motivo} (celular ou e-mail) / saidas_listar → quem pediu para não receber
   - sair_email {t} (sem token de operador) → descadastro pelo link do e-mail
   Agendado (sem navegador): POST com o cabeçalho X-Agenda-Chave = segredo WHATSAPP_AGENDA_CHAVE.
   Descadastro de um clique (provedor de e-mail): POST/GET ?sair=<t>.

   Telefone e e-mail completos, token e chaves não vão para log nem para as tabelas de envio
   (lá ficam só os 4 últimos dígitos, o e-mail mascarado e um resumo).
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
const EMAIL_ENDPOINT = segredo("EMAIL_ENDPOINT");
const EMAIL_CHAVE = segredo("EMAIL_CHAVE");
const REMETENTE = segredo("REMARKETING_REMETENTE") || "Souza Ribeiro <ofertas@souzaribeiro.net>";
const emailPronto = () => /^https:\/\/[^\s]+$/.test(EMAIL_ENDPOINT) && EMAIL_CHAVE.length >= 10;
const SUPABASE_URL = obrigatoria("SUPABASE_URL").replace(/\/$/, "");
const MAX_POR_RODADA = 50;

type Gatilho = { ativo: boolean; espera: number; modelo: string; texto: string; canais: { whatsapp: boolean; email: boolean }; assunto: string; email_texto: string };
const DEF: Record<string, { rotulo: string; unidade: "horas" | "dias"; min: number; max: number; padrao: Gatilho }> = {
  cadastro_sem_senha: {
    rotulo: "Cadastrou e não criou a senha", unidade: "horas", min: 1, max: 168,
    padrao: { ativo: false, espera: 24, modelo: "", texto: "Olá, {nome}! Seu acesso ao Portal B2B da Souza Ribeiro já está pronto. Crie a sua senha pelo link que mandamos no seu e-mail e veja os seus preços: {portal}",
      canais: { whatsapp: true, email: true }, assunto: "{nome}, seu acesso ao Portal B2B está pronto",
      email_texto: "Olá, {nome}!\n\nO acesso da {empresa} ao Portal B2B da Souza Ribeiro já está pronto. Falta só criar a sua senha: use o link que mandamos no seu e-mail ou toque em \"Esqueci minha senha\" na tela de entrada.\n\nOs seus preços e as compras já estão liberados." },
  },
  sem_primeira_compra: {
    rotulo: "Entrou e ainda não comprou", unidade: "dias", min: 1, max: 30,
    padrao: { ativo: false, espera: 3, modelo: "", texto: "Olá, {nome}! Os seus preços na Souza Ribeiro já estão liberados no portal. Que tal fazer o primeiro pedido? {portal}",
      canais: { whatsapp: true, email: true }, assunto: "{nome}, seus preços já estão liberados",
      email_texto: "Olá, {nome}!\n\nOs preços da {empresa} já estão liberados no Portal B2B da Souza Ribeiro: descartáveis, embalagens, limpeza e copa com preço de distribuidor.\n\nQue tal fazer o primeiro pedido? Leva poucos minutos." },
  },
  carrinho_abandonado: {
    rotulo: "Deixou itens no carrinho", unidade: "horas", min: 1, max: 72,
    padrao: { ativo: false, espera: 4, modelo: "", texto: "Olá, {nome}! Você deixou itens no carrinho do Portal B2B. É só entrar e finalizar: {portal}",
      canais: { whatsapp: true, email: true }, assunto: "{nome}, você deixou itens no carrinho",
      email_texto: "Olá, {nome}!\n\nVocê deixou itens no carrinho do Portal B2B da Souza Ribeiro. Eles continuam lá: é só entrar e finalizar o pedido." },
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
const emailValido = (v: unknown) => { const e = texto(v, 160).toLowerCase(); return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e) ? e : null; };
const destinoEmail = (email: string) => resumo(`${LOJA}|email|${email}`);
const mascarar = (email: string) => { const [u, d] = email.split("@"); return `${u.slice(0, 2)}***@${d}`.slice(0, 80); };

/* ---------- descadastro do e-mail (link assinado; não expõe o endereço) ---------- */
let chaveSair: CryptoKey | null = null;
async function assinatura(dest: string) {
  if (!chaveSair) chaveSair = await crypto.subtle.importKey("raw", new TextEncoder().encode(`remarketing-sair|${chaveAdmin}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const b = new Uint8Array(await crypto.subtle.sign("HMAC", chaveSair, new TextEncoder().encode(`sair|${LOJA}|${dest}`)));
  return Array.from(b.slice(0, 16), (x) => x.toString(16).padStart(2, "0")).join("");
}
const tokenSair = async (dest: string) => `${dest}.${await assinatura(dest)}`;
/** Confere o link e põe o e-mail na lista de saída. true = feito (ou já estava). */
async function sairPorToken(t: unknown): Promise<boolean> {
  const m = /^([a-f0-9]{64})\.([a-f0-9]{32})$/.exec(String(t ?? ""));
  if (!m || (await assinatura(m[1])) !== m[2]) return false;
  const { error } = await admin.from("whatsapp_saidas").upsert({ loja: LOJA, destinatario: m[1], canal: "email", motivo: "Pediu pelo link do e-mail" }, { onConflict: "loja,destinatario", ignoreDuplicates: true });
  if (error) throw error;
  return true;
}
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
  const { data, error } = await admin.from("whatsapp_config").select("envio_ligado, email_ligado, intervalo_dias, gatilhos, atualizado_em, atualizado_por").eq("loja", LOJA).maybeSingle();
  if (error) throw error;
  const g = (data?.gatilhos ?? {}) as Record<string, Partial<Gatilho>>;
  const gatilhos: Record<string, Gatilho> = {};
  for (const [k, d] of Object.entries(DEF)) gatilhos[k] = { ...d.padrao, ...(g[k] ?? {}), canais: { ...d.padrao.canais, ...(g[k]?.canais ?? {}) } };
  return { envio_ligado: data?.envio_ligado === true, email_ligado: data?.email_ligado === true, intervalo_dias: data?.intervalo_dias ?? 3, gatilhos, atualizado_em: data?.atualizado_em ?? null, atualizado_por: data?.atualizado_por ?? null };
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
    const cx = (x.canais ?? {}) as Record<string, unknown>;
    const canais = { whatsapp: cx.whatsapp === true, email: cx.email === true };
    if (x.ativo === true && !canais.whatsapp && !canais.email) return `${d.rotulo}: escolha WhatsApp, e-mail ou os dois.`;
    const assunto = texto(x.assunto, 120); const emailTexto = texto(x.email_texto, 2000);
    if (canais.email && assunto.length < 3) return `${d.rotulo}: escreva o assunto do e-mail.`;
    if (canais.email && emailTexto.length < 10) return `${d.rotulo}: escreva o texto do e-mail.`;
    saida[k] = { ativo: x.ativo === true, espera, modelo, texto: t, canais, assunto, email_texto: emailTexto };
  }
  return saida;
}

/* ---------- candidatos de cada gatilho ---------- */
type Cand = { gatilho: string; ref: string; empresa: string; nome: string; fone: string | null; email: string | null };
const horasAtras = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

/** Cadastros com aceite, por código do G360 (o mais recente de cada cliente). */
async function cadastrosComAceite(codigos?: number[]) {
  let q = admin.from("portal_cadastros").select("id, codigo_g360, razao_social, fantasia, responsavel, whats, email, criado_em, status")
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
  const add = (gatilho: string, ref: string, c: { razao_social?: string | null; fantasia?: string | null; responsavel?: string | null; whats?: string | null; email?: string | null }) => {
    const fone = telefone(c.whats); const email = emailValido(c.email);
    if (fone || email) lista.push({ gatilho, ref, empresa: texto(c.fantasia || c.razao_social, 200), nome: primeiroNome(c.responsavel) || texto(c.fantasia || c.razao_social, 60), fone, email });
  };
  const g = cfg.gatilhos;

  if (g.cadastro_sem_senha.ativo) {
    const { data, error } = await admin.from("portal_cadastros").select("id, codigo_g360, razao_social, fantasia, responsavel, whats, email")
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
  return t.replaceAll("{nome}", c.nome || "tudo bem").replaceAll("{empresa}", c.empresa || "sua empresa").replaceAll("{portal}", PORTAL).slice(0, 2000);
}
const escHtml = (t: string) => t.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);

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

/** E-mail pelo Resend, com o visual do portal, botão para entrar e o descadastro (link + um clique). */
async function enviarEmail(para: string, dest: string, assunto: string, corpo: string): Promise<{ ok: boolean; detalhe: string }> {
  const t = await tokenSair(dest);
  const sairPagina = `${PORTAL}/sair-emails#t=${t}`;
  const sairUmClique = `${SUPABASE_URL}/functions/v1/whatsapp-g360?sair=${t}`;
  const paragrafos = corpo.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${escHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17242e">` +
    `<div style="background:#061505;padding:20px 22px;border-radius:14px 14px 0 0"><span style="color:#b2e04a;font-weight:800;font-size:20px">Souza Ribeiro</span>` +
    `<span style="color:#a9c19a;font-size:13px;margin-left:8px">Portal B2B</span></div>` +
    `<div style="border:1px solid #e2e6e1;border-top:none;padding:24px;border-radius:0 0 14px 14px;font-size:15px;line-height:1.5">${paragrafos}` +
    (PORTAL ? `<p style="text-align:center;margin:24px 0"><a href="${escHtml(PORTAL)}" style="background:#b2e04a;color:#132c09;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:10px;display:inline-block">Entrar no portal</a></p>` : "") +
    `<p style="font-size:12px;color:#6b7a72;margin-top:24px;border-top:1px solid #e2e6e1;padding-top:12px">Você recebe este e-mail porque se cadastrou no Portal B2B da Souza Ribeiro. ` +
    `<a href="${escHtml(sairPagina)}" style="color:#4b5a52">Não quero mais receber</a></p></div></div>`;
  const textoPuro = `${corpo}\n\nEntrar no portal: ${PORTAL}\n\nNão quer mais receber? ${sairPagina}`;
  try {
    const r = await fetch(EMAIL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${EMAIL_CHAVE}` },
      body: JSON.stringify({ from: REMETENTE, to: [para], subject: assunto, html, text: textoPuro,
        headers: { "List-Unsubscribe": `<${sairUmClique}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }),
      redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    let tipo = "";
    if (!r.ok) { const e = await r.json().catch(() => null); tipo = typeof e?.name === "string" && /^[a-z_]{1,60}$/.test(e.name) ? ` ${e.name}` : ""; } else await r.body?.cancel();
    return { ok: r.ok, detalhe: r.ok ? "Aceito pelo Resend." : `Resend recusou (${r.status}${tipo}).` };
  } catch (e) {
    return { ok: false, detalhe: `Sem resposta do Resend (${(e as Error)?.name ?? "erro"}).` };
  }
}

async function rodar(forcarSimulacao: boolean) {
  const cfg = await lerConfig();
  const realWpp = !forcarSimulacao && cfg.envio_ligado && provedorPronto();
  const realEmail = !forcarSimulacao && cfg.email_ligado && emailPronto();
  const lista = await candidatos(cfg);
  const res = { modo: realWpp || realEmail ? "real" : "simulacao", candidatos: lista.length, enviados: 0, simulados: 0, erros: 0, pulados: 0 };
  if (!lista.length) return res;

  const limiteDias = new Date(Date.now() - cfg.intervalo_dias * 86_400_000).toISOString();
  const dia = new Date(Date.now() - 86_400_000).toISOString();
  const { data: saidas } = await admin.from("whatsapp_saidas").select("destinatario").eq("loja", LOJA);
  const fora = new Set((saidas ?? []).map((x) => x.destinatario));
  const { data: recentes } = await admin.from("whatsapp_envios").select("canal, gatilho, ref, destinatario, modo, criado_em").eq("loja", LOJA).gte("criado_em", horasAtras(24 * 60)).limit(5000);
  const jaReal = new Set((recentes ?? []).filter((e) => e.modo !== "simulado").map((e) => `${e.canal}|${e.gatilho}|${e.ref}`));
  const simHoje = new Set((recentes ?? []).filter((e) => e.modo === "simulado" && e.criado_em >= dia).map((e) => `${e.canal}|${e.gatilho}|${e.ref}`));
  // Intervalo entre mensagens (por canal: cada destino é de um canal): na simulação conta o simulado; no real, só o enviado.
  const ultimo = new Map<string, string>();
  for (const e of recentes ?? []) {
    const real = e.canal === "email" ? realEmail : realWpp;
    if ((real ? e.modo === "enviado" : e.modo !== "erro") && (!ultimo.has(e.destinatario) || e.criado_em > ultimo.get(e.destinatario)!)) ultimo.set(e.destinatario, e.criado_em);
  }

  let feitos = 0;
  for (const c of lista) {
    const g = cfg.gatilhos[c.gatilho];
    const canais: Array<["whatsapp" | "email", string]> = [];
    if (g.canais.whatsapp && c.fone) canais.push(["whatsapp", c.fone]);
    if (g.canais.email && c.email) canais.push(["email", c.email]);
    for (const [canal, contato] of canais) {
      if (feitos >= MAX_POR_RODADA) { res.pulados++; continue; }
      const real = canal === "email" ? realEmail : realWpp;
      const dest = canal === "email" ? await destinoEmail(contato) : await destino(contato);
      const chave = `${canal}|${c.gatilho}|${c.ref}`;
      if (fora.has(dest) || jaReal.has(chave) || (!real && simHoje.has(chave)) || (ultimo.get(dest) ?? "") >= limiteDias) { res.pulados++; continue; }
      let modo: "simulado" | "enviado" | "erro" = "simulado"; let detalhe = "Simulação: nada foi enviado.";
      if (real) {
        const r = canal === "email"
          ? await enviarEmail(contato, dest, montarTexto(g.assunto, c).slice(0, 150), montarTexto(g.email_texto, c))
          : await enviarParceiro(contato, g.modelo, montarTexto(g.texto, c), c);
        modo = r.ok ? "enviado" : "erro"; detalhe = r.detalhe;
      }
      const { error } = await admin.from("whatsapp_envios").insert({
        loja: LOJA, canal, gatilho: c.gatilho, ref: c.ref, empresa: c.empresa || null, destinatario: dest, modo, detalhe,
        telefone_final: canal === "whatsapp" ? contato.slice(-4) : null, email_mascara: canal === "email" ? mascarar(contato) : null,
      });
      if (error && error.code !== "23505") throw error;
      ultimo.set(dest, new Date().toISOString()); feitos++;
      if (modo === "enviado") res.enviados++; else if (modo === "erro") res.erros++; else res.simulados++;
    }
  }
  return res;
}

/* ---------- servidor ---------- */
Deno.serve(async (req) => {
  // Descadastro de um clique (List-Unsubscribe do provedor de e-mail): sem navegador do portal.
  const sairParam = new URL(req.url).searchParams.get("sair");
  if (sairParam !== null) {
    const txt = (t: string, st = 200) => new Response(t, { status: st, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    // Só POST (RFC 8058): antivírus e prévias de link fazem GET e não podem descadastrar ninguém.
    if (req.method !== "POST") return txt("Para sair da lista, use o link \"Não quero mais receber\" do e-mail.");
    try { return txt((await sairPorToken(sairParam)) ? "Pronto: você não recebe mais estes e-mails." : "Link inválido."); }
    catch { return txt("Tente de novo em instantes.", 503); }
  }
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
    // Página /sair-emails do portal (link do e-mail): não precisa de login.
    if (corpo.acao === "sair_email") {
      return (await sairPorToken(corpo.t)) ? json(200, { mensagem: "Pronto. Você não vai mais receber estes e-mails da Souza Ribeiro." })
        : json(400, { mensagem: "Este link não é válido. Abra o link direto do e-mail." });
    }
    const op = await operador(typeof corpo.token === "string" ? corpo.token : "");
    if (!op) return json(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." });
    const d = (corpo.dados ?? {}) as Record<string, unknown>;

    if (corpo.acao === "config_ler") {
      const cfg = await lerConfig();
      const { count } = await admin.from("portal_cadastros").select("id", { count: "exact", head: true }).eq("loja", LOJA).eq("aceita_whatsapp", true);
      const definicoes = Object.fromEntries(Object.entries(DEF).map(([k, v]) => [k, { rotulo: v.rotulo, unidade: v.unidade, min: v.min, max: v.max }]));
      return json(200, { dados: { ...cfg, definicoes, provedor_pronto: provedorPronto(), email_pronto: emailPronto(), remetente: REMETENTE, agenda_pronta: CHAVE_AGENDA.length >= 20, com_aceite: count ?? 0 } });
    }
    if (corpo.acao === "config_salvar") {
      const gatilhos = validarGatilhos(d.gatilhos);
      if (typeof gatilhos === "string") return json(400, { mensagem: gatilhos });
      const intervalo = Number(d.intervalo_dias);
      if (!Number.isInteger(intervalo) || intervalo < 1 || intervalo > 30) return json(400, { mensagem: "O intervalo entre mensagens vai de 1 a 30 dias." });
      const ligado = d.envio_ligado === true; const emailLigado = d.email_ligado === true;
      if (ligado && !provedorPronto()) return json(400, { mensagem: "Cadastre a API do parceiro antes de ligar o WhatsApp. Até lá, ele roda em simulação." });
      if (emailLigado && !emailPronto()) return json(400, { mensagem: "O envio de e-mail (Resend) não está configurado nos segredos." });
      const { error } = await admin.from("whatsapp_config").upsert({ loja: LOJA, envio_ligado: ligado, email_ligado: emailLigado, intervalo_dias: intervalo, gatilhos, atualizado_em: new Date().toISOString(), atualizado_por: op.nome }, { onConflict: "loja" });
      if (error) throw error;
      return json(200, { dados: await lerConfig() });
    }
    if (corpo.acao === "rodar") return json(200, { dados: await rodar(d.simular === true) });
    if (corpo.acao === "envios_listar") {
      const { data, error } = await admin.from("whatsapp_envios").select("id, canal, gatilho, empresa, telefone_final, email_mascara, modo, detalhe, criado_em").eq("loja", LOJA).order("criado_em", { ascending: false }).limit(100);
      if (error) throw error;
      return json(200, { dados: data ?? [] });
    }
    if (corpo.acao === "saida_adicionar") {
      const contato = texto(d.contato ?? d.telefone, 160);
      const email = contato.includes("@") ? emailValido(contato) : null; const fone = email ? null : telefone(contato);
      if (!email && !fone) return json(400, { mensagem: "Digite o celular com DDD ou o e-mail." });
      const linha = email
        ? { loja: LOJA, canal: "email", destinatario: await destinoEmail(email), email_mascara: mascarar(email), telefone_final: null }
        : { loja: LOJA, canal: "whatsapp", destinatario: await destino(fone!), telefone_final: fone!.slice(-4), email_mascara: null };
      const { error } = await admin.from("whatsapp_saidas").upsert({ ...linha, motivo: texto(d.motivo, 120) || `Incluído por ${op.nome}` }, { onConflict: "loja,destinatario" });
      if (error) throw error;
      return json(200, { ok: true });
    }
    if (corpo.acao === "saidas_listar") {
      const { data, error } = await admin.from("whatsapp_saidas").select("canal, telefone_final, email_mascara, motivo, criado_em").eq("loja", LOJA).order("criado_em", { ascending: false }).limit(200);
      if (error) throw error;
      return json(200, { dados: data ?? [] });
    }
    return json(400, { mensagem: "Ação desconhecida." });
  } catch (e) {
    console.warn("whatsapp-g360", String((e as Error)?.message ?? "").slice(0, 120));
    return json(503, { mensagem: "Não foi possível concluir agora. Tente de novo em instantes." });
  }
});
