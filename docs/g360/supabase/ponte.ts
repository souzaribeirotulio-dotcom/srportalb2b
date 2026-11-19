import { isIP } from "node:net";
import { createClient, type User } from "npm:@supabase/supabase-js@2.119.0";

const tokenOpaco = /^[A-Za-z0-9_-]{43}$/;
const mensagemLink =
  "Se o cadastro permitir, o link será enviado para o e-mail cadastrado.";
const opcoesAuth = {
  autoRefreshToken: false,
  persistSession: false,
  detectSessionInUrl: false,
};

export interface Configuracao {
  api: URL;
  loja: string;
  chaveSistema: string;
  origens: ReadonlySet<string>;
  paginaSenha: URL;
  supabase: URL;
  chaveAdmin: string;
  reconferenciaMinutos: number;
  chaveOcorrencias: string;
}

export interface Dependencias {
  fetch: typeof fetch;
  aguardar: (tarefa: Promise<void>) => void;
  enviarEmail: (email: { para: string; link: string }) => Promise<void>;
  avisarFalha: (etapa: string, status?: number) => void;
}

type Identidade = { g360_loja: string; g360_comprador: number };

function endereco(config: Configuracao, recurso: string): string {
  return `${
    config.api.href.replace(/\/$/, "")
  }/b2b/v1/lojas/${config.loja}/${recurso}`;
}

async function corpo(requisicao: Request): Promise<Record<string, unknown>> {
  const leitor = requisicao.body?.getReader();
  if (!leitor) return {};
  let bytes = 0;
  let texto = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 2048) {
        await leitor.cancel();
        return {};
      }
      texto += decoder.decode(value, { stream: true });
    }
    const json: unknown = JSON.parse(texto + decoder.decode());
    return json && typeof json === "object" && !Array.isArray(json)
      ? json as Record<string, unknown>
      : {};
  } catch {
    return {};
  } finally {
    leitor.releaseLock();
  }
}

async function registrarOcorrenciaLink(
  config: Configuracao,
  deps: Dependencias,
  documento: string,
  codigo: string,
  requestId: string,
): Promise<void> {
  const encoder = new TextEncoder();
  const chave = await crypto.subtle.importKey(
    "raw",
    encoder.encode(config.chaveOcorrencias),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const normalizado = documento.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const marcador = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      chave,
      encoder.encode(config.loja + "|" + normalizado),
    ),
  ).toHex();

  const admin = createClient(config.supabase.href, config.chaveAdmin, {
    auth: opcoesAuth,
    global: { fetch: deps.fetch },
  });
  const { error } = await admin.rpc("registrar_ocorrencia_link_g360", {
    p_loja: config.loja,
    p_codigo: codigo,
    p_request_id: requestId,
    p_marcador: marcador,
  }).abortSignal(AbortSignal.timeout(8000));
  if (error) deps.avisarFalha("ocorrencia");
}

async function pedirLink(
  config: Configuracao,
  deps: Dependencias,
  documento: string,
): Promise<void> {
  const resposta = await deps.fetch(endereco(config, "acessos/links"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Chave-Sistema": config.chaveSistema,
    },
    body: JSON.stringify({ documento }),
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (resposta.status !== 201) {
    const envelope = await resposta.json().catch(() => null);
    const codigo = envelope?.erro?.codigo;
    const requestId = envelope?.request_id;
    if (
      envelope?.erro?.responsavel === "fornecedor" &&
      typeof codigo === "string" && /^[A-Z][A-Z0-9_]{1,79}$/.test(codigo) &&
      typeof requestId === "string" && /^[a-f0-9]{16}$/.test(requestId)
    ) {
      await registrarOcorrenciaLink(config, deps, documento, codigo, requestId);
    }
    return;
  }
  const { dados } = await resposta.json();
  if (
    typeof dados?.token !== "string" || !tokenOpaco.test(dados.token) ||
    typeof dados?.email !== "string" || /[\r\n,;]/.test(dados.email) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)
  ) {
    throw new Error("Resposta de emissão inválida");
  }
  const link = new URL(config.paginaSenha);
  link.hash = new URLSearchParams({ token: dados.token }).toString();
  await deps.enviarEmail({ para: dados.email, link: link.href });
}

