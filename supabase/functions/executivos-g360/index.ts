/* =====================================================================
   executivos-g360 — Programa "Executivo de Contas" (painel do administrador).

   Mesmo desenho das permissões próprias do painel (CLAUDE.md, seção 11):
   o navegador manda o token do operador (op_...). A função confere o token com
   GET operadores/me e usa o operador.codigo DESSA resposta (nunca um código
   vindo do navegador) para ler a permissão própria 'executivos'. Só quem tem a
   permissão lê ou grava. Tudo com a chave secreta, recortado pela loja.

   Conta do executivo: criada aqui no Supabase Auth com a senha digitada pelo
   administrador, e-mail já confirmado, SEM nenhum e-mail enviado. Ela não é
   cliente do G360 e não serve para comprar nem para o painel.

   Ações (POST, só Content-Type, origens de PORTAL_ORIGENS; token no corpo):
   - pode                 → { pode: true|false }
   - listar               → { executivos: [...], config }
   - salvar {executivo}   → cria ou altera (com senha opcional)
   - situacao {id, ativo} → ativa ou desativa (desativado não entra na área dele)
   - config_salvar {...}  → regras do programa
   - clientes {executivo_id}            → clientes vinculados (com início e fim)
   - vinculos_cadastros                 → "Indicado por" dos pedidos de Quero ser cliente
   - vinculo_definir {cadastro_id, executivo_id|null} → confirma, troca ou remove antes de aprovar
   - relatorio {mes: "AAAA-MM"}         → comissões do mês (por pedido), com o cliente
   - comissao_marcar {ids, acao, data, observacao} → faturada | cliente_pagou | paga | cancelar | reabrir
   - recalcular {desde: "AAAA-MM-DD"}   → refaz as comissões que faltarem a partir dos pedidos do portal
   Ações que qualquer operador do painel dispara ao aprovar ou reprovar um pedido
   (não mostram nada além do necessário):
   - vinculo_do_cadastro {cadastro_id}  → executivo indicado (nome, código, vendedor no G360)
   - vinculo_ativar {cadastro_id, cliente_codigo, novo} → ativo (ou sem comissão, se o cliente já existia)
   - vinculo_recusar {cadastro_id}      → pedido reprovado
   Nada do token, da senha ou do documento vai para log.
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

const tokenOperador = /^op_[A-Za-z0-9_-]{20,80}$/;
const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const CONFIG_PADRAO = { percentual: 3, liberar_em: "pagamento", so_novos: true, prazo_meses: 12 };
const COLUNAS = "id, codigo, nome, documento, whatsapp, email, percentual, vendedor_g360, vendedor_nome, ocultar_termos, ocultar_codigos, ativo, user_id, criado_em";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ABERTAS = ["aguardando", "ativo"];
/** Hoje no horário de Brasília (AAAA-MM-DD). */
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
function somarMeses(dia: string, meses: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}
/** Lista de texto do painel ("saco lixo, saco p lixo") → palavras sem acento, minúsculas, sem repetir. */
function listaTermos(v: unknown, max: number): string[] {
  const bruto = Array.isArray(v) ? v.map(String) : String(v ?? "").split(/[,;\n]/);
  return [...new Set(bruto.map((x) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).filter((x) => x.length >= 2))].slice(0, max);
}
function listaCodigos(v: unknown, max: number): string[] {
  const bruto = Array.isArray(v) ? v.map(String) : String(v ?? "").split(/[,;\s]+/);
  return [...new Set(bruto.map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z0-9._-]{1,40}$/.test(x)))].slice(0, max);
}

