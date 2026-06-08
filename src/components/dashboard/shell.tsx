"use client";

/**
 * ============================================================================
 * DASHBOARD SHELL - SUPER DARK MONOCHROME WITH EFFECTS
 * ============================================================================
 * Main layout wrapper with minimal, ultra-dark aesthetic and subtle animations.
 */

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { Bell } from "lucide-react";
import {
  IconLayoutDashboard,
  IconShield,
  IconSettings,
  IconBell,
  IconHeartbeat,
} from "@tabler/icons-react";
import { FloatingDock, DockItem } from "@/components/ui/floating-dock";
import { BackgroundRippleEffect } from "@/components/ui/background-ripple-effect";
import { DarkModeToggle } from "@/components/ui/DarkModeToggle";

interface DashboardShellProps {
  children: React.ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    return pathname.startsWith(href);
  };

  // Navigation items - monochrome
  const dockItems: DockItem[] = [
    {
      title: "Dashboard",
      href: "/dashboard",
      icon: <IconLayoutDashboard className="h-full w-full" />,
      active: isActive("/dashboard"),
    },
    {
      title: "Code Police",
      href: "/dashboard/code-police",
      icon: <IconShield className="h-full w-full" />,
      active: isActive("/dashboard/code-police"),
    },
    {
      title: "Self-Healing",
      href: "/dashboard/self-healing",
      icon: <IconHeartbeat className="h-full w-full" />,
      active: isActive("/dashboard/self-healing"),
    },
    {
      title: "Notifications",
      href: "/dashboard/notifications",
      icon: <IconBell className="h-full w-full" />,
      active: isActive("/dashboard/notifications"),
    },
    {
      title: "Settings",
      href: "/dashboard/settings",
      icon: <IconSettings className="h-full w-full" />,
      active: isActive("/dashboard/settings"),
    },
  ];

  return (
    <div className="relative min-h-screen bg-neutral-950 dark:bg-neutral-950 light:bg-white overflow-hidden">
      {/* Background Effects Layer */}
      <div className="fixed inset-0 z-0">
        {/* Ripple Grid Background */}
        <BackgroundRippleEffect rows={12} cols={35} cellSize={48} />
      </div>

      {/* Header with Gradient Accent */}
      <header className="fixed top-0 left-0 right-0 z-50">
        {/* Gradient accent line */}
        <div className="h-0.5 bg-gradient-to-r from-transparent via-violet-500/50 to-transparent" />

        <div className="h-14 flex items-center justify-between px-6 bg-neutral-950/90 dark:bg-neutral-950/90 light:bg-white/90 backdrop-blur-xl border-b border-white/5 dark:border-white/5 light:border-black/5">
          <a href="/dashboard" className="flex items-center gap-2.5 group">
            <Image
              src="/zero3.png"
              alt="Code-Police Logo"
              width={32}
              height={32}
              className="rounded-lg group-hover:shadow-[0_0_20px_rgba(139,92,246,0.3)] transition-shadow duration-300"
              priority
              unoptimized
            />
            <span className="text-base font-semibold bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
              Code-Police
            </span>
          </a>

          <div className="flex items-center gap-3">
            {/* Theme Toggle */}
            <DarkModeToggle />

            {/* Notifications Link */}
            <Link
              href="/dashboard/notifications"
              className="relative p-2 rounded-lg text-zinc-500 hover:text-violet-400 hover:bg-white/5 transition-all duration-200"
              aria-label="Notifications"
            >
              <Bell className="w-4.5 h-4.5" />
            </Link>

            <UserButton
              afterSignOutUrl="/"
              appearance={{
                elements: {
                  avatarBox: "w-8 h-8 ring-2 ring-white/10",
                  userButtonPopoverCard: "bg-zinc-900 border-zinc-800 backdrop-blur-xl",
                  userButtonPopoverActionButton: "hover:bg-white/5",
                  userButtonPopoverActionButtonText: "text-zinc-300",
                  userButtonPopoverFooter: "hidden",
                },
              }}
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative pt-16 pb-24 min-h-screen z-10">
        {children}
      </main>

      {/* Floating Dock */}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50">
        <FloatingDock items={dockItems} />
      </div>
    </div>
  );
}



