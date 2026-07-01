-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0007 — Custom Access Token Auth Hook (claim injection)                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Owner: 03-auth-and-session.md §5, reconciled by 00-overview.md §6.1.
--
-- GoTrue calls this on EVERY access-token mint (initial sign-in AND every
-- refresh), letting us inject team_id + onboarded straight into the JWT under
-- app_metadata — the SAME path current_user_team_id() (0001) and the middleware
-- read. This is the canonical, race-free way to put data in a JWT: it reads live
-- DB state at mint time, so the very first token already carries correct claims
-- (no refreshSession() dance).
--
-- AFTER THIS MIGRATION, ENABLE THE HOOK:
--   • Local : supabase/config.toml → [auth.hook.custom_access_token] enabled=true
--   • Hosted: Dashboard → Authentication → Hooks → Custom Access Token →
--             public.custom_access_token_hook
-- The supabase_auth_admin read GRANTs + policies it depends on are in 0005.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims      jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_team_id   uuid;
  v_onboarded boolean;
begin
  select p.team_id, t.onboarded into v_team_id, v_onboarded
  from public.profiles p
  join public.teams t on t.id = p.team_id
  where p.id = (event ->> 'user_id')::uuid;

  if not (claims ? 'app_metadata') then   -- ensure parent object exists for jsonb_set
    claims := jsonb_set(claims, '{app_metadata}', '{}'::jsonb);
  end if;
  if v_team_id is not null then
    claims := jsonb_set(claims, '{app_metadata,team_id}', to_jsonb(v_team_id));
  end if;
  claims := jsonb_set(claims, '{app_metadata,onboarded}', to_jsonb(coalesce(v_onboarded, false)));

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Only the auth admin may execute the hook; never clients.
grant  execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
