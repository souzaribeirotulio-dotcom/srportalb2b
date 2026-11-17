/* =====================================================================
   Painel do operador (Etapa 10) e leitura de ocorrências (Etapa 11).
   Duas sessões, separadas das do comprador:
   - API: POST operadores/sessoes; token só em memória; 401 encerra só o painel.
   - Supabase: conta própria do operador (criada pelo administrador), só para
     ler as ocorrências; cliente com storageKey próprio.
   Custo e margem só aparecem com custo_visivel; nada é calculado aqui.
   ===================================================================== */
import {
  entrarOperador, sairOperador, consultarClienteOperador, buscarProdutosOperador, consultarPrecosOperador,
  listarPrecosCongelados, incluirPrecoCongelado, alterarPrecoCongelado, encerrarPrecoCongelado,
  listarFotosOperador, obterFotoOperador, incluirFotoOperador, definirCapaOperador, ordenarFotosOperador, removerFotoOperador,
} from '../api/g360.js';
import { supabasePainel, supabaseConfigurado } from '../api/supabase.js';
import { definirEncerramentoOperador, definirAtividadeOperador } from '../estado/sessao.js';
import { mostrarMensagemErro } from '../ui/mensagem.js';
import { dinheiro, numeroPainel, dataBr } from '../ui/formato.js';
import { carregando, vazia, erroTela } from '../ui/telas-comum.js';
import { esc } from '../ui/util.js';

const op = { token: null, expira: 0, ultima: 0, minutos: 8, aviso: null };
let relogio = null;
let redesenhar = () => {};
let aba = 'cadastros';
let cliente = null;
let urlsGaleria = [];

function liberarGaleria() { urlsGaleria.forEach((u) => URL.revokeObjectURL(u)); urlsGaleria = []; }

function encerrarOperador(mensagem) {
  op.token = null; op.expira = 0; op.aviso = mensagem || null;
  cliente = null;
  liberarGaleria();
  if (relogio) { clearInterval(relogio); relogio = null; }
  redesenhar();
}
definirEncerramentoOperador((erro) => encerrarOperador(erro.message));
definirAtividadeOperador(() => { op.ultima = Date.now(); });

function vigiar() {
  if (relogio) clearInterval(relogio);
  relogio = setInterval(() => {
    if (!op.token) return;
    if (Date.now() - op.ultima > op.minutos * 60000) encerrarOperador('A sessão do painel terminou por inatividade. Entre novamente.');
    else if (op.expira && Date.now() >= op.expira) encerrarOperador('A sessão do painel terminou. Entre novamente.');
  }, 5000);
}

/** Valor digitado (vírgula ou ponto) → texto do contrato com ponto, ou null. */
function valorPreco(digitado) {
  let s = String(digitado || '').trim();
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // "1.234,56" vira "1234.56"
  return /^(?:0|[1-9][0-9]{0,10})(?:\.[0-9]{1,7})?$/.test(s) && !/^0(?:\.0+)?$/.test(s) ? s : null;
}

export function telaPainel({ loja, raiz, ir, logo }) {
  op.minutos = Number(loja.sessao_minutos) || 8;
  redesenhar = () => telaPainel({ loja, raiz, ir, logo });
  liberarGaleria();
  if (!op.token) return telaLogin({ loja, raiz, ir, logo });

  raiz.className = 'g360-app painel';
  raiz.innerHTML = `
    <header class="app-topo">
      <div class="app-marca">${logo ? `<img src="${esc(logo)}" alt="" width="30" height="36">` : ''}
        <div><strong id="g360Titulo">Painel da equipe</strong><span class="app-quem">${esc(loja.nome)}</span></div></div>
      <div class="app-conta"><button type="button" class="app-link" id="pSair">Sair do painel</button></div>
    </header>
    <nav class="app-nav" aria-label="Seções do painel">
      ${[['cadastros', 'Cadastros novos'], ['clientes', 'Clientes e preços'], ['produtos', 'Produtos e fotos'], ['ocorrencias', 'Ocorrências']].map(([id, nome]) =>
        `<button type="button" data-aba="${id}" class="${aba === id ? 'ativo' : ''}" ${aba === id ? 'aria-current="page"' : ''}>${nome}</button>`).join('')}
    </nav>
    <p class="app-aviso suave">A vaga do G360 usada pelo painel pode vencer depois de 3 minutos sem uso. Se isso acontecer, é só entrar de novo.</p>
    <section class="app-conteudo" id="pConteudo"></section>`;
  raiz.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => { aba = b.dataset.aba; redesenhar(); }));
  raiz.querySelector('#pSair').addEventListener('click', async () => {
    const t = op.token;
    try { await sairOperador(t); } catch { /* sai localmente de qualquer jeito */ }
    encerrarOperador('Você saiu do painel.');
  });
  const c = raiz.querySelector('#pConteudo');
  if (aba === 'clientes') abaClientes(c);
  else if (aba === 'produtos') abaProdutos(c);
  else if (aba === 'cadastros') abaCadastros(c);
  else abaOcorrencias(c);
}

