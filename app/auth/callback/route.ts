import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

/**
 * OAuth PKCE callback: exchange the `code` query param for a session.
 * The handle_new_user trigger committed the team INSIDE the signup transaction,
 * so the team already exists and the Auth Hook reads a real team_id on this first
 * token — no manual refresh needed here. Middleware then applies the onboarding
 * gate.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient(); // Next 15: await — cookies() is async
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Honor the proxy host on Vercel/load balancers; fall back to origin locally.
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocal = process.env.NODE_ENV === "development";
      const base = isLocal
        ? origin
        : forwardedHost
          ? `https://${forwardedHost}`
          : origin;
      return NextResponse.redirect(`${base}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
