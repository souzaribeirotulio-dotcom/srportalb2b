/* =====================================================================
   Cadastro de endereço de entrega (POST enderecos), em passos simples:
   1. CEP: GET enderecos/cep/{cep} devolve rua, bairro, cidade e UF já com os
      códigos do G360. Pelo CEP, grava-se sem cidade_id: a API resolve cidade e
      bairro (e cadastra o bairro que faltar).
   2. CEP geral da cidade (sem bairro/rua): o comprador escolhe o bairro na lista
      do G360 (GET enderecos/referencias) e digita a rua.
   3. CEP fora do ar ou não encontrado: preenchimento manual escolhendo cidade e
      bairro nas referências (envia cidade_id, bairro_id, UF e rua).
   ===================================================================== */
import { buscarReferenciasEndereco, incluirEndereco, consultarEnderecoCep } from '../api/g360.js';
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
  let pelCep = null; // resposta de GET enderecos/cep quando o CEP foi encontrado
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

    <div id="eCepCidade" class="status-cep" hidden></div>
    <div class="grade3" id="eManualCid">
      <div><label for="eCidQ">Cidade</label><div id="eCidBox"></div><div class="campo-erro" id="eCidErr"></div></div>
      <div><label for="eUf">UF</label><select class="inp" id="eUf">${UFS.map((u) => `<option ${u === 'MG' ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
    </div>
    <div id="eBaiWrap"><label for="eBaiQ">Bairro</label><div id="eBaiBox"></div><div class="campo-erro" id="eBaiErr"></div></div>

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
          const r = await buscarReferenciasEndereco(sessao.token, tipo, q.slice(0, 70), tipo === 'cidade' ? $('eUf').value : undefined);
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

  /** Mostra os campos do modo: pelo CEP (cidade fixa, bairro só se o CEP for geral) ou manual. */
  function modo(m) {
    const manual = m === 'manual';
    $('eManualCid').hidden = !manual;
    $('eCepCidade').hidden = manual || !pelCep;
    $('eBaiWrap').hidden = !manual && !!pelCep?.bairro?.nome;
  }

  /* ---- CEP (pela API do G360) ---- */
  const cep = $('eCep');
  let consulta = 0;
  cep.addEventListener('input', async () => {
    const d = cep.value.replace(/\D/g, '').slice(0, 8);
    cep.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
    erro('eCep', '');
    pelCep = null; escolha.bairro = null; bairro.desenhar(); modo('manual');
    if (d.length !== 8) { $('eCepSt').textContent = ''; return; }
    const minha = ++consulta;
    $('eCepSt').textContent = 'Procurando o CEP…';
    try {
      const r = await consultarEnderecoCep(sessao.token, d);
      if (minha !== consulta) return;
      pelCep = r;
      if (r.logradouro) $('eRua').value = r.logradouro;
      $('eCepSt').textContent = '';
      $('eCepCidade').innerHTML = `<b>${esc(r.cidade?.nome || '')}${r.uf ? ` · ${esc(r.uf)}` : ''}</b>${r.bairro?.nome ? ` — bairro ${esc(r.bairro.nome)}` : ''}`;
      if (!r.bairro?.nome) $('eCepSt').textContent = 'Este CEP atende à cidade inteira: escolha o bairro e digite a rua.';
      modo('cep');
      ($('eRua').value ? $('eNum') : $('eRua')).focus();
    } catch (e) {
      if (minha !== consulta) return;
      pelCep = null; modo('manual');
      // CEP_NAO_ENCONTRADO / CEP_INDISPONIVEL: mensagem da API e preenchimento manual pelas referências.
      $('eCepSt').innerHTML = `${esc(e?.message || 'Não deu para consultar o CEP agora.')} Preencha cidade e bairro abaixo.`;
    }
  });
  modo('manual');

  /* ---- salvar ---- */
  $('eCancelar').onclick = () => aoCancelar();
  $('eSalvar').onclick = async () => {
    ['eCep', 'eRua', 'eNum', 'eCid', 'eBai', 'eDesc'].forEach((i) => erro(i, ''));
    $('eRes').innerHTML = '';
    const corpo = { descricao: $('eDesc').value.trim(), numero: $('eNum').value.trim(), cep: cep.value.trim() };
    const rua = $('eRua').value.trim(); if (rua) corpo.endereco = rua;
    const comp = $('eComp').value.trim(); if (comp) corpo.complemento = comp;
    let primeiro = null;
    const falta = (id, msg) => { erro(id, msg); if (!primeiro) primeiro = id; };
    if (!/^[0-9]{5}-?[0-9]{3}$/.test(corpo.cep)) falta('eCep', 'Digite o CEP com 8 números.');
    if (!rua) falta('eRua', 'Digite a rua ou avenida.');
    if (!corpo.numero) falta('eNum', 'Digite o número (ou S/N).');
    if (pelCep) {
      // Pelo CEP: sem cidade_id; no CEP geral, o bairro escolhido na lista.
      if (!pelCep.bairro?.nome) { if (!escolha.bairro) falta('eBai', 'Busque e toque no bairro.'); else corpo.bairro_id = escolha.bairro.id; }
    } else {
      if (!escolha.cidade) falta('eCid', 'Busque e toque na cidade.');
      if (!escolha.bairro) falta('eBai', 'Busque e toque no bairro.');
      Object.assign(corpo, { cidade_id: escolha.cidade?.id, bairro_id: escolha.bairro?.id, uf: $('eUf').value });
    }
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
