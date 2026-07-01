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
    <header className="sticky top-0 z-20 border-b border-border bg-bg/70 backdrop-blur-md relative">
      <TopLoader />
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-accent/15 font-mono text-xs font-bold text-accent">
            TS
          </span>
          <span className="hidden font-semibold sm:inline">
            Team<span className="text-accent">Social</span>
          </span>
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
          <nav className="flex items-center gap-0.5 text-[13px]">
            {[
              ["/", "Home"],
              ["/teams", "Teams"],
              ["/messages", "Messages"],
              ["/requests", "Requests"],
              ["/settings", "Settings"],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="rounded-md px-2.5 py-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                {label}
              </Link>
            ))}
            <div className="ml-1.5 flex items-center gap-2 border-l border-border pl-2.5">
              {teamName && (
                <div className="hidden items-center gap-2 rounded-full border border-border bg-surface-2 py-1 pl-1 pr-3 sm:flex">
                  <Avatar name={teamName} size={22} />
                  <span className="text-xs leading-none">
                    <span className="text-muted">acting as </span>
                    <span className="font-medium">{teamName}</span>
                  </span>
                </div>
              )}
              <form action={signOut}>
                <button className="rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:text-danger">
                  Sign out
                </button>
              </form>
            </div>
          </nav>
        )}

        {user && !onboarded && (
          <form action={signOut}>
            <button className="rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:text-danger">
              Sign out
            </button>
          </form>
        )}
      </div>
    </header>
  );
}
