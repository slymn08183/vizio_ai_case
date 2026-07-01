import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "TeamSocial — team-based social MVP",
  description:
    "A team-based social network: every action is under your team's identity. Built with Next.js 15 + Supabase.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <SiteHeader />
        <main className="mx-auto w-full max-w-2xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
