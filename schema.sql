-- =====================================================================
--  예언자들의 탑 (Tower of Prophets) — Supabase 스키마
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
--  (필요하면 맨 아래 "초기화" 블록으로 전부 지우고 다시 만들 수 있습니다.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------

-- 탑(방). 한 교실 = 한 row.
create table if not exists public.rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,                 -- 학생에게 알려주는 입장 코드
  phase            text not null default 'lobby',         -- lobby | prophecy | revealing | revealed | ended
  current_layer    int  not null default 0,               -- 0=대기, 1..total=진행 계층
  total_layers     int  not null default 5,
  duration_seconds int  not null default 300,             -- 한 계층 예언 시간(초)
  layer_deadline   timestamptz,                           -- 현재 계층 예언 마감 시각
  average          numeric,                               -- 직전 공개 계층의 예언 평균
  truth_coordinate numeric,                               -- 직전 공개 계층의 진실의 좌표
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- 예언자(플레이어).
create table if not exists public.players (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms(id) on delete cascade,
  player_number int  not null,
  nickname      text,
  insight       int  not null default 0,                  -- 통찰력(점수)
  joined_at     timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  unique (room_id, player_number)
);

-- 예언(숫자 제출). 한 계층 당 1개.
create table if not exists public.prophecies (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms(id)   on delete cascade,
  player_id      uuid not null references public.players(id) on delete cascade,
  layer          int  not null,
  value          int  not null check (value between 1 and 100),
  hidden         boolean not null default false,            -- 운명의 장막 사용 시 true (표시만 ???)
  distance       numeric,                                   -- 진실의 좌표와의 거리(공개 후 채움)
  rank           int,                                       -- 공동순위 포함 등수(공개 후 채움)
  gained_insight int not null default 0,                    -- 이 계층에서 얻은 통찰력(공개 후 채움)
  submitted_at   timestamptz not null default now(),
  unique (room_id, player_id, layer)
);

-- 능력 사용 기록.
create table if not exists public.ability_uses (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references public.rooms(id)   on delete cascade,
  player_id        uuid not null references public.players(id) on delete cascade,
  layer            int  not null,
  ability          text not null,                            -- veil | telepathy | akashic | resonance
  target_player_id uuid references public.players(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_players_room      on public.players(room_id);
create index if not exists idx_prophecies_room    on public.prophecies(room_id, layer);
create index if not exists idx_ability_room       on public.ability_uses(room_id, layer);

-- ---------------------------------------------------------------------
-- 2. updated_at 자동 갱신
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_rooms_touch on public.rooms;
create trigger trg_rooms_touch before update on public.rooms
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. 실시간(Realtime) 발행 — 변경 사항을 클라이언트로 푸시
-- ---------------------------------------------------------------------
do $$
begin
  -- 이미 추가돼 있으면 무시
  begin execute 'alter publication supabase_realtime add table public.rooms';       exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.players';     exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.prophecies';  exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------
-- 4. RLS (행 수준 보안)
--    수업용 익명 게임이라 anon 역할에 읽기/쓰기를 허용합니다.
--    저장되는 값은 1~100 숫자와 닉네임뿐이며, 게임 종료 시 모두 삭제됩니다.
--    (더 엄격히 막으려면 README의 "보안 강화" 항목 참고)
-- ---------------------------------------------------------------------
alter table public.rooms        enable row level security;
alter table public.players      enable row level security;
alter table public.prophecies   enable row level security;
alter table public.ability_uses enable row level security;

do $$
declare t text;
begin
  foreach t in array array['rooms','players','prophecies','ability_uses'] loop
    execute format('drop policy if exists "open_all" on public.%I', t);
    execute format(
      'create policy "open_all" on public.%I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. 게임 종료 정리 함수 — 방 하나와 그 모든 기록을 삭제
--    (rooms 삭제 시 cascade로 players/prophecies/ability_uses 자동 삭제)
-- ---------------------------------------------------------------------
create or replace function public.purge_room(p_room_id uuid)
returns void language sql as $$
  delete from public.rooms where id = p_room_id;
$$;

-- 방치된 방 정리(선택): 6시간 넘게 갱신 안 된 방 삭제.
-- pg_cron 확장이 있으면 아래 주석을 풀어 매시간 자동 청소할 수 있습니다.
create or replace function public.purge_stale_rooms()
returns void language sql as $$
  delete from public.rooms where updated_at < now() - interval '6 hours';
$$;
-- select cron.schedule('purge-stale-rooms', '0 * * * *', $$select public.purge_stale_rooms()$$);

-- =====================================================================
--  초기화(전체 삭제) — 다시 깔끔히 시작하고 싶을 때만 주석 해제 후 실행
-- =====================================================================
-- drop table if exists public.ability_uses cascade;
-- drop table if exists public.prophecies   cascade;
-- drop table if exists public.players      cascade;
-- drop table if exists public.rooms        cascade;
