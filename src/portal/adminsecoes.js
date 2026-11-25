/* Painel › Configurações › Seções (árvore do catálogo: departamento → seção).
   Departamento = categoria do portal. Para cada um: seções, cada uma com as suas palavras.
   Conta ao vivo quantos produtos cada seção pega e mostra os que ficaram sem seção.
   Grava pela função painel-g360 (ação secoes_salvar), que substitui a árvore do departamento. */
import { esc, toast } from './comum.js';
import { carregarExibicao, categorias, secoesDe, termosTexto, termosDeTexto, bateTermos, produtosDaCategoria } from '../catalogo/exibicao.js';

/** Monta o editor em "alvo". painel(acao, dados) chama a função do painel com o token do operador. */
export async function montarEditorSecoes(alvo, { painel }) {
  await carregarExibicao();
  let dep = categorias()[0] || '';
  let arvore = [];           // [{ nome, termos: 'a, b', linhas: [{ nome, termos }] }]
  let mudou = false;

  const ler = () => {
    arvore = secoesDe(dep).map((s) => ({ nome: s.nome, antes: s.nome, termos: termosTexto(s).join(', '), linhas: s.linhas.map((l) => ({ nome: l.nome, termos: termosTexto(l).join(', ') })) }));
    mudou = false;
  };
  const produtos = () => produtosDaCategoria(dep);
  const pega = (lista, termos, mae) => {
    const t = termosDeTexto(termos); const m = mae ? termosDeTexto(mae) : null;
    return t.length ? lista.filter((p) => (!m || bateTermos(p.busca, m)) && bateTermos(p.busca, t)) : [];
  };

  function pintar() {
    const lista = produtos();
    const semSecao = lista.filter((p) => !arvore.some((s) => bateTermos(p.busca, termosDeTexto(s.termos))));
    alvo.innerHTML = `
      <div class="sx-topo"><label for="sxDep" class="hint" style="margin:0">Departamento</label>
        <select class="inp" id="sxDep">${categorias().map((c) => `<option ${c === dep ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <small class="hint" style="margin:0">${lista.length} produtos no departamento</small></div>
      <div class="sx-lista">${arvore.map((s, i) => {
        const n = pega(lista, s.termos).length;
        return `<div class="sx-sec" data-i="${i}">
          <div class="sx-linha1"><input class="inp sx-nome" value="${esc(s.nome)}" maxlength="40" aria-label="Nome da seção" placeholder="Nome da seção">
            <span class="sx-n ${n ? '' : 'zero'}">${n} produto${n === 1 ? '' : 's'}</span>
            <button class="tool" type="button" data-up ${i ? '' : 'disabled'} aria-label="Subir">↑</button><button class="tool" type="button" data-dn ${i < arvore.length - 1 ? '' : 'disabled'} aria-label="Descer">↓</button><button class="tool" type="button" data-rm style="color:#ff8a8a" aria-label="Remover seção">×</button></div>
          <input class="inp sx-termos" value="${esc(s.termos)}" maxlength="600" aria-label="Palavras da seção ${esc(s.nome)}" placeholder="Palavras, separadas por vírgula (ex.: saco lixo, saco p lixo)">
        </div>`;
      }).join('') || '<div class="hint">Nenhuma seção neste departamento ainda.</div>'}</div>
      <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap"><button class="btn sec" type="button" id="sxAdd">＋ Nova seção</button>
        <button class="btn pri" type="button" id="sxSalvar">Salvar seções de ${esc(dep)}</button><span class="hint" id="sxRes" style="margin:0" aria-live="polite">${mudou ? 'Alterações não salvas.' : ''}</span></div>
      <details class="sx-sem" ${semSecao.length && semSecao.length <= 40 ? 'open' : ''}><summary>Produtos sem seção neste departamento (${semSecao.length})</summary>
        ${semSecao.length ? `<ul>${semSecao.slice(0, 200).map((p) => `<li><span class="sx-cod">${esc(p.codigo)}</span> · ${esc(p.nome)}</li>`).join('')}</ul>${semSecao.length > 200 ? `<small class="hint">…e mais ${semSecao.length - 200}.</small>` : ''}` : '<small class="hint">Todos os produtos estão em alguma seção. 👏</small>'}</details>
      <small class="hint" style="display:block;margin-top:8px">Como funciona: o produto do departamento entra na seção se o nome tiver todas as palavras de algum item (separe itens por vírgula). Sem acento; palavra de 5 letras ou mais vale pelo começo ("vassoura" pega "vassouras"); mais curta só vale inteira ou no plural ("copo" pega "copos"). Um produto pode aparecer em mais de uma seção.</small>`;
    ligar();
  }

  const recontar = () => { // atualiza só os números, sem perder o foco do campo
    const lista = produtos();
    alvo.querySelectorAll('.sx-sec').forEach((el) => {
      const s = arvore[Number(el.dataset.i)]; const n = pega(lista, s.termos).length;
      const b = el.querySelector('.sx-linha1 .sx-n'); b.textContent = `${n} produto${n === 1 ? '' : 's'}`; b.classList.toggle('zero', !n);
    });
    alvo.querySelector('#sxRes').textContent = 'Alterações não salvas.';
  };

  function ligar() {
    alvo.querySelector('#sxDep').onchange = (e) => {
      if (mudou) toast(`Alterações não salvas de ${dep} descartadas.`);
      dep = e.target.value; ler(); pintar();
    };
    alvo.querySelectorAll('.sx-sec').forEach((el) => {
      const i = Number(el.dataset.i); const s = arvore[i];
      el.querySelector('.sx-nome').oninput = (e) => { s.nome = e.target.value; mudou = true; alvo.querySelector('#sxRes').textContent = 'Alterações não salvas.'; };
      el.querySelector('.sx-termos').oninput = (e) => { s.termos = e.target.value; mudou = true; recontar(); };
      el.querySelector('[data-up]').onclick = () => { [arvore[i - 1], arvore[i]] = [arvore[i], arvore[i - 1]]; mudou = true; pintar(); };
      el.querySelector('[data-dn]').onclick = () => { [arvore[i + 1], arvore[i]] = [arvore[i], arvore[i + 1]]; mudou = true; pintar(); };
      el.querySelector('[data-rm]').onclick = (ev) => {
        const b = ev.currentTarget;
        if (b.dataset.conf !== '1') { b.dataset.conf = '1'; b.textContent = 'Remover?'; setTimeout(() => { if (b.isConnected) { b.dataset.conf = ''; b.textContent = '×'; } }, 3000); return; }
        arvore.splice(i, 1); mudou = true; pintar();
      };
    });
    alvo.querySelector('#sxAdd').onclick = () => { arvore.push({ nome: '', termos: '', linhas: [] }); mudou = true; pintar(); alvo.querySelector('.sx-sec:last-of-type .sx-nome')?.focus(); };
    alvo.querySelector('#sxSalvar').onclick = async (ev) => {
      const b = ev.currentTarget; const res = alvo.querySelector('#sxRes');
      const secoes = arvore.map((s) => ({ nome: s.nome.trim(), antes: s.antes || '', termos: s.termos.split(',').map((t) => t.trim()).filter(Boolean),
        linhas: [] }))
        .filter((s) => s.nome || s.termos.length);
      const semNome = secoes.find((s) => !s.nome);
      if (semNome) { res.textContent = 'Dê um nome para cada seção.'; return; }
      const semPalavra = secoes.find((s) => !s.termos.length);
      if (semPalavra) { res.textContent = `"${semPalavra.nome}" precisa de pelo menos uma palavra.`; return; }
      b.disabled = true; res.textContent = 'Salvando…';
      try {
        await painel('secoes_salvar', { categoria: dep, secoes });
        await carregarExibicao(true); ler(); pintar(); toast(`Seções de ${dep} salvas ✓`);
      } catch (e) { res.textContent = e.message; b.disabled = false; }
    };
  }

  ler(); pintar();
}