function telaLogin({ loja, raiz, ir, logo }) {
  raiz.className = 'g360-entrada';
  raiz.innerHTML = `
    <div class="g360-cartao" role="region" aria-labelledby="g360Titulo">
      <div class="g360-marca">${logo ? `<img src="${esc(logo)}" alt="Souza Ribeiro" width="44" height="52">` : ''}<span class="g360-portal">Painel da equipe</span></div>
      <h1 id="g360Titulo" class="g360-nome">${esc(loja.nome)}</h1>
      ${op.aviso ? `<div class="g360-msg g360-msg-corrigir" role="status"><p>${esc(op.aviso)}</p></div>` : ''}
      <p class="g360-info">Entre com o seu usuário e a sua senha do G360.</p>
      <form class="g360-form" id="pLogin" novalidate>
        <label for="pUsuario">Usuário do G360</label><input id="pUsuario" maxlength="20" autocomplete="username" spellcheck="false" autocapitalize="off">
        <label for="pSenha">Senha</label><input id="pSenha" type="password" maxlength="8" autocomplete="current-password">
        <small class="g360-erro-campo" id="pErro" aria-live="polite"></small>
        <button type="submit" class="g360-btn pri">Entrar no painel</button>
      </form>
      <div id="pResultado" aria-live="polite"></div>
      <div class="g360-acoes"><button type="button" class="g360-link" id="pVoltar">Voltar ao portal do cliente</button></div>
    </div>`;
  raiz.querySelector('#pVoltar').addEventListener('click', () => ir('/'));
  const f = raiz.querySelector('#pLogin');
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const u = f.querySelector('#pUsuario'); const s = f.querySelector('#pSenha'); const b = f.querySelector('button');
    const erro = f.querySelector('#pErro');
    erro.textContent = '';
    if (!u.value.trim() || !s.value) { erro.textContent = 'Digite o usuário e a senha.'; return; }
    b.disabled = true; b.textContent = 'Entrando…';
    try {
      const d = await entrarOperador(u.value.trim(), s.value);
      s.value = '';
      op.token = d.token; op.expira = Date.parse(d.expira_em) || 0; op.ultima = Date.now(); op.aviso = null;
      vigiar();
      redesenhar();
    } catch (e) {
      s.value = '';
      b.disabled = false; b.textContent = 'Entrar no painel';
      mostrarMensagemErro(raiz.querySelector('#pResultado'), e);
    }
  });
}

/* ---------------- Clientes, preços e preço congelado ---------------- */

function abaClientes(c) {
  c.innerHTML = `<div class="app-titulo"><h2>Clientes e preços</h2><p>Consulte o cliente pelo CNPJ, veja os preços dele e negocie preço congelado.</p></div>
    <form class="filtros" id="pFormCliente"><div class="filtro-busca"><label for="pCnpj">CNPJ do cliente</label>
      <input id="pCnpj" maxlength="32" autocapitalize="characters" spellcheck="false"></div>
      <button type="submit" class="g360-btn pri">Consultar</button></form>
    <div id="pCliente" aria-live="polite"></div><div id="pPrecos"></div><div id="pCongelados"></div>`;
  const alvo = c.querySelector('#pCliente');
  c.querySelector('#pFormCliente').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const cnpj = c.querySelector('#pCnpj').value.trim();
    if (!cnpj) return;
    cliente = null;
    c.querySelector('#pPrecos').innerHTML = ''; c.querySelector('#pCongelados').innerHTML = '';
    carregando(alvo, 'Consultando o cliente…');
    try {
      cliente = await consultarClienteOperador(op.token, cnpj);
      mostrarCliente(c);
    } catch (e) { mostrarMensagemErro(alvo, e); }
  });
  if (cliente) mostrarCliente(c);
}

