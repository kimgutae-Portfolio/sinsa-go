-- Keep snapshot fencing and access rules intact while avoiding an unqualified DELETE.
-- Projects with pg_safeupdate reject DELETE without WHERE, even on an empty table.
begin;

create or replace function public.shrine_save_state(
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
    -- Remove only IDs omitted from this complete snapshot; retained IDs are updated below.
    -- Both operations and the revision update roll back together on any invalid row.
    delete from public.shrine_lanterns as existing
      where not exists (
        select 1 from jsonb_array_elements(p_records) as incoming(value)
          where incoming.value ->> 'id' = existing.id
      );
    insert into public.shrine_lanterns
      select * from jsonb_populate_recordset(null::public.shrine_lanterns, p_records)
      on conflict (id) do update set
        room = excluded.room, owner_hash = excluded.owner_hash,
        product_id = excluded.product_id, slot = excluded.slot,
        wish = excluded.wish, signature = excluded.signature,
        created_at = excluded.created_at, expires_at = excluded.expires_at,
        issuance = excluded.issuance, request_id = excluded.request_id;
  end if;
  update public.shrine_storage_state set revision = revision + 1, last_write_id = p_write_id
    where kind = p_kind returning revision into current_state.revision;
  return current_state.revision;
end;
$$;

-- CREATE OR REPLACE preserves the existing function owner and grants.
-- No role settings, table policies, records or unrelated service objects are changed here.
notify pgrst, 'reload schema';
commit;
