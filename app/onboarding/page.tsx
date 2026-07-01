import { Card } from "@/components/ui";
import { createClient } from "@/utils/supabase/server";
import { getCurrentTeamId } from "@/lib/auth/claims";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Set up your team — TeamSocial" };

export default async function OnboardingPage() {
  // Prefill the name the user chose at signup (the trigger seeded it).
  const supabase = await createClient();
  const teamId = await getCurrentTeamId();
  let defaultName: string | undefined;
  if (teamId) {
    const { data } = await supabase
      .from("teams")
      .select("name")
      .eq("id", teamId)
      .maybeSingle();
    if (data?.name && data.name !== "My Team") defaultName = data.name;
  }

  return (
    <div className="mx-auto mt-8 max-w-md">
      <h1 className="mb-1 text-xl font-semibold">Set up your team</h1>
      <p className="mb-6 text-sm text-muted">
        Name your team and choose its visibility. This is the identity everything
        you post and send will appear under.
      </p>
      <Card className="p-6">
        <OnboardingForm defaultName={defaultName} />
      </Card>
    </div>
  );
}