function mostrarCliente(c) {
  c.querySelector('#pCliente').innerHTML = `<section class="resumo"><dl>
    <div><dt>Código</dt><dd>${esc(cliente.codigo)}</dd></div>
    <div><dt>Nome</dt><dd>${esc(cliente.nome)}</dd></div>
    <div><dt>Acesso ao portal</dt><dd>${cliente.acesso_portal ? 'Liberado' : 'Sem acesso'}</dd></div>
    ${cliente.segmento?.descricao ? `<div><dt>Segmento</dt><dd>${esc(cliente.segmento.descricao)}</dd></div>` : ''}
  </dl></section>`;
  const precos = c.querySelector('#pPrecos');
  precos.innerHTML = `<h3>Preços para este cliente</h3>
    <form class="filtros" id="pFormPrecos"><div class="filtro-busca"><label for="pBuscaPreco">Produto</label>
      <input id="pBuscaPreco" type="search" maxlength="80" placeholder="Nome ou código"></div>
      <button type="submit" class="g360-btn pri">Ver preços</button></form><div id="pTabelaPrecos"></div>`;
  precos.querySelector('#pFormPrecos').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const q = precos.querySelector('#pBuscaPreco').value.trim();
    const t = precos.querySelector('#pTabelaPrecos');
    if (!q) return;
    carregando(t, 'Consultando preços…');
    try {
      const { dados } = await buscarProdutosOperador(op.token, { q, limite: 20 });
      if (!dados.length) { vazia(t, 'Nenhum produto encontrado.', 'Tente outro nome ou código.'); return; }
      const lista = await consultarPrecosOperador(op.token, cliente.codigo, dados.map((p) => p.id));
      t.innerHTML = tabelaProdutos(lista, true);
      t.querySelectorAll('[data-negociar]').forEach((b) => b.addEventListener('click', () => formCongelado(c, { produto: Number(b.dataset.negociar), nome: b.dataset.nome })));
    } catch (e) { erroTela(t, e); }
  });
  carregarCongelados(c);
}

function tabelaProdutos(lista, comNegociar) {
  return `<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Código</th><th>Produto</th><th>Unid.</th><th>Preço de tabela</th>
    ${comNegociar ? '<th>Preço congelado</th>' : ''}<th>Origem</th><th>Custo</th><th>Margem</th>${comNegociar ? '<th></th>' : '<th>Fotos</th>'}</tr></thead>
    <tbody>${lista.map((p) => `<tr>
      <td>${esc(p.codigo)}</td><td>${esc(p.nome)}</td><td>${esc(p.unidade || '')}</td><td>${esc(dinheiro(p.preco))}</td>
      ${comNegociar ? `<td>${p.preco_congelado ? esc(dinheiro(p.preco_congelado)) : '—'}</td>` : ''}
      <td>${esc(p.origem_preco || '—')}</td>
      <td>${p.custo_visivel ? esc(p.custo === null ? '—' : `R$ ${numeroPainel(p.custo, 2)}`) : '<span class="g360-mini">sem acesso</span>'}</td>
      <td>${p.custo_visivel ? esc(p.margem_percentual === null ? '—' : `${numeroPainel(p.margem_percentual, 2)}%`) : '<span class="g360-mini">sem acesso</span>'}</td>
      ${comNegociar ? `<td><button type="button" class="app-link" data-negociar="${Number(p.id)}" data-nome="${esc(p.nome)}">Negociar</button></td>`
        : `<td><button type="button" class="app-link" data-fotos="${Number(p.id)}" data-nome="${esc(p.nome)}">Fotos</button></td>`}
    </tr>`).join('')}</tbody></table></div>`;
}

