// app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ProjectsProvider } from "@/components/projects/projects-provider";
import { ChatProvider, StoredChat } from "@/components/chat/chat-provider";
import { getProjectsForUser } from "@/lib/data/projects";
import { getConversationsForUser } from "@/lib/data/conversations";

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
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const projects = await getProjectsForUser();
  const conversations = await getConversationsForUser();

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

  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="font-sans antialiased bg-background text-foreground">
        <ProjectsProvider initialProjects={initialProjectSummaries}>
          <ChatProvider initialChats={initialChats}>{children}</ChatProvider>
        </ProjectsProvider>
      </body>
    </html>
  );
}
