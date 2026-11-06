import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { FEATURES, type FeatureName } from "./catalog";

// How features are shown to farmers (client- and server-safe).
// The catalog's `unit` documents the model contract; some units read badly
// next to the name ("Days since last irrigation (days)"), so the screen uses
// these display units instead.

const DISPLAY_UNITS: Partial<Record<FeatureName, string | null>> = {
  Days_Since_Last_Irrigation: null,
  Day_of_Year: null,
  Time_of_Day: null,
  Evaporation_Demand: "mm/day",
};

export function featureUnit(name: FeatureName): string | undefined {
  if (name in DISPLAY_UNITS) return DISPLAY_UNITS[name] ?? undefined;
  return (FEATURES[name] as { unit?: string }).unit;
}

/** "Soil moisture (%)" */
export function featureLabel(name: FeatureName): string {
  const unit = featureUnit(name);
  return `${t(`feature.${name}`)}${unit ? ` (${unit})` : ""}`;
}

/** A feature value in words: dropdown labels for categories, units for numbers. */
export function formatFeatureValue(name: FeatureName, value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    if (name === "Growth_Stage") return t(`stage.${value}`);
    if (name === "Soil_Type") return t(`soil.${value}`);
    if (name === "Crop_Type") return t(`crop.${value}`);
    return value;
  }
  if (name === "Time_of_Day") return `${String(value).padStart(2, "0")}:00`;
  const unit = featureUnit(name);
  return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value);
}