function formCongelado(c, { produto, nome, registro = null }) {
  const alvo = c.querySelector('#pCongelados');
  const hoje = new Date().toISOString().slice(0, 10);
  const caixa = document.createElement('section');
  caixa.className = 'resumo';
  caixa.innerHTML = `<h3>${registro ? 'Alterar' : 'Negociar'} preço — ${esc(nome || `produto ${produto}`)}</h3>
    <p class="g360-mini">Vale para a unidade base, nos dois dias informados. A API recusa períodos que se sobrepõem.</p>
    <form class="g360-form" novalidate>
      <label for="cValor">Valor (R$)</label><input id="cValor" inputmode="decimal" value="${registro ? esc(String(registro.valor).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',')) : ''}">
      <div class="duas"><div><label for="cIni">Início</label><input id="cIni" type="date" value="${esc(registro?.inicio || hoje)}"></div>
        <div><label for="cFim">Fim</label><input id="cFim" type="date" value="${esc(registro?.fim || hoje)}"></div></div>
      <small class="g360-erro-campo" id="cErro" aria-live="polite"></small>
      <div class="linha-botoes"><button type="submit" class="g360-btn pri">Gravar</button><button type="button" class="g360-btn sec" id="cCancelar">Cancelar</button></div>
      <div id="cResultado" aria-live="polite"></div>
    </form>`;
  alvo.prepend(caixa);
  caixa.scrollIntoView({ block: 'nearest' });
  caixa.querySelector('#cCancelar').addEventListener('click', () => caixa.remove());
  caixa.querySelector('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const valor = valorPreco(caixa.querySelector('#cValor').value);
    const inicio = caixa.querySelector('#cIni').value; const fim = caixa.querySelector('#cFim').value;
    const erro = caixa.querySelector('#cErro');
    erro.textContent = '';
    if (!valor) { erro.textContent = 'Informe um valor maior que zero, com até 7 casas decimais.'; return; }
    if (!inicio || !fim || fim < inicio) { erro.textContent = 'A data final precisa ser igual ou depois da inicial.'; return; }
    const b = caixa.querySelector('button[type="submit"]'); b.disabled = true;
    try {
      if (registro) await alterarPrecoCongelado(op.token, cliente.codigo, registro.id, { valor, inicio, fim });
      else await incluirPrecoCongelado(op.token, cliente.codigo, { produto, unidade_id: null, valor, inicio, fim });
      caixa.remove();
      carregarCongelados(c);
    } catch (e) { b.disabled = false; mostrarMensagemErro(caixa.querySelector('#cResultado'), e); }
  });
}

async function carregarCongelados(c, apos = undefined, acumulado = []) {
  const alvo = c.querySelector('#pCongelados');
  let lista = alvo.querySelector('#pListaCongelados');
  if (!lista) { alvo.insertAdjacentHTML('beforeend', '<h3>Preços congelados do cliente</h3><div id="pListaCongelados"></div>'); lista = alvo.querySelector('#pListaCongelados'); }
  if (!apos) carregando(lista, 'Carregando preços congelados…');
  try {
    const d = await listarPrecosCongelados(op.token, cliente.codigo, apos);
    if (!d.disponivel) { vazia(lista, 'Preço congelado indisponível.', 'A base do G360 precisa ser atualizada para usar este recurso.'); return; }
    const itens = acumulado.concat(d.itens);
    if (!itens.length) { vazia(lista, 'Nenhum preço congelado para este cliente.', 'Use "Negociar" na tabela de preços acima.'); return; }
    lista.innerHTML = `<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Produto</th><th>Unidade</th><th>Valor</th><th>Início</th><th>Fim</th><th>Situação</th><th></th></tr></thead>
      <tbody>${itens.map((r) => `<tr><td>${esc(r.produto)}</td><td>${esc(r.unidade_id || 'base')}</td><td>${esc(dinheiro(r.valor))}</td>
        <td>${esc(dataBr(r.inicio))}</td><td>${esc(dataBr(r.fim))}</td><td>${r.situacao === 'ativo' ? 'Ativo' : 'Encerrado'}</td>
        <td>${r.situacao === 'ativo' ? `<button type="button" class="app-link" data-alterar="${r.id}">Alterar</button> <button type="button" class="app-link" data-encerrar="${r.id}">Encerrar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${d.proximo ? '<button type="button" class="g360-btn sec" id="pMaisCongelados">Carregar mais</button>' : ''}
      <div id="pCongResultado" aria-live="polite"></div>`;
    lista.querySelector('#pMaisCongelados')?.addEventListener('click', () => carregarCongelados(c, d.proximo, itens));
    lista.querySelectorAll('[data-alterar]').forEach((b) => b.addEventListener('click', () => {
      const r = itens.find((x) => x.id === Number(b.dataset.alterar));
      formCongelado(c, { produto: r.produto, nome: `produto ${r.produto}`, registro: r });
    }));
    lista.querySelectorAll('[data-encerrar]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = 'Confirmar encerramento'; return; }
      b.disabled = true;
      try { await encerrarPrecoCongelado(op.token, cliente.codigo, Number(b.dataset.encerrar)); carregarCongelados(c); }
      catch (e) { b.disabled = false; mostrarMensagemErro(lista.querySelector('#pCongResultado'), e); }
    }));
  } catch (e) { erroTela(lista, e, () => carregarCongelados(c)); }
}

