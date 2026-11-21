/* =====================================================================
   Função painel-g360: dados do Supabase para o painel do administrador,
   com o MESMO login do G360 (sem conta separada no Supabase).

   O navegador manda o token do operador (o da API, op_...). A função confere
   o token chamando a própria API do G360 (POST operadores/produtos/busca,
   limite 1). Token aceito -> lê/grava com a chave secreta, sempre recortado
   pela loja. Token recusado (401) -> 401, nada é lido.

   Usa os segredos que a ponte-g360 já tem no projeto (G360_BASE_URL, G360_LOJA,
   PORTAL_ORIGENS, SUPABASE_URL, SUPABASE_SECRET_KEYS). Não usa a chave de sistema.
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
// Conferência recente do token (resumo SHA-256 -> validade), para não chamar a API a cada clique.
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
  // OPERADOR_SEM_ACESSO = sessão válida sem a permissão de produtos: o operador está autenticado.
  if (r.ok || (r.status === 403 && codigo === "OPERADOR_SEM_ACESSO")) {
    conferidos.set(h, Date.now() + CONFERENCIA_MS);
    if (conferidos.size > 500) for (const [k, v] of conferidos) if (v < Date.now()) conferidos.delete(k);
    return true;
  }
  if (r.status === 401) { conferidos.delete(h); return false; }
  throw new Error(`api ${r.status} ${codigo}`);
}

const SITUACOES = new Set(["pendente", "aprovado", "recusado"]);
const docLimpo = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** GET operadores/clientes/{codigo} com o token do operador: [status, ficha | null]. */
async function lerFichaG360(token: string, codigo: number): Promise<[number, Record<string, any> | null]> {
  const r = await fetch(`${api.href.replace(/\/$/, "")}/b2b/v1/lojas/${loja}/operadores/clientes/${codigo}`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) { await r.body?.cancel(); return [r.status, null]; }
  return [200, ((await r.json())?.dados ?? null) as Record<string, any> | null];
}

