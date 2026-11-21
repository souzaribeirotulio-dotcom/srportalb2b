/* Souzinha (assistente do portal antigo) ligado ao portal G360.
   - O widget é o mesmo do portal antigo (/souzinha.js e /souzinha.css em public/).
   - A conversa vai para /api/souzinha (função da Vercel; a chave da IA fica só lá).
   - Candidatos de produto saem da busca do portal (nomes do portal); preço e estoque
     só aparecem no catálogo, pela API, nunca pela IA. */
import { carregarExibicao, registro, apresentar } from '../catalogo/exibicao.js';
import { buscarLocal } from '../catalogo/busca.js';
import { buscarProdutos } from '../api/g360.js';
import { sessao } from '../estado/sessao.js';
import { incluirNaLista } from '../estado/minha-lista.js';
import { toast } from './comum.js';

const VAZIO = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
let iniciado = false;

/** ctx: { ir(caminho), exigirLogin(fn), buscar(texto), abrirDetalhe(produto) } */
export function iniciarSouzinha(ctx) {
  if (iniciado) return; iniciado = true;
  carregarExibicao();
  window.Servicos = window.Servicos || {};
  const perguntar = async ({ message, history, candidates }) => {
    try {
      const r = await fetch('/api/souzinha', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, history, candidates }), credentials: 'omit' });
      const d = await r.json().catch(() => ({}));
      return r.ok ? d : { error: d.error || 'Não consegui responder agora. Tente novamente em instantes.' };
    } catch { return { error: 'Não foi possível falar com o servidor. Confira a conexão e tente de novo.' }; }
  };
  // Fixa a operação: os scripts antigos (com defer) rodam depois e não podem trocá-la pela versão "pendente".
  const fixar = () => { if (window.Servicos?.assistentePerguntar !== perguntar) { window.Servicos = { ...(window.Servicos || {}), assistentePerguntar: perguntar }; } };
  fixar(); document.addEventListener('DOMContentLoaded', fixar); window.addEventListener('load', fixar);
  const porCodigo = (cod) => registro({ codigo: String(cod) });
  const produtoApi = async (cod) => {
    const { dados } = await buscarProdutos(sessao.token, { codigos: [String(cod)], limite: 1 });
    return dados[0] ? apresentar(dados[0]) : null;
  };
  window.SouzinhaPortal = {
    candidates: (texto) => buscarLocal(texto, { max: 24 }).map((l) => ({ cod: l.codigo, name: l.nome, category: l.categoria || '', unit: '' })),
    product: (cod) => { const r = porCodigo(cod); return r ? { code: r.codigo, name: r.nome, unit: r.categoria || '', price: '', image: VAZIO } : null; },
    navigate: (sec) => ctx.ir({ lista: '/minha-lista', ped: '/pedidos', cat: '/catalogo' }[sec] || '/catalogo'),
    search: (q) => ctx.buscar(q),
    view: (cod) => ctx.exigirLogin(async () => { try { const p = await produtoApi(cod); if (p) ctx.abrirDetalhe(p); else toast('Produto indisponível no seu catálogo.'); } catch (e) { toast(e.message); } }),
    addCart: (cod) => window.SouzinhaPortal.view(cod),
    addList: (cod) => ctx.exigirLogin(async () => {
      try {
        const id = porCodigo(cod)?.produto_id || (await produtoApi(cod))?.id;
        if (!id) { toast('Produto indisponível no seu catálogo.'); return; }
        await incluirNaLista(Number(id)); toast('Adicionado à Minha Lista ⭐');
      } catch (e) { toast(e.message); }
    }),
    addMany: (cods) => ctx.exigirLogin(async () => {
      let n = 0;
      for (const c of cods) { const id = porCodigo(c)?.produto_id; if (id) { try { await incluirNaLista(Number(id)); n += 1; } catch { /* segue */ } } }
      toast(n ? `${n} produto(s) adicionados à Minha Lista ⭐` : 'Não foi possível adicionar agora.');
    }),
  };
  const s = document.createElement('script'); s.src = '/souzinha.js'; s.defer = true; document.body.appendChild(s);
}
