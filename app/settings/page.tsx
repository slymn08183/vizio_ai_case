import { Card } from "@/components/ui";
import { createClient } from "@/utils/supabase/server";
import { requireCurrentTeamId } from "@/lib/auth/claims";
import type { TeamMember } from "@/lib/types";
import { SettingsForm } from "./settings-form";
import { InviteCard } from "./invite-card";
import { MembersList } from "./members-list";

export const metadata = { title: "Team settings — TeamSocial" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const teamId = await requireCurrentTeamId();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // All three reads are RLS-scoped to the caller's own team:
  //  • teams        → teams_select_authenticated (own team row)
  //  • profiles     → profiles_select_own_team   (teammates only)
  //  • team_invites → team_invites_select_own_team (own code only)
  const [{ data: team }, { data: members }, { data: invite }] =
    await Promise.all([
      supabase.from("teams").select("name, is_public").eq("id", teamId).single(),
      supabase
        .from("profiles")
        .select("id, email, created_at")
        .eq("team_id", teamId)
        .order("created_at", { ascending: true }),
      supabase
        .from("team_invites")
        .select("code")
        .eq("team_id", teamId)
        .maybeSingle(),
    ]);

  return (
    <div className="mx-auto mt-8 flex max-w-md flex-col gap-5">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Team settings</h1>
        <p className="text-sm text-muted">
          Manage your team&apos;s identity, invite teammates, and review members.
        </p>
      </div>

      <Card className="p-6">
        <SettingsForm
          defaultName={team?.name ?? ""}
          defaultIsPublic={team?.is_public ?? false}
        />
      </Card>

      <Card className="p-6">
        <InviteCard code={invite?.code ?? null} />
      </Card>

      <Card className="p-6">
        <MembersList
          members={(members as TeamMember[] | null) ?? []}
          currentUserId={user?.id ?? ""}
        />
      </Card>
    </div>
  );
}
