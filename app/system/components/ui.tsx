import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icon";

// Small presentational building blocks (server-safe: no hooks).
// Mobile-first: full-width by default, 44px+ tap targets, visible keyboard
// focus, press feedback and a clear disabled state (ui-ux-pro-max priorities
// 1-2: accessibility and touch).

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

/** Keyboard focus ring for anything interactive (never removed, only restyled). */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export function PageHeader({ title, back, action }: { title: string; back?: { href: string; label: string }; action?: ReactNode }) {
  return (
    <header className="mb-4">
      {back && (
        <Link
          href={back.href}
          className={cx("-ml-1 mb-2 inline-flex min-h-11 items-center gap-1 rounded-lg pr-2 text-sm font-medium text-primary", focusRing)}
        >
          <Icon icon={ChevronLeft} size="sm" /> {back.label}
        </Link>
      )}
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight text-balance">{title}</h1>
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

// Press feedback is a small scale (transform only, so no layout shift); it is
// switched off for people who ask for reduced motion.
const buttonBase = cx(
  "inline-flex min-h-11 cursor-pointer select-none items-center justify-center gap-2 rounded-xl px-4 text-base font-medium",
  "transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98]",
  "motion-reduce:transition-none motion-reduce:active:scale-100",
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
  focusRing,
);

export const buttonStyles = {
  primary: cx(buttonBase, "bg-primary text-primary-foreground hover:bg-primary-hover"),
  secondary: cx(buttonBase, "border border-border bg-surface text-foreground hover:bg-accent"),
  danger: cx(buttonBase, "border border-danger/40 bg-surface text-danger hover:bg-danger-soft"),
  dangerSolid: cx(buttonBase, "bg-danger text-white"),
  ghost: cx(buttonBase, "px-2 text-primary hover:bg-accent"),
};

export function ButtonLink({
  href, children, variant = "primary", className, icon,
}: { href: string; children: ReactNode; variant?: keyof typeof buttonStyles; className?: string; icon?: ReactNode }) {
  return (
    <Link href={href} className={cx(buttonStyles[variant], className)}>
      {icon}
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
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function EmptyState({ children, action, icon }: { children: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border p-6 text-center text-muted">
      {icon && <div className="mb-2 text-muted">{icon}</div>}
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
          <dd className="font-medium tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PageLoading({ label }: { label: string }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label}>
      <div className="h-8 w-2/3 animate-pulse rounded-lg bg-accent motion-reduce:animate-none" />
      <div className="h-28 animate-pulse rounded-2xl bg-accent motion-reduce:animate-none" />
      <div className="h-28 animate-pulse rounded-2xl bg-accent motion-reduce:animate-none" />
    </div>
  );
}
