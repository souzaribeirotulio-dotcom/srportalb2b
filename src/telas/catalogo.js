/* Catálogo (Etapa 6): GET produtos com busca, grupo, marca e paginação;
   GET grupos e GET marcas para os filtros; fotos com o Bearer do comprador. */
import { listarProdutos, listarGrupos, listarMarcas } from '../api/g360.js';
import { sessao } from '../estado/sessao.js';
import { carregarIds } from '../estado/minha-lista.js';
import { htmlCartao } from '../ui/produto.js';
import { ligarCartoes, naLista } from '../ui/acoes-produto.js';
import { ligarFotos } from '../ui/fotos.js';
import { carregando, vazia, erroTela, titulo } from '../ui/telas-comum.js';
import { esc } from '../ui/util.js';

const LIMITE = 20;
const filtros = { q: '', grupo: '', marca: '', pagina: 1 };
let classificacoes = null; // { token, grupos, marcas }

export function limparFiltrosCatalogo() { Object.assign(filtros, { q: '', grupo: '', marca: '', pagina: 1 }); classificacoes = null; }

async function carregarClassificacoes() {
  if (classificacoes && classificacoes.token === sessao.token) return classificacoes;
  const [grupos, marcas] = await Promise.all([listarGrupos(sessao.token), listarMarcas(sessao.token)]);
  classificacoes = { token: sessao.token, grupos, marcas };
  return classificacoes;
}

export function telaCatalogo({ conteudo, eAtual }) {
  conteudo.innerHTML = `
    ${titulo('Catálogo', 'Preços e disponibilidade do momento, já com as condições do seu cadastro.')}
    <form class="filtros" id="g360Filtros" role="search">
      <div class="filtro-busca">
        <label for="g360Busca">Buscar</label>
        <input id="g360Busca" type="search" maxlength="80" placeholder="Nome, código ou aplicação" value="${esc(filtros.q)}">
      </div>
      <div><label for="g360Grupo">Grupo</label><select id="g360Grupo"><option value="">Todos</option></select></div>
      <div><label for="g360Marca">Marca</label><select id="g360Marca"><option value="">Todas</option></select></div>
      <button type="submit" class="g360-btn pri">Buscar</button>
    </form>
    <p class="filtros-erro" id="g360FiltrosErro" aria-live="polite"></p>
    <div id="g360Lista" aria-live="polite"></div>
    <nav class="paginacao" id="g360Paginacao" aria-label="Páginas do catálogo"></nav>`;

  const lista = conteudo.querySelector('#g360Lista');
  const pag = conteudo.querySelector('#g360Paginacao');
  const selGrupo = conteudo.querySelector('#g360Grupo');
  const selMarca = conteudo.querySelector('#g360Marca');

  carregarClassificacoes().then(({ grupos, marcas }) => {
    if (!eAtual()) return;
    selGrupo.insertAdjacentHTML('beforeend', grupos.map((g) => `<option value="${Number(g.codigo)}">${esc(g.nome)} (${Number(g.quantidade)})</option>`).join(''));
    selMarca.insertAdjacentHTML('beforeend', marcas.map((m) => `<option value="${Number(m.codigo)}">${esc(m.nome)} (${Number(m.quantidade)})</option>`).join(''));
    selGrupo.value = filtros.grupo; selMarca.value = filtros.marca;
  }).catch(() => {
    if (eAtual()) conteudo.querySelector('#g360FiltrosErro').textContent = 'Os filtros de grupo e marca não carregaram agora. A busca continua funcionando.';
  });


  async function buscar() {
    carregando(lista, 'Carregando produtos…');
    pag.innerHTML = '';
    try {
      const { dados, paginacao } = await listarProdutos(sessao.token, {
        q: filtros.q || undefined,
        grupo: filtros.grupo || undefined,
        marca: filtros.marca || undefined,
        pagina: filtros.pagina,
        limite: LIMITE,
      });
      if (!eAtual()) return;
      const total = paginacao?.total || 0;
      const paginas = Math.max(1, Math.ceil(total / LIMITE));
      if (!dados.length) {
        vazia(lista, 'Nenhum produto encontrado.', filtros.q || filtros.grupo || filtros.marca
          ? 'Tente outra palavra ou limpe os filtros.' : 'O catálogo está vazio no momento.',
        (filtros.q || filtros.grupo || filtros.marca) ? '<button type="button" class="g360-btn sec" id="g360Limpar">Limpar filtros</button>' : '');
        lista.querySelector('#g360Limpar')?.addEventListener('click', () => {
          Object.assign(filtros, { q: '', grupo: '', marca: '', pagina: 1 });
          conteudo.querySelector('#g360Busca').value = ''; selGrupo.value = ''; selMarca.value = '';
          buscar();
        });
        return;
      }
      const mapa = new Map(dados.map((p) => [Number(p.id), p]));
      lista.innerHTML = `<p class="contagem">${total} produto${total === 1 ? '' : 's'} · página ${filtros.pagina} de ${paginas}</p>
        <div class="grade-produtos">${dados.map((p) => htmlCartao(p, { naLista: naLista(p.id) })).join('')}</div>`;
      ligarCartoes(lista, mapa);
      ligarFotos(lista);
      pag.innerHTML = paginas > 1 ? `
        <button type="button" class="g360-btn sec" id="g360Anterior" ${filtros.pagina <= 1 ? 'disabled' : ''}>Anterior</button>
        <span>Página ${filtros.pagina} de ${paginas}</span>
        <button type="button" class="g360-btn sec" id="g360Proxima" ${filtros.pagina >= paginas ? 'disabled' : ''}>Próxima</button>` : '';
      pag.querySelector('#g360Anterior')?.addEventListener('click', () => { filtros.pagina -= 1; buscar(); conteudo.scrollIntoView(); });
      pag.querySelector('#g360Proxima')?.addEventListener('click', () => { filtros.pagina += 1; buscar(); conteudo.scrollIntoView(); });
    } catch (e) {
      if (eAtual()) erroTela(lista, e, buscar);
    }
  }

  conteudo.querySelector('#g360Filtros').addEventListener('submit', (ev) => {
    ev.preventDefault();
    filtros.q = conteudo.querySelector('#g360Busca').value.trim();
    filtros.grupo = selGrupo.value;
    filtros.marca = selMarca.value;
    filtros.pagina = 1;
    buscar();
  });
  selGrupo.addEventListener('change', () => { filtros.grupo = selGrupo.value; filtros.pagina = 1; buscar(); });
  selMarca.addEventListener('change', () => { filtros.marca = selMarca.value; filtros.pagina = 1; buscar(); });
  // A Minha Lista é opcional nesta tela: sem ela, o botão de salvar não aparece.
  const listaPronta = sessao.supabaseOk && naLista(0) === null ? carregarIds().catch(() => {}) : Promise.resolve();
  carregando(lista, 'Carregando produtos…');
  listaPronta.then(() => { if (eAtual()) buscar(); });
}
