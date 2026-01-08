"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLoginModal } from "@/lib/auth/login-context";
import supabaseClient from "@/lib/supabase/browser-client";
import { SUPABASE_PKCE_VERIFIER_KEY } from "@/lib/supabase/constants";
import { buildTokenAuthEmail } from "@/lib/auth/tokenAuth";

const GoogleIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.74 1.23 9.24 3.63l6.9-6.9C35.88 2.2 30.31 0 24 0 14.64 0 6.64 5.38 2.75 13.22l8.02 6.23C12.75 13.1 18 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.14-3.09-.4-4.55H24v9.03h12.95c-.56 2.94-2.2 5.43-4.67 7.1l7.56 5.86c4.43-4.09 7.14-10.12 7.14-17.44z"
    />
    <path
      fill="#FBBC05"
      d="M10.77 28.98c-.48-1.43-.75-2.96-.75-4.53 0-1.57.27-3.1.75-4.53l-8.02-6.23C.99 16.53 0 20.13 0 24c0 3.87.99 7.47 2.75 10.31l8.02-6.23z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.31 0 11.88-2.08 15.84-5.65l-7.56-5.86c-2.09 1.4-4.77 2.22-8.28 2.22-6 0-11.25-3.6-13.23-8.95l-8.02 6.23C6.64 42.62 14.64 48 24 48z"
    />
  </svg>
);

const MailIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
    <path
      fill="currentColor"
      d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"
    />
  </svg>
);

