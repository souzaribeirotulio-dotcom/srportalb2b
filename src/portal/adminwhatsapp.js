/* Painel: aba Remarketing (WhatsApp e e-mail).
   Liga e desliga cada gatilho, escolhe os canais, ajusta prazo e textos, roda agora (simulação ou envio)
   e mostra os últimos envios. Cada canal só envia de verdade quando está pronto e ligado:
   WhatsApp com a API do parceiro nos segredos; e-mail com o Resend (o mesmo dos e-mails de senha).
   Fora disso, o canal fica em simulação: o painel mostra quem receberia, mas nada sai. */
import { chamarWhatsapp } from '../api/whatsapp.js';
import { esc, toast } from './comum.js';

const ROT = { cadastro_sem_senha: 'Cadastrou e não criou a senha', sem_primeira_compra: 'Entrou e ainda não comprou', carrinho_abandonado: 'Deixou itens no carrinho', manual: 'Envio manual' };
const MODO = { simulado: 'Simulação', enviado: 'Enviado', erro: 'Erro' };
const ICONE = { whatsapp: '💬', email: '✉️' };
const quando = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const contatoDe = (x) => (x.canal === 'email' ? (x.email_mascara || 'e-mail') : `final ${x.telefone_final || '----'}`);

export async function desenharWhatsappPainel(alvo, { token, aoEncerrar }) {
  let cfg = null; let envios = null; let saidas = null; let erro = ''; let ultimaRodada = null;
  // Envio manual: o rascunho fica aqui enquanto a aba está aberta (a tela redesenha a cada ação).
  const novaCampanha = () => (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`).toLowerCase();
  const manual = { canal: 'email', publico: 'todos', cidade: '', assunto: '', texto: '', modelo: '', para: '', id: novaCampanha(), total: null, msg: '', msgErro: false, confirmando: false };
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

      <h3 class="wpp-h">✍️ Envio manual</h3>
      <div class="wpp-g on" id="wmBox">
        <div class="fgrid">
          <div><label for="wmCanal">Canal</label><select class="inp" id="wmCanal"><option value="email"${manual.canal === 'email' ? ' selected' : ''}>✉️ E-mail</option><option value="whatsapp"${manual.canal === 'whatsapp' ? ' selected' : ''}>💬 WhatsApp</option></select></div>
          <div><label for="wmPub">Quem recebe</label><select class="inp" id="wmPub">
            <option value="todos"${manual.publico === 'todos' ? ' selected' : ''}>Todos os cadastrados pelo portal</option>
            <option value="aprovados"${manual.publico === 'aprovados' ? ' selected' : ''}>Só os aprovados (já são clientes)</option>
            <option value="pendentes"${manual.publico === 'pendentes' ? ' selected' : ''}>Só os pendentes (ainda não aprovados)</option></select></div>
          <div><label for="wmCid">Cidade (opcional)</label><input class="inp" id="wmCid" maxlength="60" value="${esc(manual.cidade)}" placeholder="Ex.: Uberlândia"></div>
          <div class="full" ${manual.canal === 'email' ? '' : 'hidden'}><label for="wmAss">Assunto</label><input class="inp" id="wmAss" maxlength="120" value="${esc(manual.assunto)}" placeholder="Ex.: {nome}, ofertas da semana na Souza Ribeiro"></div>
          <div ${manual.canal === 'whatsapp' ? '' : 'hidden'}><label for="wmMod">Nome do modelo aprovado na Meta</label><input class="inp" id="wmMod" maxlength="80" value="${esc(manual.modelo)}" spellcheck="false" autocapitalize="off"></div>
          <div class="full"><label for="wmTxt">Mensagem</label><textarea class="inp" id="wmTxt" rows="5" maxlength="2000" placeholder="Use {nome}, {empresa} e {portal}.">${esc(manual.texto)}</textarea></div>
        </div>
        <div class="row" style="gap:6px;flex-wrap:wrap;align-items:flex-end;margin-top:10px">
          <div style="flex:1 1 200px"><label for="wmPara">Mandar um teste para</label><input class="inp" id="wmPara" maxlength="160" value="${esc(manual.para)}" placeholder="${manual.canal === 'email' ? 'seu@email.com' : '(34) 99999-0000'}" autocapitalize="off" spellcheck="false"></div>
          <button class="tool" id="wmTeste" type="button">Mandar teste</button>
        </div>
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="tool" id="wmContar" type="button">Ver quantos recebem</button>
          ${manual.total ? `<button class="btn ${manual.confirmando ? 'perigo' : 'pri'}" id="wmEnviar" type="button">${manual.confirmando ? `Toque de novo para enviar a ${Math.min(manual.total, 100)}` : `Enviar para ${Math.min(manual.total, 100)}${manual.total > 100 ? ` (de ${manual.total})` : ''}`}</button>` : ''}
          <button class="tool" id="wmNova" type="button">Nova mensagem</button>
        </div>
        <div id="wmRes" class="okmsg${manual.msgErro ? ' bad' : ''}" aria-live="polite">${esc(manual.msg)}</div>
        <small class="hint" style="display:block">Quem saiu da lista não recebe. O envio vai em lotes de até 100; se sobrar gente, toque de novo para mandar o próximo lote, sem repetir quem já recebeu.</small>
      </div>

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
      alvo.querySelectorAll('.wpp-g[data-g]').forEach((el) => {
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
    // ---- envio manual ----
    const lerManual = () => {
      const antes = JSON.stringify([manual.canal, manual.publico, manual.cidade, manual.assunto, manual.texto, manual.modelo]);
      manual.canal = alvo.querySelector('#wmCanal').value; manual.publico = alvo.querySelector('#wmPub').value;
      manual.cidade = alvo.querySelector('#wmCid').value.trim(); manual.assunto = alvo.querySelector('#wmAss').value.trim();
      manual.texto = alvo.querySelector('#wmTxt').value.trim(); manual.modelo = alvo.querySelector('#wmMod').value.trim(); manual.para = alvo.querySelector('#wmPara').value.trim();
      // Mudou a mensagem ou o público: é outra campanha (o próximo lote não mistura com a anterior).
      if (antes !== JSON.stringify([manual.canal, manual.publico, manual.cidade, manual.assunto, manual.texto, manual.modelo])) { manual.total = null; manual.confirmando = false; }
    };
    const dadosManual = () => ({ canal: manual.canal, publico: manual.publico, cidade: manual.cidade, assunto: manual.assunto, texto: manual.texto, modelo: manual.modelo, campanha: manual.id });
    ['#wmCanal', '#wmPub', '#wmCid', '#wmAss', '#wmTxt', '#wmMod', '#wmPara'].forEach((sel) => alvo.querySelector(sel).addEventListener('change', () => { const canalAntes = manual.canal; lerManual(); if (sel === '#wmCanal' && canalAntes !== manual.canal) pintar(); }));
    const avisar = (t, ruim = false) => { manual.msg = t; manual.msgErro = ruim; };
    alvo.querySelector('#wmContar').onclick = async (ev) => {
      lerManual(); const b = ev.currentTarget; b.disabled = true;
      try {
        const r = (await chamar('manual_contar', dadosManual())).dados; manual.total = r.total; manual.confirmando = false;
        avisar(r.total ? `${r.total} pessoa${r.total === 1 ? '' : 's'} vai${r.total === 1 ? '' : 'o'} receber${r.ja_enviados ? ` (${r.ja_enviados} já receberam esta mensagem)` : ''}.${r.pronto ? '' : ' Atenção: este canal ainda não está pronto para enviar.'}` : (r.ja_enviados ? 'Todos desse público já receberam esta mensagem.' : 'Ninguém para receber com esse público.'));
      } catch (e) { manual.total = null; avisar(e.message, true); }
      pintar();
    };
    alvo.querySelector('#wmTeste').onclick = async (ev) => {
      lerManual(); const b = ev.currentTarget; b.disabled = true; b.textContent = 'Mandando…';
      try { avisar((await chamar('manual_teste', { ...dadosManual(), para: manual.para })).mensagem || 'Teste enviado.'); } catch (e) { avisar(e.message, true); }
      pintar();
    };
    alvo.querySelector('#wmEnviar')?.addEventListener('click', async (ev) => {
      lerManual();
      if (!manual.confirmando) { manual.confirmando = true; pintar(); return; }
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Enviando… não feche a página';
      try {
        const r = (await chamar('manual_enviar', { ...dadosManual(), confirmar: true })).dados;
        manual.total = r.restantes || null; manual.confirmando = false;
        avisar(`${r.enviados} enviada${r.enviados === 1 ? '' : 's'}${r.erros ? ` · ${r.erros} com erro` : ''}.${r.restantes ? ` Faltam ${r.restantes}: toque em "Enviar" de novo para o próximo lote.` : ' Pronto, todos receberam.'}`, r.erros > 0 && !r.enviados);
        envios = (await chamar('envios_listar')).dados;
      } catch (e) { manual.confirmando = false; avisar(e.message, true); }
      pintar();
    });
    alvo.querySelector('#wmNova').onclick = () => { Object.assign(manual, { assunto: '', texto: '', modelo: '', id: novaCampanha(), total: null, msg: '', msgErro: false, confirmando: false }); pintar(); };

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
