/* Minha Lista no Supabase (seção 7, passo 4, e seção 8, passo 5).
   Cada linha pertence a uma loja e a um código de comprador; a regra de acesso
   (RLS) só aceita a sessão vinculada pela ponte e ainda válida. Antes de ler
   ou gravar, o vínculo é conferido. Inclui com insert (duplicidade = "já está
   na lista"); upsert não serve porque a regra não deixa alterar. */
import { sessao, garantirVinculo } from './sessao.js';
import { supabaseComprador, LOJA } from '../api/supabase.js';

let ids = null; // Set de produto_id carregado nesta sessão

export class ErroLista extends Error {}
const MSG_INDISPONIVEL = 'A Minha Lista está indisponível no momento. Tente de novo em instantes.';

export function limparMinhaListaEstado() { ids = null; }
export function idsCarregados() { return ids; }

async function cliente() {
  if (!(await garantirVinculo())) throw new ErroLista(MSG_INDISPONIVEL);
  return supabaseComprador();
}

/** Lê os produto_id da lista do comprador (o vínculo recorta pela regra de acesso). */
export async function carregarIds() {
  const sb = await cliente();
  const { data, error } = await sb.from('minha_lista').select('produto_id');
  if (error) throw new ErroLista(MSG_INDISPONIVEL);
  ids = new Set((data || []).map((l) => Number(l.produto_id)));
  return ids;
}

export async function incluirNaLista(produtoId) {
  const sb = await cliente();
  const { error } = await sb.from('minha_lista').insert({ loja: LOJA, comprador_codigo: sessao.comprador.codigo, produto_id: Number(produtoId) });
  if (error && error.code !== '23505') throw new ErroLista(MSG_INDISPONIVEL);
  if (ids) ids.add(Number(produtoId));
  return error?.code === '23505' ? 'ja_estava' : 'incluido';
}

export async function removerDaLista(produtoId) {
  const sb = await cliente();
  const { error } = await sb.from('minha_lista').delete()
    .eq('loja', LOJA).eq('comprador_codigo', sessao.comprador.codigo).eq('produto_id', Number(produtoId));
  if (error) throw new ErroLista(MSG_INDISPONIVEL);
  if (ids) ids.delete(Number(produtoId));
}
