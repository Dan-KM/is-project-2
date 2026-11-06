import { FEATURES, FEATURE_NAMES, type FeatureName } from "./catalog";

// Reads a stored irrigation_action_prediction row back into model features.
// The table has one column per feature and NULL means the feature was left out
// of the request (estimated by the model), so the exact payload can be rebuilt.

type PredictionRow = Record<string, unknown>;

export type StoredFeature = { name: FeatureName; value: string | number | null };

export function storedFeatures(row: PredictionRow): StoredFeature[] {
  return FEATURE_NAMES.map((name) => {
    const def = FEATURES[name];
    const raw = row[def.predictionColumn];
    if (raw === null || raw === undefined) return { name, value: null };
    if (def.kind === "category") return { name, value: String(raw) };
    const n = Number(raw);
    return { name, value: Number.isFinite(n) ? n : null };
  });
}

/** How many features were missing from the request (and estimated by the model). */
export function estimatedCount(row: PredictionRow): number {
  return storedFeatures(row).filter((f) => f.value === null).length;
}
