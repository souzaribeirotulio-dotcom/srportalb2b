/* =====================================================================
   Área do executivo de contas (/executivo).
   Login próprio (e-mail e senha cadastrados pela equipe no painel), sessão do
   Supabase só nesta aba. Tudo é lido pela regra de acesso (RLS): o executivo vê
   só a linha dele, os clientes que indicou e as comissões dele. Nada de preço,
   custo, margem, catálogo, outros clientes ou painel.
   ===================================================================== */
import Decimal from 'decimal.js';
import { supabaseExecutivo, supabaseConfigurado, lembrarExecutivo } from '../api/supabase.js';
import { esc } from '../ui/util.js';
import { dinheiro, dataBr } from '../ui/formato.js';
import { situacaoAvisos, ativarAvisosExecutivo, desativarAvisosExecutivo, testarAvisoExecutivo } from '../estado/avisos.js';
import { podeInstalarApp, estaNoApp, instalarApp, aoMudarInstalacao } from '../ui/instalar.js';

const SITV = { aguardando: 'Aguardando aprovação', ativo: 'Aprovado', recusado: 'Recusado', removido: 'Vínculo removido', sem_comissao: 'Aprovado — já era cliente (sem comissão)' };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = (c) => { const [a, m] = String(c).split('-'); return `${MESES[Number(m) - 1] || m}/${a}`; };
const soma = (l) => l.reduce((t, x) => t.plus(new Decimal(String(x ?? 0))), new Decimal(0)).toFixed(2);

export async function telaExecutivo({ conteudo, titulo }) {
  titulo.textContent = 'Área do executivo';
  if (!supabaseConfigurado()) { conteudo.innerHTML = '<p class="g360-info">A área do executivo não está disponível neste site.</p>'; return; }
  const sb = supabaseExecutivo();
  const { data } = await sb.auth.getSession();
  if (data?.session) return painelExecutivo(sb, conteudo);
  formularioLogin(sb, conteudo);
}

function formularioLogin(sb, conteudo, aviso = '') {
  conteudo.closest('.g360-cartao')?.classList.remove('g360-cartao-largo', 'g360-cartao-exec');
  conteudo.innerHTML = `
    <p class="g360-info g360-esquerda">Para parceiros da Souza Ribeiro. Entre com o e-mail e a senha que a equipe cadastrou para você.</p>
    ${aviso ? `<div class="g360-msg" role="alert">${esc(aviso)}</div>` : ''}
    <form class="g360-form" id="exLogin" novalidate>
      <label for="exEmail">E-mail</label>
      <input id="exEmail" type="email" autocomplete="username" maxlength="160" inputmode="email">
      <label for="exSenha">Senha</label>
      <input id="exSenha" type="password" autocomplete="current-password" maxlength="72">
      <label class="g360-check" for="exLembrar"><input type="checkbox" id="exLembrar" checked> Continuar conectado</label>
      <small class="g360-dica">Desmarque em computador compartilhado.</small>
      <small id="exErro" class="g360-erro-campo" aria-live="polite"></small>
      <button type="submit" class="g360-btn pri" id="exEntrar">Entrar</button>
    </form>
    <p class="g360-info">Esqueceu a senha? Fale com a equipe da Souza Ribeiro para cadastrar uma nova.</p>
    <p class="g360-info"><a href="/">Voltar ao portal</a></p>`;
  const f = conteudo.querySelector('#exLogin');
  setTimeout(() => f.querySelector('#exEmail').focus(), 50);
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const email = f.querySelector('#exEmail').value.trim().toLowerCase(); const senha = f.querySelector('#exSenha').value;
    const erro = f.querySelector('#exErro'); const bt = f.querySelector('#exEntrar');
    if (!email || !senha) { erro.textContent = 'Digite o e-mail e a senha.'; return; }
    bt.disabled = true; bt.textContent = 'Entrando…'; erro.textContent = '';
    try {
      // Escolhe onde a sessão fica ANTES de entrar (o Supabase grava a sessão logo no login).
      lembrarExecutivo(f.querySelector('#exLembrar').checked);
      const { error } = await sb.auth.signInWithPassword({ email, password: senha });
      f.querySelector('#exSenha').value = '';
      if (error) {
        erro.textContent = /rate|many/i.test(error.message) ? 'Muitas tentativas. Espere alguns minutos e tente de novo.' : 'E-mail ou senha incorretos.';
        bt.disabled = false; bt.textContent = 'Entrar'; return;
      }
      painelExecutivo(sb, conteudo);
    } catch {
      erro.textContent = 'Não foi possível falar com o servidor. Confira a conexão e tente de novo.';
      bt.disabled = false; bt.textContent = 'Entrar';
    }
  };
}

