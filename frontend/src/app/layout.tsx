import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Meeting Copilot",
  description: "Private, local speech transcription and meeting intelligence powered by Whisper & Ollama.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}>
      <body className="min-h-full flex bg-[#080c14] text-slate-100 selection:bg-indigo-500/30">
        <Suspense fallback={<aside className="hidden md:flex w-64 bg-slate-950 border-r border-slate-800 shrink-0" />}>
          <Sidebar />
        </Suspense>
        <main className="flex-1 flex flex-col min-w-0 overflow-y-auto h-screen bg-[#080c14] pt-14 md:pt-0">
          {children}
        </main>
      </body>
    </html>
  );
}