/* ---------------- Produtos e fotos ---------------- */

function abaProdutos(c) {
  c.innerHTML = `<div class="app-titulo"><h2>Produtos e fotos</h2><p>Busca geral com preço de tabela. Inclui produtos ainda não publicados no portal.</p></div>
    <form class="filtros" id="pFormProd"><div class="filtro-busca"><label for="pBuscaProd">Produto</label>
      <input id="pBuscaProd" type="search" maxlength="80" placeholder="Nome ou código"></div>
      <button type="submit" class="g360-btn pri">Buscar</button></form>
    <div id="pProdutos"></div><nav class="paginacao" id="pPagProd"></nav><div id="pGaleria"></div>`;
  let pagina = 1; let q = '';
  const alvo = c.querySelector('#pProdutos'); const pag = c.querySelector('#pPagProd');
  async function buscar() {
    carregando(alvo, 'Buscando produtos…'); pag.innerHTML = '';
    try {
      const { dados, paginacao } = await buscarProdutosOperador(op.token, { q: q || undefined, pagina, limite: 20 });
      if (!dados.length) { vazia(alvo, 'Nenhum produto encontrado.', 'Tente outro nome ou código.'); return; }
      alvo.innerHTML = tabelaProdutos(dados, false);
      alvo.querySelectorAll('[data-fotos]').forEach((b) => b.addEventListener('click', () => galeria(c.querySelector('#pGaleria'), Number(b.dataset.fotos), b.dataset.nome)));
      const paginas = Math.max(1, Math.ceil((paginacao?.total || 0) / 20));
      if (paginas > 1) {
        pag.innerHTML = `<button type="button" class="g360-btn sec" id="ppA" ${pagina <= 1 ? 'disabled' : ''}>Anterior</button><span>Página ${pagina} de ${paginas}</span>
          <button type="button" class="g360-btn sec" id="ppP" ${pagina >= paginas ? 'disabled' : ''}>Próxima</button>`;
        pag.querySelector('#ppA').addEventListener('click', () => { pagina -= 1; buscar(); });
        pag.querySelector('#ppP').addEventListener('click', () => { pagina += 1; buscar(); });
      }
    } catch (e) { erroTela(alvo, e, buscar); }
  }
  c.querySelector('#pFormProd').addEventListener('submit', (ev) => { ev.preventDefault(); q = c.querySelector('#pBuscaProd').value.trim(); pagina = 1; buscar(); });
}

