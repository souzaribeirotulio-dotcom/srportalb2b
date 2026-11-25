/* Produtos escondidos por causa de um executivo de contas: para o comprador logado que é cliente dele e, antes do
   cadastro, para o visitante que chegou pelo link do executivo (?ex=CODIGO, guardado neste navegador).
   Lê uma vez por comprador, pela sessão do Supabase vinculada pela ponte (garantirVinculo).
   Sem Supabase ou sem vínculo, não esconde nada (e não trava a tela). */
import { sessao, garantirVinculo, aoEncerrar } from './sessao.js';
import { supabaseComprador } from '../api/supabase.js';
import { definirOcultosExecutivo } from '../catalogo/exibicao.js';
import { codigoExecutivoGuardado, linkComOcultos } from './executivo.js';
import { definirEmAnalise } from './analise.js';

let dono = null; let pedindo = null;
aoEncerrar(() => { dono = null; pedindo = null; definirOcultosExecutivo(null); });

/** Espera no máximo `ms` (padrão 2,5 s). Devolve true quando a lista mudou para este comprador.
 *  Se a resposta chegar depois do prazo e esconder algo, chama `depois()` para redesenhar a tela. */
export async function carregarOcultosComprador(depois = null, ms = 2500) {
  if (!sessao.ativa || !sessao.comprador) { definirEmAnalise(false); if (dono !== null) { dono = null; definirOcultosExecutivo(null); } return false; }
  const cod = sessao.comprador.codigo;
  if (dono === cod) return false;
  if (!pedindo) {
    pedindo = (async () => {
      try {
        if (!(await garantirVinculo())) return false;
        const { data, error } = await supabaseComprador().rpc('portal_ocultos_comprador');
        if (error || sessao.comprador?.codigo !== cod) return false;
        definirOcultosExecutivo(data); dono = cod; definirEmAnalise(data?.em_analise === true);
        return !!(data?.termos?.length || data?.codigos?.length);
      } catch { return false; } finally { pedindo = null; }
    })();
  }
  const espera = pedindo;
  let atrasou = false;
  const r = await Promise.race([espera, new Promise((ok) => setTimeout(() => { atrasou = true; ok(false); }, ms))]);
  if (atrasou && depois) espera.then((mudou) => { if (mudou) depois(); });
  return r;
}

/** Visitante (sem login) que veio pelo link "sem os produtos escondidos" do executivo: esconde os mesmos produtos que os clientes dele não veem.
 *  Mesma espera máxima e mesmo "depois()" de carregarOcultosComprador. Sem código guardado, não esconde nada. */
export async function carregarOcultosVisitante(depois = null, ms = 2500) {
  if (sessao.ativa) return false;
  // Só o link "sem os produtos escondidos" (?oc=1) esconde; o link completo mostra tudo.
  const ex = linkComOcultos() ? codigoExecutivoGuardado() : '';
  const chave = ex ? `ex:${ex}` : null;
  if (dono === chave) return false;
  if (!ex) { dono = null; definirOcultosExecutivo(null); return true; }
  if (!pedindo) {
    pedindo = (async () => {
      try {
        const { data, error } = await supabaseComprador().rpc('portal_ocultos_executivo', { p_codigo: ex });
        if (error || sessao.ativa) return false;
        definirOcultosExecutivo(data); dono = chave;
        return !!(data?.termos?.length || data?.codigos?.length);
      } catch { return false; } finally { pedindo = null; }
    })();
  }
  const espera = pedindo;
  let atrasou = false;
  const r = await Promise.race([espera, new Promise((ok) => setTimeout(() => { atrasou = true; ok(false); }, ms))]);
  if (atrasou && depois) espera.then((mudou) => { if (mudou) depois(); });
  return r;
}