export function LoginOverlay() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/";
  const { closeLoginModal } = useLoginModal();

  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenActionLoading, setTokenActionLoading] = useState(false);
  const [tokenActionError, setTokenActionError] = useState<string | null>(null);
  const [tokenModalToken, setTokenModalToken] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<
    | "main"
    | "email"
    | "email-password"
    | "email-sent"
    | "email-verify"
    | "create-password"
  >("main");
  const [emailValue, setEmailValue] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordValue, setPasswordValue] = useState("");
  const [isNewEmail, setIsNewEmail] = useState<boolean | null>(null);
  const [otpValue, setOtpValue] = useState("");
  const [createPasswordValue, setCreatePasswordValue] = useState("");
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
        pkceVal =
          typeof window !== "undefined" ? localStorage.getItem(SUPABASE_PKCE_VERIFIER_KEY) : null;
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
        window.location.assign(nextPath);
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
    window.location.assign(nextPath);
  };

  const closeOverlay = () => {
    closeLoginModal();
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
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-white/10 bg-[#0f0f0f] p-6 shadow-[0_25px_80px_rgba(0,0,0,0.8)]">
        <div className="space-y-2">
          <h3 className="text-xl font-semibold text-white">Save your login token</h3>
          <p className="text-sm text-white/70">
            This token acts as both your identifier and password. Keep it safe - you will not be shown it again.
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 font-mono text-sm break-words text-white">
          {tokenModalToken}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="ghost"
            className="flex-1 gap-2 justify-center rounded-full border border-white/20 bg-white/5 text-white hover:bg-white/10"
            onClick={handleCopyToken}
          >
            <Copy className="h-4 w-4" />
            {copyStatus === "copied" ? "Copied" : "Copy token"}
          </Button>
          <Button
            className="flex-1 rounded-full bg-white text-black font-semibold"
            onClick={closeTokenModal}
          >
            Continue to app
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4 py-8">
      <div className="w-full max-w-md rounded-[32px] border border-white/10 bg-gradient-to-b from-white/5 to-black/90 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.8)] backdrop-blur-xl">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-white">Log in or sign up</h1>
            <p className="mt-1 text-sm text-white/60">
              You'll get smarter responses and can upload files, images, and more.
            </p>
          </div>
          <button
            type="button"
            className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/60 hover:bg-white/10 transition"
            onClick={closeOverlay}
          >
            Close
          </button>
        </div>

        <div className="mt-6 space-y-3">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 rounded-full border border-white/20 bg-white/5 px-5 py-3 text-base font-medium text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] transition hover:bg-white/10"
            onClick={handleGoogleLogin}
            disabled={googleLoading}
          >
            <span className="flex h-8 w-8 items-center justify-center">
              <GoogleIcon />
            </span>
            {googleLoading ? "Redirecting..." : "Continue with Google"}
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 rounded-full border border-white/20 bg-white/5 px-5 py-3 text-base font-medium text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] transition hover:bg-white/10"
            onClick={() => {
              setAuthMode("email");
              setEmailError(null);
            }}
          >
            <span className="flex h-8 w-8 items-center justify-center">
              <MailIcon />
            </span>
            Continue with email
          </Button>
        </div>

        {authMode === "email" && (
          <div className="mt-4">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setEmailError(null);
                const email = emailValue.trim();
                if (!email) {
                  setEmailError("Please enter an email address");
                  return;
                }

                try {
                  const res = await fetch("/api/auth/check-email", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email }),
                  });
                  const payload = await res.json();
                  if (!res.ok) throw new Error(payload?.error ?? "Failed to check email");
                  if (payload.exists) {
                    setIsNewEmail(false);
                    setAuthMode("email-password");
                  } else {
                    setIsNewEmail(true);
                    // send magic link / OTP for new account
                    const { error } = await supabaseClient.auth.signInWithOtp({ email });
                    if (error) {
                      setEmailError(error.message ?? String(error));
                      return;
                    }
                    setAuthMode("email-verify");
                  }
                } catch (err: any) {
                  setEmailError(err?.message ?? "Error checking email");
                }
              }}
              className="space-y-3"
            >
              <Input
                id="continue-email"
                value={emailValue}
                onChange={(e) => setEmailValue(e.target.value)}
                placeholder="you@example.com"
                className="bg-white/5 text-white placeholder:text-white/40"
              />
              {emailError && <p className="text-sm text-destructive">{emailError}</p>}
              <div className="flex gap-3">
                <Button type="submit" className="flex-1 rounded-full bg-white text-black">
                  Continue
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1 rounded-full border border-white/10"
                  onClick={() => setAuthMode("main")}
                >
                  Back
                </Button>
              </div>
            </form>
          </div>
        )}

        {authMode === "email-password" && (
          <div className="mt-4">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setTokenActionError(null);
                try {
                  const { data, error } = await supabaseClient.auth.signInWithPassword({
                    email: emailValue.trim(),
                    password: passwordValue,
                  });
                  if (error) throw error;
                  // successful sign in
                  window.location.assign(nextPath);
                } catch (err: any) {
                  setTokenActionError(err?.message ?? "Failed to sign in");
                }
              }}
              className="space-y-3"
            >
              <Input
                id="continue-email-password"
                value={passwordValue}
                onChange={(e) => setPasswordValue(e.target.value)}
                placeholder="Password"
                type="password"
                className="bg-white/5 text-white placeholder:text-white/40"
              />
              {tokenActionError && <p className="text-sm text-destructive">{tokenActionError}</p>}
              <div className="flex gap-3">
                <Button type="submit" className="flex-1 rounded-full bg-white text-black">
                  Sign in
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1 rounded-full border border-white/10"
                  onClick={() => setAuthMode("email")}
                >
                  Back
                </Button>
              </div>
            </form>
          </div>
        )}
        {authMode === "email-verify" && (
          <div className="mt-4">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setEmailError(null);
                const code = otpValue.trim();
                if (!code) {
                  setEmailError("Please enter the code from your email");
                  return;
                }
                try {
                  // Try to verify OTP (type may be 'signup' or 'magiclink' depending on Supabase settings)
                  // The SDK may return a session upon successful verification.
                  // @ts-ignore
                  const { data, error } = await supabaseClient.auth.verifyOtp({ email: emailValue.trim(), token: code, type: "signup" });
                  if (error) throw error;
                  // If new user flow, prompt to create password
                  if (isNewEmail) {
                    setAuthMode("create-password");
                    return;
                  }
                  // otherwise reload / redirect since verification may have created a session
                  window.location.assign(nextPath);
                } catch (err: any) {
                  setEmailError(err?.message ?? "Failed to verify code");
                }
              }}
              className="space-y-3"
            >
              <Input
                id="otp-code"
                value={otpValue}
                onChange={(e) => setOtpValue(e.target.value)}
                placeholder="Enter code"
                className="bg-white/5 text-white placeholder:text-white/40"
              />
              {emailError && <p className="text-sm text-destructive">{emailError}</p>}
              <div className="flex gap-3">
                <Button type="submit" className="flex-1 rounded-full bg-white text-black">Verify</Button>
                <Button variant="ghost" className="flex-1 rounded-full border border-white/10" onClick={() => setAuthMode("email")}>Back</Button>
              </div>
            </form>
          </div>
        )}

        {authMode === "create-password" && (
          <div className="mt-4">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setEmailError(null);
                const pw = createPasswordValue.trim();
                if (pw.length < 8) {
                  setEmailError("Password must be at least 8 characters");
                  return;
                }
                try {
                  // Update user's password. This requires a valid session after OTP verification.
                  // If no session exists, attempt to sign in with email+password after setting password server-side would be required.
                  const { data, error } = await supabaseClient.auth.updateUser({ password: pw });
                  if (error) throw error;
                  // after password set, redirect
                  window.location.assign(nextPath);
                } catch (err: any) {
                  setEmailError(err?.message ?? "Failed to set password");
                }
              }}
              className="space-y-3"
            >
              <Input
                id="create-password"
                value={createPasswordValue}
                onChange={(e) => setCreatePasswordValue(e.target.value)}
                placeholder="Create a password"
                type="password"
                className="bg-white/5 text-white placeholder:text-white/40"
              />
              {emailError && <p className="text-sm text-destructive">{emailError}</p>}
              <div className="flex gap-3">
                <Button type="submit" className="flex-1 rounded-full bg-white text-black">Create password</Button>
                <Button variant="ghost" className="flex-1 rounded-full border border-white/10" onClick={() => setAuthMode("email")}>
                  Back
                </Button>
              </div>
            </form>
          </div>
        )}

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
