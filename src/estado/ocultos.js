/* Produtos escondidos para o comprador logado por ser cliente de um executivo de contas.
   Lê uma vez por comprador, pela sessão do Supabase vinculada pela ponte (garantirVinculo).
   Sem Supabase ou sem vínculo, não esconde nada (e não trava a tela). */
import { sessao, garantirVinculo, aoEncerrar } from './sessao.js';
import { supabaseComprador } from '../api/supabase.js';
import { definirOcultosExecutivo } from '../catalogo/exibicao.js';

let dono = null; let pedindo = null;
aoEncerrar(() => { dono = null; pedindo = null; definirOcultosExecutivo(null); });

/** Espera no máximo `ms` (padrão 2,5 s). Devolve true quando a lista mudou para este comprador.
 *  Se a resposta chegar depois do prazo e esconder algo, chama `depois()` para redesenhar a tela. */
export async function carregarOcultosComprador(depois = null, ms = 2500) {
  if (!sessao.ativa || !sessao.comprador) { if (dono !== null) { dono = null; definirOcultosExecutivo(null); } return false; }
  const cod = sessao.comprador.codigo;
  if (dono === cod) return false;
  if (!pedindo) {
    pedindo = (async () => {
      try {
        if (!(await garantirVinculo())) return false;
        const { data, error } = await supabaseComprador().rpc('portal_ocultos_comprador');
        if (error || sessao.comprador?.codigo !== cod) return false;
        definirOcultosExecutivo(data); dono = cod;
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
