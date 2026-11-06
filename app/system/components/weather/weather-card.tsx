import {
  ChevronRight, CloudOff, CloudRain, Droplet, Leaf, Sun, Thermometer, ThermometerSun, Umbrella, Wind, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { Badge, Card, cx, focusRing } from "@/components/ui";
import type { Actor } from "@/lib/auth/actor";
import { formatNumber, formatTimeOrDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getFarmWeather, MAX_WEATHER_AGE_HOURS, type WeatherFeatures, type WeatherSnapshot } from "@/lib/services/weather";
import { RefreshWeatherButton } from "./refresh-weather-button";

// The farm's weather at a glance. Loads inside its own Suspense boundary (see
// WeatherSection) so a slow weather service never holds up the rest of the page.

const rows: Array<{ key: keyof WeatherFeatures; label: string; unit: string; icon: LucideIcon }> = [
  { key: "Ambient_Temperature", label: "weatherCard.temperature", unit: "°C", icon: Thermometer },
  { key: "Relative_Humidity", label: "weatherCard.humidity", unit: "%", icon: Droplet },
  { key: "Wind_Speed", label: "weatherCard.wind", unit: "m/s", icon: Wind },
  { key: "Rainfall_24h", label: "weatherCard.rainPast", unit: "mm", icon: CloudRain },
  { key: "Rainfall_Forecast_24h", label: "weatherCard.rainNext", unit: "mm", icon: Umbrella },
  { key: "Evaporation_Demand", label: "weatherCard.et0", unit: "mm/day", icon: Leaf },
  { key: "Solar_Radiation", label: "weatherCard.solar", unit: "MJ/m²", icon: Sun },
  { key: "Soil_Temperature", label: "weatherCard.soilTemp", unit: "°C", icon: ThermometerSun },
];

/** Fetches (or reuses) the farm's weather, then renders the card. */
export async function WeatherSection({ actor, farmId }: { actor: Actor; farmId: string }) {
  const snapshot = await getFarmWeather(actor, farmId);
  return <WeatherCard farmId={farmId} snapshot={snapshot} />;
}

export function WeatherCard({ farmId, snapshot }: { farmId: string; snapshot: WeatherSnapshot }) {
  const hasData = snapshot.observedAt !== null;
  const status =
    snapshot.source === "live"
      ? t("weatherCard.source.live")
      : snapshot.source === "cached"
        ? t("weatherCard.source.cached", { time: formatTimeOrDate(snapshot.observedAt) })
        : snapshot.source === "stored"
          ? t("weatherCard.source.stored", { time: formatTimeOrDate(snapshot.observedAt) })
          : null;

  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("weatherCard.title")}</h2>
        {status && <Badge tone={snapshot.source === "stored" ? "warn" : "info"}>{status}</Badge>}
      </div>

      {/* Failure: say so plainly, keep showing the last known values */}
      {snapshot.fetchFailed && (
        <div role="status" className="mb-3 flex gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
          <Icon icon={CloudOff} size="sm" className="mt-0.5" />
          <p>{hasData ? t("weatherCard.failed") : t("weatherCard.failedNoData")}</p>
        </div>
      )}
      {hasData && !snapshot.usableForPrediction && (
        <p className="mb-3 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
          {t("weatherCard.tooOld", { hours: MAX_WEATHER_AGE_HOURS })}
        </p>
      )}

      {hasData && (
        <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-3">
          {rows.map((row) => {
            const value = snapshot.features[row.key];
            return (
              <div key={row.key} className="flex items-start gap-2">
                <span className="mt-0.5 text-primary">
                  <Icon icon={row.icon} size="sm" />
                </span>
                <div>
                  <dt className="text-sm text-muted">{t(row.label)}</dt>
                  <dd className={cx("font-medium tabular-nums", value === undefined && "text-sm font-normal text-muted")}>
                    {value === undefined ? t("weatherCard.notAvailable") : `${formatNumber(Math.round(value * 10) / 10)} ${row.unit}`}
                  </dd>
                </div>
              </div>
            );
          })}
        </dl>
      )}
      {hasData && snapshot.missing.length > 0 && (
        <p className="mb-3 text-sm text-muted">{t("weatherCard.missingNote")}</p>
      )}

      <RefreshWeatherButton farmId={farmId} retry={snapshot.fetchFailed} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted">{t("weatherCard.provider")}</span>
        <Link href={`/farms/${farmId}/weather`} className={cx("min-h-11 content-center rounded-lg font-medium text-primary", focusRing)}>
          {t("weatherCard.manualLink")}
        </Link>
      </div>
    </Card>
  );
}

/** Placeholder while the weather loads (same height, so nothing jumps). */
export function WeatherCardSkeleton() {
  return <div aria-hidden="true" className="h-72 animate-pulse rounded-2xl bg-accent motion-reduce:animate-none" />;
}

/**
 * Dashboard version: just what matters for today's watering decision
 * (temperature, rain past/next 24 h, evaporation), linking to the full card.
 */
export async function WeatherGlance({ actor, farmId }: { actor: Actor; farmId: string }) {
  const snapshot = await getFarmWeather(actor, farmId);
  const f = snapshot.features;
  const items: Array<{ key: keyof WeatherFeatures; label: string; unit: string; icon: LucideIcon }> = [
    { key: "Ambient_Temperature", label: "weatherCard.temperature", unit: "°C", icon: Thermometer },
    { key: "Rainfall_Forecast_24h", label: "weatherCard.rainNext", unit: "mm", icon: Umbrella },
    { key: "Rainfall_24h", label: "weatherCard.rainPast", unit: "mm", icon: CloudRain },
    { key: "Evaporation_Demand", label: "weatherCard.et0", unit: "mm/day", icon: Leaf },
  ];
  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("dashboard.weather.title")}</h2>
        {snapshot.observedAt && (
          <Badge tone={snapshot.source === "stored" ? "warn" : "info"}>
            {snapshot.source === "live"
              ? t("weatherCard.source.live")
              : t(snapshot.source === "stored" ? "weatherCard.source.stored" : "weatherCard.source.cached", {
                  time: formatTimeOrDate(snapshot.observedAt),
                })}
          </Badge>
        )}
      </div>
      {snapshot.fetchFailed && (
        <p role="status" className="mb-3 flex gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
          <Icon icon={CloudOff} size="sm" className="mt-0.5" />
          {snapshot.observedAt ? t("weatherCard.failed") : t("weatherCard.failedNoData")}
        </p>
      )}
      {snapshot.observedAt && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {items.map((item) => (
            <div key={item.key} className="flex items-start gap-2">
              <span className="mt-0.5 text-primary">
                <Icon icon={item.icon} size="sm" />
              </span>
              <div>
                <dt className="text-sm text-muted">{t(item.label)}</dt>
                <dd className="font-medium tabular-nums">
                  {f[item.key] === undefined ? t("weatherCard.notAvailable") : `${formatNumber(Math.round(f[item.key]! * 10) / 10)} ${item.unit}`}
                </dd>
              </div>
            </div>
          ))}
        </dl>
      )}
      <Link
        href={`/farms/${farmId}/weather`}
        className={cx("mt-2 inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-primary", focusRing)}
      >
        {t("dashboard.weather.more")}
        <Icon icon={ChevronRight} size="sm" />
      </Link>
    </Card>
  );
}
