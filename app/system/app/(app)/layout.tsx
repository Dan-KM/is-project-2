import Link from "next/link";
import { Suspense } from "react";
import { logoutAction } from "@/app/actions/auth";
import { getActor } from "@/lib/auth/current-user";
import { t } from "@/lib/i18n";

// Shell for every signed-in page: brand + account links on top, content in a
// single phone-width column. The account links read the session cookie, so
// they stream in behind Suspense (Cache Components rule).

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-2">
          <Link href="/" className="flex min-h-11 items-center gap-2 font-semibold text-primary">
            <span aria-hidden className="text-xl">💧</span>
            {t("app.name")}
          </Link>
          <Suspense fallback={null}>
            <AccountLinks />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-5">{children}</main>
    </div>
  );
}

async function AccountLinks() {
  const actor = await getActor();
  if (!actor) return null;
  return (
    <nav className="flex items-center gap-1 text-sm">
      <Link href="/profile" className="flex min-h-11 items-center rounded-lg px-3 hover:bg-accent">
        {t("nav.profile")}
      </Link>
      <form action={logoutAction}>
        <button type="submit" className="flex min-h-11 items-center rounded-lg px-3 text-muted hover:bg-accent">
          {t("nav.logout")}
        </button>
      </form>
    </nav>
  );
}
