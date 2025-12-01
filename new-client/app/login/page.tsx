"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import supabaseClient from "@/lib/supabase/browser-client";
import { useSearchParams } from "next/navigation";
import { SUPABASE_PKCE_VERIFIER_KEY } from "@/lib/supabase/constants";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);

    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback`
        : undefined;

    // Request provider URL without auto-redirect so we can capture PKCE verifier.
    const { data, error: authError } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        flowType: "pkce",
        skipBrowserRedirect: true,
      },
    });

    if (authError) {
      setError(authError.message ?? String(authError));
      setLoading(false);
      return;
    }

    const providerUrl = data?.url;
    if (!providerUrl) {
      setError("Could not get provider URL from auth client.");
      setLoading(false);
      return;
    }

    // Try to persist PKCE verifier to server for reliability.
    try {
      let pkceVal: string | null = null;
      for (let i = 0; i < 5; i++) {
        pkceVal = typeof window !== "undefined" ? localStorage.getItem(SUPABASE_PKCE_VERIFIER_KEY) : null;
        if (pkceVal) break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 50));
      }
      if (pkceVal) {
        await fetch("/api/auth/pkce", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pkce: pkceVal }),
        });
      }
    } catch (e) {
      console.warn("[login] failed to persist pkce to server", e);
    }

    window.location.assign(providerUrl);
  };

  useEffect(() => {
    const err = searchParams.get("error");
    if (err) {
      setError(err);
    }
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6 border border-border rounded-xl p-8 shadow-sm bg-card">
        <div>
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Continue with your Google account to access your projects and chats.
          </p>
        </div>
        <Button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full justify-center"
        >
          {loading ? "Redirecting…" : "Continue with Google"}
        </Button>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
