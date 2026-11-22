create or replace function public.estoque_alertas(p_loja text, p_queda numeric default 0.5, p_abaixo numeric default 30, p_dias int default 7)
returns table (produto_id bigint, codigo text, nome text, atual numeric, pico numeric, pico_dia date, queda numeric, lido_em timestamptz)
language sql security definer set search_path = '' stable as $$
  with picos as (
    select d.produto_id, max(d.maximo) as pico
    from public.estoque_dia d
    where d.loja = p_loja and d.dia >= (now() at time zone 'America/Sao_Paulo')::date - (p_dias - 1)
    group by d.produto_id
  ), dia_pico as (
    select distinct on (d.produto_id) d.produto_id, d.dia
    from public.estoque_dia d join picos p on p.produto_id = d.produto_id and d.maximo = p.pico
    where d.loja = p_loja and d.dia >= (now() at time zone 'America/Sao_Paulo')::date - (p_dias - 1)
    order by d.produto_id, d.dia desc
  )
  select a.produto_id, a.codigo, a.nome, a.disponivel, p.pico, dp.dia, round((p.pico - a.disponivel) / p.pico * 100, 1), a.lido_em
  from public.estoque_atual a
  join picos p on p.produto_id = a.produto_id
  left join dia_pico dp on dp.produto_id = a.produto_id
  left join public.estoque_vistos v on v.loja = a.loja and v.produto_id = a.produto_id
  where a.loja = p_loja and a.disponivel > 0 and p.pico > 0
    and (p.pico - a.disponivel) / p.pico >= p_queda and a.disponivel < p_abaixo
    and (v.produto_id is null or p.pico > v.pico)
  order by (p.pico - a.disponivel) / p.pico desc, a.disponivel asc
  limit 300;
$$;
revoke all on function public.estoque_alertas(text, numeric, numeric, int) from public, anon, authenticated;
