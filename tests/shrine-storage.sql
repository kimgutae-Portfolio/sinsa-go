-- Run only in a disposable local Postgres cluster after the shrine migration.
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
do $$ begin
  begin
    perform public.shrine_save_state('lanterns',1,'00000000-0000-4000-8000-000000000004',
     '[{"id":"broken","room":"garden","owner_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","product_id":"paper-warm","slot":99,"wish":"test","signature":"test","created_at":1000,"expires_at":100000,"issuance":"free","request_id":"request_0002"}]');
    raise exception 'Invalid lantern was accepted';
  exception when check_violation then null; end;
  if not exists (select 1 from public.shrine_lanterns where id='test-lantern') then
    raise exception 'Failed write deleted the previous lantern snapshot'; end if;
  if (select revision from public.shrine_storage_state where kind='lanterns') <> 1 then
    raise exception 'Failed write advanced the revision'; end if;
end $$;
rollback;
