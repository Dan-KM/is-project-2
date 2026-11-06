import { t } from "@/lib/i18n";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-8">
      <div className="mb-6 text-center">
        <div aria-hidden className="mb-2 text-4xl">💧</div>
        <p className="text-xl font-semibold text-primary">{t("app.name")}</p>
        <p className="text-muted">{t("app.tagline")}</p>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-5">{children}</div>
    </main>
  );
}
