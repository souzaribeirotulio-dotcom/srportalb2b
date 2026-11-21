-- Banners com vídeo (MP4 curto, sem som). A imagem continua obrigatória: é a capa enquanto o vídeo
-- carrega e o que aparece para quem pediu menos movimento ou economia de dados.
alter table public.portal_banners
  add column if not exists video_desktop text check (video_desktop is null or video_desktop ~ '^[a-f0-9]{16}/[0-9a-f-]{36}\.mp4$'),
  add column if not exists video_celular text check (video_celular is null or video_celular ~ '^[a-f0-9]{16}/[0-9a-f-]{36}\.mp4$');
update storage.buckets set file_size_limit = 8388608, allowed_mime_types = array['image/jpeg', 'image/webp', 'image/png', 'video/mp4'] where id = 'portal-banners';
