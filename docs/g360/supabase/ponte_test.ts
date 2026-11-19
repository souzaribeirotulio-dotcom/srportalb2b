import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { type Configuracao, criarPonte } from "./ponte.ts";

const origem = "https://portal.example.invalid";
const api = "https://homologacao.example.invalid";
const supabase = "https://supabase.example.invalid";
const loja = "0123456789abcdef";
const chaveSistema = "chave-ficticia-do-teste";
const tokenLink = "l".repeat(43);
const tokenApi = "t".repeat(43);
const emailApi = "comprador@example.invalid";
const ipComprador = "2001:db8::10";
const chaveAdmin = "sb_secret_" + "teste-ficticio";
const sessaoId = "00000000-0000-4000-8000-000000000003";
const config: Configuracao = {
  api: new URL(api),
  loja,
  chaveSistema,
  origens: new Set([origem]),
  paginaSenha: new URL(origem + "/definir-senha"),
  supabase: new URL(supabase),
  chaveAdmin,
  reconferenciaMinutos: 3,
  chaveOcorrencias: "amostra-ficticia-para-teste".repeat(2),
};

function simular(fetch: typeof globalThis.fetch, configuracao = config) {
  const tarefas: Promise<void>[] = [];
  const emails: { para: string; link: string }[] = [];
  const falhas: string[] = [];
  return {
    tarefas,
    emails,
    falhas,
    responder: criarPonte(configuracao, {
      fetch,
      aguardar: (tarefa) => tarefas.push(tarefa),
      enviarEmail(email) {
        emails.push(email);
        return Promise.resolve();
      },
      avisarFalha(etapa) {
        falhas.push(etapa);
      },
    }),
  };
}

function requisicao(entrada: object, origin = origem): Request {
  return new Request(supabase + "/functions/v1/ponte-g360", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "CF-Connecting-IP": ipComprador,
      "X-Forwarded-For": "192.0.2.77, 192.0.2.40",
      "Sb-Forwarded-For": "192.0.2.77",
    },
    body: JSON.stringify(entrada),
  });
}

function linkEmitido() {
  return Response.json({
    dados: { email: emailApi, token: tokenLink, nome: "Comprador Exemplo" },
  }, { status: 201 });
}

Deno.test("201, 404 e 422 devolvem a mesma resposta antes do e-mail", async () => {
  const respostas = [];
  for (const status of [201, 404, 422]) {
    let finalizar!: (resposta: Response) => void;
    const ambiente = simular(() =>
      new Promise((resolve) => finalizar = resolve)
    );
    const promessa = ambiente.responder(requisicao({
      acao: "pedir_link",
      documento: "12.ABC.345/01DE-35",
      email: "ignorado@example.invalid",
    }));
    // Resolve a consulta só depois da resposta pública. O timeout acusa se ela esperar.
    let timer: number | undefined;
    const resposta = await Promise.race([
      promessa,
      new Promise<never>((_, rejeitar) => {
        timer = setTimeout(() => {
          finalizar(new Response(null, { status: 503 }));
          rejeitar(new Error("Resposta pública esperou a API"));
        }, 1000);
      }),
    ]).finally(() => clearTimeout(timer));
    respostas.push([resposta.status, await resposta.text()]);
    finalizar(status === 201 ? linkEmitido() : new Response(null, { status }));
    await Promise.all(ambiente.tarefas);
    deepStrictEqual(ambiente.falhas, []);
    if (status === 201) {
      deepStrictEqual(ambiente.emails, [
        { para: emailApi, link: origem + "/definir-senha#token=" + tokenLink },
      ]);
    } else {
      deepStrictEqual(ambiente.emails, []);
    }
  }
  equal(respostas[0][0], 202);
  deepStrictEqual(respostas[1], respostas[0]);
  deepStrictEqual(respostas[2], respostas[0]);
});

