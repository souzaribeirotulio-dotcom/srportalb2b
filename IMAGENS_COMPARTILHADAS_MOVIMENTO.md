# Fotos compartilhadas no Portal B2B

## Problema corrigido
Anteriormente a edição de imagens era salva no `localStorage` do computador do administrador. Outros clientes e administradores não recebiam a alteração, mesmo com os arquivos publicados na Vercel.

## Como funciona
- Metadados (código do produto → fotos ordenadas) são salvos em `public.portal_produtos_imagens`.
- As imagens enviadas do computador são compactadas pelo navegador e gravadas no bucket público `portal-produtos` do Supabase Storage, com nomes únicos e cache.
- O envio passa pela Edge Function `portal-upload-imagem`, que valida a sessão real do administrador. A chave secreta fica no servidor.
- O editor de fotos continua com as mesmas funcionalidades: adicionar link, enviar arquivo, reordenar, definir principal e restaurar.
- Quando o admin clica **Salvar fotos**, a mudança é persistida no banco e aparece para todos os clientes. Telas abertas atualizam as fotos a cada 60 segundos ou ao voltar à aba.
- Se falhar o envio, o editor permanece aberto e mostra o erro; não exibe sucesso falso.
- As imagens estáticas e as consultas por EAN continuam como fallback se um produto não tiver fotos próprias.
- Não há acesso direto das contas de cliente à gravação dos metadados nem ao upload dos arquivos.

## Passo único: migrar as fotos que já estavam no navegador do marketing
No **mesmo navegador/perfil em que as fotos antigas foram alteradas**:
1. Abra o portal atualizado e entre no modo administrador.
2. Ative **Editar imagens** no catálogo.
3. Clique em **☁ Publicar fotos deste navegador (N)**.
4. Confirme. O portal publica apenas produtos que ainda **não** possuem fotos compartilhadas. Não sobrescreve fotos já publicadas por outro administrador.
5. Confira em outro navegador ou em uma janela anônima. **Não limpe o cache ou armazenamento local antes de completar essa migração.**

Se as imagens antigas estiverem num arquivo `sr_portal_b2b_imagens.json`, a opção **Importar** no modo edição permite publicá-las.

## Para a Movimento Sistemas
- Preservar o código do produto como chave da galeria (não amarrar imagem ao código interno do banco do portal).
- Preservar a ordem das imagens: primeira = principal.
- Gravação de imagens só por administradores autenticados, com confirmação de operação.
- Tratar atualização de fotos de maneira independente de preços, estoque e dados financeiros.
- Validar governança dos arquivos, direitos de uso de imagens e eventual exclusão dos arquivos antigos não referenciados do Storage.
- Não mover a chave service role para o frontend.
