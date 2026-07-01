import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { signOut } from "@/app/(auth)/actions";
import { Avatar, LinkButton } from "@/components/ui";
import { TopLoader } from "@/components/top-loader";

/**
 * Adaptive top bar — the brief's "clear logged-in vs logged-out" affordance.
 *
 * Logged OUT: brand + Sign in / Sign up.
 * Logged IN (onboarded): "Acting as {team}" badge + team nav + Sign out.
 * Logged IN (mid-onboarding): brand + Sign out only (nav would just bounce back
 * to /onboarding via middleware, so it is hidden).
 */
export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let teamName: string | null = null;
  let onboarded = false;

  if (user) {
    const { data: claimsData } = await supabase.auth.getClaims();
    const claims = claimsData?.claims as
      | { app_metadata?: { team_id?: string; onboarded?: boolean } }
      | undefined;
    onboarded = claims?.app_metadata?.onboarded === true;
    const teamId = claims?.app_metadata?.team_id;
    if (teamId) {
      const { data: team } = await supabase
        .from("teams")
        .select("name")
        .eq("id", teamId)
        .maybeSingle();
      teamName = team?.name ?? null;
    }
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur relative">
      <TopLoader />
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-4 px-4">
        <Link href="/" className="font-semibold tracking-tight">
          Team<span className="text-primary">Social</span>
        </Link>

        {!user && (
          <nav className="flex items-center gap-2">
            <LinkButton href="/login" variant="ghost" size="sm">
              Sign in
            </LinkButton>
            <LinkButton href="/signup" size="sm">
              Sign up
            </LinkButton>
          </nav>
        )}

        {user && onboarded && (
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/" className="rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-fg">
              Home
            </Link>
            <Link href="/teams" className="rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-fg">
              Teams
            </Link>
            <Link href="/messages" className="rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-fg">
              Messages
            </Link>
            <Link href="/requests" className="rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-fg">
              Requests
            </Link>
            <Link href="/settings" className="rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-fg">
              Settings
            </Link>
            <div className="mx-1 flex items-center gap-2 border-l border-border pl-3">
              {teamName && <Avatar name={teamName} size={28} />}
              <span className="hidden text-xs text-muted sm:inline">
                Acting as{" "}
                <span className="font-medium text-fg">{teamName ?? "your team"}</span>
              </span>
              <form action={signOut}>
                <button className="rounded-md px-2 py-1.5 text-xs text-muted hover:text-danger">
                  Sign out
                </button>
              </form>
            </div>
          </nav>
        )}

        {user && !onboarded && (
          <form action={signOut}>
            <button className="rounded-md px-2 py-1.5 text-xs text-muted hover:text-danger">
              Sign out
            </button>
          </form>
        )}
      </div>
    </header>
  );
}