async function galeria(alvo, id, nome) {
  liberarGaleria();
  alvo.innerHTML = `<section class="resumo galeria" aria-labelledby="gTit"><h3 id="gTit">Fotos — ${esc(nome)}</h3><div id="gCorpo"></div></section>`;
  const corpo = alvo.querySelector('#gCorpo');
  alvo.scrollIntoView({ block: 'nearest' });
  carregando(corpo, 'Carregando a galeria…');
  let g;
  try { g = await listarFotosOperador(op.token, id); } catch (e) { erroTela(corpo, e, () => galeria(alvo, id, nome)); return; }
  desenhar(g);

  function desenhar(gal) {
    liberarGaleria();
    corpo.innerHTML = `<p class="g360-mini">${gal.fotos.length} de ${gal.maximo} fotos. A primeira é a capa.</p>
      <ul class="fotos-galeria">${gal.fotos.map((f, i) => `<li data-item="${f.item}">
        <div class="foto" data-item="${f.item}"><span>Carregando…</span></div>
        <p>${f.item === gal.capa ? '<strong>Capa</strong> · ' : ''}${esc(f.descricao || `Foto ${f.item}`)}</p>
        <div class="linha-botoes">
          ${f.item !== gal.capa ? `<button type="button" class="app-link" data-capa="${f.item}">Tornar capa</button>` : ''}
          ${i > 0 ? `<button type="button" class="app-link" data-subir="${f.item}" aria-label="Mover para a esquerda">↑</button>` : ''}
          ${i < gal.fotos.length - 1 ? `<button type="button" class="app-link" data-descer="${f.item}" aria-label="Mover para a direita">↓</button>` : ''}
          <button type="button" class="app-link perigo" data-remover="${f.item}">Remover</button>
        </div></li>`).join('')}</ul>
      ${gal.fotos.length < gal.maximo ? `<form class="g360-form" id="gNova" novalidate>
        <label for="gArquivo">Nova foto (JPEG até 2 MB)</label><input id="gArquivo" type="file" accept="image/jpeg">
        <label for="gDesc">Descrição (opcional)</label><input id="gDesc" maxlength="50">
        <small class="g360-erro-campo" id="gErro" aria-live="polite"></small>
        <button type="submit" class="g360-btn pri">Enviar foto</button></form>` : '<p class="cp-sem">Galeria cheia: remova uma foto para incluir outra.</p>'}
      <div id="gResultado" aria-live="polite"></div>`;
    corpo.querySelectorAll('.foto[data-item]').forEach(async (el) => {
      try {
        const blob = await obterFotoOperador(op.token, id, el.dataset.item);
        const url = URL.createObjectURL(blob); urlsGaleria.push(url);
        el.innerHTML = `<img src="${url}" alt="">`;
      } catch { el.innerHTML = '<span>Sem foto</span>'; el.classList.add('vazia'); }
    });
    const res = corpo.querySelector('#gResultado');
    const acao = async (fn) => { try { desenhar(await fn()); } catch (e) { mostrarMensagemErro(res, e); } };
    const ordem = gal.fotos.map((f) => f.item);
    const mover = (item, delta) => {
      const i = ordem.indexOf(item); const j = i + delta;
      const nova = [...ordem]; [nova[i], nova[j]] = [nova[j], nova[i]];
      acao(() => ordenarFotosOperador(op.token, id, nova));
    };
    corpo.querySelectorAll('[data-capa]').forEach((b) => b.addEventListener('click', () => acao(() => definirCapaOperador(op.token, id, Number(b.dataset.capa)))));
    corpo.querySelectorAll('[data-subir]').forEach((b) => b.addEventListener('click', () => mover(Number(b.dataset.subir), -1)));
    corpo.querySelectorAll('[data-descer]').forEach((b) => b.addEventListener('click', () => mover(Number(b.dataset.descer), 1)));
    corpo.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = 'Confirmar remoção'; return; }
      acao(() => removerFotoOperador(op.token, id, Number(b.dataset.remover)));
    }));
    corpo.querySelector('#gNova')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const arq = corpo.querySelector('#gArquivo').files[0];
      const erro = corpo.querySelector('#gErro');
      erro.textContent = '';
      if (!arq) { erro.textContent = 'Escolha um arquivo.'; return; }
      if (arq.type !== 'image/jpeg') { erro.textContent = 'Use uma foto em JPEG.'; return; }
      if (arq.size > 2 * 1024 * 1024) { erro.textContent = 'A foto passa de 2 MB. Reduza o tamanho e tente de novo.'; return; }
      const leitor = new FileReader();
      leitor.onload = () => acao(() => incluirFotoOperador(op.token, id, String(leitor.result), corpo.querySelector('#gDesc').value.trim()));
      leitor.readAsDataURL(arq);
    });
  }
}

/* ---------------- Ocorrências (leitura pelo Supabase do painel) ---------------- */

/** Conta do painel no Supabase (Cadastros e Ocorrências): pede e-mail e senha uma vez por abertura. */
function comContaPainel(alvo, titulo, aoEntrar) {
  if (!supabaseConfigurado()) { vazia(alvo, 'Supabase não configurado.', 'Confira as variáveis públicas do site.'); return null; }
  const sb = supabasePainel();
  const login = (mensagem = '') => {
    alvo.innerHTML = `<section class="resumo"><h3>${esc(titulo)}</h3>
      <p class="g360-mini">Use a conta do painel criada no Supabase da Souza Ribeiro (é diferente do usuário do G360).</p>
      ${mensagem ? `<div class="g360-msg g360-msg-corrigir" role="alert"><p>${esc(mensagem)}</p></div>` : ''}
      <form class="g360-form" id="oLogin" novalidate>
        <label for="oEmail">E-mail</label><input id="oEmail" type="email" autocomplete="username">
        <label for="oSenha">Senha</label><input id="oSenha" type="password" autocomplete="current-password">
        <button type="submit" class="g360-btn pri">Entrar</button></form></section>`;
    alvo.querySelector('#oLogin').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const b = ev.target.querySelector('button'); b.disabled = true;
      const sn = alvo.querySelector('#oSenha');
      const { error } = await sb.auth.signInWithPassword({ email: alvo.querySelector('#oEmail').value.trim(), password: sn.value });
      sn.value = '';
      if (error) { login('E-mail ou senha incorretos, ou conta sem acesso.'); return; }
      aoEntrar();
    });
  };
  sb.auth.getSession().then(({ data }) => { if (data.session) aoEntrar(); else login(); });
  return { sb, login };
}