Deno.test("o navegador recebe só a mensagem neutra, sem chave ou dados da API", async () => {
  const ambiente = simular(() => Promise.resolve(linkEmitido()));
  const resposta = await ambiente.responder(
    requisicao({ acao: "pedir_link", documento: "12.ABC.345/01DE-35" }),
  );
  await Promise.all(ambiente.tarefas);
  const texto = await resposta.text();
  for (
    const segredo of [chaveSistema, emailApi, tokenLink, "Comprador Exemplo"]
  ) {
    ok(!texto.includes(segredo), "Dado indevido na resposta");
  }
  deepStrictEqual(Object.keys(JSON.parse(texto)), ["mensagem"]);
  equal(resposta.headers.get("Cache-Control"), "no-store");
});

Deno.test("origens exatas na ponte e emissão de link sem Origin", async () => {
  const chamadas: Request[] = [];
  const ambiente = simular((input, init) => {
    chamadas.push(new Request(input, init));
    return Promise.resolve(linkEmitido());
  });
  const recusada = await ambiente.responder(
    requisicao(
      { acao: "pedir_link", documento: "12.ABC.345/01DE-35" },
      "https://preview.example.invalid",
    ),
  );
  equal(recusada.status, 403);
  equal(recusada.headers.has("Access-Control-Allow-Origin"), false);
  equal(chamadas.length, 0);
  const resposta = await ambiente.responder(
    requisicao({ acao: "pedir_link", documento: "12.ABC.345/01DE-35" }),
  );
  await Promise.all(ambiente.tarefas);
  equal(resposta.headers.get("Access-Control-Allow-Origin"), origem);
  equal(chamadas.length, 1);
  const [chamada] = chamadas;
  equal(chamada.url, api + "/b2b/v1/lojas/" + loja + "/acessos/links");
  equal(chamada.method, "POST");
  equal(chamada.headers.has("Origin"), false);
  equal(chamada.headers.get("X-Chave-Sistema"), chaveSistema);
  deepStrictEqual(await chamada.json(), { documento: "12.ABC.345/01DE-35" });
});

Deno.test("GET me com 401 impede qualquer chamada ao Auth", async () => {
  const chamadas: Request[] = [];
  const ambiente = simular((input, init) => {
    chamadas.push(new Request(input, init));
    return Promise.resolve(new Response(null, { status: 401 }));
  });
  const resposta = await ambiente.responder(
    requisicao({ acao: "abrir_sessao", token: tokenApi }),
  );
  equal(chamadas.length, 1);
  equal(resposta.status, 401);
  equal(chamadas[0].url, api + "/b2b/v1/lojas/" + loja + "/me");
  equal(chamadas[0].method, "GET");
  equal(chamadas[0].headers.get("Authorization"), "Bearer " + tokenApi);
  equal(chamadas[0].headers.has("X-Chave-Sistema"), false);
});

function jwtDeTeste(id: string): string {
  const codificar = (objeto: object) =>
    btoa(JSON.stringify(objeto)).replace(/=+$/, "").replace(/\+/g, "-").replace(
      /\//g,
      "_",
    );
  return [
    codificar({ alg: "HS256", typ: "JWT" }),
    codificar({
      sub: id,
      session_id: sessaoId,
      exp: Math.floor(Date.now() / 1000) + 900,
    }),
    "assinatura-ficticia",
  ].join(".");
}

