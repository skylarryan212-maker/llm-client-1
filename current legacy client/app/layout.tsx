import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quarry",
  description: "Custom ChatGPT-style LLM client (test mode)",
};

const baseBodyClass = [
  "antialiased",
  "bg-[#050509]",
  "text-zinc-100",
  "min-h-screen",
  "overflow-hidden",
].join(" ");

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full overflow-hidden">
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
      </head>
      <body suppressHydrationWarning className={baseBodyClass}>
        {children}
      </body>
    </html>
  );
}
