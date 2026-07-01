import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client. `@supabase/ssr` defaults to the PKCE flow and stores
 * the session in cookies (not localStorage), which is what makes the session
 * readable by Server Components, Server Actions, and middleware on the same
 * request — the foundation of persistent sessions + clear logged-in/out state.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
