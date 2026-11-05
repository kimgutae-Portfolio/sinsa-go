-- Run only in a disposable local Postgres cluster after both shrine migrations.
begin;
do $$ begin
  if exists (select 1 from pg_class where oid in ('public.shrine_visitors'::regclass,
      'public.shrine_lanterns'::regclass, 'public.shrine_storage_state'::regclass) and not relrowsecurity)
    then raise exception 'RLS is disabled'; end if;
  if has_table_privilege('anon', 'public.shrine_visitors', 'SELECT,INSERT,UPDATE,DELETE') or
     has_table_privilege('authenticated', 'public.shrine_lanterns', 'SELECT,INSERT,UPDATE,DELETE') or
     has_function_privilege('anon', 'public.shrine_save_state(text,bigint,uuid,jsonb)', 'EXECUTE') or
     has_function_privilege('authenticated', 'public.shrine_save_state(text,bigint,uuid,jsonb)', 'EXECUTE')
    then raise exception 'Browser roles have private access'; end if;
end $$;
set local role service_role;
select public.shrine_save_state('visitors',0,'00000000-0000-4000-8000-000000000001',
 '[{"visitor_id":"test-visitor","owner_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","account_id":null,"first_seen_at":1000,"last_seen_at":2000,"last_room":"garden","connection_count":1,"visit_count":1,"prayer_count":2,"fortune_count":0,"ema_view_count":0,"lantern_hang_count":0,"lantern_remove_count":0,"connected_ms":1000,"daily":{}}]');
do $$ declare result bigint; begin
  result := public.shrine_save_state('visitors',0,'00000000-0000-4000-8000-000000000001','[]');
  if result <> 1 then raise exception 'Idempotent retry failed'; end if;
  if (select prayer_count from public.shrine_visitors where visitor_id='test-visitor') <> 2 then
    raise exception 'Retry overwrote data'; end if;
  begin
    perform public.shrine_save_state('visitors',0,'00000000-0000-4000-8000-000000000002','[]');
    raise exception 'Stale revision was accepted';
  exception when sqlstate 'PT409' then null; end;
end $$;
select public.shrine_save_state('lanterns',0,'00000000-0000-4000-8000-000000000003',
 '[{"id":"test-lantern","room":"garden","owner_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","product_id":"paper-warm","slot":0,"wish":"よい一日を","signature":"旅人","created_at":1000,"expires_at":100000,"issuance":"free","request_id":"request_0001"}]');
do $$ declare result bigint; snapshot jsonb; begin
  snapshot := '[{"id":"test-lantern","room":"garden","owner_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","product_id":"paper-warm","slot":0,"wish":"穏やかな一日を","signature":"旅人","created_at":1000,"expires_at":100000,"issuance":"free","request_id":"request_0001"},
    {"id":"second-lantern","room":"hinoki","owner_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","product_id":"paper-sakura","slot":0,"wish":"優しい一日を","signature":"旅人","created_at":2000,"expires_at":100000,"issuance":"free","request_id":"request_0002"}]'::jsonb;
  result := public.shrine_save_state('lanterns',1,'00000000-0000-4000-8000-000000000004',snapshot);
  if result <> 2 or (select count(*) from public.shrine_lanterns) <> 2 or
      (select wish from public.shrine_lanterns where id='test-lantern') <> '穏やかな一日を' then
    raise exception 'Retained ID update and second-room insert failed'; end if;
  result := public.shrine_save_state('lanterns',1,'00000000-0000-4000-8000-000000000004','[]');
  if result <> 2 or (select count(*) from public.shrine_lanterns) <> 2 then
    raise exception 'Lantern retry changed records or advanced the revision'; end if;
  result := public.shrine_save_state('lanterns',2,'00000000-0000-4000-8000-000000000005',jsonb_build_array(snapshot -> 1));
  if result <> 3 or (select count(*) from public.shrine_lanterns) <> 1 or
      exists (select 1 from public.shrine_lanterns where id='test-lantern') or
      not exists (select 1 from public.shrine_lanterns where id='second-lantern' and wish='優しい一日を') then
    raise exception 'Omitted-ID removal did not retain the other room'; end if;
  if (select prayer_count from public.shrine_visitors where visitor_id='test-visitor') <> 2 then
    raise exception 'Lantern snapshot changed visitor records'; end if;
  begin
    perform public.shrine_save_state('lanterns',3,'00000000-0000-4000-8000-000000000006',
     '[{"id":"broken","room":"garden","owner_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","product_id":"paper-warm","slot":99,"wish":"test","signature":"test","created_at":1000,"expires_at":100000,"issuance":"free","request_id":"request_0003"}]');
    raise exception 'Invalid lantern was accepted';
  exception when check_violation then null; end;
  if not exists (select 1 from public.shrine_lanterns where id='second-lantern' and wish='優しい一日を') then
    raise exception 'Failed write deleted the previous lantern snapshot'; end if;
  begin
    perform public.shrine_save_state('lanterns',3,'00000000-0000-4000-8000-000000000007',
      jsonb_build_array(snapshot -> 1, (snapshot -> 1) || '{"id":"duplicate-slot","owner_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'::jsonb));
    raise exception 'Duplicate lantern slot was accepted';
  exception when unique_violation then null; end;
  if (select count(*) from public.shrine_lanterns) <> 1 or
      (select wish from public.shrine_lanterns where id='second-lantern') <> '優しい一日を' then
    raise exception 'Unique validation failure changed retained records'; end if;
  if (select revision from public.shrine_storage_state where kind='lanterns') <> 3 then
    raise exception 'Failed write advanced the revision'; end if;
end $$;
rollback;
