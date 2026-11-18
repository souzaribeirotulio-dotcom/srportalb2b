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
    // Adaptado ao Resend (https://resend.com/docs/api-reference/emails/send-email).
    // Rastreamento de cliques desligado no domínio: o link não passa pelo provedor.
    const seguro = link.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
    );
    const resposta = await fetch(provedor, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${chaveEmail}`,
      },
      body: JSON.stringify({
        from: "Souza Ribeiro <nao-responda@souzaribeiro.net>",
        to: [para],
        subject: "Defina sua senha de acesso ao Portal B2B",
        text:
          `Olá!\n\nRecebemos um pedido para definir a senha de acesso ao Portal B2B da Souza Ribeiro.\n\n` +
          `Abra este link para definir sua senha: ${link}\n\n` +
          `O link vale 30 minutos e só pode ser usado uma vez. Um pedido novo invalida este link.\n` +
          `Se você não pediu, ignore este e-mail.`,
        html:
          `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#17242e">` +
          `<div style="background:#061505;padding:20px 22px;border-radius:14px 14px 0 0">` +
          `<span style="color:#b2e04a;font-weight:800;font-size:20px">Souza Ribeiro</span>` +
          `<span style="color:#a9c19a;font-size:13px;margin-left:8px">Portal B2B</span></div>` +
          `<div style="border:1px solid #e2e6e1;border-top:none;padding:24px;border-radius:0 0 14px 14px">` +
          `<p>Olá!</p><p>Recebemos um pedido para definir a senha de acesso ao Portal B2B da Souza Ribeiro.</p>` +
          `<p style="text-align:center;margin:26px 0"><a href="${seguro}" style="background:#b2e04a;color:#132c09;` +
          `text-decoration:none;font-weight:700;padding:13px 22px;border-radius:10px;display:inline-block">Definir minha senha</a></p>` +
          `<p style="font-size:13px;color:#4b5a52">O link vale 30 minutos e só pode ser usado uma vez. ` +
          `Um pedido novo invalida este link. Se você não pediu, ignore este e-mail.</p></div></div>`,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!resposta.ok) {
      // Só o status e o tipo de erro do provedor: sem e-mail, link, token ou chave.
      const erro = await resposta.json().catch(() => null);
      const tipo = typeof erro?.name === "string" && /^[a-z_]{1,60}$/.test(erro.name) ? erro.name : "";
      console.warn("Ponte de acesso", "provedor_email", resposta.status, tipo);
      throw new Error("Provedor recusou a entrega");
    }
  },
  avisarFalha(etapa, status) {
    console.warn("Ponte de acesso", etapa, status ?? "");
  },
}));
