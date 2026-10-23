"use client";

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
  Mic
} from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Live Recording", href: "/live", icon: Mic },
    { name: "Meetings", href: "/meetings", icon: FolderKanban },
    { name: "Voice Assistant", href: "/copilot", icon: BotMessageSquare },
    { name: "Settings", href: "/settings", icon: Sliders },
  ];

  return (
    <aside className="w-64 bg-slate-950/70 border-r border-slate-800/80 backdrop-blur-md flex flex-col justify-between h-screen sticky top-0 shrink-0 z-30">
      <div>
        {/* Brand Header */}
        <div className="h-16 px-6 flex items-center gap-3 border-b border-slate-800/70">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white font-bold">
            <Radio className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-slate-100 flex items-center gap-1.5">
              AI Copilot
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                Local
              </span>
            </h1>
            <p className="text-[11px] text-slate-400">Speech & Meeting Intelligence</p>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="p-4 space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-indigo-600/15 text-indigo-400 border border-indigo-500/30 shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-indigo-400" : "text-slate-400"}`} />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Local Privacy & Model Pill */}
      <div className="p-4 border-t border-slate-800/70 space-y-2">
        <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800/80 text-xs space-y-2">
          <div className="flex items-center gap-2 text-slate-300 font-medium">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>100% Private & Local</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Cpu className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>faster-whisper + llama3.2</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
