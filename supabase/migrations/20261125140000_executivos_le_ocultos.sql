-- A área do executivo mostra o que ele esconde dos clientes (só a própria linha, pela política executivo_le_o_seu).
grant select (ocultar_termos, ocultar_codigos) on public.executivos to authenticated;
