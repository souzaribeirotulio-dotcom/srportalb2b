/* =====================================================================
   Cadastro de endereço de entrega (POST enderecos), em passos simples:
   1. CEP: preenche rua, bairro, cidade e UF pelo ViaCEP (consulta pública,
      só o CEP vai para lá) e já procura cidade e bairro no G360.
   2. Cidade e bairro: busca enquanto digita (GET enderecos/referencias),
      com escolha por toque. Se o CEP achou um nome igual, já vem escolhido.
   3. Rua, número, complemento e nome do endereço.
   Os códigos de cidade e bairro vêm sempre do G360; nada é inventado.
   ===================================================================== */
import { buscarReferenciasEndereco, incluirEndereco } from '../api/g360.js';
import { sessao } from '../estado/sessao.js';
import { mostrarMensagemErro } from '../ui/mensagem.js';
import { esc, adiar } from './comum.js';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const sem = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Monta o formulário em `alvo`. aoSalvar(endereco) recebe o endereço criado; aoCancelar() fecha.
 */
export function formularioEndereco(alvo, { aoSalvar, aoCancelar }) {
  const escolha = { cidade: null, bairro: null };
  alvo.innerHTML = `<div class="end-form" role="group" aria-labelledby="eTit">
    <h4 id="eTit">Novo endereço de entrega</h4>
    <p class="passo">Comece pelo CEP: o resto vem preenchido. Confira e salve.</p>

    <label for="eCep">CEP</label>
    <input class="inp" id="eCep" inputmode="numeric" autocomplete="postal-code" maxlength="9" placeholder="00000-000">
    <div class="status-cep" id="eCepSt" aria-live="polite"></div><div class="campo-erro" id="eCepErr"></div>

    <div class="grade3">
      <div><label for="eRua">Rua / avenida</label><input class="inp" id="eRua" maxlength="90" autocomplete="address-line1"><div class="campo-erro" id="eRuaErr"></div></div>
      <div><label for="eNum">Número</label><input class="inp" id="eNum" maxlength="10" inputmode="text"><div class="campo-erro" id="eNumErr"></div></div>
    </div>
    <label for="eComp">Complemento <span style="text-transform:none;font-weight:400">(opcional)</span></label>
    <input class="inp" id="eComp" maxlength="60" placeholder="Sala, galpão, bloco…">

    <div class="grade3">
      <div><label for="eCidQ">Cidade</label><div id="eCidBox"></div><div class="campo-erro" id="eCidErr"></div></div>
      <div><label for="eUf">UF</label><select class="inp" id="eUf">${UFS.map((u) => `<option ${u === 'MG' ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
    </div>
    <label for="eBaiQ">Bairro</label><div id="eBaiBox"></div><div class="campo-erro" id="eBaiErr"></div>

    <label for="eDesc">Nome deste endereço</label>
    <input class="inp" id="eDesc" maxlength="50" placeholder="Ex.: Depósito, Filial Centro"><div class="campo-erro" id="eDescErr"></div>

    <div id="eRes" aria-live="polite"></div>
    <div class="act"><button type="button" class="btn sec" id="eCancelar">Cancelar</button><button type="button" class="btn pri" id="eSalvar">Salvar e usar este endereço</button></div>
  </div>`;

  const $ = (id) => alvo.querySelector(`#${id}`);
  const erro = (id, msg) => { $(`${id}Err`).textContent = msg || ''; const c = $(id) || $(`${id}Q`); if (c) { if (msg) c.setAttribute('aria-invalid', 'true'); else c.removeAttribute('aria-invalid'); } };

  /* ---- campo de busca com sugestões (cidade ou bairro) ---- */
  function campoBusca(tipo) {
    const box = $(tipo === 'cidade' ? 'eCidBox' : 'eBaiBox');
    const id = tipo === 'cidade' ? 'eCidQ' : 'eBaiQ';
    const desenhar = () => {
      const sel = escolha[tipo];
      if (sel) {
        box.innerHTML = `<div class="escolhido"><span>✓ ${esc(sel.nome)}</span><button type="button">trocar</button></div>`;
        box.querySelector('button').onclick = () => { escolha[tipo] = null; desenhar(); $(id).focus(); };
        return;
      }
      box.innerHTML = `<input class="inp" id="${id}" autocomplete="off" maxlength="70" placeholder="Digite para buscar" aria-autocomplete="list" aria-controls="${id}L"><ul class="sugestoes" id="${id}L" role="listbox"></ul>`;
      const entrada = box.querySelector('input'); const lista = box.querySelector('ul');
      const buscar = adiar(async () => {
        const q = entrada.value.trim();
        if (q.length < 2) { lista.innerHTML = ''; return; }
        lista.innerHTML = '<li style="padding:8px 10px;color:var(--tx3);font-size:13px">Buscando…</li>';
        try {
          const r = await buscarReferenciasEndereco(sessao.token, tipo, semAcento(q).slice(0, 70), tipo === 'cidade' ? $('eUf').value : undefined);
          if (entrada.value.trim() !== q) return;
          lista.innerHTML = r.length ? r.map((x) => `<li><button type="button" role="option" data-id="${Number(x.id)}" data-nome="${esc(x.nome)}">${esc(x.nome)}</button></li>`).join('')
            : `<li style="padding:8px 10px;color:var(--tx3);font-size:13px">Nada encontrado. Confira ${tipo === 'cidade' ? 'o nome e a UF' : 'o nome do bairro'}.</li>`;
          lista.querySelectorAll('button').forEach((b) => b.onclick = () => { escolha[tipo] = { id: Number(b.dataset.id), nome: b.dataset.nome }; erro(id.slice(0, -1), ''); desenhar(); });
        } catch (e) {
          // Erro da API (ex.: 422 DADOS_INVALIDOS): a mensagem dela, não "Nada encontrado".
          if (entrada.value.trim() !== q) return;
          lista.innerHTML = `<li style="padding:8px 10px;color:#ffb5ac;font-size:13px">${esc(e?.message || 'Não foi possível buscar agora.')}${e?.codigo ? ` <small style="color:var(--tx3)">(${esc(e.codigo)}${e.requestId ? ` · ${esc(e.requestId)}` : ''})</small>` : ''}</li>`;
        }
      }, 400);
      entrada.addEventListener('input', buscar);
    };
    return { desenhar, preencher: (texto) => { if (escolha[tipo]) return; desenhar(); const i = box.querySelector('input'); i.value = texto; i.dispatchEvent(new Event('input')); } };
  }
  const cidade = campoBusca('cidade'); const bairro = campoBusca('bairro');
  cidade.desenhar(); bairro.desenhar();
  $('eUf').addEventListener('change', () => { escolha.cidade = null; cidade.desenhar(); });

  /** Procura pelo nome do ViaCEP (sem acento). Um resultado: escolhe. Vários: escolhe o de nome igual; dá para trocar. */
  async function autoEscolher(tipo, nome, uf) {
    const campo = tipo === 'cidade' ? cidade : bairro;
    try {
      const r = await buscarReferenciasEndereco(sessao.token, tipo, semAcento(nome).slice(0, 70), tipo === 'cidade' ? uf : undefined);
      const escolhido = r.length === 1 ? r[0] : r.find((x) => sem(x.nome) === sem(nome));
      if (escolhido) { escolha[tipo] = { id: Number(escolhido.id), nome: escolhido.nome }; campo.desenhar(); return; }
    } catch { /* a busca manual abaixo mostra a mensagem da API */ }
    campo.preencher(nome);
  }

  /* ---- CEP ---- */
  const cep = $('eCep');
  cep.addEventListener('input', async () => {
    const d = cep.value.replace(/\D/g, '').slice(0, 8);
    cep.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
    erro('eCep', '');
    if (d.length !== 8) { $('eCepSt').textContent = ''; return; }
    $('eCepSt').textContent = 'Procurando o CEP…';
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      const j = await r.json();
      if (!r.ok || j.erro) { $('eCepSt').textContent = 'CEP não encontrado. Preencha os campos abaixo.'; return; }
      if (j.logradouro && !$('eRua').value) $('eRua').value = j.logradouro;
      if (j.uf) $('eUf').value = j.uf;
      $('eCepSt').textContent = `${j.localidade || ''}${j.uf ? ` · ${j.uf}` : ''}`;
      escolha.cidade = null; escolha.bairro = null;
      if (j.localidade) await autoEscolher('cidade', j.localidade, j.uf);
      if (j.bairro) await autoEscolher('bairro', j.bairro);
      else bairro.desenhar();
      ($('eRua').value ? $('eNum') : $('eRua')).focus();
    } catch {
      $('eCepSt').textContent = 'Não deu para consultar o CEP agora. Preencha os campos abaixo.';
    }
  });

  /* ---- salvar ---- */
  $('eCancelar').onclick = () => aoCancelar();
  $('eSalvar').onclick = async () => {
    ['eCep', 'eRua', 'eNum', 'eCid', 'eBai', 'eDesc'].forEach((i) => erro(i, ''));
    $('eRes').innerHTML = '';
    const corpo = {
      descricao: $('eDesc').value.trim(), endereco: $('eRua').value.trim(), numero: $('eNum').value.trim(),
      cep: cep.value.trim(), uf: $('eUf').value, cidade_id: escolha.cidade?.id, bairro_id: escolha.bairro?.id,
    };
    const comp = $('eComp').value.trim(); if (comp) corpo.complemento = comp;
    let primeiro = null;
    const falta = (id, msg) => { erro(id, msg); if (!primeiro) primeiro = id; };
    if (!/^[0-9]{5}-?[0-9]{3}$/.test(corpo.cep)) falta('eCep', 'Digite o CEP com 8 números.');
    if (!corpo.endereco) falta('eRua', 'Digite a rua ou avenida.');
    if (!corpo.numero) falta('eNum', 'Digite o número (ou S/N).');
    if (!corpo.cidade_id) falta('eCid', 'Busque e toque na cidade.');
    if (!corpo.bairro_id) falta('eBai', 'Busque e toque no bairro.');
    if (!corpo.descricao) falta('eDesc', 'Dê um nome para reconhecer este endereço.');
    if (primeiro) { (alvo.querySelector(`#${primeiro}`) || alvo.querySelector(`#${primeiro}Q`) || alvo.querySelector(`#${primeiro}Err`))?.focus?.(); return; }
    const b = $('eSalvar'); b.disabled = true; b.textContent = 'Salvando…';
    try {
      const novo = await incluirEndereco(sessao.token, corpo);
      aoSalvar(novo);
    } catch (e) {
      b.disabled = false; b.textContent = 'Salvar e usar este endereço';
      mostrarMensagemErro($('eRes'), e);
    }
  };
  setTimeout(() => cep.focus(), 30);
}
