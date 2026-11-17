/* =====================================================================
   Ficha do cliente no G360, aberta pelo painel (contrato 2026.11.17 noite):
   GET/PUT operadores/clientes/{cliente} e PUT .../acesso.
   - edição só com pode_alterar (00502); IE só leitura com ie_travada;
   - endereço pelo CEP da API (sem cidade_id); CEP geral → bairro na lista e rua;
     CEP fora do ar → cidade e bairro pelas referências (com IDs e UF);
   - grava só o que mudou, com a versao lida; DOCUMENTO_REPETIDO pede
     confirmação; CADASTRO_ALTERADO recarrega a ficha;
   - Liberar / Bloquear acesso com a revisao; depois de liberar, link de
     primeiro acesso (ponte-g360, pedir_link).
   O roteiro numa tela: CNPJ → ficha → corrigir e-mail → liberar → enviar link.
   ===================================================================== */
import {
  consultarFichaClienteOperador, alterarFichaClienteOperador, alterarAcessoClienteOperador,
  consultarCepOperador, buscarReferenciasOperador,
} from '../api/g360.js';
import { pedirLink } from '../api/ponte.js';
import { mostrarMensagemErro } from '../ui/mensagem.js';
import { $, esc, toast, abrirModal, fecharModal, adiar } from './comum.js';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

/**
 * opcoes: { token: () => string, aoVoltar?: fn, aoMudar?: fn(ficha), aoSessaoEncerrada: fn(erro) }
 */
export async function abrirFichaG360(codigo, opcoes) {
  abrirModal('mAdm');
  const box = $('admBox');
  box.innerHTML = '<div class="empty2">Abrindo a ficha no G360…</div>';
  let ficha;
  try { ficha = await consultarFichaClienteOperador(opcoes.token(), codigo); }
  catch (e) {
    if (e.status === 401) { fecharModal('mAdm'); opcoes.aoSessaoEncerrada?.(e); return; }
    box.innerHTML = `<div class="fxh"><div><h3>Ficha do cliente no G360</h3></div><button class="fxx" id="gX" title="Fechar">×</button></div><div id="gErr"></div>
      <div class="act">${opcoes.aoVoltar ? '<button class="btn sec" id="gVoltar" type="button">‹ Voltar</button>' : ''}</div>`;
    mostrarMensagemErro($('gErr'), e, { aoTentarDeNovo: () => abrirFichaG360(codigo, opcoes) });
    $('gX').onclick = () => fecharModal('mAdm'); if ($('gVoltar')) $('gVoltar').onclick = opcoes.aoVoltar;
    return;
  }
  desenhar(ficha, opcoes);
}