const SIT = { pendente: 'Aguardando análise', aprovado: 'Aprovado', recusado: 'Recusado' };
let filtroCadastro = 'pendente';

function abaCadastros(c) {
  c.innerHTML = `<div class="app-titulo"><h2>Cadastros novos</h2><p>Empresas que pediram para ser clientes pelo portal. Depois de aprovar, cadastre a empresa no G360 e marque "Acesso à API dos sistemas externos" em Gestão comercial; aí ela usa "Primeiro acesso" para criar a senha.</p></div><div id="pCad"></div>`;
  const alvo = c.querySelector('#pCad');
  const conta = comContaPainel(alvo, 'Entrar para ver os cadastros', listar);
  if (!conta) return;
  const { sb } = conta;
  async function listar() {
    carregando(alvo, 'Carregando cadastros…');
    let q = sb.from('portal_cadastros').select('*').order('criado_em', { ascending: false }).limit(200);
    if (filtroCadastro) q = q.eq('status', filtroCadastro);
    const { data, error } = await q;
    if (error) { alvo.innerHTML = ''; mostrarMensagemErro(alvo, null); return; }
    alvo.innerHTML = `<div class="linha-botoes">${[['pendente', 'Aguardando'], ['aprovado', 'Aprovados'], ['recusado', 'Recusados'], ['', 'Todos']].map(([v, n]) =>
      `<button type="button" class="g360-btn ${filtroCadastro === v ? 'pri' : 'sec'}" data-f="${v}">${n}</button>`).join('')}
      <button type="button" class="app-link" id="kSair">Sair da conta do painel</button></div>
      ${data.length ? data.map((k) => `<section class="resumo" data-id="${esc(k.id)}">
        <h3>${esc(k.razao_social)}${k.fantasia ? ` · <span style="font-weight:500">${esc(k.fantasia)}</span>` : ''}</h3>
        <p class="g360-mini">${esc(SIT[k.status])} · enviado em ${esc(new Date(k.criado_em).toLocaleString('pt-BR'))}${k.decidido_por ? ` · decidido por ${esc(k.decidido_por)}` : ''}</p>
        <dl>
          <div><dt>CPF/CNPJ</dt><dd class="mono">${esc(k.documento)}</dd></div>
          ${k.inscricao_estadual ? `<div><dt>Inscrição estadual</dt><dd>${esc(k.inscricao_estadual)}</dd></div>` : ''}
          <div><dt>Responsável</dt><dd>${esc(k.responsavel)}</dd></div>
          <div><dt>WhatsApp</dt><dd>${esc(k.whats || '—')}</dd></div>
          ${k.telefone ? `<div><dt>Telefone</dt><dd>${esc(k.telefone)}</dd></div>` : ''}
          <div><dt>E-mail</dt><dd>${esc(k.email)}</dd></div>
          <div><dt>Endereço</dt><dd>${esc([k.logradouro, k.numero, k.complemento].filter(Boolean).join(', '))} — ${esc(k.bairro || '')}, ${esc(k.cidade || '')}/${esc(k.uf || '')} · CEP ${esc(k.cep || '')}</dd></div>
          ${k.origem ? `<div><dt>Como conheceu</dt><dd>${esc(k.origem)}</dd></div>` : ''}
          ${k.observacao_equipe ? `<div><dt>Observação da equipe</dt><dd>${esc(k.observacao_equipe)}</dd></div>` : ''}
        </dl>
        <form class="g360-form" novalidate><label for="ob${esc(k.id)}">Observação (opcional)</label><input id="ob${esc(k.id)}" maxlength="500" value="${esc(k.observacao_equipe || '')}">
          <div class="linha-botoes">${k.status !== 'aprovado' ? '<button type="button" class="g360-btn pri" data-d="aprovado">Aprovar</button>' : ''}
            ${k.status !== 'recusado' ? '<button type="button" class="g360-btn sec" data-d="recusado">Recusar</button>' : ''}
            ${k.status !== 'pendente' ? '<button type="button" class="app-link" data-d="pendente">Voltar para análise</button>' : ''}</div>
          <div class="kRes" aria-live="polite"></div></form>
      </section>`).join('') : '<div class="estado-tela vazia"><strong>Nenhum cadastro aqui.</strong><p>Os pedidos feitos em "Quero ser cliente" aparecem nesta aba.</p></div>'}`;
    alvo.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filtroCadastro = b.dataset.f; listar(); }));
    alvo.querySelector('#kSair').addEventListener('click', async () => { await sb.auth.signOut({ scope: 'local' }); conta.login(); });
    alvo.querySelectorAll('section[data-id] [data-d]').forEach((b) => b.addEventListener('click', async () => {
      const sec = b.closest('section'); const res = sec.querySelector('.kRes');
      b.disabled = true;
      const { error: e } = await sb.rpc('portal_cadastro_decidir', { p_id: sec.dataset.id, p_status: b.dataset.d, p_observacao: sec.querySelector('input').value });
      if (e) { b.disabled = false; res.innerHTML = `<div class="g360-msg g360-msg-corrigir"><p>${esc(e.message || 'Não foi possível gravar.')}</p></div>`; return; }
      listar();
    }));
  }
}

