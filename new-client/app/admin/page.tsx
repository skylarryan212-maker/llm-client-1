import { redirect } from "next/navigation";
import { getAdminGate, getAdminUsageSummary } from "@/app/actions/admin-actions";
import { AdminClaim } from "./admin-claim";
import { AdminDashboard } from "./admin-dashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const gate = await getAdminGate();
  if (gate.status === "unauthenticated") {
    redirect("/login?next=/admin");
  }

  if (gate.status === "unclaimed") {
    return (
      <AdminClaim email={gate.email} isGoogleUser={gate.isGoogleUser} />
    );
  }

  if (gate.status === "forbidden") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6">
        <div className="max-w-lg rounded-2xl border border-white/10 bg-white/5 p-6 text-center space-y-3">
          <h1 className="text-2xl font-semibold">Admin access required</h1>
          <p className="text-sm text-slate-300">
            This admin console is locked to {gate.adminEmail ?? "the owner"}.
          </p>
        </div>
      </div>
    );
  }

  const usage = await getAdminUsageSummary();
  return <AdminDashboard data={usage} adminEmail={gate.adminEmail} />;
}
