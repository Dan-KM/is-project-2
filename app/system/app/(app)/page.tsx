import { ChevronRight, CloudSun, Droplets, Plus, Sparkles, Sprout, Tractor, Wheat } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { ActionBadge } from "@/components/prediction/action-display";
import { Badge, ButtonLink, Card, cx, EmptyState, focusRing, PageLoading, SectionTitle } from "@/components/ui";
import { BudgetStatusBadge, TankSummary } from "@/components/water-summary";
import { WeatherCardSkeleton, WeatherGlance } from "@/components/weather/weather-card";
import type { Actor } from "@/lib/auth/actor";
import { formatLitres, formatNumber, formatSignedLitres, formatTimeOrDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { requirePageActor } from "@/lib/page";
import { getFarmDashboard, type DashboardField } from "@/lib/services/dashboard";
import { listFarms } from "@/lib/services/farms";

// Farmer dashboard: one farm at a glance.
//   water (tank + field budgets) · weather · each field's crop, moisture,
//   last recommendation and last irrigation · recent water · quick actions.
// A farmer with several farms switches with ?farm=<id>.

export default function DashboardPage(props: PageProps<"/">) {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <Dashboard searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Dashboard({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const actor = await requirePageActor();
  const [farms, params] = await Promise.all([listFarms(actor), searchParams]);

  if (farms.length === 0) {
    return (
      <EmptyState
        icon={<Icon icon={Tractor} size="xl" />}
        action={<ButtonLink href="/farms/new" icon={<Icon icon={Plus} size="sm" />}>{t("farm.add")}</ButtonLink>}
      >
        {t("farm.list.empty")}
      </EmptyState>
    );
  }

  const requested = typeof params.farm === "string" ? params.farm : undefined;
  // Requested farm, else the first farm that has fields (more useful than an empty one), else the first
  const farm = farms.find((f) => f.farmId === requested) ?? farms.find((f) => f.fields > 0) ?? farms[0];
  return <FarmDashboard actor={actor} farmId={farm.farmId} farms={farms.map((f) => ({ id: f.farmId, name: f.farmName }))} />;
}

async function FarmDashboard({ actor, farmId, farms }: { actor: Actor; farmId: string; farms: Array<{ id: string; name: string }> }) {
  const data = await getFarmDashboard(actor, farmId);
  const { farm, water, fields, recentLedger, hasWaterRecords } = data;

  return (
    <div className="space-y-5">
      <header>
        {farms.length > 1 && <FarmSwitcher farms={farms} current={farmId} />}
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-balance">
            {t("dashboard.title", { farm: farm.farmName })}
          </h1>
          <ButtonLink href={`/farms/${farmId}`} variant="secondary" className="shrink-0">
            {t("dashboard.farmDetails")}
          </ButtonLink>
        </div>
      </header>

      {/* ---- Quick actions ---- */}
      <nav aria-label={t("dashboard.quick.title")} className="grid grid-cols-3 gap-2">
        <QuickAction href={`/farms/${farmId}/water`} icon={Droplets} label={t("dashboard.quick.addWater")} />
        <QuickAction href={`/farms/${farmId}/weather`} icon={CloudSun} label={t("dashboard.quick.weather")} />
        <QuickAction href={`/farms/${farmId}/fields/new`} icon={Plus} label={t("dashboard.quick.addField")} />
      </nav>

      {/* ---- Fields (the main reason to open the app) ---- */}
      <section>
        <SectionTitle>{t("dashboard.fields.title")}</SectionTitle>
        {fields.length === 0 ? (
          <EmptyState
            icon={<Icon icon={Sprout} size="xl" />}
            action={<ButtonLink href={`/farms/${farmId}/fields/new`} icon={<Icon icon={Plus} size="sm" />}>{t("field.add")}</ButtonLink>}
          >
            {t("dashboard.fields.empty")}
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {fields.map((field) => (
              <li key={field.fieldId}>
                <FieldSummary field={field} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Weather (streams in separately so a slow API never blocks the page) ---- */}
      <Suspense fallback={<WeatherCardSkeleton />}>
        <WeatherGlance actor={actor} farmId={farmId} />
      </Suspense>

      {/* ---- Farm water ---- */}
      <section>
        <SectionTitle>{t("dashboard.water.title")}</SectionTitle>
        <Card>
          {hasWaterRecords ? (
            <TankSummary balance={water.balanceLitres} allocated={water.allocatedLitres} unallocated={water.unallocatedLitres} />
          ) : (
            <div>
              <p className="mb-3 text-muted">{t("dashboard.water.start")}</p>
              <ButtonLink href={`/farms/${farmId}/water`} icon={<Icon icon={Droplets} size="sm" />} className="w-full">
                {t("dashboard.water.startAction")}
              </ButtonLink>
            </div>
          )}
        </Card>
      </section>

      {/* ---- Recent water transactions ---- */}
      {recentLedger.length > 0 && (
        <section>
          <SectionTitle>{t("dashboard.ledger.title")}</SectionTitle>
          <Card>
            <ul className="divide-y divide-border">
              {recentLedger.map((entry) => (
                <li key={entry.transactionId} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {t(`water.type.${entry.transactionType}`)}
                      {entry.fieldName && <span className="font-normal text-muted"> · {entry.fieldName}</span>}
                    </p>
                    <p className="text-sm text-muted">{formatTimeOrDate(entry.transactionDate)}</p>
                  </div>
                  <p className="shrink-0 font-semibold tabular-nums">
                    {formatSignedLitres(entry.transactionType === "IRRIGATION" ? -entry.quantityLitres : entry.quantityLitres)}
                  </p>
                </li>
              ))}
            </ul>
            <Link
              href={`/farms/${farmId}/water`}
              className={cx("mt-2 inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-primary", focusRing)}
            >
              {t("dashboard.ledger.all")}
              <Icon icon={ChevronRight} size="sm" />
            </Link>
          </Card>
        </section>
      )}
    </div>
  );
}

/** Links to the farmer's other farms (wraps instead of scrolling sideways). */
function FarmSwitcher({ farms, current }: { farms: Array<{ id: string; name: string }>; current: string }) {
  return (
    <nav aria-label={t("dashboard.chooseFarm")} className="mb-3 flex flex-wrap gap-2">
      {farms.map((f) => (
        <Link
          key={f.id}
          href={`/?farm=${f.id}`}
          aria-current={f.id === current ? "page" : undefined}
          className={cx(
            "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium",
            f.id === current ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:bg-accent",
            focusRing,
          )}
        >
          {f.name}
        </Link>
      ))}
    </nav>
  );
}

function QuickAction({ href, icon, label }: { href: string; icon: typeof Droplets; label: string }) {
  return (
    <Link
      href={href}
      className={cx(
        "flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-surface p-2 text-center text-sm font-medium",
        "transition-[background-color,transform] duration-150 hover:bg-accent active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
        focusRing,
      )}
    >
      <span className="text-primary">
        <Icon icon={icon} size="lg" />
      </span>
      {label}
    </Link>
  );
}

function relativeDays(days: number | null) {
  if (days === null) return t("dashboard.field.never");
  if (days === 0) return t("dashboard.field.today");
  if (days === 1) return t("dashboard.field.yesterday");
  return t("dashboard.field.daysAgo", { days });
}

/** One field: what's growing, how wet it is, and what to do next. */
function FieldSummary({ field }: { field: DashboardField }) {
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <Link href={`/fields/${field.fieldId}`} className={cx("rounded-lg text-lg font-semibold hover:underline", focusRing)}>
          {field.fieldName}
        </Link>
        <div className="flex flex-wrap gap-1.5">
          {field.cropName ? (
            <Badge tone="good">
              {t(`crop.${field.cropName}`)}
              {field.growthStage && ` · ${t(`stage.${field.growthStage}`)}`}
            </Badge>
          ) : (
            <Badge>{t("field.noCrop")}</Badge>
          )}
          {field.daysToMaturity !== null && field.daysToMaturity <= 7 && (
            <Badge tone="warn">
              <Icon icon={Wheat} size="sm" />
              {field.daysToMaturity <= 0 ? t("dashboard.field.ready") : t("dashboard.field.readySoon", { days: field.daysToMaturity })}
            </Badge>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-muted">{t("dashboard.field.moisture")}</dt>
          <dd className="text-base font-semibold tabular-nums">
            {field.latestMoisture === null ? "—" : `${formatNumber(field.latestMoisture)} %`}
          </dd>
          <dd className="text-xs text-muted">
            {field.latestMoistureAt ? formatTimeOrDate(field.latestMoistureAt) : t("dashboard.field.noReading")}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t("dashboard.field.lastIrrigation")}</dt>
          <dd className="text-base font-semibold">{relativeDays(field.daysSinceLastIrrigation)}</dd>
        </div>
        <div>
          <dt className="text-muted">{t("dashboard.field.budget")}</dt>
          <dd className="text-base font-semibold tabular-nums">
            {field.budgetStatus === "NO_ALLOCATION" ? "—" : formatLitres(field.remainingBudgetLitres)}
          </dd>
          <dd>
            <BudgetStatusBadge status={field.budgetStatus} />
          </dd>
        </div>
      </dl>

      {field.latestAction && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{t("dashboard.field.latest")}:</span>
          <ActionBadge action={field.latestAction} />
          <span className="text-muted">{formatTimeOrDate(field.latestActionAt)}</span>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {field.cropName ? (
          <ButtonLink href={`/fields/${field.fieldId}/predict`} icon={<Icon icon={Sparkles} size="sm" />}>
            {t("dashboard.field.recommend")}
          </ButtonLink>
        ) : (
          <ButtonLink href={`/fields/${field.fieldId}/plant`} icon={<Icon icon={Sprout} size="sm" />}>
            {t("planting.plant")}
          </ButtonLink>
        )}
        <ButtonLink href={`/fields/${field.fieldId}/water`} variant="secondary" icon={<Icon icon={Droplets} size="sm" />}>
          {t("dashboard.field.irrigate")}
        </ButtonLink>
      </div>
    </Card>
  );
}