async function idDoComprador(identidade: Identidade): Promise<string> {
  const entrada = new TextEncoder().encode(
    `movimento-g360-integracao:v1:${identidade.g360_loja}:${identidade.g360_comprador}`,
  );
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", entrada))
    .slice(0, 16);
  // UUIDv8 de um namespace fixo e do par completo loja/comprador.
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20)}`;
}

function corresponde(
  user: User | null,
  id: string,
  email: string,
  identidade: Identidade,
) {
  return user?.id === id && user.email === email &&
    user.app_metadata?.g360_loja === identidade.g360_loja &&
    user.app_metadata?.g360_comprador === identidade.g360_comprador;
}

async function abrirSessaoSupabase(
  config: Configuracao,
  deps: Dependencias,
  identidade: Identidade,
  vinculoExpiraEm: string,
  ipComprador: string,
) {
  const opcoes = { auth: opcoesAuth, global: { fetch: deps.fetch } };
  const admin = createClient(config.supabase.href, config.chaveAdmin, opcoes);

  const id = await idDoComprador(identidade);
  const email = `g360-${id}@identidade.example.invalid`;

  const existente = await admin.auth.admin.getUserById(id);
  let usuario = existente.data.user;
  if (existente.error?.status === 404) {
    const criado = await admin.auth.admin.createUser({
      id,
      email,
      email_confirm: true,
      app_metadata: identidade,
    });
    // Outra solicitação pode criar a mesma conta entre a leitura e a criação.
    usuario = criado.error
      ? (await admin.auth.admin.getUserById(id)).data.user
      : criado.data.user;
  }
  if (!corresponde(usuario, id, email, identidade)) {
    throw new Error("Identidade provisionada não corresponde à API");
  }

  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (link.error || !corresponde(link.data.user, id, email, identidade)) {
    throw new Error("Não foi possível gerar o comprovante de sessão");
  }

  const verificador = createClient(config.supabase.href, config.chaveAdmin, {
    ...opcoes,
    global: {
      fetch: deps.fetch,
      headers: { "sb-forwarded-for": ipComprador },
    },
  });
  const verificacao = await verificador.auth.verifyOtp({
    type: "email",
    token_hash: link.data.properties.hashed_token,
  });
  const sessao = verificacao.data.session;
  if (!sessao || verificacao.error) {
    deps.avisarFalha("verificacao_auth", verificacao.error?.status);
    throw new Error("A sessão não foi emitida");
  }

  try {
    if (!corresponde(sessao.user, id, email, identidade)) {
      throw new Error(
        "A sessão emitida não corresponde à identidade conferida",
      );
    }
    const claims = await verificador.auth.getClaims(sessao.access_token);
    const sessaoId = claims.data?.claims.session_id;
    if (
      claims.error || typeof sessaoId !== "string" ||
      claims.data?.claims.sub !== id
    ) {
      throw new Error("Sessão sem identificação válida");
    }
    const vinculo = await admin.rpc("vincular_sessao_g360", {
      p_sessao: sessaoId,
      p_usuario: id,
      p_expira_em: vinculoExpiraEm,
    });
    if (vinculo.error) {
      throw new Error("Sessão sem vínculo com o acesso pela API");
    }
  } catch (erro) {
    await admin.auth.admin.signOut(sessao.access_token, "local");
    throw erro;
  }
  return {
    access_token: sessao.access_token,
    refresh_token: sessao.refresh_token,
  };
}

export function criarPonte(config: Configuracao, deps: Dependencias) {
  return async (requisicao: Request): Promise<Response> => {
    const origem = requisicao.headers.get("Origin");
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "Vary": "Origin",
    });
    const responder = (status: number, corpo: object) =>
      Response.json(corpo, { status, headers });

    if (!origem || !config.origens.has(origem)) {
      return responder(403, { mensagem: "Origem não permitida." });
    }
    headers.set("Access-Control-Allow-Origin", origem);
    if (requisicao.method === "OPTIONS") {
      headers.set("Access-Control-Allow-Headers", "Content-Type");
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      return new Response(null, { status: 204, headers });
    }
    if (requisicao.method !== "POST") {
      headers.set("Allow", "POST, OPTIONS");
      return responder(405, { mensagem: "Use POST." });
    }

    const entrada = await corpo(requisicao);
    if (entrada.acao === "pedir_link") {
      const documento = entrada.documento;
      if (
        typeof documento === "string" &&
        /^[A-Za-z0-9./-]{1,32}$/.test(documento)
      ) {
        // Não espere a consulta nem a entrega para devolver a mensagem neutra.
        deps.aguardar(
          pedirLink(config, deps, documento).catch(() =>
            deps.avisarFalha("entrega")
          ),
        );
      }
      return responder(202, { mensagem: mensagemLink });
    }

    if (entrada.acao !== "abrir_sessao") {
      return responder(400, { mensagem: "Ação inválida." });
    }

    const token = entrada.token;
    const invalida = () =>
      responder(401, { mensagem: "Sessão da API inválida." });
    if (typeof token !== "string" || !tokenOpaco.test(token)) return invalida();

    // O ingresso gerenciado preenche este cabeçalho. Ignore listas encaminhadas pelo chamador.
    const ipComprador = requisicao.headers.get("CF-Connecting-IP") ?? "";
    if (!isIP(ipComprador) || ipComprador.includes("%")) {
      deps.avisarFalha("ip_comprador");
      return responder(503, {
        mensagem: "Não foi possível abrir a sessão. Tente de novo.",
      });
    }

    try {
      const iniciouConferencia = Date.now();
      const resposta = await deps.fetch(endereco(config, "me"), {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      if (resposta.status === 401) return invalida();
      if (resposta.status !== 200) {
        deps.avisarFalha("conferencia", resposta.status);
        return responder(503, {
          mensagem: "Não foi possível conferir a sessão. Tente de novo.",
        });
      }
      const { dados } = await resposta.json();
      const codigo = dados?.comprador?.codigo;
      const expiraEm = dados?.expira_em;
      const inatividade = dados?.loja?.sessao_minutos;
      if (
        !Number.isSafeInteger(codigo) || codigo < 1 ||
        typeof expiraEm !== "string" || !(Date.parse(expiraEm) > Date.now()) ||
        !Number.isSafeInteger(inatividade) || inatividade < 1
      ) {
        throw new Error("Resposta de sessão inválida");
      }
      // Só uma nova conferência na API libera outro intervalo para dados privados.
      const vinculoExpiraEm = new Date(Math.min(
        Date.parse(expiraEm),
        iniciouConferencia +
          Math.min(inatividade, config.reconferenciaMinutos) * 60_000,
      )).toISOString();
      const sessao = await abrirSessaoSupabase(
        config,
        deps,
        { g360_loja: config.loja, g360_comprador: codigo },
        vinculoExpiraEm,
        ipComprador,
      );
      return responder(200, {
        sessao,
        api_expira_em: expiraEm,
        api_inatividade_minutos: inatividade,
        api_vinculo_expira_em: vinculoExpiraEm,
      });
    } catch {
      deps.avisarFalha("sessao");
      return responder(503, {
        mensagem: "Não foi possível abrir a sessão. Tente de novo.",
      });
    }
  };
}
