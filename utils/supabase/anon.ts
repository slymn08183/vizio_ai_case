import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cookie-less anonymous Supabase client for NON-personalized, cacheable reads
 * (the public feed slice).
 *
 * Why a bare client and not the cookie-bound server client: the public slice is
 * identical for everyone, so it is wrapped in `unstable_cache` + tagged
 * `TAGS.publicFeed`. `unstable_cache` callbacks may not read cookies/headers, so
 * the request-scoped server client (which awaits cookies()) cannot be used
 * inside them. This client carries no session — it reads exactly what the `anon`
 * role's RLS allows (is_public = true), which is precisely the public feed.
 */
export function createAnonClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
