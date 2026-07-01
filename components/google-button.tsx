"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { buttonClasses } from "@/components/ui";

/**
 * Google OAuth (PKCE). `@supabase/ssr` returns a short-lived `code` in the query
 * string that /auth/callback exchanges for a session over a back channel —
 * nothing sensitive lands in the URL fragment.
 */
export function GoogleButton({ next = "/" }: { next?: string }) {
  const [loading, setLoading] = useState(false);

  async function signInWithGoogle() {
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (error) setLoading(false); // on success the browser navigates away
  }

  return (
    <button
      type="button"
      onClick={signInWithGoogle}
      disabled={loading}
      className={buttonClasses("secondary")}
    >
      {loading ? "Redirecting…" : "Continue with Google"}
    </button>
  );
}