// Resposta do "me" guardada por até 1 minuto, pelo resumo do token (nunca o token aberto).
const conferidos = new Map<string, { ate: number; codigo: number; usuario: string; nome: string }>();
async function resumo(t: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))), (b) => b.toString(16).padStart(2, "0")).join("");
}
/** Operador do token (GET operadores/me). null = sessão encerrada; lança se a API não respondeu. */
async function operador(token: string) {
  const h = await resumo(token);
  const c = conferidos.get(h);
  if (c && c.ate > Date.now()) return c;
  const r = await fetch(`${API}/b2b/v1/lojas/${LOJA}/operadores/me`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (r.status === 401) { conferidos.delete(h); await r.body?.cancel(); return null; }
  if (!r.ok) { await r.body?.cancel(); throw new Error(`api ${r.status}`); }
  const o = (await r.json())?.dados?.operador;
  if (!Number.isSafeInteger(o?.codigo)) throw new Error("me sem operador");
  const v = { ate: Date.now() + 60_000, codigo: o.codigo as number, usuario: String(o.usuario ?? "").slice(0, 60), nome: String(o.nome ?? "").slice(0, 120) };
  conferidos.set(h, v);
  if (conferidos.size > 500) for (const [k, x] of conferidos) if (x.ate < Date.now()) conferidos.delete(k);
  return v;
}

async function lerConfig() {
  const { data, error } = await admin.from("comissao_config").select("percentual, liberar_em, so_novos, prazo_meses").eq("loja", LOJA).maybeSingle();
  if (error) throw error;
  return data ?? CONFIG_PADRAO;
}

/** Cria ou atualiza a conta de acesso do executivo (Supabase Auth). Não envia e-mail. */
async function conta(userId: string | null, email: string, senha: string, executivoId: string): Promise<string> {
  const app_metadata = { g360_executivo: executivoId, g360_loja: LOJA };
  if (userId) {
    const mud: Record<string, unknown> = { email, email_confirm: true, app_metadata };
    if (senha) mud.password = senha;
    const { error } = await admin.auth.admin.updateUserById(userId, mud);
    if (error) throw error;
    return userId;
  }
  const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, app_metadata });
  if (error) throw error;
  return data.user.id;
}

