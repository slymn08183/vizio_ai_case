import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookiesToSet = { name: string; value: string; options: CookieOptions }[];

/**
 * Server Supabase client for Server Components & Server Actions.
 *
 * Next.js 15: cookies() is ASYNC, so this factory is async and MUST be awaited
 * at every call site (`const supabase = await createClient()`). Forgetting the
 * await yields a client bound to a Promise instead of the cookie store, so
 * getUser() silently sees no session and every RLS-scoped query returns empty.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Thrown when called from a Server Component (read-only cookie store).
            // Safe to ignore: the middleware is the writer that refreshes the session.
          }
        },
      },
    },
  );
}
