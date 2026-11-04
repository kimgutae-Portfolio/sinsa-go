import "../server/env.ts";
import { ShrineDatabase, supabaseConfig, openSupabaseRepositories } from "../server/storage/supabase.ts";
const repositories = await openSupabaseRepositories(new ShrineDatabase(supabaseConfig()));
console.log(JSON.stringify({ connected: true, visitors: repositories.visitors.load().length,
  lanterns: repositories.lanterns.load().length, storage: "supabase" }, null, 2));
