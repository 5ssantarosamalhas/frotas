-- ==========================================================================
-- RASTREADOR DE FROTA — Schema do banco (Supabase / PostgreSQL)
-- Cole este arquivo inteiro no Supabase > SQL Editor > New query > Run.
-- Ele cria as tabelas, a segurança por linha (RLS) e os gatilhos.
-- Pode rodar de novo sem problema: usa "if not exists" / "drop if exists".
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1) PERFIS — quem é gestor e quem é motorista
--    Cada usuário que loga ganha uma linha aqui automaticamente (gatilho no fim).
-- --------------------------------------------------------------------------
create table if not exists public.perfis (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text,
  papel       text not null default 'motorista'  -- 'gestor' ou 'motorista'
                check (papel in ('gestor', 'motorista')),
  veiculo     text,                               -- placa/apelido do veículo do motorista
  criado_em   timestamptz not null default now()
);

alter table public.perfis enable row level security;

-- Função auxiliar: o usuário logado é gestor?
create or replace function public.e_gestor()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfis
    where id = auth.uid() and papel = 'gestor'
  );
$$;

-- Cada um lê o próprio perfil; gestor lê todos.
drop policy if exists perfis_select on public.perfis;
create policy perfis_select on public.perfis
  for select using (id = auth.uid() or public.e_gestor());

-- Cada um pode atualizar o próprio perfil (ex.: o nome). Gestor atualiza qualquer um.
drop policy if exists perfis_update on public.perfis;
create policy perfis_update on public.perfis
  for update using (id = auth.uid() or public.e_gestor());

-- --------------------------------------------------------------------------
-- 2) POSIÇÕES — cada ping de GPS enviado pelo celular do motorista
-- --------------------------------------------------------------------------
create table if not exists public.posicoes (
  id           bigint generated always as identity primary key,
  motorista_id uuid not null references auth.users(id) on delete cascade,
  latitude     double precision not null,
  longitude    double precision not null,
  velocidade   double precision,          -- em km/h (null se o aparelho não informar)
  precisao     double precision,          -- em metros
  rumo         double precision,          -- direção em graus (0-360), se disponível
  criado_em    timestamptz not null default now()
);

create index if not exists idx_posicoes_motorista_tempo
  on public.posicoes (motorista_id, criado_em desc);

alter table public.posicoes enable row level security;

-- Motorista só insere a PRÓPRIA posição.
drop policy if exists posicoes_insert on public.posicoes;
create policy posicoes_insert on public.posicoes
  for insert with check (motorista_id = auth.uid());

-- Motorista lê as próprias posições; gestor lê todas.
drop policy if exists posicoes_select on public.posicoes;
create policy posicoes_select on public.posicoes
  for select using (motorista_id = auth.uid() or public.e_gestor());

-- --------------------------------------------------------------------------
-- 3) MENSAGENS — avisos que o gestor envia para serem lidos em voz alta
-- --------------------------------------------------------------------------
create table if not exists public.mensagens (
  id            bigint generated always as identity primary key,
  destinatario  uuid not null references auth.users(id) on delete cascade,
  remetente     uuid references auth.users(id) on delete set null,
  texto         text not null,
  aviso_sonoro  boolean not null default true,   -- toca um som antes de ler
  lida          boolean not null default false,  -- marcada quando o app falou a mensagem
  criado_em     timestamptz not null default now()
);

create index if not exists idx_mensagens_destinatario_tempo
  on public.mensagens (destinatario, criado_em desc);

alter table public.mensagens enable row level security;

-- Só gestor envia mensagens.
drop policy if exists mensagens_insert on public.mensagens;
create policy mensagens_insert on public.mensagens
  for insert with check (public.e_gestor());

-- Motorista lê as próprias mensagens; gestor lê todas.
drop policy if exists mensagens_select on public.mensagens;
create policy mensagens_select on public.mensagens
  for select using (destinatario = auth.uid() or public.e_gestor());

-- Motorista marca a própria mensagem como "lida"; gestor também pode.
drop policy if exists mensagens_update on public.mensagens;
create policy mensagens_update on public.mensagens
  for update using (destinatario = auth.uid() or public.e_gestor());

-- --------------------------------------------------------------------------
-- 4) REALTIME — faz o painel e o celular receberem mudanças na hora
-- --------------------------------------------------------------------------
alter publication supabase_realtime add table public.posicoes;
alter publication supabase_realtime add table public.mensagens;

-- --------------------------------------------------------------------------
-- 5) GATILHO — cria o perfil automaticamente quando alguém se cadastra
-- --------------------------------------------------------------------------
create or replace function public.criar_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, nome, papel)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', new.email),
    coalesce(new.raw_user_meta_data->>'papel', 'motorista')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil();

-- ==========================================================================
-- PRONTO.
-- Depois de rodar: cadastre os usuários em Authentication > Users > Add user.
-- Para transformar alguém em GESTOR, rode (troque o e-mail):
--
--   update public.perfis set papel = 'gestor'
--   where id = (select id from auth.users where email = 'gestor@empresa.com');
--
-- Para definir o veículo de um motorista:
--
--   update public.perfis set veiculo = 'Caminhão 01 - ABC1D23'
--   where id = (select id from auth.users where email = 'motorista@empresa.com');
-- ==========================================================================
