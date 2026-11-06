import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { IRRIGATION_ACTIONS, type FeaturePayload, type IrrigationAction } from "@/lib/features/catalog";

// The model sits behind this one interface: predict(features) → action.
//
//   PREDICTION_MODE=mock (default)  rule-based stand-in so the app is testable now
//   PREDICTION_MODE=api             POST ${MODEL_API_URL}/predict to the FastAPI service
//
// Switching to the real model is a single env var change. Nothing else in the
// app knows which one is running, except the "Mock prediction" badge.

export type { IrrigationAction };
export type PredictionMode = "mock" | "api";

export function getPredictionMode(): PredictionMode {
  return process.env.PREDICTION_MODE === "api" ? "api" : "mock";
}

/** Stored in irrigation_action_prediction.model_version so mock rows are easy to tell apart. */
export function getModelVersion(): string {
  return getPredictionMode() === "mock" ? "mock-v1" : (process.env.MODEL_VERSION ?? "fastapi");
}

export async function predict(features: FeaturePayload): Promise<IrrigationAction> {
  return getPredictionMode() === "api" ? apiPredict(features) : mockPredict(features);
}

// ---------------------------------------------------------------------------
// MOCK: NOT the trained model. Simple agronomic rules so every screen can be
// exercised. Works with any subset of features (missing keys are just not used).
// ---------------------------------------------------------------------------
export function mockPredict(features: FeaturePayload): IrrigationAction {
  const moisture = features.Soil_Moisture;
  const rainNext = features.Rainfall_Forecast_24h;
  const et0 = features.Evaporation_Demand;

  if (moisture === undefined) return "Low"; // shouldn't happen (required), but never crash
  if (moisture >= 70) return "No_Irrigation"; // soil already wet
  if (rainNext !== undefined && rainNext >= 10) return "No_Irrigation"; // rain is coming
  if (moisture < 30) return et0 !== undefined && et0 >= 5 ? "High" : "Medium"; // dry; hot/windy → more
  if (moisture < 50) return rainNext !== undefined && rainNext >= 5 ? "Low" : "Medium";
  return et0 !== undefined && et0 >= 5 ? "Low" : "No_Irrigation"; // 50–70 %: only top up if demand is high
}

// ---------------------------------------------------------------------------
// REAL: the FastAPI service. Written now, enabled with PREDICTION_MODE=api.
// Contract: POST /predict  body = FeaturePayload (missing keys omitted)
//           200 → { "action": "No_Irrigation" | "Low" | "Medium" | "High" }
// See docs/prediction-contract.md.
// ---------------------------------------------------------------------------
const TIMEOUT_MS = 10_000;
const apiResponseSchema = z.object({ action: z.enum(IRRIGATION_ACTIONS) });

async function apiPredict(features: FeaturePayload): Promise<IrrigationAction> {
  const baseUrl = process.env.MODEL_API_URL;
  if (!baseUrl) throw new AppError("prediction.notConfigured");

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(features),
      signal: AbortSignal.timeout(TIMEOUT_MS), // don't leave the farmer waiting forever
      cache: "no-store",
    });
  } catch (e) {
    // Network error or timeout
    throw new AppError("prediction.apiUnavailable", undefined, e);
  }

  if (!response.ok) {
    console.error("[prediction api]", response.status, await response.text().catch(() => ""));
    throw new AppError(response.status >= 500 ? "prediction.apiUnavailable" : "prediction.apiBadResponse");
  }

  const parsed = apiResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new AppError("prediction.apiBadResponse", undefined, parsed.error);
  return parsed.data.action;
}