function abaOcorrencias(c) {
  c.innerHTML = `<div class="app-titulo"><h2>Ocorrências</h2><p>Casos em que o portal recebeu um aviso que depende de ajuste da Souza Ribeiro no G360.</p></div><div id="pOcorr"></div>`;
  const alvo = c.querySelector('#pOcorr');
  if (!supabaseConfigurado()) { vazia(alvo, 'Supabase não configurado.', 'Confira as variáveis públicas do site.'); return; }
  const sb = supabasePainel();
  sb.auth.getSession().then(({ data }) => { if (data.session) listar(); else login(); });

  function login(mensagem = '') {
    alvo.innerHTML = `<section class="resumo"><h3>Entrar para ver as ocorrências</h3>
      <p class="g360-mini">Use a conta do painel criada no Supabase da Souza Ribeiro (é diferente do usuário do G360).</p>
      ${mensagem ? `<div class="g360-msg g360-msg-corrigir" role="alert"><p>${esc(mensagem)}</p></div>` : ''}
      <form class="g360-form" id="oLogin" novalidate>
        <label for="oEmail">E-mail</label><input id="oEmail" type="email" autocomplete="username">
        <label for="oSenha">Senha</label><input id="oSenha" type="password" autocomplete="current-password">
        <button type="submit" class="g360-btn pri">Entrar</button></form></section>`;
    alvo.querySelector('#oLogin').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const b = ev.target.querySelector('button'); b.disabled = true;
      const s = alvo.querySelector('#oSenha');
      const { error } = await sb.auth.signInWithPassword({ email: alvo.querySelector('#oEmail').value.trim(), password: s.value });
      s.value = '';
      if (error) { login('E-mail ou senha incorretos, ou conta sem acesso.'); return; }
      listar();
    });
  }

  async function listar() {
    carregando(alvo, 'Carregando ocorrências…');
    const { data, error } = await sb.from('ocorrencias_g360').select('registrada_em, codigo, operacao, comprador_codigo, request_id')
      .order('registrada_em', { ascending: false }).limit(200);
    if (error) { alvo.innerHTML = ''; mostrarMensagemErro(alvo, null); return; }
    const barra = `<div class="linha-botoes"><button type="button" class="g360-btn sec" id="oAtualizar">Atualizar</button>
      <button type="button" class="app-link" id="oSair">Sair das ocorrências</button></div>`;
    if (!data.length) {
      alvo.innerHTML = `${barra}<div class="estado-tela vazia"><strong>Nenhuma ocorrência registrada.</strong>
        <p>Se você esperava ver alguma, confira se esta conta tem o acesso do painel (g360_painel_loja) no Supabase.</p></div>`;
    } else {
      alvo.innerHTML = `${barra}<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Quando</th><th>Código</th><th>Operação</th><th>Cliente</th><th>Código para o suporte</th></tr></thead>
        <tbody>${data.map((o) => `<tr><td>${esc(new Date(o.registrada_em).toLocaleString('pt-BR'))}</td><td>${esc(o.codigo)}</td><td>${esc(o.operacao)}</td>
          <td>${esc(o.comprador_codigo ?? '—')}</td><td class="mono">${esc(o.request_id)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    alvo.querySelector('#oAtualizar').addEventListener('click', listar);
    alvo.querySelector('#oSair').addEventListener('click', async () => { await sb.auth.signOut({ scope: 'local' }); login(); });
  }
}
