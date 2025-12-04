// app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ProjectsProvider } from "@/components/projects/projects-provider";
import { ChatProvider, StoredChat } from "@/components/chat/chat-provider";
import { AccentColorProvider } from "@/components/accent-color-provider";
import { getProjectsForUser } from "@/lib/data/projects";
import { getConversationsForUser } from "@/lib/data/conversations";
import { getUserPreferences } from "@/lib/data/user-preferences";
import { getCurrentUserIdentity } from "@/lib/supabase/user";
import { UserIdentityProvider } from "@/components/user-identity-provider";
import { UsageSnapshotProvider } from "@/components/usage-snapshot-provider";
import { getMonthlySpending } from "@/app/actions/usage-actions";
import { getUserPlan } from "@/app/actions/plan-actions";
import { getUsageStatus } from "@/lib/usage-limits";
import { LocationPermissionWrapper } from "@/components/location-permission-wrapper";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "LLM Client - AI Platform for Developers",
  description: "A refined, modern AI platform built for developers",
  themeColor: "#000000",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await getCurrentUserIdentity();

  const isGuest = identity.isGuest;

  const projects = isGuest ? [] : await getProjectsForUser();
  const conversations = isGuest ? [] : await getConversationsForUser();
  const userPreferences = isGuest ? null : await getUserPreferences();
  let usageSnapshot = null;
  if (!isGuest) {
    const [monthlySpending, planType] = await Promise.all([
      getMonthlySpending(),
      getUserPlan(),
    ]);
    usageSnapshot = {
      spending: monthlySpending,
      status: getUsageStatus(monthlySpending, planType),
    };
  }

  const initialProjectSummaries = projects.map((project) => ({
    id: project.id,
    name: project.name ?? "Untitled project",
    createdAt: project.created_at ?? "",
  }));

  const initialChats: StoredChat[] = conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title ?? "Untitled chat",
    timestamp: conversation.created_at ?? new Date().toISOString(),
    projectId: conversation.project_id ?? undefined,
    messages: [],
  }));

  const initialAccentColor = userPreferences?.accent_color ?? "white";

  return (
    <html
      lang="en"
      className={`dark bg-background ${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="font-sans antialiased bg-background text-foreground">
        <UserIdentityProvider identity={identity}>
          <UsageSnapshotProvider value={usageSnapshot}>
            <AccentColorProvider initialAccentColor={initialAccentColor}>
              <ProjectsProvider initialProjects={initialProjectSummaries} userId={identity.userId ?? ""}>
                <ChatProvider initialChats={initialChats} userId={identity.userId ?? ""}>
                  <LocationPermissionWrapper />
                  {children}
                </ChatProvider>
              </ProjectsProvider>
            </AccentColorProvider>
          </UsageSnapshotProvider>
        </UserIdentityProvider>
      </body>
    </html>
  );
}
