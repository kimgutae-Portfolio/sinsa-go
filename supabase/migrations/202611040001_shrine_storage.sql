-- Additive migration for a SHARED project. Never reset/push an unrelated migration history.
-- All objects are shrine_*; no existing service tables, Auth, Storage or settings are modified.
begin;

create table public.shrine_storage_state (
  kind text primary key check (kind in ('visitors', 'lanterns')),
  schema_version integer not null default 1 check (schema_version = 1),
  revision bigint not null default 0 check (revision >= 0),
  last_write_id uuid
);
insert into public.shrine_storage_state (kind) values ('visitors'), ('lanterns');

create table public.shrine_visitors (
  visitor_id text primary key check (length(visitor_id) between 1 and 64),
  owner_hash text not null unique check (owner_hash ~ '^[a-f0-9]{64}$'),
  account_id text,
  first_seen_at bigint not null check (first_seen_at >= 0),
  last_seen_at bigint not null check (last_seen_at >= first_seen_at),
  last_room text not null check (last_room ~ '^[a-z0-9_-]{1,32}$'),
  connection_count bigint not null default 0 check (connection_count >= 0),
  visit_count bigint not null default 0 check (visit_count >= 0),
  prayer_count bigint not null default 0 check (prayer_count >= 0),
  fortune_count bigint not null default 0 check (fortune_count >= 0),
  ema_view_count bigint not null default 0 check (ema_view_count >= 0),
  lantern_hang_count bigint not null default 0 check (lantern_hang_count >= 0),
  lantern_remove_count bigint not null default 0 check (lantern_remove_count >= 0),
  connected_ms bigint not null default 0 check (connected_ms >= 0),
  daily jsonb not null default '{}'::jsonb check (jsonb_typeof(daily) = 'object')
);
create index shrine_visitors_last_seen on public.shrine_visitors (last_seen_at desc);
create index shrine_visitors_prayers on public.shrine_visitors (prayer_count desc);

create table public.shrine_lanterns (
  id text primary key check (length(id) between 1 and 64),
  room text not null check (room ~ '^[a-z0-9_-]{1,32}$'),
  owner_hash text not null check (owner_hash ~ '^[a-f0-9]{64}$'),
  product_id text not null check (product_id in ('paper-warm', 'paper-sakura', 'paper-leaf', 'festival-gold')),
  slot smallint not null check (slot between 0 and 23),
  wish text not null check (char_length(wish) <= 36),
  signature text not null check (char_length(signature) <= 12),
  created_at bigint not null,
  expires_at bigint not null check (expires_at > created_at),
  issuance text not null check (issuance = 'free'),
  request_id text not null check (length(request_id) <= 64),
  unique (room, slot),
  unique (room, owner_hash)
);
create index shrine_lanterns_expiry on public.shrine_lanterns (expires_at);

alter table public.shrine_storage_state enable row level security;
alter table public.shrine_visitors enable row level security;
alter table public.shrine_lanterns enable row level security;
revoke all on public.shrine_storage_state, public.shrine_visitors, public.shrine_lanterns from public, anon, authenticated;
grant select, insert, update, delete on public.shrine_storage_state, public.shrine_visitors, public.shrine_lanterns to service_role;

-- One transactional snapshot per dataset. Revision fencing rejects stale game servers.
-- Retrying a timed-out committed write with the SAME UUID returns the original acknowledgement.
create function public.shrine_save_state(
  p_kind text, p_expected_revision bigint, p_write_id uuid, p_records jsonb
) returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  current_state public.shrine_storage_state%rowtype;
begin
  if p_write_id is null or p_expected_revision is null or p_expected_revision < 0 or
      p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'Invalid shrine snapshot';
  end if;
  select * into current_state from public.shrine_storage_state where kind = p_kind for update;
  if not found then raise exception 'Unknown shrine dataset'; end if;
  if current_state.last_write_id = p_write_id then return current_state.revision; end if;
  if current_state.revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'Shrine revision conflict: only one game server may write';
  end if;

  if p_kind = 'visitors' then
    -- Visitors are never removed by a snapshot. Existing history is retained.
    insert into public.shrine_visitors
      select * from jsonb_populate_recordset(null::public.shrine_visitors, p_records)
      on conflict (visitor_id) do update set
        owner_hash = excluded.owner_hash, account_id = excluded.account_id,
        first_seen_at = excluded.first_seen_at, last_seen_at = excluded.last_seen_at,
        last_room = excluded.last_room, connection_count = excluded.connection_count,
        visit_count = excluded.visit_count, prayer_count = excluded.prayer_count,
        fortune_count = excluded.fortune_count, ema_view_count = excluded.ema_view_count,
        lantern_hang_count = excluded.lantern_hang_count, lantern_remove_count = excluded.lantern_remove_count,
        connected_ms = excluded.connected_ms, daily = excluded.daily;
  else
    if jsonb_array_length(p_records) > 768 then raise exception 'Too many shrine lanterns'; end if;
    -- Scoped to this game's table, and rolled back together on any validation error.
    delete from public.shrine_lanterns;
    insert into public.shrine_lanterns
      select * from jsonb_populate_recordset(null::public.shrine_lanterns, p_records);
  end if;
  update public.shrine_storage_state set revision = revision + 1, last_write_id = p_write_id
    where kind = p_kind returning revision into current_state.revision;
  return current_state.revision;
end;
$$;
revoke all on function public.shrine_save_state(text, bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.shrine_save_state(text, bigint, uuid, jsonb) to service_role;

comment on table public.shrine_visitors is 'Komorebi shrine private visitor statistics; JST daily keys, epoch milliseconds.';
comment on table public.shrine_lanterns is 'Komorebi shrine private ownership and currently retained lantern records.';
notify pgrst, 'reload schema';
commit;
