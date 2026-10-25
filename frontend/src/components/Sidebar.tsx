"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  FolderKanban, 
  BotMessageSquare, 
  Sliders, 
  ShieldCheck, 
  Cpu, 
  Radio,
  Mic,
  Menu,
  X
} from "lucide-react";

const NAV_ITEMS = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Live Recording", href: "/live", icon: Mic },
  { name: "Meetings", href: "/meetings", icon: FolderKanban },
  { name: "Voice Assistant", href: "/copilot", icon: BotMessageSquare },
  { name: "Settings", href: "/settings", icon: Sliders },
];

interface NavContentProps {
  pathname: string;
  onNavigate?: () => void;
}

function NavContent({ pathname, onNavigate }: NavContentProps) {
  return (
    <div className="flex flex-col justify-between h-full">
      <div>
        {/* Brand Header */}
        <div className="h-16 px-6 flex items-center justify-between border-b border-slate-800/80">
          <Link href="/" onClick={onNavigate} className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 flex items-center justify-center shadow-lg shadow-indigo-500/25 text-white font-bold transition-transform group-hover:scale-105">
              <Radio className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold tracking-tight text-white group-hover:text-indigo-200 transition-colors">
                  AI Copilot
                </span>
                <span className="text-[9px] uppercase font-mono px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/25">
                  Local
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Meeting Intelligence</p>
            </div>
          </Link>
        </div>

        {/* Navigation Items */}
        <nav className="p-4 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-3 pb-1">
            Workspace
          </p>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={`relative flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                  isActive
                    ? "bg-indigo-600/15 text-indigo-300 border border-indigo-500/30 shadow-sm shadow-indigo-950/40"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/70"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`w-4 h-4 transition-colors ${
                      isActive ? "text-indigo-400" : "text-slate-400 group-hover:text-slate-200"
                    }`}
                  />
                  <span>{item.name}</span>
                </div>
                {isActive && (
                  <span className="w-1.5 h-4 bg-indigo-500 rounded-full shadow-sm shadow-indigo-500/50" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Local Privacy & Model Pill */}
      <div className="p-4 border-t border-slate-800/80 space-y-2">
        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800/90 text-xs space-y-2 shadow-inner">
          <div className="flex items-center justify-between text-slate-300 font-medium">
            <span className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              100% Private & Local
            </span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Cpu className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="font-mono">whisper + llama3.2</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [prevPathname, setPrevPathname] = useState(pathname);

  // Close mobile drawer on route change without cascading effect render
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setMobileOpen(false);
  }

  return (
    <>
      {/* Mobile Top Navbar Bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 flex items-center justify-between px-4 z-40">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white">
            <Radio className="w-4 h-4" />
          </div>
          <span className="text-sm font-semibold text-white">AI Meeting Copilot</span>
        </Link>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle Navigation Menu"
          className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-72 max-w-[80vw] bg-slate-950 border-r border-slate-800 h-full flex flex-col justify-between shadow-2xl z-10 animate-in slide-in-from-left duration-200">
            <NavContent pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Desktop Sticky Sidebar */}
      <aside className="hidden md:flex w-64 bg-slate-950/70 border-r border-slate-800/80 backdrop-blur-md flex-col justify-between h-screen sticky top-0 shrink-0 z-30">
        <NavContent pathname={pathname} />
      </aside>
    </>
  );
}