function simularSessao(
  expiraEm: string,
  inatividade = 8,
  configuracao = config,
) {
  const chamadas: Request[] = [];
  const gravacoes: Record<string, unknown>[] = [];
  let usuario: Record<string, unknown> = {};
  const ambiente = simular(async (input, init) => {
    const req = new Request(input, init);
    const caminho = new URL(req.url).pathname;
    chamadas.push(req.clone());
    if (caminho.endsWith("/me")) {
      return Response.json({
        dados: {
          comprador: { codigo: 701 },
          loja: { sessao_minutos: inatividade },
          expira_em: expiraEm,
        },
      });
    }
    const corpo = req.body ? await req.json() : {};
    if (caminho.startsWith("/auth/v1/admin/users/")) {
      return Response.json(
        { message: "Conta ausente", code: "user_not_found" },
        { status: 404 },
      );
    }
    if (caminho === "/auth/v1/admin/users") {
      gravacoes.push(corpo);
      usuario = {
        id: corpo.id,
        email: corpo.email,
        app_metadata: corpo.app_metadata,
        user_metadata: corpo.user_metadata ?? {},
      };
      return Response.json(usuario);
    }
    if (caminho === "/auth/v1/admin/generate_link") {
      return Response.json({ ...usuario, hashed_token: "hash-ficticio" });
    }
    if (caminho === "/auth/v1/verify") {
      gravacoes.push(corpo);
      return Response.json({
        user: usuario,
        access_token: jwtDeTeste(String(usuario.id)),
        refresh_token: "<renovacao-ficticia>",
        token_type: "bearer",
        expires_in: 900,
      });
    }
    if (caminho === "/auth/v1/user") return Response.json(usuario);
    if (caminho === "/rest/v1/rpc/vincular_sessao_g360") {
      gravacoes.push(corpo);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 500 });
  }, configuracao);
  return { ...ambiente, chamadas, gravacoes };
}

Deno.test("a identidade verificada vai para app_metadata e o vínculo expira com a API", async () => {
  const expiraEm = new Date(Date.now() + 600_000).toISOString();
  const ambiente = simularSessao(expiraEm);
  const resposta = await ambiente.responder(requisicao({
    acao: "abrir_sessao",
    token: tokenApi,
    loja: "1111111111111111",
    comprador: { codigo: 900 },
  }));
  const { chamadas, gravacoes } = ambiente;
  deepStrictEqual(gravacoes[0]?.app_metadata, {
    g360_loja: loja,
    g360_comprador: 701,
  });
  equal(gravacoes[0]?.user_metadata, undefined);
  ok(String(gravacoes[0]?.email).endsWith("@identidade.example.invalid"));
  equal(gravacoes[1]?.type, "email");
  equal(gravacoes[1]?.token_hash, "hash-ficticio");
  equal(resposta.status, 200);
  ok(chamadas[0].url.endsWith("/me"));
  const dados = await resposta.json();
  equal(dados.api_expira_em, expiraEm);
  equal(dados.api_inatividade_minutos, 8);
  deepStrictEqual(gravacoes[2], {
    p_sessao: sessaoId,
    p_usuario: gravacoes[0].id,
    p_expira_em: dados.api_vinculo_expira_em,
  });
  deepStrictEqual(Object.keys(dados.sessao).sort(), [
    "access_token",
    "refresh_token",
  ]);
  ok(!JSON.stringify(dados).includes(tokenApi));
  deepStrictEqual(ambiente.falhas, []);
});

Deno.test("verify usa chave secreta e somente o IP do ingresso gerenciado", async () => {
  const ambiente = simularSessao(new Date(Date.now() + 600_000).toISOString());
  const resposta = await ambiente.responder(
    requisicao({ acao: "abrir_sessao", token: tokenApi }),
  );
  equal(resposta.status, 200);
  const verify = ambiente.chamadas.find((req) =>
    new URL(req.url).pathname === "/auth/v1/verify"
  );
  ok(verify);
  equal(verify.headers.get("sb-forwarded-for"), ipComprador);
  equal(verify.headers.get("apikey"), chaveAdmin);
  const api = ambiente.chamadas[0];
  equal(api.headers.get("sb-forwarded-for"), null);
  equal(api.headers.get("apikey"), null);
});

