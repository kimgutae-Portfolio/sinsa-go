-- Ema remain room-scoped, but one owner may retain only one ema across all rooms.
-- Refuse legacy duplicates without removing, moving or rewriting any records.
begin;

lock table public.shrine_lanterns in share row exclusive mode;
do $$ begin
  if exists (
    select 1 from public.shrine_lanterns group by owner_hash having count(*) > 1
  ) then
    raise exception 'Existing ema ownership duplicates must be resolved before applying the global quota; no records were removed';
  end if;
end $$;

create unique index if not exists shrine_lanterns_owner_hash_unique
  on public.shrine_lanterns (owner_hash);

-- Do not silently accept an unrelated index with the same name.
do $$ begin
  if not exists (
    select 1 from pg_index as i
      join pg_attribute as a on a.attrelid = i.indrelid and a.attname = 'owner_hash'
      where i.indexrelid = 'public.shrine_lanterns_owner_hash_unique'::regclass
        and i.indrelid = 'public.shrine_lanterns'::regclass
        and i.indisunique and i.indisvalid
        and i.indpred is null and i.indexprs is null
        and i.indkey::text = a.attnum::text
  ) then
    raise exception 'Unexpected shrine ema ownership index; global quota migration refused';
  end if;
end $$;

-- Existing table data, columns, roles, grants, policies and storage revisions are unchanged.
commit;
