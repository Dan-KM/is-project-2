"use client";

import { House, Tractor, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import { cx, focusRing } from "@/components/ui";
import { t } from "@/lib/i18n";

// Bottom tab bar for the top-level screens (ui-ux-pro-max: bottom-nav-limit
// <= 5 items, icon + label, current tab highlighted, clear of the phone's
// home indicator via the safe-area inset).

const TABS: Array<{ href: string; label: string; icon: LucideIcon; match: (path: string) => boolean }> = [
  { href: "/", label: "nav.dashboard", icon: House, match: (p) => p === "/" },
  {
    href: "/farms",
    label: "nav.farms",
    icon: Tractor,
    // Everything under a farm (fields, crops, readings, water, predictions) belongs to this tab
    match: (p) => /^\/(farms|fields|plantings|growth|readings|predictions)(\/|$)/.test(p),
  },
  { href: "/profile", label: "nav.profile", icon: UserRound, match: (p) => p.startsWith("/profile") },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label={t("nav.main")}
      className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-3">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium",
                  active ? "text-primary" : "text-muted hover:text-foreground",
                  focusRing,
                )}
              >
                {/* The active tab also gets a pill behind the icon, so colour isn't the only cue */}
                <span className={cx("rounded-full px-4 py-1", active && "bg-accent")}>
                  <Icon icon={tab.icon} />
                </span>
                {t(tab.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
