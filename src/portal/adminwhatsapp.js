/* Painel: aba WhatsApp (remarketing).
   Liga e desliga cada gatilho, ajusta prazo e texto, roda agora (simulação ou envio) e mostra os
   últimos envios. Sem a API do parceiro cadastrada nos segredos, tudo fica em modo simulação:
   o painel mostra quem receberia, mas nada é enviado. */
import { chamarWhatsapp } from '../api/whatsapp.js';
import { esc, toast } from './comum.js';

const ROT = { cadastro_sem_senha: 'Cadastrou e não criou a senha', sem_primeira_compra: 'Entrou e ainda não comprou', carrinho_abandonado: 'Deixou itens no carrinho' };
const MODO = { simulado: 'Simulação', enviado: 'Enviado', erro: 'Erro' };
const quando = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

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

  const cartaoGatilho = (k) => {
    const g = cfg.gatilhos[k]; const d = cfg.definicoes[k];
    return `<div class="wpp-g${g.ativo ? ' on' : ''}" data-g="${esc(k)}">
      <label class="wpp-liga"><input type="checkbox" data-ativo ${g.ativo ? 'checked' : ''}> <b>${esc(d.rotulo)}</b></label>
      <div class="fgrid" style="margin-top:8px">
        <div><label>Mandar depois de</label><div class="row" style="gap:6px;align-items:center"><input class="inp" data-espera type="number" min="${d.min}" max="${d.max}" value="${Number(g.espera)}" style="max-width:90px"> <span class="hint" style="margin:0">${esc(d.unidade)}</span></div></div>
        <div><label>Nome do modelo aprovado na Meta</label><input class="inp" data-modelo maxlength="80" value="${esc(g.modelo || '')}" placeholder="ex.: acesso_pronto" spellcheck="false" autocapitalize="off"></div>
        <div class="full"><label>Mensagem</label><textarea class="inp" data-texto rows="3" maxlength="700">${esc(g.texto)}</textarea>
          <small class="hint" style="display:block;margin-top:4px">Use {nome} (primeiro nome do responsável), {empresa} e {portal} (endereço do portal).</small></div>
      </div></div>`;
  };

  function pintar() {
    if (!cfg) { alvo.innerHTML = `<div class="hint">${erro ? `<span class="okmsg bad">${esc(erro)}</span>` : 'Carregando…'}</div>`; return; }
    const simulacao = !cfg.provedor_pronto || !cfg.envio_ligado;
    alvo.innerHTML = `
      <div class="wpp-topo ${simulacao ? 'sim' : 'real'}">
        <b>${simulacao ? '🧪 Modo simulação' : '🟢 Envio ligado'}</b>
        <span>${!cfg.provedor_pronto ? 'A API do parceiro ainda não foi cadastrada. O sistema mostra quem receberia cada mensagem, mas não envia nada.'
          : simulacao ? 'A API do parceiro está pronta. Ligue o envio abaixo quando os modelos estiverem aprovados na Meta.'
          : 'As mensagens dos gatilhos ligados estão saindo pelo WhatsApp.'}</span>
        <small>${cfg.com_aceite} cliente${cfg.com_aceite === 1 ? '' : 's'} aceitou receber pelo WhatsApp no cadastro. Só eles recebem.</small>
      </div>
      ${erro ? `<div class="okmsg bad">${esc(erro)}</div>` : ''}
      <div class="wpp-gs">${Object.keys(cfg.definicoes).map(cartaoGatilho).join('')}</div>
      <div class="fgrid" style="margin-top:12px">
        <div><label for="wpInt">Intervalo mínimo entre mensagens para a mesma pessoa</label><div class="row" style="gap:6px;align-items:center"><input class="inp" id="wpInt" type="number" min="1" max="30" value="${Number(cfg.intervalo_dias)}" style="max-width:90px"> <span class="hint" style="margin:0">dias</span></div></div>
        <div><label class="wpp-liga" style="margin-top:22px"><input type="checkbox" id="wpLig" ${cfg.envio_ligado ? 'checked' : ''} ${cfg.provedor_pronto ? '' : 'disabled'}> <b>Envio ligado</b> ${cfg.provedor_pronto ? '' : '<small class="hint">(depende da API do parceiro)</small>'}</label></div>
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn pri" id="wpSalvar" type="button">Salvar</button>
        <button class="tool" id="wpSim" type="button">🧪 Simular agora</button>
        ${cfg.provedor_pronto && cfg.envio_ligado ? '<button class="tool" id="wpReal" type="button">📤 Enviar agora</button>' : ''}
      </div>
      <div id="wpRes" class="okmsg" aria-live="polite">${ultimaRodada ? esc(ultimaRodada) : ''}</div>
      ${cfg.atualizado_em ? `<small class="hint">Última alteração: ${esc(quando(cfg.atualizado_em))}${cfg.atualizado_por ? ` por ${esc(cfg.atualizado_por)}` : ''}</small>` : ''}

      <h3 class="wpp-h">Últimos envios</h3>
      ${envios?.length ? `<div class="wpp-lista">${envios.map((e) => `<div class="wpp-l"><span><b>${esc(e.empresa || 'Cliente')}</b><small>${esc(ROT[e.gatilho] || e.gatilho)} · final ${esc(e.telefone_final || '----')} · ${esc(quando(e.criado_em))}</small></span><span class="wpp-m ${esc(e.modo)}" title="${esc(e.detalhe || '')}">${esc(MODO[e.modo] || e.modo)}</span></div>`).join('')}</div>`
        : '<div class="hint">Nenhum envio ainda. Ligue um gatilho, salve e toque em "Simular agora".</div>'}

      <h3 class="wpp-h">Não mandar mais para</h3>
      <div class="row" style="gap:6px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1 1 180px"><label for="wpSaiTel">Celular com DDD</label><input class="inp" id="wpSaiTel" inputmode="tel" maxlength="20" placeholder="(34) 99999-0000"></div>
        <button class="tool" id="wpSaiOk" type="button">Não mandar mais</button>
      </div>
      <small class="hint" style="display:block;margin-top:4px">Use quando o cliente pedir para sair. A pessoa sai de todos os gatilhos.</small>
      ${saidas?.length ? `<div class="wpp-lista" style="margin-top:8px">${saidas.map((s) => `<div class="wpp-l"><span>Final ${esc(s.telefone_final || '----')}<small>${esc(s.motivo || '')} · ${esc(quando(s.criado_em))}</small></span></div>`).join('')}</div>` : ''}`;

    alvo.querySelectorAll('[data-ativo]').forEach((c) => c.addEventListener('change', () => c.closest('.wpp-g').classList.toggle('on', c.checked)));
    const lerForm = () => {
      const gatilhos = {};
      alvo.querySelectorAll('.wpp-g').forEach((el) => {
        gatilhos[el.dataset.g] = { ativo: el.querySelector('[data-ativo]').checked, espera: Number(el.querySelector('[data-espera]').value), modelo: el.querySelector('[data-modelo]').value.trim(), texto: el.querySelector('[data-texto]').value.trim() };
      });
      return { gatilhos, intervalo_dias: Number(alvo.querySelector('#wpInt').value), envio_ligado: alvo.querySelector('#wpLig').checked };
    };
    alvo.querySelector('#wpSalvar').onclick = async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Salvando…';
      try { cfg = { ...cfg, ...(await chamar('config_salvar', lerForm())).dados }; erro = ''; toast('WhatsApp salvo ✓'); }
      catch (e) { erro = e.message; }
      pintar();
    };
    const rodar = async (simular, b) => {
      b.disabled = true; const antes = b.textContent; b.textContent = simular ? 'Simulando…' : 'Enviando…';
      try {
        const r = (await chamar('rodar', { simular })).dados;
        ultimaRodada = r.candidatos === 0 ? 'Ninguém se encaixa nos gatilhos ligados agora.'
          : `${r.candidatos} na fila: ${r.simulados ? `${r.simulados} simulado${r.simulados === 1 ? '' : 's'}` : ''}${r.enviados ? `${r.enviados} enviado${r.enviados === 1 ? '' : 's'}` : ''}${r.erros ? ` · ${r.erros} com erro` : ''}${r.pulados ? ` · ${r.pulados} pulado${r.pulados === 1 ? '' : 's'} (já recebeu, saiu da lista ou dentro do intervalo)` : ''}.`;
        envios = (await chamar('envios_listar')).dados; erro = '';
      } catch (e) { erro = e.message; }
      b.textContent = antes; pintar();
    };
    alvo.querySelector('#wpSim').onclick = (ev) => rodar(true, ev.currentTarget);
    alvo.querySelector('#wpReal')?.addEventListener('click', (ev) => rodar(false, ev.currentTarget));
    alvo.querySelector('#wpSaiOk').onclick = async (ev) => {
      const tel = alvo.querySelector('#wpSaiTel').value.trim();
      const b = ev.currentTarget; b.disabled = true;
      try { await chamar('saida_adicionar', { telefone: tel }); saidas = (await chamar('saidas_listar')).dados; erro = ''; toast('Esse número não recebe mais ✓'); }
      catch (e) { erro = e.message; }
      pintar();
    };
  }

  pintar();
  await carregar();
}
