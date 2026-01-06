"use client";

import { FormEvent, useEffect, useRef, useState, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import supabaseClient from "@/lib/supabase/browser-client";
import { SUPABASE_PKCE_VERIFIER_KEY } from "@/lib/supabase/constants";
import { buildTokenAuthEmail } from "@/lib/auth/tokenAuth";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/";

  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenActionLoading, setTokenActionLoading] = useState(false);
  const [tokenActionError, setTokenActionError] = useState<string | null>(null);
  const [tokenModalToken, setTokenModalToken] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setGoogleError(null);

    let redirectTo: string | undefined;
    if (typeof window !== "undefined") {
      redirectTo = `${window.location.origin}/auth/callback`;
    }

    const { data, error: authError } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (authError) {
      setGoogleError(authError.message ?? String(authError));
      setGoogleLoading(false);
      return;
    }

    const providerUrl = data?.url;
    if (!providerUrl) {
      setGoogleError("Could not get provider URL from auth client.");
      setGoogleLoading(false);
      return;
    }

    try {
      let pkceVal: string | null = null;
      for (let i = 0; i < 5; i++) {
        pkceVal = typeof window !== "undefined" ? localStorage.getItem(SUPABASE_PKCE_VERIFIER_KEY) : null;
        if (pkceVal) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
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

  const handleTokenAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedToken = tokenInput.trim();

    setTokenActionLoading(true);
    setTokenActionError(null);

    try {
      if (trimmedToken) {
        const { error } = await supabaseClient.auth.signInWithPassword({
          email: buildTokenAuthEmail(trimmedToken),
          password: trimmedToken,
        });
        if (error) {
          throw error;
        }
        router.push(nextPath);
        return;
      }

      const res = await fetch("/api/auth/token", {
        method: "POST",
      });
      const payload = await res.json();
      if (!res.ok || !payload?.token) {
        throw new Error(payload?.error ?? "Unable to create a token account");
      }
      const generatedToken = payload.token;
      const { error } = await supabaseClient.auth.signInWithPassword({
        email: buildTokenAuthEmail(generatedToken),
        password: generatedToken,
      });
      if (error) {
        throw error;
      }
      setTokenModalToken(generatedToken);
      setCopyStatus("idle");
      setTokenInput("");
    } catch (err: any) {
      setTokenActionError(
        err?.message ??
          (trimmedToken ? "Failed to log in with token" : "Failed to create a token login")
      );
    } finally {
      setTokenActionLoading(false);
    }
  };

  const handleCopyToken = async () => {
    if (!tokenModalToken || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(tokenModalToken);
      setCopyStatus("copied");
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopyStatus("idle");
      }, 1500);
    } catch (err) {
      console.error("[login] failed to copy token", err);
    }
  };

  const closeTokenModal = () => {
    setTokenModalToken(null);
    setCopyStatus("idle");
    router.push(nextPath);
  };

  useEffect(() => {
    const err = searchParams.get("error");
    if (err) {
      setGoogleError(err);
    }
  }, [searchParams]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const tokenOverlay = tokenModalToken ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="space-y-2">
          <h3 className="text-xl font-semibold">Save your login token</h3>
          <p className="text-sm text-muted-foreground">
            This token acts as both your identifier and password. Keep it safe - you will not be shown it again.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-muted/50 p-4 font-mono text-sm break-words">
          {tokenModalToken}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            className="flex-1 gap-2 justify-center"
            onClick={handleCopyToken}
          >
            <Copy className="h-4 w-4" />
            {copyStatus === "copied" ? "Copied" : "Copy token"}
          </Button>
          <Button className="flex-1" onClick={closeTokenModal}>
            Continue to app
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="min-h-screen bg-[#030303] text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-[32px] border border-white/10 bg-gradient-to-b from-white/5 to-black/90 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.8)] backdrop-blur-xl">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Log in or sign up</h1>
            <p className="mt-1 text-sm text-white/60">
              You'll get smarter responses and can upload files, images, and more.
            </p>
          </div>
          <button
            type="button"
            className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/60 hover:bg-white/10 transition"
            onClick={() => router.push("/")}
          >
            Close
          </button>
        </div>

        <div className="mt-6 space-y-3">
          <Button
            variant="ghost"
            className="w-full justify-start rounded-full border border-white/20 bg-white/5 px-5 py-3 text-base font-medium text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] transition hover:bg-white/10"
            onClick={handleGoogleLogin}
            disabled={googleLoading}
          >
            {googleLoading ? "Redirecting..." : "Continue with Google"}
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start rounded-full border border-white/10 bg-transparent px-5 py-3 text-base font-medium text-white/70"
            disabled
          >
            Continue with Apple
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start rounded-full border border-white/10 bg-transparent px-5 py-3 text-base font-medium text-white/70"
            disabled
          >
            Continue with Microsoft
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start rounded-full border border-white/10 bg-transparent px-5 py-3 text-base font-medium text-white/70"
            disabled
          >
            Continue with phone
          </Button>
        </div>

        {googleError ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {googleError}
          </p>
        ) : null}

        <div className="mt-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.4em] text-white/50">
          <span className="flex-1 h-px bg-white/20" />
          <span>or</span>
          <span className="flex-1 h-px bg-white/20" />
        </div>

        <div className="mt-5 space-y-3 rounded-2xl border border-white/10 bg-black/20 p-5">
          <form onSubmit={handleTokenAction} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="token-input" className="text-white/70">
                Token
              </Label>
              <Input
                id="token-input"
                className="bg-white/5 text-white placeholder:text-white/40 focus:bg-white/10 focus:border-white/30"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder="Enter saved token (optional)"
                disabled={tokenActionLoading}
              />
            </div>
            <p className="text-[11px] text-white/50">
              Your token is a short hex string that acts as both email and password.
            </p>
            <Button
              type="submit"
              className="w-full justify-center rounded-full bg-white text-black px-5 py-3 font-medium shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
              disabled={tokenActionLoading}
            >
              {tokenActionLoading ? "Processing..." : "Use or create a token"}
            </Button>
            {tokenActionError && (
              <p className="text-sm text-destructive" role="alert">
                {tokenActionError}
              </p>
            )}
          </form>
        </div>
      </div>
      {tokenOverlay}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
          <div className="w-full max-w-md space-y-6 border border-border rounded-xl p-8 shadow-sm bg-card">
            <div className="text-center">Loading...</div>
          </div>
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}


