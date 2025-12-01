"use client";

import { createContext, useContext } from "react";

export type UsageSnapshot = {
  spending: number;
  status: {
    exceeded: boolean;
    warning: boolean;
    percentage: number;
    remaining: number;
    limit: number;
  };
} | null;

const UsageSnapshotContext = createContext<UsageSnapshot>(null);

export function UsageSnapshotProvider({
  value,
  children,
}: {
  value: UsageSnapshot;
  children: React.ReactNode;
}) {
  return (
    <UsageSnapshotContext.Provider value={value}>
      {children}
    </UsageSnapshotContext.Provider>
  );
}

export function useUsageSnapshot() {
  return useContext(UsageSnapshotContext);
}
