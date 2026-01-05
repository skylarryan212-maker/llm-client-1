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
  const [tokenLoginLoading, setTokenLoginLoading] = useState(false);
  const [tokenLoginError, setTokenLoginError] = useState<string | null>(null);
  const [tokenSignupLoading, setTokenSignupLoading] = useState(false);
  const [tokenSignupError, setTokenSignupError] = useState<string | null>(null);
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

  const handleTokenLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedToken = tokenInput.trim();
    if (!trimmedToken) {
      setTokenLoginError("Please enter your token");
      return;
    }
    setTokenLoginLoading(true);
    setTokenLoginError(null);
    try {
      const { error } = await supabaseClient.auth.signInWithPassword({
        email: buildTokenAuthEmail(trimmedToken),
        password: trimmedToken,
      });
      if (error) {
        throw error;
      }
      router.push(nextPath);
    } catch (err: any) {
      setTokenLoginError(err?.message ?? "Failed to log in with token");
    } finally {
      setTokenLoginLoading(false);
    }
  };

  const handleTokenSignup = async () => {
    setTokenSignupLoading(true);
    setTokenSignupError(null);
    try {
      const res = await fetch("/api/auth/token", {
        method: "POST",
      });
      const payload = await res.json();
      if (!res.ok || !payload?.token) {
        throw new Error(payload?.error ?? "Unable to create a token account");
      }
      const token = payload.token;
      const { error } = await supabaseClient.auth.signInWithPassword({
        email: buildTokenAuthEmail(token),
        password: token,
      });
      if (error) {
        throw error;
      }
      setTokenModalToken(token);
      setCopyStatus("idle");
      setTokenInput("");
    } catch (err: any) {
      setTokenSignupError(err?.message ?? "Failed to create a token login");
    } finally {
      setTokenSignupLoading(false);
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
          disabled={googleLoading}
          className="w-full justify-center"
        >
          {googleLoading ? "Redirecting..." : "Continue with Google"}
        </Button>
        {googleError ? (
          <p className="text-sm text-destructive" role="alert">
            {googleError}
          </p>
        ) : null}
        <div className="space-y-4 rounded-xl border border-border bg-muted/30 p-5">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Token login</h2>
            <p className="text-xs text-muted-foreground">
              Sign up with a token to skip email, or reuse an existing token to log in instantly.
            </p>
          </div>
          <Button
            onClick={handleTokenSignup}
            disabled={tokenSignupLoading}
            className="w-full justify-center"
          >
            {tokenSignupLoading ? "Creating token..." : "Sign up with token"}
          </Button>
          {tokenSignupError && (
            <p className="text-sm text-destructive" role="alert">
              {tokenSignupError}
            </p>
          )}
          <form onSubmit={handleTokenLogin} className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor="token-input">Have a token?</Label>
              <Input
                id="token-input"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder="Enter your login token"
                disabled={tokenLoginLoading}
              />
            </div>
            <Button type="submit" className="w-full justify-center" disabled={tokenLoginLoading}>
              {tokenLoginLoading ? "Signing in..." : "Log in with token"}
            </Button>
            {tokenLoginError && (
              <p className="text-sm text-destructive" role="alert">
                {tokenLoginError}
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


