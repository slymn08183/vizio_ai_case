import { Card } from "@/components/ui";
import { NoTeamForm } from "./no-team-form";

export const metadata = { title: "Join or create a team — TeamSocial" };

/**
 * Recovery screen for a teamless authenticated user (removed from their team).
 * Middleware routes any authed user with no team_id claim here. Everyone belongs
 * to exactly one team, so they must either create a new one or join with a code
 * before continuing.
 */
export default function NoTeamPage() {
  return (
    <div className="mx-auto mt-8 max-w-sm">
      <h1 className="mb-1 text-xl font-semibold">You&apos;re not on a team</h1>
      <p className="mb-6 text-sm text-muted">
        You were removed from your team, or don&apos;t have one yet. Create a new
        team or join an existing one with an invite code to continue.
      </p>
      <Card className="p-6">
        <NoTeamForm />
      </Card>
    </div>
  );
}
