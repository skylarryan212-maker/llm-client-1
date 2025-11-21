"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code.trim()) {
      setError("Enter the access code.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!response.ok) {
        throw new Error("Invalid code");
      }
      router.replace("/");
      router.refresh();
    } catch (err) {
      console.error("Login failed", err);
      setError("Invalid code. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050509] px-4 py-8 text-zinc-100">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#0c0c13] p-6 shadow-2xl">
        <div className="mb-6 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-white/40">LLM Client</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">Sign in</h1>
          <p className="mt-1 text-sm text-white/60">
            Enter the access code to continue.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/60">
              Access code
            </label>
            <input
              type="password"
              className="w-full rounded-2xl border border-white/10 bg-[#12121a] px-4 py-3 text-sm text-white focus:border-[#5c5cf5] focus:outline-none"
              value={code}
              autoComplete="off"
              onChange={(event) => setCode(event.target.value)}
              autoFocus
            />
          </div>
          {error && (
            <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-2xl bg-[#5c5cf5] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#7070ff] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