async function executar(acao: string, d: Record<string, unknown>): Promise<[number, unknown]> {
  if (acao === "listar") {
    const { data, error } = await admin.from("executivos").select(COLUNAS).eq("loja", LOJA).order("nome");
    if (error) throw error;
    const { data: vinc, error: e2 } = await admin.from("executivo_clientes").select("executivo_id, situacao").eq("loja", LOJA);
    if (e2) throw e2;
    const conta = new Map<string, { ativos: number; aguardando: number }>();
    for (const v of vinc ?? []) {
      const c = conta.get(v.executivo_id) ?? { ativos: 0, aguardando: 0 };
      if (v.situacao === "ativo") c.ativos++; else if (v.situacao === "aguardando") c.aguardando++;
      conta.set(v.executivo_id, c);
    }
    return [200, { dados: {
      executivos: (data ?? []).map(({ user_id, ...e }) => ({ ...e, tem_acesso: !!user_id, clientes: conta.get(e.id) ?? { ativos: 0, aguardando: 0 } })),
      config: await lerConfig(),
    } }];
  }

  if (acao === "salvar") {
    const e = (d.executivo ?? {}) as Record<string, unknown>;
    const id = texto(e.id, 40);
    const codigo = texto(e.codigo, 20).toUpperCase();
    const documento = texto(e.documento, 32).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const whatsapp = texto(e.whatsapp, 20).replace(/\D/g, "");
    const email = texto(e.email, 160).toLowerCase();
    const senha = typeof e.senha === "string" ? e.senha : "";
    const pctTxt = texto(String(e.percentual ?? ""), 8).replace(",", ".");
    const percentual = pctTxt === "" ? null : Number(pctTxt);
    const vend = e.vendedor_g360 === null || e.vendedor_g360 === "" || e.vendedor_g360 === undefined ? null : Number(e.vendedor_g360);
    const linha = {
      codigo, nome: texto(e.nome, 120), documento, whatsapp: whatsapp || null, email,
      percentual, vendedor_g360: vend, vendedor_nome: vend ? texto(e.vendedor_nome, 120) || null : null,
      ocultar_termos: listaTermos(e.ocultar_termos, 30), ocultar_codigos: listaCodigos(e.ocultar_codigos, 500),
      atualizado_em: new Date().toISOString(),
    };
    if (!/^[A-Z0-9]{3,20}$/.test(codigo)) return [400, { mensagem: "Código com 3 a 20 letras ou números, sem espaços (ex.: JOAO)." }];
    if (linha.nome.length < 2) return [400, { mensagem: "Digite o nome do executivo." }];
    if (!/^[A-Z0-9]{11,14}$/.test(documento)) return [400, { mensagem: "Digite o CPF ou CNPJ completo." }];
    if (whatsapp && !/^[0-9]{10,11}$/.test(whatsapp)) return [400, { mensagem: "WhatsApp com DDD (10 ou 11 números)." }];
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return [400, { mensagem: "Digite um e-mail válido. Ele é o login do executivo." }];
    if (percentual !== null && !(percentual >= 0 && percentual <= 50)) return [400, { mensagem: "Percentual entre 0 e 50%. Deixe em branco para usar o padrão." }];
    if (vend !== null && !(Number.isSafeInteger(vend) && vend > 0)) return [400, { mensagem: "Vendedor do G360 inválido." }];
    if (senha && (senha.length < 8 || senha.length > 72)) return [400, { mensagem: "A senha do executivo precisa ter de 8 a 72 caracteres." }];
    const { data: igual, error: e0 } = await admin.from("executivos").select("id").eq("loja", LOJA).eq("codigo", codigo).limit(1);
    if (e0) throw e0;
    if (igual?.length && igual[0].id !== id) return [409, { mensagem: `O código ${codigo} já é de outro executivo.` }];

    let atual: { id: string; user_id: string | null } | null = null;
    if (id) {
      if (!/^[0-9a-f-]{36}$/.test(id)) return [400, { mensagem: "Executivo inválido." }];
      const { data, error } = await admin.from("executivos").update(linha).eq("id", id).eq("loja", LOJA).select("id, user_id");
      if (error) throw error;
      if (!data?.length) return [404, { mensagem: "Executivo não encontrado." }];
      atual = data[0];
    } else {
      if (!senha) return [400, { mensagem: "Defina a senha de acesso do executivo (8 caracteres ou mais)." }];
      const { data, error } = await admin.from("executivos").insert({ ...linha, loja: LOJA }).select("id, user_id");
      if (error) throw error;
      atual = data[0];
    }
    // Conta de acesso: cria na primeira vez; depois atualiza o e-mail e, se veio, a senha.
    try {
      const uid = await conta(atual.user_id, email, senha, atual.id);
      if (uid !== atual.user_id) await admin.from("executivos").update({ user_id: uid }).eq("id", atual.id).eq("loja", LOJA);
    } catch (err) {
      const msg = String((err as Error)?.message ?? "");
      if (!id) await admin.from("executivos").delete().eq("id", atual.id).eq("loja", LOJA); // não deixa executivo sem acesso
      if (/already|registered|exists/i.test(msg)) return [409, { mensagem: "Esse e-mail já é usado por outra conta. Use outro e-mail para o executivo." }];
      if (/password/i.test(msg)) return [400, { mensagem: "Senha fraca demais. Use 8 caracteres ou mais, misturando letras e números." }];
      throw err;
    }
    const { data: fim, error: e3 } = await admin.from("executivos").select(COLUNAS).eq("id", atual.id).single();
    if (e3) throw e3;
    const { user_id, ...sem } = fim;
    return [200, { dados: { ...sem, tem_acesso: !!user_id } }];
  }

  if (acao === "situacao") {
    const id = texto(d.id, 40);
    if (!/^[0-9a-f-]{36}$/.test(id)) return [400, { mensagem: "Executivo inválido." }];
    const ativo = d.ativo === true;
    const { data, error } = await admin.from("executivos").update({ ativo, atualizado_em: new Date().toISOString() }).eq("id", id).eq("loja", LOJA).select("user_id");
    if (error) throw error;
    if (!data?.length) return [404, { mensagem: "Executivo não encontrado." }];
    // Desativado: encerra as sessões abertas da área do executivo (a regra de acesso já o barra).
    if (!ativo && data[0].user_id) await admin.auth.admin.signOut(data[0].user_id, "global").catch(() => {});
    return [200, { ok: true }];
  }

  if (acao === "config_salvar") {
    const pct = Number(String(d.percentual ?? "").replace(",", "."));
    const liberar = String(d.liberar_em);
    const prazo = d.prazo_meses === null || d.prazo_meses === "" ? null : Number(d.prazo_meses);
    if (!(pct >= 0 && pct <= 50)) return [400, { mensagem: "Percentual entre 0 e 50%." }];
    if (!["faturamento", "pagamento"].includes(liberar)) return [400, { mensagem: "Escolha quando a comissão é liberada." }];
    if (prazo !== null && !(Number.isSafeInteger(prazo) && prazo >= 1 && prazo <= 120)) return [400, { mensagem: "Prazo do vínculo entre 1 e 120 meses, ou sem prazo." }];
    const linha = { loja: LOJA, percentual: Math.round(pct * 100) / 100, liberar_em: liberar, so_novos: d.so_novos !== false, prazo_meses: prazo, atualizado_em: new Date().toISOString() };
    const { error } = await admin.from("comissao_config").upsert(linha, { onConflict: "loja" });
    if (error) throw error;
    return [200, { dados: await lerConfig() }];
  }

  if (acao === "clientes") {
    const id = texto(d.executivo_id, 40);
    if (!uuid.test(id)) return [400, { mensagem: "Executivo inválido." }];
    const { data, error } = await admin.from("executivo_clientes")
      .select("id, cadastro_id, cliente_codigo, documento, razao_social, situacao, inicio, fim, motivo, criado_em")
      .eq("loja", LOJA).eq("executivo_id", id).order("criado_em", { ascending: false }).limit(1000);
    if (error) throw error;
    return [200, { dados: data }];
  }

  if (acao === "vinculos_cadastros") {
    const { data: ex, error: e1 } = await admin.from("executivos").select("id, codigo, nome, ativo").eq("loja", LOJA).order("nome");
    if (e1) throw e1;
    const { data: v, error: e2 } = await admin.from("executivo_clientes").select("id, executivo_id, cadastro_id, situacao, motivo, inicio, fim")
      .eq("loja", LOJA).not("cadastro_id", "is", null).order("criado_em", { ascending: false }).limit(5000);
    if (e2) throw e2;
    return [200, { dados: { executivos: ex, vinculos: v } }];
  }

  if (acao === "vinculo_definir") {
    const cad = texto(d.cadastro_id, 40); const exe = d.executivo_id === null ? null : texto(d.executivo_id, 40);
    if (!uuid.test(cad) || (exe !== null && !uuid.test(exe))) return [400, { mensagem: "Dados inválidos." }];
    const { data: k, error: e0 } = await admin.from("portal_cadastros").select("id, documento, razao_social, status").eq("id", cad).eq("loja", LOJA).maybeSingle();
    if (e0) throw e0;
    if (!k) return [404, { mensagem: "Pedido não encontrado." }];
    const { data: abertos, error: e1 } = await admin.from("executivo_clientes").select("id, situacao").eq("loja", LOJA).eq("cadastro_id", cad).in("situacao", ABERTAS);
    if (e1) throw e1;
    const agora = new Date().toISOString();
    if (exe === null) {
      if (abertos?.length) {
        const { error } = await admin.from("executivo_clientes").update({ situacao: "removido", motivo: "Removido pela equipe", atualizado_em: agora }).in("id", abertos.map((x) => x.id));
        if (error) throw error;
      }
      return [200, { ok: true }];
    }
    const { data: e, error: e2 } = await admin.from("executivos").select("id, ativo").eq("id", exe).eq("loja", LOJA).maybeSingle();
    if (e2) throw e2;
    if (!e?.ativo) return [400, { mensagem: "Escolha um executivo ativo." }];
    if (abertos?.length) {
      const { error } = await admin.from("executivo_clientes").update({ executivo_id: exe, atualizado_em: agora }).eq("id", abertos[0].id);
      if (error) throw error;
    } else {
      const { error } = await admin.from("executivo_clientes").insert({
        loja: LOJA, executivo_id: exe, cadastro_id: cad, documento: k.documento, razao_social: String(k.razao_social ?? "").slice(0, 200),
        situacao: "aguardando",
      });
      if (error) {
        if (error.code === "23505") return [409, { mensagem: "Este cliente já está vinculado a um executivo em outro pedido." }];
        throw error;
      }
    }
    return [200, { ok: true }];
  }

  if (acao === "relatorio") {
    const mes = texto(d.mes, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return [400, { mensagem: "Escolha o mês." }];
    const { data: ex, error: e1 } = await admin.from("executivos").select("id, codigo, nome, ativo, percentual").eq("loja", LOJA).order("nome");
    if (e1) throw e1;
    const { data: c, error: e2 } = await admin.from("comissoes")
      .select("id, executivo_id, vinculo_id, cliente_codigo, pedido_ref, pedido_numero, pedido_data, base, percentual, valor, situacao, faturado_em, liberada_em, paga_em, observacao")
      .eq("loja", LOJA).eq("competencia", `${mes}-01`).order("pedido_data").limit(5000);
    if (e2) throw e2;
    const vids = [...new Set((c ?? []).map((x) => x.vinculo_id).filter(Boolean))];
    const nomes = new Map<string, string>();
    for (let i = 0; i < vids.length; i += 200) {
      const { data: v, error } = await admin.from("executivo_clientes").select("id, razao_social").in("id", vids.slice(i, i + 200));
      if (error) throw error;
      for (const x of v ?? []) nomes.set(x.id, x.razao_social);
    }
    return [200, { dados: { config: await lerConfig(), executivos: ex, comissoes: (c ?? []).map((x) => ({ ...x, cliente: nomes.get(x.vinculo_id) || `Cliente ${x.cliente_codigo}` })) } }];
  }

  if (acao === "comissao_marcar") {
    const ids = [...new Set((Array.isArray(d.ids) ? d.ids : []).map((x) => texto(x, 40)).filter((x) => uuid.test(x)))].slice(0, 1000);
    const tipo = texto(d.acao, 20);
    const dia = texto(d.data, 10) || hoje();
    const obs = texto(d.observacao, 300) || null;
    if (!ids.length) return [400, { mensagem: "Escolha ao menos um pedido." }];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return [400, { mensagem: "Data inválida." }];
    const cfg = await lerConfig();
    const regras: Record<string, { de: string[]; mud: Record<string, unknown> }> = {
      faturada: { de: ["prevista"], mud: cfg.liberar_em === "faturamento" ? { situacao: "liberada", faturado_em: dia, liberada_em: dia } : { situacao: "faturada", faturado_em: dia } },
      cliente_pagou: { de: ["prevista", "faturada"], mud: { situacao: "liberada", liberada_em: dia } },
      paga: { de: ["liberada"], mud: { situacao: "paga", paga_em: dia, ...(obs ? { observacao: obs } : {}) } },
      cancelar: { de: ["prevista", "faturada", "liberada"], mud: { situacao: "cancelada", ...(obs ? { observacao: obs } : {}) } },
      reabrir: { de: ["cancelada"], mud: { situacao: "prevista", faturado_em: null, liberada_em: null, paga_em: null } },
    };
    const r = regras[tipo];
    if (!r) return [400, { mensagem: "Ação inválida." }];
    const { data, error } = await admin.from("comissoes").update({ ...r.mud, atualizado_em: new Date().toISOString() })
      .eq("loja", LOJA).in("id", ids).in("situacao", r.de).select("id");
    if (error) throw error;
    // "Cliente pagou" num pedido que ainda não estava marcado como faturado: conta o mesmo dia.
    if (tipo === "cliente_pagou" && data?.length) await admin.from("comissoes").update({ faturado_em: dia }).eq("loja", LOJA).in("id", data.map((x) => x.id)).is("faturado_em", null);
    return [200, { dados: { alterados: data?.length ?? 0 } }];
  }

  if (acao === "recalcular") {
    const desde = texto(d.desde, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return [400, { mensagem: "Data inválida." }];
    const { data, error } = await admin.rpc("portal_comissoes_recalcular", { p_loja: LOJA, p_desde: desde });
    if (error) throw error;
    return [200, { dados: { novas: Number(data) || 0 } }];
  }

  return [400, { mensagem: "Ação desconhecida." }];
}

/** Ações disparadas pela aprovação/reprovação, liberadas para qualquer operador do painel. */
async function executarAprovacao(acao: string, d: Record<string, unknown>): Promise<[number, unknown]> {
  const cad = texto(d.cadastro_id, 40);
  if (!uuid.test(cad)) return [400, { mensagem: "Pedido inválido." }];
  const { data: v, error: e0 } = await admin.from("executivo_clientes").select("id, executivo_id, situacao")
    .eq("loja", LOJA).eq("cadastro_id", cad).in("situacao", ABERTAS).maybeSingle();
  if (e0) throw e0;

  if (acao === "vinculo_do_cadastro") {
    if (!v) return [200, { dados: null }];
    const { data: e, error } = await admin.from("executivos").select("nome, codigo, vendedor_g360, vendedor_nome").eq("id", v.executivo_id).maybeSingle();
    if (error) throw error;
    return [200, { dados: e ? { ...e, situacao: v.situacao } : null }];
  }

  if (acao === "vinculo_recusar") {
    if (v?.situacao === "aguardando") {
      const { error } = await admin.from("executivo_clientes").update({ situacao: "recusado", motivo: "Pedido reprovado", atualizado_em: new Date().toISOString() }).eq("id", v.id);
      if (error) throw error;
    }
    return [200, { ok: true }];
  }

  if (acao === "vinculo_ativar") {
    const cliente = Number(d.cliente_codigo);
    if (!Number.isSafeInteger(cliente) || cliente <= 0) return [400, { mensagem: "Cliente inválido." }];
    if (!v) return [200, { dados: null }];
    const cfg = await lerConfig();
    // Cliente que já existia no G360 (vinculado a um cadastro antigo) ou que já usava o portal não é novo.
    const { data: acesso } = await admin.from("portal_acessos").select("comprador_codigo").eq("loja", LOJA).eq("comprador_codigo", cliente).limit(1);
    const jaExistia = d.novo !== true || !!acesso?.length;
    const inicio = hoje();
    const linha = cfg.so_novos && jaExistia
      ? { situacao: "sem_comissao", motivo: "Cliente já existente — não gera comissão", cliente_codigo: cliente, inicio: null, fim: null }
      : { situacao: "ativo", motivo: null, cliente_codigo: cliente, inicio, fim: cfg.prazo_meses ? somarMeses(inicio, cfg.prazo_meses) : null };
    const { error } = await admin.from("executivo_clientes").update({ ...linha, atualizado_em: new Date().toISOString() }).eq("id", v.id);
    if (error) throw error;
    return [200, { dados: { situacao: linha.situacao, motivo: linha.motivo, fim: linha.fim } }];
  }
  return [400, { mensagem: "Ação desconhecida." }];
}

Deno.serve(async (req) => {
  const origem = req.headers.get("Origin") ?? "";
  if (!ORIGENS.has(origem)) return new Response(null, { status: 403 });
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
    if (t.length > 50_000) return json(413, { mensagem: "Pedido grande demais." });
    corpo = JSON.parse(t);
  } catch { return json(400, { mensagem: "Pedido inválido." }); }
  const token = typeof corpo.token === "string" ? corpo.token : "";
  const encerrada = () => json(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." });
  if (!tokenOperador.test(token)) return encerrada();
  let op;
  try { op = await operador(token); } catch (e) {
    console.warn("executivos-g360: conferência falhou:", String((e as Error)?.message ?? e).slice(0, 80));
    return json(503, { mensagem: "Não foi possível conferir o acesso agora. Tente de novo em instantes." });
  }
  if (!op) return encerrada();
  const acao = String(corpo.acao || "");
  try {
    await admin.from("painel_operadores").upsert({ loja: LOJA, codigo: op.codigo, usuario: op.usuario, nome: op.nome, visto_em: new Date().toISOString() }, { onConflict: "loja,codigo" });
    const { data: perms, error: ep } = await admin.rpc("painel_permissoes_efetivas", { p_loja: LOJA, p_codigo: op.codigo });
    if (ep) throw ep;
    const pode = Array.isArray(perms) && perms.includes("executivos");
    if (acao === "pode") return json(200, { dados: { pode } });
    if (["vinculo_do_cadastro", "vinculo_ativar", "vinculo_recusar"].includes(acao)) {
      const [s, b] = await executarAprovacao(acao, (corpo.dados ?? {}) as Record<string, unknown>);
      return json(s, b);
    }
    if (!pode) return json(403, { mensagem: "Só o administrador do programa de executivos pode ver esta área." });
    const [s, b] = await executar(acao, (corpo.dados ?? {}) as Record<string, unknown>);
    return json(s, b);
  } catch (e) {
    console.warn("executivos-g360: falha", acao, String((e as { code?: string })?.code ?? ""), String((e as Error)?.message ?? "").slice(0, 160));
    return json(500, { mensagem: "Não foi possível concluir agora. Tente de novo em instantes." });
  }
});
