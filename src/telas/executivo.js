/* =====================================================================
   Área do executivo de contas (/executivo).
   Login próprio (e-mail e senha cadastrados pela equipe no painel), sessão do
   Supabase só nesta aba. Tudo é lido pela regra de acesso (RLS): o executivo vê
   só a linha dele, os clientes que indicou e as comissões dele. Nada de preço,
   custo, margem, catálogo, outros clientes ou painel.
   ===================================================================== */
import Decimal from 'decimal.js';
import { supabaseExecutivo, supabaseConfigurado } from '../api/supabase.js';
import { esc } from '../ui/util.js';
import { dinheiro, dataBr } from '../ui/formato.js';

const SITV = { aguardando: 'Aguardando aprovação', ativo: 'Aprovado', recusado: 'Recusado', removido: 'Vínculo removido', sem_comissao: 'Aprovado — já era cliente (sem comissão)' };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = (c) => { const [a, m] = String(c).split('-'); return `${MESES[Number(m) - 1] || m}/${a}`; };
const soma = (l) => l.reduce((t, x) => t.plus(new Decimal(String(x ?? 0))), new Decimal(0)).toFixed(2);

export async function telaExecutivo({ conteudo, titulo }) {
  titulo.textContent = 'Área do executivo';
  conteudo.closest('.g360-cartao')?.classList.add('g360-cartao-largo');
  if (!supabaseConfigurado()) { conteudo.innerHTML = '<p class="g360-info">A área do executivo não está disponível neste site.</p>'; return; }
  const sb = supabaseExecutivo();
  const { data } = await sb.auth.getSession();
  if (data?.session) return painelExecutivo(sb, conteudo);
  formularioLogin(sb, conteudo);
}

function formularioLogin(sb, conteudo, aviso = '') {
  conteudo.innerHTML = `
    <p class="g360-info g360-esquerda">Para parceiros da Souza Ribeiro. Entre com o e-mail e a senha que a equipe cadastrou para você.</p>
    ${aviso ? `<div class="g360-msg" role="alert">${esc(aviso)}</div>` : ''}
    <form class="g360-form" id="exLogin" novalidate>
      <label for="exEmail">E-mail</label>
      <input id="exEmail" type="email" autocomplete="username" maxlength="160" inputmode="email">
      <label for="exSenha">Senha</label>
      <input id="exSenha" type="password" autocomplete="current-password" maxlength="72">
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
  formularioLogin(sb, conteudo, aviso);
}

async function painelExecutivo(sb, conteudo) {
  conteudo.innerHTML = '<div class="g360-estado">Carregando os seus dados…</div>';
  let eu; let clientes; let comissoes;
  try {
    const [r1, r2, r3] = await Promise.all([
      sb.from('executivos').select('id, codigo, nome').limit(1),
      sb.from('executivo_clientes').select('id, razao_social, situacao, inicio, fim, criado_em').order('criado_em', { ascending: false }).limit(1000),
      sb.from('comissoes').select('id, pedido_data, pedido_numero, competencia, base, percentual, valor, situacao, paga_em').order('pedido_data', { ascending: false }).limit(5000),
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
  const meses = new Map();
  for (const c of comissoes) { const k = String(c.competencia).slice(0, 7); const l = meses.get(k) || []; l.push(c); meses.set(k, l); }
  const validas = (l) => l.filter((c) => c.situacao !== 'cancelada');
  const totais = (l) => ({
    vendas: soma(validas(l).map((c) => c.base)),
    prevista: soma(l.filter((c) => ['prevista', 'faturada'].includes(c.situacao)).map((c) => c.valor)),
    liberada: soma(l.filter((c) => c.situacao === 'liberada').map((c) => c.valor)),
    paga: soma(l.filter((c) => c.situacao === 'paga').map((c) => c.valor)),
  });
  const geral = totais(comissoes);

  conteudo.innerHTML = `
    <div class="exa-topo"><div><b>Olá, ${esc(eu.nome.split(' ')[0])}!</b><small>Seu código: <span class="exa-cod">${esc(eu.codigo)}</span></small></div><button type="button" class="g360-btn sec" id="exSair">Sair</button></div>
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
      <p class="g360-info g360-esquerda">Prevista: pedido feito pelo portal, aguardando conferência. Liberada: pronta para pagar. A base é o valor dos produtos, sem frete.</p>
      ${meses.size ? [...meses.entries()].map(([k, l]) => { const t = totais(l); return `<details class="exa-mes"><summary><span>${esc(nomeMes(k))}</span><span>vendas ${esc(dinheiro(t.vendas))} · comissão ${esc(dinheiro(soma([t.prevista, t.liberada, t.paga])))}</span></summary>
        <div class="exa-ped">${l.map((c) => `<div class="exa-l${c.situacao === 'cancelada' ? ' off' : ''}"><span>${esc(dataBr(c.pedido_data))} · pedido ${esc(c.pedido_numero || 'em aprovação')}<small>vendas ${esc(dinheiro(c.base))} × ${esc(String(Number(c.percentual)).replace('.', ','))}%</small></span><span><b>${esc(dinheiro(c.valor))}</b><small>${esc({ prevista: 'Prevista', faturada: 'Prevista', liberada: 'Liberada', paga: `Paga${c.paga_em ? ` em ${dataBr(c.paga_em)}` : ''}`, cancelada: 'Cancelada' }[c.situacao] || c.situacao)}</small></span></div>`).join('')}</div></details>`; }).join('') : '<p class="g360-info g360-esquerda">Ainda não há comissões. Elas aparecem quando um cliente indicado por você faz um pedido pelo portal.</p>'}
    </section>
    <section class="exa-bloco" aria-labelledby="exaCliT">
      <h2 id="exaCliT">Clientes indicados (${clientes.length})</h2>
      ${clientes.length ? `<div class="exa-cli">${clientes.map((c) => `<div class="exa-l"><span>${esc(c.razao_social || 'Cliente')}<small>${c.inicio ? `desde ${esc(dataBr(c.inicio))}${c.fim ? ` · até ${esc(dataBr(c.fim))}` : ''}` : `indicado em ${esc(dataBr(String(c.criado_em).slice(0, 10)))}`}</small></span><span class="exa-st ${esc(c.situacao)}">${esc(SITV[c.situacao] || c.situacao)}</span></div>`).join('')}</div>`
        : '<p class="g360-info g360-esquerda">Nenhum cliente ainda. Mande o seu link para as empresas que você conhece.</p>'}
    </section>`;
  conteudo.querySelector('#exSair').onclick = () => sair(sb, conteudo, 'Você saiu da área do executivo.');
  conteudo.querySelector('#exCopiar').onclick = async (ev) => {
    const b = ev.currentTarget;
    try { await navigator.clipboard.writeText(link); b.textContent = 'Link copiado ✓'; }
    catch { const r = document.createRange(); r.selectNodeContents(conteudo.querySelector('#exLink')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Link selecionado: copie'; }
    setTimeout(() => { b.textContent = 'Copiar link'; }, 2500);
  };
}
