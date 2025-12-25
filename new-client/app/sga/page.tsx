export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

import { redirect } from "next/navigation";

import { SgaFleet } from "@/components/sga/sga-fleet";
import { loadSgaInstances } from "@/lib/data/sga";
import { getCurrentUserIdServer } from "@/lib/supabase/user";
import type { SgaInstance } from "@/lib/types/sga";

export default async function SgaFleetPage() {
  const userId = await getCurrentUserIdServer();
  if (!userId) {
    redirect("/login?next=/sga");
  }

  let instances: SgaInstance[] = [];
  try {
    instances = await loadSgaInstances();
  } catch (error) {
    console.error("Failed to load SGA fleet", error);
  }

  return <SgaFleet initialInstances={instances} />;
}