function desenhar(f, opcoes) {
  const box = $('admBox');
  const pode = f.pode_alterar === true;
  const ro = pode ? '' : 'readonly';
  const e = f.endereco || {};
  const req = ' <span class="req">*</span>';
  const inp = (id, v, extra = '') => `<input class="inp" id="${id}" value="${esc(v ?? '')}" ${ro} ${extra}>`;
  const escolha = { cidade: e.cidade?.id ? { id: e.cidade.id, nome: e.cidade.nome } : null, bairro: e.bairro?.id ? { id: e.bairro.id, nome: e.bairro.nome } : null };
  let cepNovo = null; // resposta da consulta de CEP feita nesta tela
  let manual = false;
  box.innerHTML = `<div class="fxh"><div><h3>Ficha do cliente no G360</h3><div class="sub">Cód. ${esc(f.id)} · ${f.tipo_pessoa === 'fisica' ? 'Pessoa física' : 'Pessoa jurídica'} · o que for gravado aqui vai direto para o cadastro do G360.</div></div><button class="fxx" id="gX" title="Fechar">×</button></div>
    ${pode ? '' : '<div class="rv-aviso">Seu usuário do G360 só pode consultar esta ficha (falta o acesso 00502 para alterar).</div>'}
    <div class="csec">Acesso ao portal</div>
    <div class="ci2" style="display:block"><b>${f.acesso_liberado ? '<span class="stt aprovado">Liberado</span>' : '<span class="stt reprovado">Bloqueado</span>'}</b>
      <small style="display:block;margin-top:4px">${f.acesso_liberado ? 'O cliente pode entrar no portal. Bloquear encerra as sessões abertas e invalida os links de acesso pendentes.' : 'Para liberar, o cadastro precisa ter CPF ou CNPJ válido, nome e endereço principal completo. Confira o e-mail antes: é para ele que vai o link de primeiro acesso.'}</small>
      <div class="row" style="margin-top:10px;gap:8px;display:flex;flex-wrap:wrap">
        ${f.pode_alterar_acesso && f.revisao !== null ? (f.acesso_liberado ? '<button class="btn sec" id="gBloq" type="button">Bloquear acesso</button>' : '<button class="btn pri" id="gLib" type="button">Liberar acesso</button>') : `<span class="hint" style="margin:0">${f.revisao === null ? 'Esta base do G360 ainda não permite liberar pelo portal.' : 'Seu usuário não pode alterar o acesso.'}</span>`}
        ${f.acesso_liberado ? '<button class="btn sec" id="gLink" type="button">✉ Enviar link de primeiro acesso</button>' : ''}
        <span class="hint" id="gAcRes" style="margin:0" aria-live="polite"></span></div></div>
    <div class="csec">Cadastro</div>
    <div class="fgrid">
      <div class="full"><label for="gDoc">${f.tipo_pessoa === 'fisica' ? 'CPF' : 'CNPJ'}${req}</label>${inp('gDoc', f.documento, 'maxlength="32" autocapitalize="characters"')}</div>
      <div class="full"><label for="gNome">Nome / razão social${req}</label>${inp('gNome', f.nome, 'maxlength="90"')}</div>
      <div class="full"><label for="gFan">Nome fantasia</label>${inp('gFan', f.fantasia, 'maxlength="90"')}</div>
      <div class="full"><label for="gIe">IE ou RG${req}</label>${inp('gIe', f.ie_rg, `maxlength="26" ${f.ie_travada ? 'readonly title="Cliente com nota emitida: trocar a IE pede o acesso 500085 no G360."' : ''}`)}${f.ie_travada ? '<div class="okmsg" style="color:var(--tx3)">Cliente com nota emitida: a IE só muda com o acesso 500085.</div>' : ''}</div>
      <div class="full"><label for="gEm">E-mail (recebe o link de acesso)</label>${inp('gEm', f.email, 'type="email" maxlength="200"')}</div>
      <div><label for="gT1">Telefone 1</label>${inp('gT1', f.telefone1, 'maxlength="60"')}</div>
      <div><label for="gT2">Telefone 2</label>${inp('gT2', f.telefone2, 'maxlength="60"')}</div>
      <div><label for="gT3">Telefone 3</label>${inp('gT3', f.telefone3, 'maxlength="60"')}</div>
      <div><label for="gCont">Contato</label>${inp('gCont', f.contato, 'maxlength="50"')}</div></div>
    <div class="csec">Endereço principal</div>
    <div class="fgrid">
      <div><label for="gCep">CEP${req}</label>${inp('gCep', e.cep, 'inputmode="numeric" maxlength="9"')}<div class="okmsg" id="gCepM" aria-live="polite"></div></div>
      <div><label for="gNum">Número${req}</label>${inp('gNum', e.numero, 'maxlength="10"')}</div>
      <div class="full"><label for="gLog">Rua / avenida${req}</label>${inp('gLog', e.logradouro, 'maxlength="90"')}</div>
      <div class="full"><label for="gCom">Complemento</label>${inp('gCom', e.complemento, 'maxlength="60"')}</div>
      <div class="full" id="gCidBairro"></div></div>
    <div id="gErr" aria-live="polite"></div>
    <div class="act">${opcoes.aoVoltar ? '<button class="btn sec" id="gVoltar" type="button">‹ Voltar</button>' : '<button class="btn sec" id="gFechar" type="button">Fechar</button>'}${pode ? '<button class="btn pri" id="gSalvar" type="button">Salvar no G360</button>' : ''}</div>`;

  $('gX').onclick = () => fecharModal('mAdm');
  if ($('gVoltar')) $('gVoltar').onclick = opcoes.aoVoltar;
  if ($('gFechar')) $('gFechar').onclick = () => fecharModal('mAdm');

  /* ---- cidade e bairro (mostra o atual; escolha pela lista quando precisa) ---- */
  const cb = $('gCidBairro');
  function pintarCidBairro() {
    const precisaBairro = cepNovo && !cepNovo.bairro?.nome;
    if (!manual && !precisaBairro) {
      const cid = cepNovo ? cepNovo.cidade?.nome : e.cidade?.nome; const uf = cepNovo ? cepNovo.uf : e.uf; const bai = cepNovo ? cepNovo.bairro?.nome : e.bairro?.nome;
      cb.innerHTML = `<div class="ci2" style="display:block;margin:0"><small>Bairro <b>${esc(bai || '—')}</b> · ${esc(cid || '—')}${uf ? ` / ${esc(uf)}` : ''}${cepNovo ? ' <span style="color:var(--lima)">(pelo CEP novo)</span>' : ''}</small>
        ${pode ? '<button type="button" class="tool" id="gManual" style="margin-top:6px">Escolher cidade e bairro na lista</button>' : ''}</div>`;
      if ($('gManual')) $('gManual').onclick = () => { manual = true; pintarCidBairro(); };
      return;
    }
    cb.innerHTML = `${manual ? `<div class="fgrid"><div><label for="gUf">UF${req}</label><select class="inp" id="gUf">${UFS.map((u) => `<option ${u === (e.uf || 'MG') ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
        <div><label>Cidade${req}</label><div id="gCidBox"></div></div></div>` : '<div class="okmsg">Este CEP atende à cidade inteira: escolha o bairro e confira a rua.</div>'}
      <label>Bairro${req}</label><div id="gBaiBox"></div>`;
    if (manual) campo('cidade', $('gCidBox'));
    campo('bairro', $('gBaiBox'));
    if ($('gUf')) $('gUf').onchange = () => { escolha.cidade = null; campo('cidade', $('gCidBox')); };
  }
  function campo(tipo, alvo) {
    const sel = escolha[tipo];
    if (sel) {
      alvo.innerHTML = `<div class="escolhido"><span>✓ ${esc(sel.nome)}</span><button type="button">trocar</button></div>`;
      alvo.querySelector('button').onclick = () => { escolha[tipo] = null; campo(tipo, alvo); };
      return;
    }
    alvo.innerHTML = `<input class="inp" autocomplete="off" maxlength="70" placeholder="Digite para buscar"><ul class="sugestoes" role="listbox"></ul>`;
    const ent = alvo.querySelector('input'); const ul = alvo.querySelector('ul');
    ent.addEventListener('input', adiar(async () => {
      const q = ent.value.trim(); if (q.length < 2) { ul.innerHTML = ''; return; }
      ul.innerHTML = '<li style="padding:8px 10px;color:var(--tx3);font-size:13px">Buscando…</li>';
      try {
        const r = await buscarReferenciasOperador(opcoes.token(), tipo, q.slice(0, 70), tipo === 'cidade' ? $('gUf').value : undefined);
        if (ent.value.trim() !== q) return;
        ul.innerHTML = r.length ? r.map((x) => `<li><button type="button" data-id="${Number(x.id)}" data-nome="${esc(x.nome)}">${esc(x.nome)}</button></li>`).join('') : '<li style="padding:8px 10px;color:var(--tx3);font-size:13px">Nada encontrado.</li>';
        ul.querySelectorAll('button').forEach((b) => { b.onclick = () => { escolha[tipo] = { id: Number(b.dataset.id), nome: b.dataset.nome }; campo(tipo, alvo); }; });
      } catch (err) { ul.innerHTML = `<li style="padding:8px 10px;color:#ffb5ac;font-size:13px">${esc(err.message)}</li>`; }
    }, 400));
  }
  pintarCidBairro();

  /* ---- CEP pela API ---- */
  if (pode) {
    let n = 0;
    $('gCep').addEventListener('input', async () => {
      const d = $('gCep').value.replace(/\D/g, '').slice(0, 8);
      $('gCep').value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
      cepNovo = null; $('gCepM').textContent = '';
      if (d.length !== 8 || d === String(e.cep || '').replace(/\D/g, '')) { pintarCidBairro(); return; }
      const minha = ++n; $('gCepM').className = 'okmsg'; $('gCepM').textContent = 'Procurando o CEP…';
      try {
        const r = await consultarCepOperador(opcoes.token(), d);
        if (minha !== n) return;
        cepNovo = r; manual = false; escolha.bairro = null;
        if (r.logradouro) $('gLog').value = r.logradouro;
        $('gCepM').textContent = '✓ Endereço encontrado'; pintarCidBairro(); $('gNum').focus();
      } catch (err) {
        if (minha !== n) return;
        $('gCepM').className = 'okmsg bad'; $('gCepM').textContent = `${err.message} Escolha cidade e bairro na lista.`;
        manual = true; escolha.cidade = null; escolha.bairro = null; pintarCidBairro();
      }
    });
  }

  /* ---- acesso ---- */
  const acesso = async (liberado, b) => {
    if (!liberado && b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = 'Confirmar bloqueio (encerra sessões e links)'; return; }
    b.disabled = true; $('gAcRes').textContent = 'Gravando no G360…';
    try {
      await alterarAcessoClienteOperador(opcoes.token(), f.id, liberado, f.revisao);
      toast(liberado ? 'Acesso liberado no G360 ✓' : 'Acesso bloqueado no G360');
      recarregar(liberado ? 'Acesso liberado. Agora envie o link de primeiro acesso.' : null);
    } catch (err) {
      b.disabled = false; $('gAcRes').textContent = '';
      if (err.status === 401) { fecharModal('mAdm'); opcoes.aoSessaoEncerrada?.(err); return; }
      if (err.codigo === 'CADASTRO_ALTERADO') { recarregar(err.message); return; }
      mostrarMensagemErro($('gErr'), err);
    }
  };
  if ($('gLib')) $('gLib').onclick = (ev) => acesso(true, ev.currentTarget);
  if ($('gBloq')) $('gBloq').onclick = (ev) => acesso(false, ev.currentTarget);
  if ($('gLink')) $('gLink').onclick = async () => {
    $('gLink').disabled = true; $('gAcRes').textContent = 'Enviando…';
    try { $('gAcRes').textContent = await pedirLink(f.documento); } catch (err) { $('gAcRes').textContent = err.message; } finally { $('gLink').disabled = false; }
  };

  async function recarregar(aviso) {
    try { const nova = await consultarFichaClienteOperador(opcoes.token(), f.id); opcoes.aoMudar?.(nova); desenhar(nova, opcoes); if (aviso) $('gAcRes').textContent = aviso; }
    catch (err) { mostrarMensagemErro($('gErr'), err); }
  }

  /* ---- salvar (só o que mudou) ---- */
  if (!$('gSalvar')) return;
  $('gSalvar').onclick = async (ev) => {
    const b = ev.currentTarget; $('gErr').innerHTML = '';
    const v = (id) => $(id).value.trim();
    const corpo = { versao: f.versao };
    const mudou = (campoApi, valor, original) => { if (valor !== String(original ?? '')) corpo[campoApi] = valor; };
    mudou('documento', v('gDoc'), f.documento); mudou('nome', v('gNome'), f.nome); mudou('fantasia', v('gFan'), f.fantasia);
    if (!f.ie_travada) mudou('ie_rg', v('gIe'), f.ie_rg);
    mudou('email', v('gEm'), f.email); mudou('telefone1', v('gT1'), f.telefone1); mudou('telefone2', v('gT2'), f.telefone2);
    mudou('telefone3', v('gT3'), f.telefone3); mudou('contato', v('gCont'), f.contato);
    const end = {};
    const cepDig = v('gCep').replace(/\D/g, '');
    if (cepDig !== String(e.cep || '').replace(/\D/g, '')) end.cep = cepDig;
    if (v('gLog') !== String(e.logradouro || '')) end.logradouro = v('gLog');
    if (v('gNum') !== String(e.numero || '')) end.numero = v('gNum');
    if (v('gCom') !== String(e.complemento || '')) end.complemento = v('gCom');
    if (manual) {
      if (!escolha.cidade || !escolha.bairro) { $('gErr').innerHTML = '<div class="rv-aviso bad">Escolha a cidade e o bairro na lista.</div>'; return; }
      Object.assign(end, { cep: cepDig, logradouro: v('gLog'), cidade_id: escolha.cidade.id, bairro_id: escolha.bairro.id, uf: $('gUf').value });
    } else if (cepNovo && !cepNovo.bairro?.nome) {
      if (!escolha.bairro) { $('gErr').innerHTML = '<div class="rv-aviso bad">Este CEP atende à cidade inteira: escolha o bairro na lista.</div>'; return; }
      Object.assign(end, { logradouro: v('gLog'), bairro_id: escolha.bairro.id });
    } else if (end.cep) Object.assign(end, { logradouro: v('gLog'), numero: v('gNum'), complemento: v('gCom') });
    if (Object.keys(end).length) corpo.endereco = end;
    const faltando = [!v('gDoc') && 'CPF ou CNPJ', !v('gNome') && 'nome', !v('gIe') && 'IE ou RG', cepDig.length !== 8 && 'CEP', !v('gLog') && 'rua', !v('gNum') && 'número'].filter(Boolean);
    if (faltando.length) { $('gErr').innerHTML = `<div class="rv-aviso bad">Falta preencher: ${esc(faltando.join(', '))}.</div>`; return; }
    if (Object.keys(corpo).length === 1) { toast('Nada mudou na ficha.'); return; }
    const emailMudou = 'email' in corpo;
    const enviar = async (confirmar) => {
      b.disabled = true; b.textContent = 'Gravando no G360…';
      try {
        await alterarFichaClienteOperador(opcoes.token(), f.id, confirmar ? { ...corpo, confirmar_documento_repetido: true } : corpo);
        toast('Ficha gravada no G360 ✓');
        await recarregar(emailMudou && f.acesso_liberado ? 'E-mail alterado: os links pendentes foram invalidados. Envie um link novo.' : null);
      } catch (err) {
        b.disabled = false; b.textContent = 'Salvar no G360';
        if (err.status === 401) { fecharModal('mAdm'); opcoes.aoSessaoEncerrada?.(err); return; }
        if (err.codigo === 'DOCUMENTO_REPETIDO' && !confirmar) {
          $('gErr').innerHTML = `<div class="rv-aviso bad">${esc(err.message)}<div class="row" style="margin-top:8px"><button class="btn sec" type="button" id="gConf">Confirmar e gravar</button></div></div>`;
          $('gConf').onclick = () => enviar(true); return;
        }
        if (err.codigo === 'CADASTRO_ALTERADO') { await recarregar(); mostrarMensagemErro($('gErr'), err); return; }
        mostrarMensagemErro($('gErr'), err);
      }
    };
    enviar(false);
  };
}
