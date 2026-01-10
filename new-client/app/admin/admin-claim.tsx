"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { claimAdminAccess } from "@/app/actions/admin-actions";

export function AdminClaim({
  email,
  isGoogleUser,
}: {
  email: string | null;
  isGoogleUser: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClaim = () => {
    setError(null);
    startTransition(async () => {
      const result = await claimAdminAccess();
      if (!result?.ok) {
        setError(result?.error ?? "Failed to claim admin access.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6">
      <div className="max-w-xl rounded-3xl border border-white/10 bg-gradient-to-b from-white/10 to-black/80 p-8 space-y-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold">Claim admin console</h1>
          <p className="text-sm text-slate-300">
            The first Google account to claim this page becomes the permanent admin.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-slate-200">
          <p className="font-semibold">Signed in as</p>
          <p className="mt-1 text-slate-300">{email ?? "Unknown email"}</p>
          {!isGoogleUser ? (
            <p className="mt-3 text-amber-300">
              This account is not a Google login. Please sign in with Google to claim admin access.
            </p>
          ) : null}
        </div>
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        <Button
          onClick={handleClaim}
          disabled={!isGoogleUser || isPending}
          className="w-full rounded-full text-sm font-semibold"
        >
          {isPending ? "Claiming access..." : "Claim admin access"}
        </Button>
      </div>
    </div>
  );
}
