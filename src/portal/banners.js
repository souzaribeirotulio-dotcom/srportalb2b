/* Banners do topo do catálogo (cadastrados pela equipe no painel, tabela portal_banners).
   - Carrossel com rolagem nativa (scroll-snap): deslizar com o dedo funciona como no celular.
   - Passa sozinho a cada 5 s; para quando a pessoa mexe, passa o mouse ou pede menos movimento.
   - Só a primeira imagem carrega logo; as outras quando chegam perto da tela.
   - Sem banner ativo, a faixa não aparece. Falha ao ler o Supabase: sem faixa e sem aviso. */
import { supabaseComprador, supabaseConfigurado, LOJA } from '../api/supabase.js';
import { esc } from '../ui/util.js';

const URL_SUPABASE = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
export const urlBanner = (caminho) => `${URL_SUPABASE}/storage/v1/object/public/portal-banners/${caminho.split('/').map(encodeURIComponent).join('/')}`;
const CACHE_MS = 5 * 60_000;
const INTERVALO = 5000;

let lista = null; let listaEm = 0; let pedido = null;

export function esquecerBanners() { lista = null; listaEm = 0; }

export async function carregarBanners() {
  if (lista && Date.now() - listaEm < CACHE_MS) return lista;
  if (!supabaseConfigurado()) return [];
  pedido ??= (async () => {
    try {
      const { data, error } = await supabaseComprador().from('portal_banners')
        .select('id, titulo, img_desktop, img_celular, destino_tipo, destino_valor, ordem')
        .eq('loja', LOJA).order('ordem').order('criado_em').limit(12);
      if (error) throw error;
      lista = data || []; listaEm = Date.now();
    } catch { lista = lista || []; } finally { pedido = null; }
    return lista;
  })();
  return pedido;
}

let timer = null;
function parar() { clearInterval(timer); timer = null; }

/** Desenha o carrossel em `el`. aoClicar(banner) decide o que acontece no toque. */
export async function desenharBanners(el, aoClicar) {
  if (!el) return;
  const bs = await carregarBanners();
  parar();
  if (!bs.length) { el.hidden = true; el.innerHTML = ''; return; }
  const chave = bs.map((b) => `${b.id}:${b.img_desktop}:${b.img_celular}`).join('|');
  if (el.dataset.chave === chave && !el.hidden) { iniciar(el); return; }
  el.dataset.chave = chave;
  el.hidden = false;
  const varios = bs.length > 1;
  el.innerHTML = `<div class="bnr-trilho" tabindex="-1" aria-roledescription="carrossel" aria-label="Destaques">
      ${bs.map((b, i) => `<button type="button" class="bnr-slide" data-i="${i}" aria-label="${esc(b.titulo)}${varios ? ` (${i + 1} de ${bs.length})` : ''}" ${b.destino_tipo === 'nenhum' ? 'tabindex="-1"' : ''}>
        <picture>${b.img_celular ? `<source media="(max-width: 640px)" srcset="${esc(urlBanner(b.img_celular))}">` : ''}
          <img src="${esc(urlBanner(b.img_desktop))}" alt="" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" draggable="false"></picture>
      </button>`).join('')}
    </div>
    ${varios ? `<button type="button" class="bnr-seta p" aria-label="Banner anterior">‹</button><button type="button" class="bnr-seta n" aria-label="Próximo banner">›</button>
    <div class="bnr-pontos">${bs.map((b, i) => `<button type="button" data-p="${i}" aria-label="Ir para o banner ${i + 1}"${i === 0 ? ' aria-current="true"' : ''}></button>`).join('')}</div>` : ''}`;
  const trilho = el.querySelector('.bnr-trilho');
  // Posição pelos próprios cartões: no celular cada um ocupa menos que a tela (o próximo aparece ao lado).
  const slides = [...trilho.querySelectorAll('.bnr-slide')];
  const pos = (k) => slides[k].offsetLeft - slides[0].offsetLeft;
  const atual = () => { let m = 0; slides.forEach((_, k) => { if (Math.abs(pos(k) - trilho.scrollLeft) < Math.abs(pos(m) - trilho.scrollLeft)) m = k; }); return m; };
  const ir = (i) => { const n = bs.length; trilho.scrollTo({ left: pos((i + n) % n), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };
  el._ir = ir; el._atual = atual;
  trilho.addEventListener('scroll', () => {
    const i = atual();
    el.querySelectorAll('[data-p]').forEach((p) => { if (Number(p.dataset.p) === i) p.setAttribute('aria-current', 'true'); else p.removeAttribute('aria-current'); });
  }, { passive: true });
  el.addEventListener('click', (e) => {
    const s = e.target.closest('.bnr-seta'); if (s) { parar(); ir(atual() + (s.classList.contains('n') ? 1 : -1)); return; }
    const p = e.target.closest('[data-p]'); if (p) { parar(); ir(Number(p.dataset.p)); return; }
    const b = e.target.closest('.bnr-slide'); if (b) { const ban = bs[Number(b.dataset.i)]; if (ban && ban.destino_tipo !== 'nenhum') aoClicar(ban); }
  });
  // Mexeu (dedo, mouse em cima, teclado): para de passar sozinho até sair da tela.
  ['pointerdown', 'mouseenter', 'focusin', 'wheel'].forEach((ev) => el.addEventListener(ev, parar, { passive: true }));
  el.addEventListener('mouseleave', () => iniciar(el));
  iniciar(el);
}

function iniciar(el) {
  parar();
  if (!el?._ir || el.querySelectorAll('.bnr-slide').length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  timer = setInterval(() => {
    if (document.hidden || el.hidden || !el.isConnected || el.offsetParent === null) return;
    el._ir(el._atual() + 1);
  }, INTERVALO);
}

export function pausarBanners() { parar(); }
