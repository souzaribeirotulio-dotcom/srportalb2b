import { criarPonte } from "./ponte.ts";

// Disponível no runtime das Supabase Edge Functions.
declare const EdgeRuntime: { waitUntil(tarefa: Promise<void>): void };

function obrigatoria(nome: string): string {
  const valor = Deno.env.get(nome)?.trim();
  if (!valor || valor === "<preencha>") throw new Error(`Configure ${nome}`);
  return valor;
}

function url(nome: string): URL {
  const endereco = new URL(obrigatoria(nome));
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    endereco.hostname,
  );
  if (
    (endereco.protocol !== "https:" &&
      !(loopback && endereco.protocol === "http:")) ||
    endereco.username || endereco.password || endereco.search || endereco.hash
  ) {
    throw new Error(`Endereço inválido em ${nome}`);
  }
  return endereco;
}

function chaveSecreta(): string {
  const valor: unknown =
    JSON.parse(obrigatoria("SUPABASE_SECRET_KEYS")).default;
  if (typeof valor !== "string" || !/^sb_secret_[A-Za-z0-9_-]+$/.test(valor)) {
    throw new Error(
      "Configure uma chave secreta em SUPABASE_SECRET_KEYS.default",
    );
  }
  return valor;
}

const intervalo = Deno.env.get("G360_RECONFERENCIA_MINUTOS")?.trim() ?? "5";
const reconferenciaMinutos = Number(intervalo);
if (
  !/^[1-9][0-9]*$/.test(intervalo) ||
  !Number.isSafeInteger(reconferenciaMinutos)
) {
  throw new Error("G360_RECONFERENCIA_MINUTOS deve ser um inteiro positivo");
}

const loja = obrigatoria("G360_LOJA");
if (!/^[a-f0-9]{16}$/.test(loja)) throw new Error("Configure G360_LOJA");
const origens = new Set(
  obrigatoria("PORTAL_ORIGENS").split(",").map((origem) => origem.trim()),
);
for (const origem of origens) {
  const u = new URL(origem);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (
    u.origin !== origem ||
    (u.protocol !== "https:" && !(loopback && u.protocol === "http:"))
  ) {
    throw new Error("Configure as origens exatas em PORTAL_ORIGENS");
  }
}
const paginaSenha = url("PORTAL_PAGINA_SENHA");
if (!origens.has(paginaSenha.origin)) {
  throw new Error("Cadastre a origem da página de senha");
}

const chaveOcorrencias = obrigatoria("G360_OCORRENCIAS_HMAC");
if (new TextEncoder().encode(chaveOcorrencias).length < 32) {
  throw new Error("G360_OCORRENCIAS_HMAC deve ter pelo menos 32 bytes");
}

const provedor = url("EMAIL_ENDPOINT");
const chaveEmail = obrigatoria("EMAIL_CHAVE");

Deno.serve(criarPonte({
  api: url("G360_BASE_URL"),
  loja,
  chaveSistema: obrigatoria("G360_CHAVE_SISTEMA"),
  origens,
  paginaSenha,
  supabase: url("SUPABASE_URL"),
  chaveAdmin: chaveSecreta(),
  reconferenciaMinutos,
  chaveOcorrencias,
}, {
  fetch,
  aguardar: (tarefa) => EdgeRuntime.waitUntil(tarefa),
  async enviarEmail({ para, link }) {
    // Adapte somente este corpo e a autenticação ao provedor escolhido.
    const resposta = await fetch(provedor, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${chaveEmail}`,
      },
      body: JSON.stringify({
        para,
        assunto: "Defina sua senha de acesso",
        texto: `Abra este link para definir sua senha: ${link}`,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!resposta.ok) throw new Error("Provedor recusou a entrega");
  },
  avisarFalha(etapa, status) {
    console.warn("Ponte de acesso", etapa, status ?? "");
  },
}));
