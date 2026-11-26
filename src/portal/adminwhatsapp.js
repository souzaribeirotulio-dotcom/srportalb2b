/* Painel: aba Remarketing (WhatsApp e e-mail).
   Liga e desliga cada gatilho, escolhe os canais, ajusta prazo e textos, roda agora (simulação ou envio)
   e mostra os últimos envios. Cada canal só envia de verdade quando está pronto e ligado:
   WhatsApp com a API do parceiro nos segredos; e-mail com o Resend (o mesmo dos e-mails de senha).
   Fora disso, o canal fica em simulação: o painel mostra quem receberia, mas nada sai. */
import { chamarWhatsapp } from '../api/whatsapp.js';
import { esc, toast } from './comum.js';

const ROT = { cadastro_sem_senha: 'Cadastrou e não criou a senha', sem_primeira_compra: 'Entrou e ainda não comprou', carrinho_abandonado: 'Deixou itens no carrinho' };
const MODO = { simulado: 'Simulação', enviado: 'Enviado', erro: 'Erro' };
const ICONE = { whatsapp: '💬', email: '✉️' };
const quando = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const contatoDe = (x) => (x.canal === 'email' ? (x.email_mascara || 'e-mail') : `final ${x.telefone_final || '----'}`);

export async function desenharWhatsappPainel(alvo, { token, aoEncerrar }) {
  let cfg = null; let envios = null; let saidas = null; let erro = ''; let ultimaRodada = null;
  const chamar = async (acao, dados) => {
    try { return await chamarWhatsapp(token, acao, dados); } catch (e) { if (e.status === 401) aoEncerrar?.(e.message); throw e; }
  };
  const carregar = async () => {
    try {
      const [c, e, s] = await Promise.all([chamar('config_ler'), chamar('envios_listar'), chamar('saidas_listar')]);
      cfg = c.dados; envios = e.dados; saidas = s.dados; erro = '';
    } catch (e) { erro = e.message; }
    pintar();
  };

  const situacao = (pronto, ligado, nome, falta) => (!pronto ? `<li><b>${nome}:</b> 🧪 simulação — ${falta}</li>`
    : ligado ? `<li><b>${nome}:</b> 🟢 enviando de verdade</li>` : `<li><b>${nome}:</b> 🧪 simulação — pronto, falta ligar abaixo</li>`);

  const cartaoGatilho = (k) => {
    const g = cfg.gatilhos[k]; const d = cfg.definicoes[k]; const cx = g.canais || {};
    return `<div class="wpp-g${g.ativo ? ' on' : ''}" data-g="${esc(k)}">
      <label class="wpp-liga"><input type="checkbox" data-ativo ${g.ativo ? 'checked' : ''}> <b>${esc(d.rotulo)}</b></label>
      <div class="row wpp-canais" style="gap:14px;flex-wrap:wrap">
        <label class="wpp-liga"><input type="checkbox" data-canal="whatsapp" ${cx.whatsapp ? 'checked' : ''}> 💬 WhatsApp</label>
        <label class="wpp-liga"><input type="checkbox" data-canal="email" ${cx.email ? 'checked' : ''}> ✉️ E-mail</label>
      </div>
      <div class="fgrid">
        <div><label>Mandar depois de</label><div class="row" style="gap:6px;align-items:center"><input class="inp" data-espera type="number" min="${d.min}" max="${d.max}" value="${Number(g.espera)}" style="max-width:90px"> <span class="hint" style="margin:0">${esc(d.unidade)}</span></div></div>
      </div>
      <div class="wpp-bloco" data-bloco="whatsapp" ${cx.whatsapp ? '' : 'hidden'}>
        <div class="fgrid">
          <div><label>Nome do modelo aprovado na Meta</label><input class="inp" data-modelo maxlength="80" value="${esc(g.modelo || '')}" placeholder="ex.: acesso_pronto" spellcheck="false" autocapitalize="off"></div>
          <div class="full"><label>Mensagem do WhatsApp</label><textarea class="inp" data-texto rows="3" maxlength="700">${esc(g.texto)}</textarea></div>
        </div>
      </div>
      <div class="wpp-bloco" data-bloco="email" ${cx.email ? '' : 'hidden'}>
        <div class="fgrid">
          <div class="full"><label>Assunto do e-mail</label><input class="inp" data-assunto maxlength="120" value="${esc(g.assunto || '')}"></div>
          <div class="full"><label>Texto do e-mail</label><textarea class="inp" data-email-texto rows="5" maxlength="2000">${esc(g.email_texto || '')}</textarea>
            <small class="hint" style="display:block;margin-top:4px">O e-mail sai com o visual do portal, o botão "Entrar no portal" e o link "Não quero mais receber". Deixe uma linha em branco entre os parágrafos.</small></div>
        </div>
      </div>
      <small class="hint" style="display:block;margin-top:6px">Use {nome} (primeiro nome do responsável), {empresa} e {portal} (endereço do portal).</small>
    </div>`;
  };

  function pintar() {
    if (!cfg) { alvo.innerHTML = `<div class="hint">${erro ? `<span class="okmsg bad">${esc(erro)}</span>` : 'Carregando…'}</div>`; return; }
    const realW = cfg.provedor_pronto && cfg.envio_ligado; const realE = cfg.email_pronto && cfg.email_ligado;
    alvo.innerHTML = `
      <div class="wpp-topo ${realW || realE ? 'real' : 'sim'}">
        <b>📣 Remarketing</b>
        <ul class="wpp-sit">
          ${situacao(cfg.provedor_pronto, cfg.envio_ligado, 'WhatsApp', 'falta cadastrar a API do parceiro')}
          ${situacao(cfg.email_pronto, cfg.email_ligado, 'E-mail', 'o Resend não está configurado nos segredos')}
        </ul>
        <small>${cfg.com_aceite} cliente${cfg.com_aceite === 1 ? '' : 's'} cadastrado${cfg.com_aceite === 1 ? '' : 's'} pelo portal entra${cfg.com_aceite === 1 ? '' : 'm'} no remarketing.${cfg.email_pronto ? ` E-mails saem como ${esc(cfg.remetente || '')}.` : ''}</small>
      </div>
      ${erro ? `<div class="okmsg bad">${esc(erro)}</div>` : ''}
      <div class="wpp-gs">${Object.keys(cfg.definicoes).map(cartaoGatilho).join('')}</div>
      <div class="fgrid" style="margin-top:12px">
        <div><label for="wpInt">Intervalo mínimo entre mensagens para a mesma pessoa (em cada canal)</label><div class="row" style="gap:6px;align-items:center"><input class="inp" id="wpInt" type="number" min="1" max="30" value="${Number(cfg.intervalo_dias)}" style="max-width:90px"> <span class="hint" style="margin:0">dias</span></div></div>
        <div style="display:grid;gap:2px;align-content:end">
          <label class="wpp-liga"><input type="checkbox" id="wpLigEmail" ${cfg.email_ligado ? 'checked' : ''} ${cfg.email_pronto ? '' : 'disabled'}> <b>✉️ E-mail ligado</b></label>
          <label class="wpp-liga"><input type="checkbox" id="wpLig" ${cfg.envio_ligado ? 'checked' : ''} ${cfg.provedor_pronto ? '' : 'disabled'}> <b>💬 WhatsApp ligado</b> ${cfg.provedor_pronto ? '' : '<small class="hint">(depende da API do parceiro)</small>'}</label>
        </div>
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn pri" id="wpSalvar" type="button">Salvar</button>
        <button class="tool" id="wpSim" type="button">🧪 Simular agora</button>
        ${realW || realE ? '<button class="tool" id="wpReal" type="button">📤 Enviar agora</button>' : ''}
      </div>
      <div id="wpRes" class="okmsg" aria-live="polite">${ultimaRodada ? esc(ultimaRodada) : ''}</div>
      ${cfg.atualizado_em ? `<small class="hint">Última alteração: ${esc(quando(cfg.atualizado_em))}${cfg.atualizado_por ? ` por ${esc(cfg.atualizado_por)}` : ''}</small>` : ''}

      <h3 class="wpp-h">Últimos envios</h3>
      ${envios?.length ? `<div class="wpp-lista">${envios.map((e) => `<div class="wpp-l"><span><b>${ICONE[e.canal] || ''} ${esc(e.empresa || 'Cliente')}</b><small>${esc(ROT[e.gatilho] || e.gatilho)} · ${esc(contatoDe(e))} · ${esc(quando(e.criado_em))}</small></span><span class="wpp-m ${esc(e.modo)}" title="${esc(e.detalhe || '')}">${esc(MODO[e.modo] || e.modo)}</span></div>`).join('')}</div>`
        : '<div class="hint">Nenhum envio ainda. Ligue um gatilho, salve e toque em "Simular agora".</div>'}

      <h3 class="wpp-h">Não mandar mais para</h3>
      <div class="row" style="gap:6px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1 1 200px"><label for="wpSaiTel">Celular com DDD ou e-mail</label><input class="inp" id="wpSaiTel" maxlength="160" placeholder="(34) 99999-0000 ou nome@empresa.com" autocapitalize="off" spellcheck="false"></div>
        <button class="tool" id="wpSaiOk" type="button">Não mandar mais</button>
      </div>
      <small class="hint" style="display:block;margin-top:4px">Use quando o cliente pedir para sair. Pelo e-mail, ele mesmo sai tocando em "Não quero mais receber".</small>
      ${saidas?.length ? `<div class="wpp-lista" style="margin-top:8px">${saidas.map((s) => `<div class="wpp-l"><span>${ICONE[s.canal] || ''} ${esc(s.canal === 'email' ? (s.email_mascara || 'E-mail (pelo link)') : `Final ${s.telefone_final || '----'}`)}<small>${esc(s.motivo || '')} · ${esc(quando(s.criado_em))}</small></span></div>`).join('')}</div>` : ''}`;

    alvo.querySelectorAll('[data-ativo]').forEach((c) => c.addEventListener('change', () => c.closest('.wpp-g').classList.toggle('on', c.checked)));
    alvo.querySelectorAll('[data-canal]').forEach((c) => c.addEventListener('change', () => { c.closest('.wpp-g').querySelector(`[data-bloco="${c.dataset.canal}"]`).hidden = !c.checked; }));
    const lerForm = () => {
      const gatilhos = {};
      alvo.querySelectorAll('.wpp-g').forEach((el) => {
        gatilhos[el.dataset.g] = {
          ativo: el.querySelector('[data-ativo]').checked, espera: Number(el.querySelector('[data-espera]').value),
          canais: { whatsapp: el.querySelector('[data-canal="whatsapp"]').checked, email: el.querySelector('[data-canal="email"]').checked },
          modelo: el.querySelector('[data-modelo]').value.trim(), texto: el.querySelector('[data-texto]').value.trim(),
          assunto: el.querySelector('[data-assunto]').value.trim(), email_texto: el.querySelector('[data-email-texto]').value.trim(),
        };
      });
      return { gatilhos, intervalo_dias: Number(alvo.querySelector('#wpInt').value), envio_ligado: alvo.querySelector('#wpLig').checked, email_ligado: alvo.querySelector('#wpLigEmail').checked };
    };
    alvo.querySelector('#wpSalvar').onclick = async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Salvando…';
      try { cfg = { ...cfg, ...(await chamar('config_salvar', lerForm())).dados }; erro = ''; toast('Remarketing salvo ✓'); }
      catch (e) { erro = e.message; }
      pintar();
    };
    const rodar = async (simular, b) => {
      b.disabled = true; const antes = b.textContent; b.textContent = simular ? 'Simulando…' : 'Enviando…';
      try {
        const r = (await chamar('rodar', { simular })).dados;
        const partes = [];
        if (r.simulados) partes.push(`${r.simulados} simulada${r.simulados === 1 ? '' : 's'}`);
        if (r.enviados) partes.push(`${r.enviados} enviada${r.enviados === 1 ? '' : 's'}`);
        if (r.erros) partes.push(`${r.erros} com erro`);
        if (r.pulados) partes.push(`${r.pulados} pulada${r.pulados === 1 ? '' : 's'} (já recebeu, saiu da lista ou dentro do intervalo)`);
        ultimaRodada = r.candidatos === 0 ? 'Ninguém se encaixa nos gatilhos ligados agora.' : `${r.candidatos} cliente${r.candidatos === 1 ? '' : 's'} na fila — mensagens: ${partes.join(' · ') || 'nenhuma'}.`;
        envios = (await chamar('envios_listar')).dados; erro = '';
      } catch (e) { erro = e.message; }
      b.textContent = antes; pintar();
    };
    alvo.querySelector('#wpSim').onclick = (ev) => rodar(true, ev.currentTarget);
    alvo.querySelector('#wpReal')?.addEventListener('click', (ev) => rodar(false, ev.currentTarget));
    alvo.querySelector('#wpSaiOk').onclick = async (ev) => {
      const contato = alvo.querySelector('#wpSaiTel').value.trim();
      const b = ev.currentTarget; b.disabled = true;
      try { await chamar('saida_adicionar', { contato }); saidas = (await chamar('saidas_listar')).dados; erro = ''; toast('Esse contato não recebe mais ✓'); }
      catch (e) { erro = e.message; }
      pintar();
    };
  }

  pintar();
  await carregar();
}