Deno.test("IP ausente ou inválido impede a conferência e a emissão de sessão", async () => {
  for (
    const ip of [
      null,
      "2001:db8::10, 192.0.2.50",
      "192.0.2.999",
      "fe80::1%eth0",
    ]
  ) {
    const ambiente = simularSessao(
      new Date(Date.now() + 600_000).toISOString(),
    );
    const pedido = requisicao({ acao: "abrir_sessao", token: tokenApi });
    if (ip === null) pedido.headers.delete("CF-Connecting-IP");
    else pedido.headers.set("CF-Connecting-IP", ip);
    const resposta = await ambiente.responder(pedido);
    equal(resposta.status, 503);
    equal(ambiente.chamadas.length, 0);
  }
});

Deno.test("janela segue configuração, inatividade e expiração absoluta", async () => {
  for (
    const [reconferenciaMinutos, inatividade, duracaoAbsoluta, janela] of [
      [3, 8, 600_000, 180_000],
      [4, 8, 600_000, 240_000],
      [3, 2, 600_000, 120_000],
      [3, 8, 60_000, 60_000],
    ]
  ) {
    const iniciou = Date.now();
    const absoluta = iniciou + duracaoAbsoluta;
    const ambiente = simularSessao(
      new Date(absoluta).toISOString(),
      inatividade,
      { ...config, reconferenciaMinutos },
    );
    const resposta = await ambiente.responder(
      requisicao({ acao: "abrir_sessao", token: tokenApi }),
    );
    equal(resposta.status, 200);
    const limite = Date.parse((await resposta.json()).api_vinculo_expira_em);
    if (janela === duracaoAbsoluta) equal(limite, absoluta);
    else {
      ok(
        limite >= iniciou + janela && limite <= Date.now() + janela,
        "O prazo precisa respeitar o menor limite",
      );
    }
  }
});

Deno.test("link neutro registra só ocorrências de fornecedor e oculta documento e mensagem", async () => {
  const registros: Record<string, unknown>[] = [];
  let status = 403;
  let codigo = "CADASTRO_SEM_ACESSO";
  let responsavel: string | undefined = "fornecedor";
  const requestId = "0011223344556677";
  const ambiente = simular(async (input, init) => {
    const req = new Request(input, init);
    if (req.url.endsWith("/acessos/links")) {
      return Response.json({
        erro: { codigo, responsavel, mensagem: "Comprador Exemplo" },
        request_id: requestId,
      }, { status });
    }
    equal(req.url, supabase + "/rest/v1/rpc/registrar_ocorrencia_link_g360");
    equal(req.headers.get("apikey"), chaveAdmin);
    registros.push(await req.json());
    return new Response(null, { status: 204 });
  });
  const pedir = async (documento: string) => {
    const resposta = await ambiente.responder(
      requisicao({ acao: "pedir_link", documento }),
    );
    equal(resposta.status, 202);
    await Promise.all(ambiente.tarefas);
    return await resposta.text();
  };

  const primeira = await pedir("12.ABC.345/01DE-35");
  status = 422;
  codigo = "CADASTRO_SEM_EMAIL";
  equal(await pedir("12abc34501de35"), primeira);
  status = 404;
  codigo = "CADASTRO_NAO_LOCALIZADO";
  responsavel = "usuario";
  equal(await pedir("12ABC34501DE35"), primeira);
  responsavel = undefined;
  equal(await pedir("12ABC34501DE35"), primeira);

  equal(registros.length, 2);
  const [{ p_marcador }, repetido] = registros;
  ok(typeof p_marcador === "string" && /^[a-f0-9]{64}$/.test(p_marcador));
  deepStrictEqual(registros[0], {
    p_loja: loja,
    p_codigo: "CADASTRO_SEM_ACESSO",
    p_request_id: requestId,
    p_marcador,
  });
  deepStrictEqual(repetido, {
    p_loja: loja,
    p_codigo: "CADASTRO_SEM_EMAIL",
    p_request_id: requestId,
    p_marcador,
  });
  ok(!primeira.includes(requestId) && !primeira.includes("Comprador Exemplo"));
  deepStrictEqual(ambiente.emails, []);
});
