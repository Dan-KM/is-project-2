import { LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { logoutAction } from "@/app/actions/auth";
import { BrandMark } from "@/components/brand-mark";
import { Icon } from "@/components/icon";
import { cx, focusRing } from "@/components/ui";
import { getActor } from "@/lib/auth/current-user";
import { t } from "@/lib/i18n";

// Shell for every signed-in page: brand + account links on top, content in a
// single phone-width column. The account links read the session cookie, so
// they stream in behind Suspense (Cache Components rule).

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Keyboard users can jump past the header straight to the page */}
      <a
        href="#main"
        className="sr-only z-20 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-2"
      >
        {t("nav.skipToContent")}
      </a>
      <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-2">
          <Link href="/" className={cx("flex min-h-11 items-center gap-2 rounded-lg font-semibold text-primary", focusRing)}>
            <BrandMark />
            {t("app.name")}
          </Link>
          <Suspense fallback={null}>
            <AccountLinks />
          </Suspense>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-xl flex-1 px-4 py-5 focus:outline-none">
        {children}
      </main>
    </div>
  );
}

const navItem = cx("flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-3 hover:bg-accent", focusRing);

async function AccountLinks() {
  const actor = await getActor();
  if (!actor) return null;
  return (
    <nav aria-label={t("nav.account")} className="flex items-center gap-1 text-sm">
      <Link href="/profile" className={navItem}>
        <Icon icon={UserRound} size="sm" />
        {t("nav.profile")}
      </Link>
      <form action={logoutAction}>
        <button type="submit" className={cx(navItem, "text-muted")}>
          <Icon icon={LogOut} size="sm" />
          {t("nav.logout")}
        </button>
      </form>
    </nav>
  );
}
