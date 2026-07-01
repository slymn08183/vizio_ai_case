import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

// Routes viewable while logged OUT: the public home feed ("/"), the auth screens,
// and the /auth/* exchange routes.
const PUBLIC_PREFIXES = ["/login", "/signup", "/auth"];

function isPublic(pathname: string) {
  return pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  // Keep any refreshed session cookies that updateSession queued.
  from.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  return redirect;
}

export async function middleware(request: NextRequest) {
  const { response, user, claims } = await updateSession(request);
  const { pathname } = request.nextUrl;
  const url = request.nextUrl.clone();

  const isAuthRoute =
    pathname.startsWith("/login") || pathname.startsWith("/signup");
  const isOnboarding = pathname.startsWith("/onboarding");

  // (1) Logged OUT: allow public content, gate everything else to /login.
  if (!user) {
    if (isPublic(pathname)) return response;
    url.pathname = "/login";
    return redirectWithCookies(url, response);
  }

  // (2) Logged IN but sitting on an auth screen → go home.
  if (isAuthRoute) {
    url.pathname = "/";
    return redirectWithCookies(url, response);
  }

  // (2.5) Logged IN but TEAMLESS — the user was removed from their team, so
  //       their (refreshed) token carries no team_id claim. They must recover at
  //       /no-team (create or join a team) before anything else. This MUST come
  //       BEFORE the onboarding gate, which assumes a team already exists.
  const teamId = claims?.app_metadata?.team_id;
  const isNoTeam = pathname.startsWith("/no-team");
  if (!teamId) {
    if (isNoTeam || pathname.startsWith("/auth")) return response;
    url.pathname = "/no-team";
    return redirectWithCookies(url, response);
  }
  // A user WITH a team should never sit on the recovery screen.
  if (isNoTeam) {
    url.pathname = "/";
    return redirectWithCookies(url, response);
  }

  // (3) Onboarding gate — read the SAME claim the hook injected into the token
  //     (claims.app_metadata.onboarded), NOT the empty getUser().app_metadata.
  const onboarded = claims?.app_metadata?.onboarded === true;
  if (!onboarded && !isOnboarding) {
    url.pathname = "/onboarding";
    return redirectWithCookies(url, response);
  }
  if (onboarded && isOnboarding) {
    url.pathname = "/";
    return redirectWithCookies(url, response);
  }

  // (4) Pass through; updateSession already set the verified x-team-id header.
  return response;
}

export const config = {
  // Run on everything except static assets / images.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