async function sair(sb, conteudo, aviso = '') {
  try { await sb.auth.signOut({ scope: 'local' }); } catch { /* segue */ }
  lembrarExecutivo(false);
  formularioLogin(sb, conteudo, aviso);
}

/* ----- datas no horário de Brasília ----- */
const FUSO = 'America/Sao_Paulo';
const hojeBr = () => new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date());
function menosDias(dia, n) { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); }
const hora = (iso) => { try { return iso ? new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : ''; } catch { return ''; } };
const diaCurto = (d) => { const m = /^\d{4}-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${m[2]}/${m[1]}` : ''; };
const qtd = (t) => String(t ?? '').replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1').replace('.', ',');
const SITC = { prevista: 'Prevista', faturada: 'Prevista', liberada: 'Liberada', paga: 'Paga', cancelada: 'Cancelada' };
function haQuanto(dia, hoje) {
  if (!dia) return '';
  const n = Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${dia}T12:00:00Z`)) / 86400000);
  return n <= 0 ? 'hoje' : n === 1 ? 'ontem' : `há ${n} dias`;
}

async function painelExecutivo(sb, conteudo) {
  conteudo.closest('.g360-cartao')?.classList.add('g360-cartao-largo', 'g360-cartao-exec');
  conteudo.innerHTML = '<div class="g360-estado">Carregando os seus dados…</div>';
  let eu; let clientes; let comissoes;
  try {
    const [r1, r2, r3] = await Promise.all([
      sb.from('executivos').select('id, codigo, nome').limit(1),
      sb.from('executivo_clientes').select('id, razao_social, situacao, inicio, fim, criado_em').order('criado_em', { ascending: false }).limit(1000),
      sb.from('comissoes').select('id, vinculo_id, pedido_data, pedido_em, pedido_numero, itens, competencia, base, percentual, valor, situacao, paga_em')
        .order('pedido_data', { ascending: false }).order('pedido_em', { ascending: false, nullsFirst: false }).limit(5000),
    ]);
    if (r1.error || r2.error || r3.error) throw r1.error || r2.error || r3.error;
    eu = r1.data?.[0]; clientes = r2.data || []; comissoes = r3.data || [];
  } catch (e) {
    if (e?.code === 'PGRST301' || /JWT|token/i.test(e?.message || '')) return sair(sb, conteudo, 'Sua sessão terminou. Entre novamente.');
    conteudo.innerHTML = '<div class="g360-msg" role="alert">Não foi possível carregar os seus dados agora. Confira a conexão e tente de novo.</div><button class="g360-btn sec" type="button" id="exDeNovo">Tentar de novo</button>';
    conteudo.querySelector('#exDeNovo').onclick = () => painelExecutivo(sb, conteudo);
    return;
  }
  // Conta sem executivo ativo (desativado pela equipe ou não é conta de executivo): não mostra nada.
  if (!eu) return sair(sb, conteudo, 'Este acesso não está ativo. Fale com a equipe da Souza Ribeiro.');

  const link = `${location.origin}/?ex=${encodeURIComponent(eu.codigo)}`;
  const texto = `Compre os suprimentos da sua empresa no Portal B2B da Souza Ribeiro: ${link}`;
  const nomeCli = new Map(clientes.map((c) => [c.id, c.razao_social || 'Cliente']));
  const validas = (l) => l.filter((c) => c.situacao !== 'cancelada');
  const geral = {
    prevista: soma(comissoes.filter((c) => ['prevista', 'faturada'].includes(c.situacao)).map((c) => c.valor)),
    liberada: soma(comissoes.filter((c) => c.situacao === 'liberada').map((c) => c.valor)),
    paga: soma(comissoes.filter((c) => c.situacao === 'paga').map((c) => c.valor)),
  };
  const hoje = hojeBr(); const mesAtual = hoje.slice(0, 7);
  const outrosMeses = [...new Set(comissoes.map((c) => String(c.competencia).slice(0, 7)))].filter((m) => m !== mesAtual).sort().reverse();
  let periodo = 'hoje';

  conteudo.innerHTML = `
    <div class="exa-topo"><div><b>Olá, ${esc(eu.nome.split(' ')[0])}!</b><small>Seu código: <span class="exa-cod">${esc(eu.codigo)}</span></small></div><button type="button" class="g360-btn sec" id="exSair">Sair</button></div>
    <div class="exa-grade">
      <div class="exa-principal">
        <section class="exa-bloco exa-vendas" aria-labelledby="exaVenT">
          <div class="exa-vcab"><h2 id="exaVenT">Suas vendas</h2>
            <div class="exa-per" role="group" aria-label="Período">
              <button type="button" data-p="hoje" aria-pressed="true">Hoje</button><button type="button" data-p="7d" aria-pressed="false">7 dias</button><button type="button" data-p="mes" aria-pressed="false">Este mês</button>
              ${outrosMeses.length ? `<select id="exMesSel" aria-label="Outro mês"><option value="">Outro mês…</option>${outrosMeses.map((m) => `<option value="${esc(m)}">${esc(nomeMes(m))}</option>`).join('')}</select>` : ''}
            </div></div>
          <div id="exVendas" aria-live="polite"></div>
        </section>
      </div>
      <aside class="exa-lado">
        <section class="exa-bloco exa-avisos" aria-labelledby="exaAvT"><h2 id="exaAvT">🔔 Avisos de venda</h2><div id="exAvisos" aria-live="polite"></div></section>
        <section class="exa-bloco" aria-labelledby="exaLinkT">
          <h2 id="exaLinkT">Seu link de indicação</h2>
          <p class="g360-info g360-esquerda">Quem se cadastra por este link já chega indicado por você.</p>
          <div class="exa-link" id="exLink">${esc(link)}</div>
          <div class="exa-botoes"><button type="button" class="g360-btn sec" id="exCopiar">Copiar link</button>
            <a class="g360-btn pri" id="exZap" href="https://wa.me/?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener noreferrer">Compartilhar no WhatsApp</a></div>
        </section>
        <section class="exa-bloco" aria-labelledby="exaTotT">
          <h2 id="exaTotT">Suas comissões</h2>
          <div class="exa-tot"><div><small>Prevista</small><b>${esc(dinheiro(geral.prevista))}</b></div><div><small>Liberada</small><b>${esc(dinheiro(geral.liberada))}</b></div><div><small>Paga</small><b>${esc(dinheiro(geral.paga))}</b></div></div>
          <p class="exa-obs g360-esquerda">Prevista: pedido feito pelo portal, aguardando conferência. Liberada: pronta para pagar. A base é o valor dos produtos, sem frete.</p>
        </section>
        <section class="exa-bloco" aria-labelledby="exaCliT">
          <h2 id="exaCliT">Clientes indicados (${clientes.length})</h2>
          ${clientes.length ? `<div class="exa-cli">${clientes.map((c) => `<div class="exa-l"><span>${esc(c.razao_social || 'Cliente')}<small>${c.inicio ? `desde ${esc(dataBr(c.inicio))}${c.fim ? ` · até ${esc(dataBr(c.fim))}` : ''}` : `indicado em ${esc(dataBr(String(c.criado_em).slice(0, 10)))}`}</small></span><span class="exa-st ${esc(c.situacao)}">${esc(SITV[c.situacao] || c.situacao)}</span></div>`).join('')}</div>`
            : '<p class="g360-info g360-esquerda">Nenhum cliente ainda. Mande o seu link para as empresas que você conhece.</p>'}
        </section>
      </aside>
    </div>`;

  const noPeriodo = (c) => {
    const d = String(c.pedido_data || '');
    if (periodo === 'hoje') return d === hoje;
    if (periodo === '7d') return d >= menosDias(hoje, 6) && d <= hoje;
    if (periodo === 'mes') return d.slice(0, 7) === mesAtual;
    return d.slice(0, 7) === periodo;
  };
  const rotulo = () => ({ hoje: 'hoje', '7d': 'nos últimos 7 dias', mes: 'neste mês' }[periodo] || `em ${nomeMes(periodo)}`);

  function pintarVendas() {
    const lista = comissoes.filter(noPeriodo); const ok = validas(lista);
    const compraram = new Set(ok.map((c) => c.vinculo_id).filter(Boolean));
    // Por cliente: clientes aprovados (vínculo ativo), com o que compraram no período e a última compra.
    const ultima = new Map();
    for (const c of validas(comissoes)) { const u = ultima.get(c.vinculo_id); if (!u || c.pedido_data > u) ultima.set(c.vinculo_id, c.pedido_data); }
    const porCli = clientes.filter((c) => c.situacao === 'ativo' || compraram.has(c.id)).map((c) => {
      const l = ok.filter((x) => x.vinculo_id === c.id);
      return { nome: c.razao_social || 'Cliente', total: soma(l.map((x) => x.base)), n: l.length, ultima: ultima.get(c.id) || null };
    }).sort((a, b) => Number(b.total) - Number(a.total) || String(b.ultima || '').localeCompare(String(a.ultima || '')));

    const ped = (c) => {
      const itens = Array.isArray(c.itens) ? c.itens : [];
      const resumo = itens.length ? `${itens.length} ${itens.length === 1 ? 'produto' : 'produtos'}` : '';
      return `<details class="exa-pedido${c.situacao === 'cancelada' ? ' off' : ''}"><summary>
        <span class="exa-p-cli"><b>${esc(nomeCli.get(c.vinculo_id) || 'Cliente')}</b><small>Pedido ${esc(c.pedido_numero || 'em aprovação')}${resumo ? ` · ${esc(resumo)}` : ''}</small></span>
        <span class="exa-p-quando">${periodo === 'hoje' ? '' : `${esc(diaCurto(c.pedido_data))} `}${esc(hora(c.pedido_em))}</span>
        <span class="exa-p-val"><b>${esc(dinheiro(c.base))}</b><small>comissão ${esc(dinheiro(c.valor))}</small></span>
        <span class="exa-st exa-sc ${esc(c.situacao)}">${esc(SITC[c.situacao] || c.situacao)}</span></summary>
        <div class="exa-itens">${itens.length ? `<ul>${itens.map((i) => `<li><span>${esc(i.nome || 'Produto')}</span><b>${esc(qtd(i.quantidade))}</b></li>`).join('')}</ul>` : '<p class="exa-obs">Produtos deste pedido não disponíveis.</p>'}
          <p class="exa-obs">${esc(dataBr(c.pedido_data))}${c.pedido_em ? ` às ${esc(hora(c.pedido_em))}` : ''} · comissão ${esc(String(Number(c.percentual)).replace('.', ','))}%${c.situacao === 'paga' && c.paga_em ? ` · paga em ${esc(dataBr(c.paga_em))}` : ''}</p></div></details>`;
    };

    document.getElementById('exVendas').innerHTML = `
      <div class="exa-kpis">
        <div><small>Vendido</small><b>${esc(dinheiro(soma(ok.map((c) => c.base))))}</b></div>
        <div><small>Pedidos</small><b>${ok.length}</b></div>
        <div><small>Clientes que compraram</small><b>${compraram.size}</b></div>
        <div class="dest"><small>Sua comissão</small><b>${esc(dinheiro(soma(ok.map((c) => c.valor))))}</b></div>
      </div>
      <h3 class="exa-h3">Pedidos ${esc(rotulo())}</h3>
      ${lista.length ? `<div class="exa-pedidos">${lista.map(ped).join('')}</div>`
        : `<div class="exa-vazio">Nenhum pedido ${esc(rotulo())}. ${periodo === 'hoje' ? 'Veja os últimos 7 dias ou o mês, ou mande o seu link para um cliente.' : 'Escolha outro período acima.'}</div>`}
      <h3 class="exa-h3">Por cliente</h3>
      ${porCli.length ? `<div class="exa-porcli">${porCli.map((c) => `<div class="exa-pc${c.n ? '' : ' parado'}"><span><b>${esc(c.nome)}</b><small>${c.ultima ? `última compra ${esc(haQuanto(c.ultima, hoje))} (${esc(dataBr(c.ultima))})` : 'ainda não comprou pelo portal'}</small></span>
        <span>${c.n ? `<b>${esc(dinheiro(c.total))}</b><small>${c.n} ${c.n === 1 ? 'pedido' : 'pedidos'}</small>` : '<small>sem compras no período</small>'}</span></div>`).join('')}</div>`
        : '<div class="exa-vazio">Quando um cliente indicado por você for aprovado, ele aparece aqui.</div>'}
      <p class="exa-obs g360-esquerda exa-nota">Só entram os pedidos feitos pelo portal por clientes indicados por você. Valores dos produtos, sem frete.</p>`;
  }
  const marcar = () => {
    conteudo.querySelectorAll('.exa-per [data-p]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === periodo)));
    const sel = conteudo.querySelector('#exMesSel'); if (sel) { sel.value = /^\d{4}-\d{2}$/.test(periodo) ? periodo : ''; sel.classList.toggle('on', !!sel.value); }
  };
  conteudo.querySelectorAll('.exa-per [data-p]').forEach((b) => { b.onclick = () => { periodo = b.dataset.p; marcar(); pintarVendas(); }; });
  const sel = conteudo.querySelector('#exMesSel');
  if (sel) sel.onchange = () => { periodo = sel.value || 'mes'; marcar(); pintarVendas(); };
  // Sem pedido hoje mas com pedidos no mês: abre direto no mês, para a tela não começar vazia.
  if (!comissoes.some((c) => c.pedido_data === hoje) && comissoes.some((c) => String(c.pedido_data).slice(0, 7) === mesAtual)) periodo = 'mes';
  marcar(); pintarVendas();

  // App instalado: abre direto na área do executivo (ver o script no topo do index.html).
  if (estaNoApp()) { try { localStorage.setItem('sr:app:abrir-em', '/executivo'); } catch { /* sem armazenamento */ } }
  desenharAvisos(sb, conteudo);
  aoMudarInstalacao(() => desenharAvisos(sb, conteudo));
  ouvirSomDeVenda();
  conteudo.querySelector('#exSair').onclick = () => sair(sb, conteudo, 'Você saiu da área do executivo.');
  conteudo.querySelector('#exCopiar').onclick = async (ev) => {
    const b = ev.currentTarget;
    try { await navigator.clipboard.writeText(link); b.textContent = 'Link copiado ✓'; }
    catch { const r = document.createRange(); r.selectNodeContents(conteudo.querySelector('#exLink')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Link selecionado: copie'; }
    setTimeout(() => { b.textContent = 'Copiar link'; }, 2500);
  };
}

/* ----- App e avisos no celular ("Você vendeu!"). Só com o "Permitir" do próprio executivo. ----- */
async function tokenSessao(sb) { try { return (await sb.auth.getSession()).data?.session?.access_token || ''; } catch { return ''; } }

async function desenharAvisos(sb, conteudo, msg = '') {
  const el = conteudo.querySelector('#exAvisos'); if (!el) return;
  const nota = msg ? `<p class="exa-av-msg" role="status">${esc(msg)}</p>` : '';
  const botaoInstalar = podeInstalarApp() ? '<button type="button" class="g360-btn sec" id="exInst">📲 Instalar app no celular</button>' : '';
  const st = await situacaoAvisos();
  const pronto = (html) => { el.innerHTML = html + nota; const b = el.querySelector('#exInst'); if (b) b.onclick = () => instalarApp(); };
  if (st === 'instalar_primeiro') {
    return pronto(`<p class="g360-info g360-esquerda">Receba um aviso no celular a cada venda dos seus clientes, com a sua comissão. No iPhone, primeiro instale o app: no Safari, <b>Compartilhar → Adicionar à Tela de Início</b>, e abra pelo ícone <b>SR Executivo</b>.</p><div class="exa-botoes">${botaoInstalar}</div>`);
  }
  if (st === 'sem_suporte') return pronto(`<p class="g360-info g360-esquerda">Este navegador não recebe avisos. Instale o app no celular para receber.</p><div class="exa-botoes">${botaoInstalar}</div>`);
  if (st === 'bloqueado') return pronto('<p class="g360-info g360-esquerda">Os avisos estão bloqueados neste aparelho. Libere em <b>Ajustes do celular → Notificações → SR Executivo</b> (ou nas permissões do navegador) e volte aqui.</p>');
  if (st === 'ativo') {
    pronto(`<p class="g360-info g360-esquerda">✅ Avisos <b>ativados</b> neste aparelho. A cada venda de um cliente seu pelo portal chega: <i>"💰 Você vendeu!"</i> com o valor e a comissão.</p>
      <div class="exa-botoes"><button type="button" class="g360-btn sec" id="exAvT">Enviar teste</button><button type="button" class="g360-btn sec" id="exAvD">Desativar</button></div>`);
    el.querySelector('#exAvT').onclick = async (ev) => {
      ev.currentTarget.disabled = true;
      try { const r = await testarAvisoExecutivo(await tokenSessao(sb)); desenharAvisos(sb, conteudo, r.enviados ? 'Aviso de teste enviado. Confira o celular.' : 'Não foi possível entregar o aviso neste aparelho. Desative e ative de novo.'); }
      catch (e) { if (e.status === 401) return sair(sb, conteudo, 'Sua sessão terminou. Entre novamente.'); desenharAvisos(sb, conteudo, e.message); }
    };
    el.querySelector('#exAvD').onclick = async (ev) => {
      ev.currentTarget.disabled = true;
      try { await desativarAvisosExecutivo(await tokenSessao(sb)); desenharAvisos(sb, conteudo, 'Avisos desativados neste aparelho.'); }
      catch { desenharAvisos(sb, conteudo, 'Não foi possível desativar agora. Tente de novo.'); }
    };
    return;
  }
  pronto(`<p class="g360-info g360-esquerda">Receba no celular um aviso a cada venda dos seus clientes pelo portal, com a sua comissão.</p>
    <div class="exa-botoes"><button type="button" class="g360-btn pri" id="exAvA">Ativar avisos</button>${botaoInstalar}</div>`);
  el.querySelector('#exAvA').onclick = async (ev) => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Ativando…';
    try { await ativarAvisosExecutivo(await tokenSessao(sb)); desenharAvisos(sb, conteudo, 'Pronto! Toque em "Enviar teste" para conferir.'); }
    catch (e) { if (e.status === 401) return sair(sb, conteudo, 'Sua sessão terminou. Entre novamente.'); desenharAvisos(sb, conteudo, e.message || 'Não foi possível ativar agora.'); }
  };
}

/* "Plim" de venda: quando chega o aviso com a área aberta na tela, a página toca um som curto
   (gerado aqui, sem arquivo). Com o app fechado, o celular usa o som de notificação dele. */
let ouvindoSom = false;
function ouvirSomDeVenda() {
  if (ouvindoSom || !('serviceWorker' in navigator)) return;
  ouvindoSom = true;
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.tipo === 'sr-aviso' && e.data.som === 'venda' && document.visibilityState === 'visible') tocarPlim();
  });
}
function tocarPlim() {
  try {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = new C(); const agora = ctx.currentTime;
    [[988, 0], [1319, 0.12], [1760, 0.24]].forEach(([f, t]) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, agora + t); g.gain.exponentialRampToValueAtTime(0.25, agora + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, agora + t + 0.35);
      o.connect(g).connect(ctx.destination); o.start(agora + t); o.stop(agora + t + 0.4);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch { /* sem som: o aviso continua aparecendo */ }
}
