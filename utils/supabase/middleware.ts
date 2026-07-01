import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookiesToSet = { name: string; value: string; options: CookieOptions }[];

/**
 * Refreshes the session cookie and resolves the verified acting team.
 *
 * Returns the NextResponse (carrying any refreshed session cookies), the
 * network-validated `user`, and the locally-decoded custom `claims`
 * (app_metadata.{team_id,onboarded}) the Auth Hook injected. The middleware uses
 * these for routing only; RLS is the real authorization boundary.
 */
export async function updateSession(request: NextRequest) {
  // Strip any client-supplied x-team-id so a caller cannot spoof team identity.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-team-id");

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // (1) FRESH, network-validated identity. Do not run code between
  //     createServerClient and getUser(). getUser() also transparently refreshes
  //     an expiring token; the setAll() handler persists the new cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // (2) Locally-decoded custom claims the Auth Hook injected UNDER app_metadata
  //     (matches the hook write path + current_user_team_id()).
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = (claimsData?.claims ?? null) as
    | { app_metadata?: { team_id?: string; onboarded?: boolean }; sub?: string }
    | null;

  // (3) Inject the VERIFIED team_id as a request header for Server Components,
  //     preserving any refresh cookies queued onto `response`.
  if (user && claims?.app_metadata?.team_id) {
    requestHeaders.set("x-team-id", String(claims.app_metadata.team_id));
    const refreshed = NextResponse.next({ request: { headers: requestHeaders } });
    response.cookies.getAll().forEach((c) => refreshed.cookies.set(c));
    response = refreshed;
  }

  return { response, user, claims };
}
