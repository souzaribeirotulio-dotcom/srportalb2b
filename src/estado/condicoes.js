/* Condições de pagamento que a Souza Ribeiro nunca mostra no portal, para nenhum cliente.
   Vale mesmo se o Supabase não responder (o filtro da equipe fica no Supabase). */
const SEMPRE_BLOQUEADAS = ['A COMBINAR'];
const normal = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
export function sempreBloqueada(c) { return SEMPRE_BLOQUEADAS.includes(normal(c?.descricao)); }
