import { createClient } from "@/utils/supabase/server";

/**
 * The ONE way feature code reads the acting team (owner: plan 03 §6.1 / 00 §6.1).
 *
 * Reads the verified JWT claim at the canonical `app_metadata.team_id` path that
 * the Custom Access Token Auth Hook wrote. NEVER read `getUser().app_metadata`:
 * the provisioning trigger deliberately does not write `raw_app_meta_data`, so
 * that field is empty — the value lives only in the token.
 */
export async function getCurrentTeamId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return (
    ((data?.claims as { app_metadata?: { team_id?: string } } | undefined)
      ?.app_metadata?.team_id) ?? null
  );
}

/**
 * Convenience for Server Actions: resolve the acting team or throw. Keeps every
 * mutation's "who am I acting as" line to one call. RLS is still the real
 * boundary, so a thrown error here is a UX guard, not the security check.
 */
export async function requireCurrentTeamId(): Promise<string> {
  const teamId = await getCurrentTeamId();
  if (!teamId) throw new Error("No acting team on session");
  return teamId;
}