/** Campos da ficha do portal que vêm do G360 (a fonte do cadastro). responsavelAtual fica se o G360 não tiver contato. */
function dadosDoG360(f: Record<string, any>, responsavelAtual: string) {
  const dig = (v: unknown) => String(v ?? "").replace(/\D/g, "");
  const fone = (v: unknown) => {
    let x = dig(v);
    if ((x.length === 12 || x.length === 13) && x.startsWith("55")) x = x.slice(2);
    if ((x.length === 11 || x.length === 12) && x.startsWith("0")) x = x.slice(1);
    return /^[0-9]{10,11}$/.test(x) ? x : null;
  };
  const e = (f.endereco ?? {}) as Record<string, any>;
  const email = texto(f.email, 160).toLowerCase();
  const cep = dig(e.cep);
  const uf = texto(e.uf, 2).toUpperCase();
  const contato = texto(f.contato, 120);
  return {
    razao_social: texto(f.nome, 200),
    fantasia: texto(f.fantasia, 200) || null,
    inscricao_estadual: texto(f.ie_rg, 30).toUpperCase() || null,
    email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
    responsavel: contato.length >= 2 ? contato : (responsavelAtual.length >= 2 ? responsavelAtual : texto(f.nome, 120)),
    whats: fone(f.telefone1),
    telefone: fone(f.telefone2),
    cep: /^[0-9]{8}$/.test(cep) ? cep : null,
    logradouro: texto(e.logradouro, 200) || null,
    numero: texto(e.numero, 20) || null,
    complemento: texto(e.complemento, 120) || null,
    bairro: texto(e.bairro?.nome, 120) || null,
    cidade: texto(e.cidade?.nome, 120) || null,
    uf: /^[A-Z]{2}$/.test(uf) ? uf : null,
  };
}
const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function executar(acao: string, d: Record<string, unknown>, token = ""): Promise<[number, unknown]> {
  if (acao === "cadastros_listar") {
    const { data, error } = await admin.from("portal_cadastros").select("*").eq("loja", loja)
      .order("criado_em", { ascending: false }).limit(300);
    if (error) throw error;
    return [200, { dados: data }];
  }
  if (acao === "cadastro_decidir") {
    const id = texto(d.id, 40); const status = texto(d.status, 12);
    if (!/^[0-9a-f-]{36}$/.test(id) || !SITUACOES.has(status)) return [400, { mensagem: "Dados inválidos." }];
    const { data, error } = await admin.from("portal_cadastros").update({
      status,
      observacao_equipe: texto(d.observacao, 500) || null,
      decidido_por: "Equipe (usuário do G360)",
      atualizado_em: new Date().toISOString(),
    }).eq("id", id).eq("loja", loja).select("id");
    if (error) throw error;
    if (!data?.length) return [404, { mensagem: "Cadastro não encontrado." }];
    return [200, { ok: true }];
  }
  if (acao === "cadastro_vincular") {
    // Liga o pedido do portal ao cliente que a API devolveu (Novo cliente ou cadastro já existente)
    // e passa a ficha do portal para os dados do G360 (o G360 é a fonte do cadastro).
    // Só vincula se a ficha do G360, lida com o token do operador, tiver o mesmo documento.
    // Também serve para "Atualizar com o G360" numa ficha já vinculada.
    const id = texto(d.id, 40); const codigo = Number(d.codigo_g360);
    if (!/^[0-9a-f-]{36}$/.test(id) || !(Number.isSafeInteger(codigo) && codigo > 0)) return [400, { mensagem: "Dados inválidos." }];
    const { data: k, error: e0 } = await admin.from("portal_cadastros").select("id, documento, responsavel").eq("id", id).eq("loja", loja).maybeSingle();
    if (e0) throw e0;
    if (!k) return [404, { mensagem: "Cadastro não encontrado." }];
    const [st, f] = await lerFichaG360(token, codigo);
    if (st === 401) return [401, { mensagem: "Sua sessão terminou. Entre novamente." }];
    if (!f) return [409, { mensagem: "Não foi possível conferir a ficha no G360. Tente de novo." }];
    if (docLimpo(f.documento) !== String(k.documento)) return [409, { mensagem: "O cliente do G360 tem outro documento. O pedido não foi vinculado." }];
    const { data, error } = await admin.from("portal_cadastros").update({
      ...dadosDoG360(f, String(k.responsavel || "")), codigo_g360: codigo, status: "aprovado", decidido_por: "Equipe (usuário do G360)", atualizado_em: new Date().toISOString(),
    }).eq("id", id).eq("loja", loja).select("*");
    if (error) throw error;
    return [200, { dados: data?.[0] }];
  }
  if (acao === "cliente_salvar") {
    // Ficha do cliente no portal (Novo/Editar cliente). Não grava no G360; com código, copia os dados do G360.
    const c = (d.cliente ?? {}) as Record<string, unknown>;
    const id = texto(c.id, 40);
    const so = (v: unknown, max: number) => texto(v, max).replace(/\D/g, "");
    const documento = texto(c.documento, 32).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const status = texto(c.status, 12) || "aprovado";
    const codigo = c.codigo_g360 === null || c.codigo_g360 === "" || c.codigo_g360 === undefined ? null : Number(c.codigo_g360);
    const ficha: Record<string, any> = {
      documento,
      razao_social: texto(c.razao_social, 200),
      fantasia: texto(c.fantasia, 200) || null,
      inscricao_estadual: texto(c.inscricao_estadual, 30).toUpperCase() || null,
      responsavel: texto(c.responsavel, 120),
      whats: so(c.whats, 16) || null,
      telefone: so(c.telefone, 16) || null,
      email: texto(c.email, 160).toLowerCase(),
      cep: so(c.cep, 9) || null,
      logradouro: texto(c.logradouro, 200) || null,
      numero: texto(c.numero, 20) || null,
      complemento: texto(c.complemento, 120) || null,
      bairro: texto(c.bairro, 120) || null,
      cidade: texto(c.cidade, 120) || null,
      uf: texto(c.uf, 2).toUpperCase() || null,
      origem: texto(c.origem, 120) || null,
      vendedor: texto(c.vendedor, 80) || null,
      codigo_g360: codigo,
      status,
      atualizado_em: new Date().toISOString(),
    };
    if (!/^[A-Z0-9]{11,14}$/.test(documento)) return [400, { mensagem: "Digite o CNPJ ou CPF completo." }];
    if (!SITUACOES.has(status)) return [400, { mensagem: "Situação inválida." }];
    if (codigo !== null && !(Number.isSafeInteger(codigo) && codigo > 0)) return [400, { mensagem: "O código do G360 tem de ser um número." }];
    if (codigo !== null) {
      // Ficha ligada ao G360: nome, IE, contato, e-mail, telefones e endereço vêm do G360, não do formulário.
      if (!token) return [401, { mensagem: "Sua sessão terminou. Entre novamente." }];
      const [st, f] = await lerFichaG360(token, codigo);
      if (st === 401) return [401, { mensagem: "Sua sessão terminou. Entre novamente." }];
      if (!f) return [409, { mensagem: "Não foi possível ler a ficha do cliente no G360 (código ou acesso). Confira o código e tente de novo." }];
      if (docLimpo(f.documento) !== documento) return [409, { mensagem: "O cliente do G360 com este código tem outro documento. A ficha não foi salva." }];
      Object.assign(ficha, dadosDoG360(f, ficha.responsavel));
    } else {
    if (ficha.razao_social.length < 2) return [400, { mensagem: "Digite a razão social." }];
    if (ficha.responsavel.length < 2) return [400, { mensagem: "Digite o nome do responsável." }];
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ficha.email)) return [400, { mensagem: "Digite um e-mail válido." }];
    if (ficha.whats && !/^[0-9]{10,11}$/.test(ficha.whats)) return [400, { mensagem: "WhatsApp com DDD (10 ou 11 números)." }];
    if (ficha.telefone && !/^[0-9]{10,11}$/.test(ficha.telefone)) return [400, { mensagem: "Telefone com DDD (10 ou 11 números)." }];
    if (ficha.cep && !/^[0-9]{8}$/.test(ficha.cep)) return [400, { mensagem: "CEP com 8 números." }];
    if (ficha.uf && !/^[A-Z]{2}$/.test(ficha.uf)) return [400, { mensagem: "UF com 2 letras." }];
    }
    // Mesmo CNPJ em outra ficha: devolve a existente em vez de duplicar.
    const { data: igual, error: e0 } = await admin.from("portal_cadastros").select("id").eq("loja", loja).eq("documento", documento).limit(1);
    if (e0) throw e0;
    if (igual?.length && igual[0].id !== id) return [409, { mensagem: "Já existe uma ficha com este CNPJ. Abrimos a ficha existente.", id: igual[0].id }];
    if (id) {
      if (!/^[0-9a-f-]{36}$/.test(id)) return [400, { mensagem: "Dados inválidos." }];
      const { data, error } = await admin.from("portal_cadastros").update({ ...ficha, decidido_por: "Equipe (usuário do G360)" })
        .eq("id", id).eq("loja", loja).select("*");
      if (error) throw error;
      if (!data?.length) return [404, { mensagem: "Ficha não encontrada." }];
      return [200, { dados: data[0] }];
    }
    const { data, error } = await admin.from("portal_cadastros")
      .insert({ ...ficha, loja, criado_por: "equipe", decidido_por: "Equipe (usuário do G360)" }).select("*");
    if (error) throw error;
    return [200, { dados: data[0] }];
  }
  if (acao === "vendedores_listar") {
    const { data, error } = await admin.from("portal_vendedores").select("nome").eq("loja", loja).order("ordem");
    if (error) throw error;
    return [200, { dados: (data ?? []).map((v) => v.nome) }];
  }
  if (acao === "vendedores_salvar") {
    const nomes = [...new Set((Array.isArray(d.vendedores) ? d.vendedores : []).map((v) => texto(v, 80)).filter(Boolean))].slice(0, 100);
    const { error: e1 } = await admin.from("portal_vendedores").delete().eq("loja", loja);
    if (e1) throw e1;
    if (nomes.length) {
      const { error } = await admin.from("portal_vendedores").insert(nomes.map((nome, ordem) => ({ loja, nome, ordem })));
      if (error) throw error;
    }
    return [200, { dados: nomes }];
  }
  if (acao === "produto_extra_salvar") {
    // Descrição e "ocultar do catálogo" de um produto. Só grava os campos enviados.
    const codigo = texto(d.codigo, 40);
    if (!codigo) return [400, { mensagem: "Produto inválido." }];
    const mud: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
    if ("descricao" in d) { const t = texto(d.descricao, 1500); mud.descricao = t.length ? t : null; }
    if ("oculto" in d) mud.oculto = d.oculto === true;
    const { data: ex, error: e0 } = await admin.from("portal_produtos_exibicao").select("codigo").eq("loja", loja).eq("codigo", codigo).limit(1);
    if (e0) throw e0;
    if (ex?.length) {
      const { error } = await admin.from("portal_produtos_exibicao").update(mud).eq("loja", loja).eq("codigo", codigo);
      if (error) throw error;
    } else {
      const nome = texto(d.nome, 160);
      if (nome.length < 2) return [400, { mensagem: "Produto sem nome." }];
      const { error } = await admin.from("portal_produtos_exibicao").insert({
        loja, codigo, nome, origem: "automatico", categoria: texto(d.categoria, 40) || null, nome_g360: texto(d.nome_g360, 200) || null,
        produto_id: Number.isSafeInteger(d.produto_id) && (d.produto_id as number) > 0 ? d.produto_id : null, ...mud,
      });
      if (error) throw error;
    }
    return [200, { ok: true }];
  }
  if (acao === "config_ler") {
    const { data, error } = await admin.from("portal_config").select("so_estoque, margem_minima, estoque_minimo").eq("loja", loja).maybeSingle();
    if (error) throw error;
    return [200, { dados: data ?? { so_estoque: false, margem_minima: 15, estoque_minimo: 0 } }];
  }
  if (acao === "config_salvar") {
    const linha: Record<string, unknown> = { loja, atualizado_em: new Date().toISOString() };
    if ("so_estoque" in d) linha.so_estoque = d.so_estoque === true;
    if ("margem_minima" in d) {
      const m = Number(d.margem_minima);
      if (!(m >= 0 && m <= 100)) return [400, { mensagem: "Margem mínima entre 0 e 100%." }];
      linha.margem_minima = Math.round(m * 100) / 100;
    }
    if ("estoque_minimo" in d) {
      const e = Number(d.estoque_minimo);
      if (!(e >= 0 && e <= 100000)) return [400, { mensagem: "Estoque mínimo entre 0 e 100.000." }];
      linha.estoque_minimo = e;
    }
    const { data, error } = await admin.from("portal_config").upsert(linha, { onConflict: "loja" }).select("so_estoque, margem_minima, estoque_minimo");
    if (error) throw error;
    return [200, { dados: data?.[0] }];
  }
  if (acao === "clips_listar") {
    const { data, error } = await admin.from("portal_clips").select("id, produto_id, codigo, titulo, caminho, ativo, criado_em").eq("loja", loja).order("criado_em", { ascending: false }).limit(500);
    if (error) throw error;
    return [200, { dados: data }];
  }
  if (acao === "clip_upload_url") {
    // URL assinada para o navegador enviar o vídeo direto ao Storage (até 50 MB).
    const ext = ({ "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" } as Record<string, string>)[texto(d.tipo, 40)];
    const tam = Number(d.tamanho);
    if (!ext) return [400, { mensagem: "Envie o vídeo em MP4, WebM ou MOV." }];
    if (!(tam > 0 && tam <= 50 * 1024 * 1024)) return [400, { mensagem: "O vídeo pode ter até 50 MB." }];
    const caminho = `${loja}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await admin.storage.from("portal-clips").createSignedUploadUrl(caminho);
    if (error) throw error;
    return [200, { dados: { caminho, url: data.signedUrl, token: data.token } }];
  }
  if (acao === "clip_salvar") {
    const id = texto(d.id, 40);
    const linha: Record<string, unknown> = {};
    if ("titulo" in d) linha.titulo = texto(d.titulo, 120) || null;
    if ("ativo" in d) linha.ativo = d.ativo !== false;
    if (id) {
      if (!/^[0-9a-f-]{36}$/.test(id)) return [400, { mensagem: "Clip inválido." }];
      const { error } = await admin.from("portal_clips").update(linha).eq("id", id).eq("loja", loja);
      if (error) throw error;
      return [200, { ok: true }];
    }
    const caminho = texto(d.caminho, 120);
    const pid = Number(d.produto_id);
    if (!caminho.startsWith(`${loja}/`) || !Number.isSafeInteger(pid) || pid <= 0) return [400, { mensagem: "Dados do clip inválidos." }];
    const { data, error } = await admin.from("portal_clips").insert({ ...linha, loja, produto_id: pid, codigo: texto(d.codigo, 40), caminho }).select("id");
    if (error) throw error;
    return [200, { dados: data?.[0] }];
  }
  if (acao === "clip_apagar") {
    const id = texto(d.id, 40);
    if (!/^[0-9a-f-]{36}$/.test(id)) return [400, { mensagem: "Clip inválido." }];
    const { data, error } = await admin.from("portal_clips").delete().eq("id", id).eq("loja", loja).select("caminho");
    if (error) throw error;
    if (data?.[0]?.caminho) await admin.storage.from("portal-clips").remove([data[0].caminho]);
    return [200, { ok: true }];
  }
  if (acao === "banners_listar") {
    const { data, error } = await admin.from("portal_banners").select("id, titulo, img_desktop, img_celular, video_desktop, video_celular, destino_tipo, destino_valor, ordem, inicio, fim, ativo, criado_em").eq("loja", loja).order("ordem").order("criado_em").limit(100);
    if (error) throw error;
    return [200, { dados: data }];
  }
  if (acao === "banner_upload_url") {
    // URL assinada para o navegador enviar a imagem (já comprimida por ele) direto ao Storage.
    const ext = ({ "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png", "video/mp4": "mp4" } as Record<string, string>)[texto(d.tipo, 40)];
    const tam = Number(d.tamanho);
    if (!ext) return [400, { mensagem: "Envie a imagem em JPG, WebP ou PNG, ou o vídeo em MP4." }];
    if (ext === "mp4" ? !(tam > 0 && tam <= 8 * 1024 * 1024) : !(tam > 0 && tam <= 3 * 1024 * 1024)) return [400, { mensagem: ext === "mp4" ? "O vídeo do banner pode ter até 8 MB." : "A imagem pode ter até 3 MB." }];
    const caminho = `${loja}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await admin.storage.from("portal-banners").createSignedUploadUrl(caminho);
    if (error) throw error;
    return [200, { dados: { caminho, url: data.signedUrl, token: data.token } }];
  }
  if (acao === "banner_salvar") {
    const id = texto(d.id, 40);
    const img = (v: unknown) => { const c = texto(v, 80); return c && new RegExp(`^${loja}/[0-9a-f-]{36}\\.(jpg|webp|png)$`).test(c) ? c : null; };
    const data_ = (v: unknown) => { const c = texto(v, 10); return /^\d{4}-\d{2}-\d{2}$/.test(c) ? c : null; };
    const linha: Record<string, unknown> = {};
    if ("titulo" in d) { linha.titulo = texto(d.titulo, 120); if (!linha.titulo) return [400, { mensagem: "Dê um título ao banner (é o texto lido para quem não enxerga a imagem)." }]; }
    if ("img_desktop" in d) { linha.img_desktop = img(d.img_desktop); if (!linha.img_desktop) return [400, { mensagem: "Envie a imagem do computador." }]; }
    if ("img_celular" in d) linha.img_celular = img(d.img_celular);
    const video = (v: unknown) => { const c = texto(v, 80); return c && new RegExp(`^${loja}/[0-9a-f-]{36}\\.mp4$`).test(c) ? c : null; };
    if ("video_desktop" in d) linha.video_desktop = video(d.video_desktop);
    if ("video_celular" in d) linha.video_celular = video(d.video_celular);
    if ("destino_tipo" in d) {
      const t = texto(d.destino_tipo, 20);
      if (!["nenhum", "categoria", "busca", "produto", "lista", "cadastro"].includes(t)) return [400, { mensagem: "Destino inválido." }];
      linha.destino_tipo = t; linha.destino_valor = ["categoria", "busca", "produto"].includes(t) ? (texto(d.destino_valor, 120) || null) : null;
      if (["categoria", "busca", "produto"].includes(t) && !linha.destino_valor) return [400, { mensagem: "Informe para onde o banner leva." }];
    }
    if ("ordem" in d) { const o = Number(d.ordem); linha.ordem = Number.isSafeInteger(o) ? Math.max(-1000, Math.min(1000, o)) : 0; }
    if ("inicio" in d) linha.inicio = data_(d.inicio);
    if ("fim" in d) linha.fim = data_(d.fim);
    if (linha.inicio && linha.fim && String(linha.fim) < String(linha.inicio)) return [400, { mensagem: "O fim do período tem de ser depois do início." }];
    if ("ativo" in d) linha.ativo = d.ativo !== false;
    if (id) {
      if (!/^[0-9a-f-]{36}$/.test(id)) return [400, { mensagem: "Banner inválido." }];
      const antes = (await admin.from("portal_banners").select("img_desktop, img_celular, video_desktop, video_celular").eq("id", id).eq("loja", loja).maybeSingle()).data as Record<string, string | null> | null;
      const { error } = await admin.from("portal_banners").update(linha).eq("id", id).eq("loja", loja);
      if (error) throw error;
      // Imagem trocada: apaga a antiga do Storage.
      const velhas: string[] = [];
      for (const k of ["img_desktop", "img_celular", "video_desktop", "video_celular"]) {
        const v = antes?.[k];
        if (v && k in linha && v !== linha[k]) velhas.push(v);
      }
      if (velhas.length) await admin.storage.from("portal-banners").remove(velhas);
      return [200, { ok: true }];
    }
    if (!linha.titulo || !linha.img_desktop) return [400, { mensagem: "Título e imagem do computador são obrigatórios." }];
    const { data, error } = await admin.from("portal_banners").insert({ ...linha, loja }).select("id");
    if (error) throw error;
    return [200, { dados: data?.[0] }];
  }
  if (acao === "banner_apagar") {
    const id = texto(d.id, 40);
    if (!/^[0-9a-f-]{36}$/.test(id)) return [400, { mensagem: "Banner inválido." }];
    const { data, error } = await admin.from("portal_banners").delete().eq("id", id).eq("loja", loja).select("img_desktop, img_celular, video_desktop, video_celular");
    if (error) throw error;
    const arqs = [data?.[0]?.img_desktop, data?.[0]?.img_celular, data?.[0]?.video_desktop, data?.[0]?.video_celular].filter(Boolean) as string[];
    if (arqs.length) await admin.storage.from("portal-banners").remove(arqs);
    return [200, { ok: true }];
  }
  if (acao === "negociacoes_listar") {
    const { data, error } = await admin.from("portal_negociacoes").select("*").eq("loja", loja).order("criado_em", { ascending: false }).limit(300);
    if (error) throw error;
    return [200, { dados: data }];
  }
  if (acao === "negociacao_decidir") {
    // Chamada depois que o painel já gravou o preço congelado no G360 (aprovada) ou para recusar.
    const id = texto(d.id, 40); const status = texto(d.status, 12);
    if (!/^[0-9a-f-]{36}$/.test(id) || !["aprovada", "recusada"].includes(status)) return [400, { mensagem: "Dados inválidos." }];
    const linha: Record<string, unknown> = { status, resposta: texto(d.resposta, 400) || null, decidido_por: "Equipe (usuário do G360)", atualizado_em: new Date().toISOString() };
    if (status === "aprovada") {
      const preco = texto(d.preco_aprovado, 20); const ate = texto(d.valido_ate, 10);
      if (!/^[0-9]{1,11}(\.[0-9]{1,7})?$/.test(preco) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return [400, { mensagem: "Preço ou data inválidos." }];
      linha.preco_aprovado = preco; linha.valido_ate = ate;
    }
    const { data, error } = await admin.from("portal_negociacoes").update(linha).eq("id", id).eq("loja", loja).eq("status", "aberta").select("id");
    if (error) throw error;
    if (!data?.length) return [409, { mensagem: "Esta negociação já foi respondida ou cancelada pelo cliente." }];
    return [200, { ok: true }];
  }
  if (acao === "lotes_listar") {
    const { data, error } = await admin.from("portal_lotes_fotos").select("id, numero, responsavel, codigos, pulados, criado_em").eq("loja", loja).order("numero", { ascending: false }).limit(500);
    if (error) throw error;
    return [200, { dados: data }];
  }
  if (acao === "lote_salvar") {
    // Novo lote com o próximo número (tenta de novo se dois operadores gravarem juntos).
    const codigos = [...new Set((Array.isArray(d.codigos) ? d.codigos : []).map((c) => texto(c, 40)).filter(Boolean))].slice(0, 500);
    if (!codigos.length) return [400, { mensagem: "Lote sem produtos." }];
    const responsavel = texto(d.responsavel, 80) || null;
    for (let t = 0; t < 3; t++) {
      const { data: ult, error: e0 } = await admin.from("portal_lotes_fotos").select("numero").eq("loja", loja).order("numero", { ascending: false }).limit(1);
      if (e0) throw e0;
      const numero = (ult?.[0]?.numero ?? 0) + 1;
      const { data, error } = await admin.from("portal_lotes_fotos").insert({ loja, numero, responsavel, codigos }).select("id, numero, responsavel, codigos, pulados, criado_em");
      if (!error) return [200, { dados: data?.[0] }];
      if (error.code !== "23505") throw error;
    }
    return [409, { mensagem: "Outro lote foi gravado agora. Tente de novo." }];
  }
  if (acao === "lote_pular") {
    // Caça-capa: marca (ou desmarca) um produto do lote como "não achei foto".
    const id = texto(d.id, 40); const codigo = texto(d.codigo, 40);
    if (!/^[0-9a-f-]{36}$/.test(id) || !codigo) return [400, { mensagem: "Dados inválidos." }];
    const { data: l, error: e0 } = await admin.from("portal_lotes_fotos").select("codigos, pulados").eq("id", id).eq("loja", loja).maybeSingle();
    if (e0) throw e0;
    if (!l) return [404, { mensagem: "Lote não encontrado." }];
    if (!(l.codigos as string[]).includes(codigo)) return [400, { mensagem: "Produto fora deste lote." }];
    const atual = new Set((l.pulados ?? []) as string[]);
    if (d.pular === false) atual.delete(codigo); else atual.add(codigo);
    const { error } = await admin.from("portal_lotes_fotos").update({ pulados: [...atual] }).eq("id", id).eq("loja", loja);
    if (error) throw error;
    return [200, { dados: [...atual] }];
  }
  if (acao === "lote_apagar") {
    const id = texto(d.id, 40);
    if (!/^[0-9a-f-]{36}$/.test(id)) return [400, { mensagem: "Lote inválido." }];
    const { error } = await admin.from("portal_lotes_fotos").delete().eq("id", id).eq("loja", loja);
    if (error) throw error;
    return [200, { ok: true }];
  }
  if (acao === "visiveis_ler") {
    // Lista de códigos com e sem estoque, gravada pelo portal na última contagem de um comprador.
    const { data, error } = await admin.from("portal_visiveis").select("visiveis, estoque_baixo, sem_estoque, estoque_minimo, atualizado_em").eq("loja", loja).maybeSingle();
    if (error) throw error;
    return [200, { dados: data ?? null }];
  }
  if (acao === "visiveis_gravar") {
    // Lista montada pelo painel (botão "Atualizar produtos do portal"): só códigos, sem preço nem quantidade.
    const lista = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map((c) => texto(c, 40)).filter(Boolean))];
    const visiveis = lista(d.visiveis), baixo = lista(d.estoque_baixo), sem = lista(d.sem_estoque);
    if (visiveis.length + baixo.length + sem.length > 30000) return [400, { mensagem: "Lista grande demais." }];
    const minimo = Number(d.estoque_minimo);
    const { error } = await admin.from("portal_visiveis").upsert({
      loja, visiveis, estoque_baixo: baixo, sem_estoque: sem,
      estoque_minimo: minimo >= 0 && minimo <= 100000 ? minimo : 0, comprador_codigo: null, atualizado_em: new Date().toISOString(),
    }, { onConflict: "loja" });
    if (error) throw error;
    return [200, { ok: true }];
  }
  if (acao === "condicoes_ler") {
    // Condições de pagamento: as que o G360 já liberou (vistas no fechamento do pedido dos clientes) e as escondidas.
    // comprador = código do cliente (ficha) ou ausente (todos os clientes, em Configurações).
    const comprador = d.comprador === undefined || d.comprador === null ? 0 : Number(d.comprador);
    if (!Number.isSafeInteger(comprador) || comprador < 0) return [400, { mensagem: "Cliente inválido." }];
    let q = admin.from("portal_condicoes_vistas").select("comprador_codigo, condicao_id, descricao, visto_em").eq("loja", loja).limit(5000);
    if (comprador > 0) q = q.eq("comprador_codigo", comprador);
    const { data: vistas, error } = await q;
    if (error) throw error;
    const { data: ocultas, error: e2 } = await admin.from("portal_condicoes_ocultas").select("comprador_codigo, condicoes")
      .eq("loja", loja).in("comprador_codigo", comprador > 0 ? [0, comprador] : [0]);
    if (e2) throw e2;
    const por = new Map<number, { id: number; descricao: string; clientes: number; visto_em: string }>();
    for (const v of vistas ?? []) {
      const r = por.get(v.condicao_id) ?? { id: v.condicao_id, descricao: v.descricao, clientes: 0, visto_em: v.visto_em };
      r.clientes += 1; if (v.visto_em > r.visto_em) { r.visto_em = v.visto_em; r.descricao = v.descricao; }
      por.set(v.condicao_id, r);
    }
    const de = (c: number) => ((ocultas ?? []).find((o) => Number(o.comprador_codigo) === c)?.condicoes ?? []) as number[];
    return [200, { dados: { condicoes: [...por.values()].sort((a, b) => a.descricao.localeCompare(b.descricao, "pt")), ocultas_todos: de(0), ocultas_cliente: comprador > 0 ? de(comprador) : [] } }];
  }
  if (acao === "condicoes_salvar") {
    const comprador = d.comprador === undefined || d.comprador === null ? 0 : Number(d.comprador);
    if (!Number.isSafeInteger(comprador) || comprador < 0) return [400, { mensagem: "Cliente inválido." }];
    const condicoes = [...new Set((Array.isArray(d.condicoes) ? d.condicoes : []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, 200);
    const { error } = await admin.from("portal_condicoes_ocultas").upsert({ loja, comprador_codigo: comprador, condicoes, atualizado_em: new Date().toISOString() }, { onConflict: "loja,comprador_codigo" });
    if (error) throw error;
    return [200, { ok: true }];
  }
  if (acao === "ocorrencias_listar") {
    const { data, error } = await admin.from("ocorrencias_g360")
      .select("registrada_em, codigo, operacao, comprador_codigo, request_id").eq("loja", loja)
      .order("registrada_em", { ascending: false }).limit(200);
    if (error) throw error;
    return [200, { dados: data }];
  }
  if (acao === "exibicao_salvar") {
    // Nome e categoria do produto no portal (até 500 por chamada).
    const linhas = Array.isArray(d.linhas) ? d.linhas.slice(0, 500) : [];
    const ok = linhas.map((l) => l as Record<string, unknown>).map((l) => ({
      loja,
      codigo: texto(l.codigo, 40),
      produto_id: Number.isSafeInteger(l.produto_id) && (l.produto_id as number) > 0 ? l.produto_id : null,
      nome: texto(l.nome, 160),
      categoria: texto(l.categoria, 40) || null,
      origem: ["automatico", "equipe"].includes(String(l.origem)) ? String(l.origem) : "equipe",
      nome_g360: texto(l.nome_g360, 200) || null,
      atualizado_em: new Date().toISOString(),
    })).filter((l) => l.codigo && l.nome.length >= 2);
    if (!ok.length) return [400, { mensagem: "Nada para gravar." }];
    // "Gerar automático" não passa por cima do que a equipe (ou o portal antigo) já definiu.
    let linhasFinais = ok;
    if (d.preservar === true) {
      const { data: exist, error: e1 } = await admin.from("portal_produtos_exibicao").select("codigo, origem").eq("loja", loja).in("codigo", ok.map((l) => l.codigo));
      if (e1) throw e1;
      const travados = new Set((exist ?? []).filter((x) => x.origem !== "automatico").map((x) => x.codigo));
      linhasFinais = ok.filter((l) => !travados.has(l.codigo));
      // Mesmo travado, guarda o id do produto (ajuda a achar pelo id).
      for (const l of ok.filter((x) => travados.has(x.codigo) && x.produto_id)) {
        await admin.from("portal_produtos_exibicao").update({ produto_id: l.produto_id, nome_g360: l.nome_g360 }).eq("loja", loja).eq("codigo", l.codigo);
      }
    }
    if (linhasFinais.length) {
      const { error } = await admin.from("portal_produtos_exibicao").upsert(linhasFinais, { onConflict: "loja,codigo" });
      if (error) throw error;
    }
    return [200, { gravados: linhasFinais.length }];
  }
  if (acao === "categorias_salvar") {
    const lista = Array.isArray(d.categorias) ? d.categorias.map((c) => texto(c, 40)).filter(Boolean).slice(0, 60) : [];
    if (!lista.length || new Set(lista).size !== lista.length) return [400, { mensagem: "Informe categorias sem repetir nomes." }];
    const renomear = Array.isArray(d.renomear) ? d.renomear as Array<Record<string, unknown>> : [];
    for (const r of renomear) {
      const de = texto(r.de, 40); const para = texto(r.para, 40);
      if (de && para && de !== para) await admin.from("portal_produtos_exibicao").update({ categoria: para }).eq("loja", loja).eq("categoria", de);
    }
    const { error: e1 } = await admin.from("portal_categorias").delete().eq("loja", loja);
    if (e1) throw e1;
    const { error } = await admin.from("portal_categorias").insert(lista.map((nome, ordem) => ({ loja, nome, ordem })));
    if (error) throw error;
    // Produtos de categoria apagada vão para "sem categoria" (o portal usa a categoria pelo nome).
    await admin.from("portal_produtos_exibicao").update({ categoria: null }).eq("loja", loja).not("categoria", "in", `(${lista.map((c) => `"${c.replace(/"/g, '')}"`).join(",")})`);
    return [200, { ok: true }];
  }
  if (acao === "sinonimos_salvar") {
    // Lista completa: [{ termo, equivalentes: [] }] (substitui a anterior).
    const lista = (Array.isArray(d.sinonimos) ? d.sinonimos : []).slice(0, 2000).map((x) => x as Record<string, unknown>)
      .map((x) => ({ loja, termo: texto(x.termo, 60).toLowerCase(), equivalentes: (Array.isArray(x.equivalentes) ? x.equivalentes : []).map((e) => texto(e, 60).toLowerCase()).filter(Boolean).slice(0, 20), atualizado_em: new Date().toISOString() }))
      .filter((x) => x.termo && x.equivalentes.length);
    // A mesma palavra em duas linhas vira uma só (o banco recusa gravar a mesma chave duas vezes de uma vez).
    const unicos = new Map<string, typeof lista[number]>();
    for (const x of lista) {
      const ja = unicos.get(x.termo);
      unicos.set(x.termo, ja ? { ...ja, equivalentes: [...new Set([...ja.equivalentes, ...x.equivalentes])].slice(0, 20) } : x);
    }
    const final = [...unicos.values()];
    // Grava primeiro e só depois apaga o que saiu da lista: se a gravação falhar, a lista antiga continua valendo.
    if (final.length) { const { error } = await admin.from("portal_sinonimos").upsert(final, { onConflict: "loja,termo" }); if (error) throw error; }
    const manter = new Set(final.map((x) => x.termo));
    const { data: atuais, error: e0 } = await admin.from("portal_sinonimos").select("termo").eq("loja", loja);
    if (e0) throw e0;
    const sair = (atuais ?? []).map((x) => x.termo).filter((t) => !manter.has(t));
    for (let i = 0; i < sair.length; i += 200) { const { error } = await admin.from("portal_sinonimos").delete().eq("loja", loja).in("termo", sair.slice(i, i + 200)); if (error) throw error; }
    return [200, { gravados: final.length }];
  }
  if (acao === "clientes_listar") {
    // Quem já entrou no portal: contas abertas pela ponte (app_metadata) + nome e acessos gravados no login.
    const contas = new Map<number, { criado: string; ultimo: string | null }>();
    for (let pagina = 1; pagina <= 50; pagina++) {
      const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 1000 });
      if (error) throw error;
      for (const u of data.users) {
        const m = u.app_metadata ?? {};
        if (m.g360_loja !== loja || m.g360_comprador == null) continue;
        const cod = Number(m.g360_comprador);
        const atual = contas.get(cod);
        const ultimo = u.last_sign_in_at ?? null;
        if (!atual) contas.set(cod, { criado: u.created_at, ultimo });
        else { if (u.created_at < atual.criado) atual.criado = u.created_at; if (ultimo && (!atual.ultimo || ultimo > atual.ultimo)) atual.ultimo = ultimo; }
      }
      if (data.users.length < 1000) break;
    }
    const { data: acessos } = await admin.from("portal_acessos").select("comprador_codigo, nome, primeiro_em, ultimo_em, acessos").eq("loja", loja);
    const { data: peds } = await admin.from("portal_eventos").select("comprador_codigo, valor").eq("loja", loja).eq("tipo", "pedido").limit(20000);
    const porCod = new Map<number, Record<string, unknown>>();
    for (const [cod, c] of contas) porCod.set(cod, { codigo: cod, nome: null, primeiro_em: c.criado, ultimo_em: c.ultimo, acessos: null, pedidos: 0, valor: 0 });
    for (const a of acessos ?? []) {
      const cod = Number(a.comprador_codigo); const r = porCod.get(cod) ?? { codigo: cod, pedidos: 0, valor: 0 };
      porCod.set(cod, { ...r, nome: a.nome, primeiro_em: r.primeiro_em && r.primeiro_em < a.primeiro_em ? r.primeiro_em : a.primeiro_em, ultimo_em: r.ultimo_em && r.ultimo_em > a.ultimo_em ? r.ultimo_em : a.ultimo_em, acessos: a.acessos });
    }
    for (const p of peds ?? []) { const r = porCod.get(Number(p.comprador_codigo)); if (r) { r.pedidos = (r.pedidos as number) + 1; r.valor = Math.round(((r.valor as number) + Number(p.valor || 0)) * 100) / 100; } }
    return [200, { dados: [...porCod.values()].sort((a, b) => String(b.ultimo_em ?? "").localeCompare(String(a.ultimo_em ?? ""))) }];
  }
  if (acao === "inteligencia") {
    const dias = [7, 30, 90].includes(Number(d.dias)) ? Number(d.dias) : 30;
    const desde = new Date(Date.now() - dias * 86400000).toISOString();
    const { data: ev, error } = await admin.from("portal_eventos").select("tipo, comprador_codigo, termo, resultados, valor, itens, criado_em, pedido_numero")
      .eq("loja", loja).gte("criado_em", desde).order("criado_em", { ascending: false }).limit(20000);
    if (error) throw error;
    const { data: acessos } = await admin.from("portal_acessos").select("comprador_codigo, nome, ultimo_em").eq("loja", loja);
    const nomes = new Map((acessos ?? []).map((a) => [Number(a.comprador_codigo), a.nome]));
    const pedidos = (ev ?? []).filter((e) => e.tipo === "pedido");
    const buscas = (ev ?? []).filter((e) => e.tipo === "busca");
    const soma = pedidos.reduce((s, p) => s + Number(p.valor || 0), 0);
    const conta = <T,>(lista: T[], chave: (x: T) => string) => { const m = new Map<string, number>(); lista.forEach((x) => m.set(chave(x), (m.get(chave(x)) ?? 0) + 1)); return m; };
    const topBuscas = [...conta(buscas, (b) => b.termo ?? "")].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([termo, vezes]) => ({ termo, vezes }));
    const semResultado = [...conta(buscas.filter((b) => !b.resultados), (b) => b.termo ?? "")].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([termo, vezes]) => ({ termo, vezes }));
    const prod = new Map<string, { codigo: string; nome: string; pedidos: number; total: number }>();
    for (const p of pedidos) for (const i of (p.itens ?? []) as Array<Record<string, unknown>>) {
      const k = String(i.codigo ?? i.produto_id); const r = prod.get(k) ?? { codigo: k, nome: String(i.nome ?? ""), pedidos: 0, total: 0 };
      r.pedidos += 1; r.total = Math.round((r.total + Number(i.total || 0)) * 100) / 100; prod.set(k, r);
    }
    const cli = new Map<number, { codigo: number; nome: string | null; pedidos: number; total: number }>();
    for (const p of pedidos) { const c = Number(p.comprador_codigo); const r = cli.get(c) ?? { codigo: c, nome: nomes.get(c) ?? null, pedidos: 0, total: 0 }; r.pedidos += 1; r.total = Math.round((r.total + Number(p.valor || 0)) * 100) / 100; cli.set(c, r); }
    const ativos = (acessos ?? []).filter((a) => a.ultimo_em >= desde).length;
    const porDia = new Map<string, { pedidos: number; valor: number }>();
    for (const p of pedidos) { const dia = String(p.criado_em).slice(0, 10); const r = porDia.get(dia) ?? { pedidos: 0, valor: 0 }; r.pedidos += 1; r.valor = Math.round((r.valor + Number(p.valor || 0)) * 100) / 100; porDia.set(dia, r); }
    return [200, { dados: {
      dias, pedidos: pedidos.length, valor: Math.round(soma * 100) / 100, ticket: pedidos.length ? Math.round((soma / pedidos.length) * 100) / 100 : 0,
      clientes_compraram: cli.size, clientes_entraram: ativos, buscas: buscas.length, buscas_sem_resultado: buscas.filter((b) => !b.resultados).length,
      top_buscas: topBuscas, sem_resultado: semResultado,
      top_produtos: [...prod.values()].sort((a, b) => b.total - a.total).slice(0, 15),
      top_clientes: [...cli.values()].sort((a, b) => b.total - a.total).slice(0, 15),
      por_dia: [...porDia.entries()].sort().map(([dia, v]) => ({ dia, ...v })),
      ultimos_pedidos: pedidos.slice(0, 10).map((p) => ({ quando: p.criado_em, cliente: nomes.get(Number(p.comprador_codigo)) ?? p.comprador_codigo, numero: p.pedido_numero, valor: p.valor })),
    } }];
  }
  if (acao === "lista_ler" || acao === "lista_incluir" || acao === "lista_remover") {
    // Minha Lista montada pela equipe para um cliente (código do G360). Mesma tabela que o cliente vê.
    const comprador = Number(d.comprador);
    if (!Number.isSafeInteger(comprador) || comprador <= 0) return [400, { mensagem: "Cliente inválido." }];
    if (acao === "lista_incluir") {
      const ids = (Array.isArray(d.produto_ids) ? d.produto_ids : []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, 500);
      if (!ids.length) return [400, { mensagem: "Escolha um produto." }];
      const { error } = await admin.from("minha_lista").upsert(ids.map((produto_id) => ({ loja, comprador_codigo: comprador, produto_id })), { onConflict: "loja,comprador_codigo,produto_id", ignoreDuplicates: true });
      if (error) throw error;
    }
    if (acao === "lista_remover") {
      const id = Number(d.produto_id);
      if (!Number.isSafeInteger(id)) return [400, { mensagem: "Produto inválido." }];
      const { error } = await admin.from("minha_lista").delete().eq("loja", loja).eq("comprador_codigo", comprador).eq("produto_id", id);
      if (error) throw error;
    }
    const { data, error } = await admin.from("minha_lista").select("produto_id").eq("loja", loja).eq("comprador_codigo", comprador).limit(2000);
    if (error) throw error;
    return [200, { dados: (data ?? []).map((r) => Number(r.produto_id)) }];
  }
  if (acao === "ensinos_listar") {
    const { data, error } = await admin.from("portal_souzinha_ensinos").select("id, categoria, titulo, conteudo, ativo, atualizado_em").eq("loja", loja).order("criado_em");
    if (error) throw error;
    return [200, { dados: data }];
  }
  if (acao === "ensinos_salvar") {
    const cat = ["segmento", "produto", "atendimento", "geral"].includes(String(d.categoria)) ? String(d.categoria) : "geral";
    const linha = { loja, categoria: cat, titulo: texto(d.titulo, 100), conteudo: texto(d.conteudo, 3000), ativo: d.ativo !== false, atualizado_em: new Date().toISOString() };
    if (linha.titulo.length < 3 || linha.conteudo.length < 10) return [400, { mensagem: "Preencha assunto e orientação (mínimo 10 caracteres)." }];
    const id = texto(d.id, 40);
    const q = /^[0-9a-f-]{36}$/.test(id) ? admin.from("portal_souzinha_ensinos").update(linha).eq("id", id).eq("loja", loja) : admin.from("portal_souzinha_ensinos").insert(linha);
    const { error } = await q;
    if (error) throw error;
    return [200, { ok: true }];
  }
  if (acao === "ensinos_apagar") {
    const id = texto(d.id, 40);
    if (!/^[0-9a-f-]{36}$/.test(id)) return [400, { mensagem: "Ensinamento inválido." }];
    const { error } = await admin.from("portal_souzinha_ensinos").delete().eq("id", id).eq("loja", loja);
    if (error) throw error;
    return [200, { ok: true }];
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
    if (t.length > 300_000) return json(413, { mensagem: "Pedido grande demais." });
    corpo = JSON.parse(t);
  } catch { return json(400, { mensagem: "Pedido inválido." }); }
  const token = typeof corpo.token === "string" ? corpo.token : "";
  if (!tokenOperador.test(token)) return json(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." });
  try {
    if (!(await conferir(token))) return json(401, { mensagem: "Sua sessão do painel terminou. Entre novamente." });
  } catch (e) {
    console.warn("painel-g360: conferência falhou:", String((e as Error)?.message ?? e).slice(0, 120));
    return json(503, { mensagem: "Não foi possível conferir o acesso agora. Tente de novo em instantes." });
  }
  try {
    const [s, b] = await executar(String(corpo.acao || ""), (corpo.dados ?? {}) as Record<string, unknown>, token);
    return json(s, b);
  } catch (e) {
    console.warn("painel-g360: falha no banco", String(corpo.acao || ""), String((e as { code?: string })?.code ?? ""), String((e as Error)?.message ?? "").slice(0, 160));
    return json(500, { mensagem: "Não foi possível concluir agora. Tente de novo em instantes." });
  }
});
