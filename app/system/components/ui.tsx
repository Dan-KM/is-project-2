import Link from "next/link";
import type { ReactNode } from "react";

// Small presentational building blocks (server-safe: no hooks).
// Mobile-first: full-width by default, 44px+ tap targets.

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function PageHeader({ title, back, action }: { title: string; back?: { href: string; label: string }; action?: ReactNode }) {
  return (
    <header className="mb-4">
      {back && (
        <Link href={back.href} className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary">
          <span aria-hidden>←</span> {back.label}
        </Link>
      )}
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">{title}</h1>
        {action}
      </div>
    </header>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-2xl border border-border bg-surface p-4", className)}>{children}</section>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{children}</h2>
      {action}
    </div>
  );
}

const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-base font-medium transition-colors disabled:opacity-60";

export const buttonStyles = {
  primary: cx(buttonBase, "bg-primary text-primary-foreground hover:bg-primary-hover"),
  secondary: cx(buttonBase, "border border-border bg-surface text-foreground hover:bg-accent"),
  danger: cx(buttonBase, "border border-danger/40 bg-surface text-danger hover:bg-danger-soft"),
  dangerSolid: cx(buttonBase, "bg-danger text-white"),
  ghost: cx(buttonBase, "px-2 text-primary hover:bg-accent"),
};

export function ButtonLink({
  href, children, variant = "primary", className,
}: { href: string; children: ReactNode; variant?: keyof typeof buttonStyles; className?: string }) {
  return (
    <Link href={href} className={cx(buttonStyles[variant], className)}>
      {children}
    </Link>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "info" }) {
  const tones = {
    neutral: "bg-accent text-foreground",
    good: "bg-success-soft text-primary",
    warn: "bg-warning-soft text-warning",
    bad: "bg-danger-soft text-danger",
    info: "bg-info-soft text-info",
  };
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium", tones[tone])}>{children}</span>;
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-6 text-center text-muted">
      <p className="mb-3">{children}</p>
      {action}
    </div>
  );
}

/** Label/value pairs, e.g. on detail pages. */
export function DetailList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-sm text-muted">{item.label}</dt>
          <dd className="font-medium">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PageLoading({ label }: { label: string }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label}>
      <div className="h-8 w-2/3 animate-pulse rounded-lg bg-accent" />
      <div className="h-28 animate-pulse rounded-2xl bg-accent" />
      <div className="h-28 animate-pulse rounded-2xl bg-accent" />
    </div>
  );
}
