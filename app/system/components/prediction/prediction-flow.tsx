"use client";

import { ArrowLeft, CloudOff, FlaskConical, LoaderCircle, Lock, Sparkles } from "lucide-react";
import { useId, useState, useTransition, type FormEvent } from "react";
import { createPredictionAction, previewPredictionAction } from "@/app/actions/predictions";
import { Icon } from "@/components/icon";
import { Badge, ButtonLink, buttonStyles, Card, cx } from "@/components/ui";
import {
  FEATURE_COUNT, FEATURES, GROWTH_STAGES, type FeatureName, type FeatureSource,
} from "@/lib/features/catalog";
import { featureLabel, formatFeatureValue } from "@/lib/features/display";
import type { AssembledFeature, AssembledFeatures } from "@/lib/features/payload";
import { formatLitres } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { PredictionMode } from "@/lib/prediction";
import type { PredictionOutcome } from "@/lib/services/predictions";
import { predictionInputSchema } from "@/lib/validation/schemas";
import { ActionPanel } from "./action-display";

// The prediction flow, one screen per step:
//   1. Today's reading: soil moisture (required), growth stage, soil temperature
//   2. Check the inputs: every feature the model will get, grouped by where it
//      came from; missing ones are marked "Will be estimated"; any can be changed
//   3. The recommendation, with what drove it and the field's water budget
// The server rebuilds the features on every step; the client only sends what
// the farmer typed or changed, never the derived values themselves.

type Props = {
  fieldId: string;
  defaultGrowthStage: string | null;
};

type Preview = Pick<AssembledFeatures, "entries" | "missing" | "context"> & { mode: PredictionMode };
type FeatureInput = Partial<Record<FeatureName, string | number | null>>;

const inputClass =
  "block w-full min-h-12 rounded-xl border border-input-border bg-surface px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary";

// Features the farmer can't change here: they belong to the field or planting,
// are automatic, or are never sent (decided in Phase 0)
const FIXED: FeatureName[] = ["Crop_Type", "Soil_Type", "Day_of_Year", "Time_of_Day", "Water_Stress_Index"];
const GROUPS: FeatureSource[] = ["farmer", "db", "weather", "system"];

/** Zod issues for the nested features object → { Soil_Moisture: "message" } */
function featureErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[issue.path.length - 1] ?? "_form");
    if (!(key in out)) out[key] = t(issue.message);
  }
  return out;
}

export function PredictionFlow({ fieldId, defaultGrowthStage }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Step 1 values (kept as typed, so going back doesn't lose them)
  const [moisture, setMoisture] = useState("");
  const [stage, setStage] = useState(defaultGrowthStage ?? "");
  const [soilTemp, setSoilTemp] = useState("");

  const [preview, setPreview] = useState<Preview | null>(null);
  const [edits, setEdits] = useState<Partial<Record<FeatureName, string>>>({});
  const [outcome, setOutcome] = useState<PredictionOutcome | null>(null);

  /** What the farmer provided in step 1 (blank optional values are not sent at all). */
  function step1Features(): FeatureInput {
    const features: FeatureInput = { Soil_Moisture: moisture, Growth_Stage: stage || undefined };
    if (soilTemp.trim() !== "") features.Soil_Temperature = soilTemp;
    return features;
  }

  function validate(features: FeatureInput) {
    const parsed = predictionInputSchema.safeParse({ fieldId, features });
    if (!parsed.success) {
      setErrors(featureErrors(parsed.error));
      setFormError(t("common.fixErrors"));
      return null;
    }
    setErrors({});
    setFormError(null);
    return parsed.data;
  }

  function submitStep1(event: FormEvent) {
    event.preventDefault();
    const input = validate(step1Features());
    if (!input) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    startTransition(async () => {
      const result = await previewPredictionAction(input);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      setPreview(result.data);
      // Start the editable copy from what the server assembled
      setEdits(
        Object.fromEntries(result.data.entries.map((e) => [e.name, e.value === undefined ? "" : String(e.value)])),
      );
      setStep(2);
      window.scrollTo({ top: 0 });
    });
  }

  /** Only send what the farmer changed on step 2: unchanged values are re-derived on the server. */
  function changedFeatures(): FeatureInput {
    const features = step1Features();
    for (const entry of preview?.entries ?? []) {
      if (FIXED.includes(entry.name)) continue;
      const original = entry.value === undefined ? "" : String(entry.value);
      const now = (edits[entry.name] ?? "").trim();
      if (now === original) continue;
      features[entry.name] = now === "" ? null : now; // cleared → omitted (estimated)
    }
    return features;
  }

  function submitStep2() {
    const input = validate(changedFeatures());
    if (!input) return;
    startTransition(async () => {
      const result = await createPredictionAction(input);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      setOutcome(result.data);
      setStep(3);
      window.scrollTo({ top: 0 });
    });
  }

  function restart() {
    setStep(1);
    setPreview(null);
    setOutcome(null);
    setMoisture("");
    setSoilTemp("");
    setErrors({});
    setFormError(null);
  }

  const mode = outcome?.mode ?? preview?.mode;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted">{t("predict.step", { n: step })}</p>
        {mode === "mock" && (
          <Badge tone="warn">
            <Icon icon={FlaskConical} size="sm" />
            {t("prediction.mockBadge")}
          </Badge>
        )}
      </div>

      {step === 1 && (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">{t("predict.step1.title")}</h2>
          <p className="mb-4 text-muted">{t("predict.step1.hint")}</p>
          <form onSubmit={submitStep1} noValidate className="space-y-4">
            <NumberInput
              name="Soil_Moisture" label={featureLabel("Soil_Moisture")} value={moisture} onChange={setMoisture}
              error={errors.Soil_Moisture}
            />
            <div>
              <label htmlFor="p-stage" className="mb-1 block font-medium">{t("feature.Growth_Stage")}</label>
              <select
                id="p-stage" value={stage} onChange={(e) => setStage(e.target.value)} aria-invalid={!!errors.Growth_Stage}
                className={cx(inputClass, errors.Growth_Stage && "border-danger")}
              >
                <option value="" disabled>{t("select.placeholder")}</option>
                {GROWTH_STAGES.map((s) => <option key={s} value={s}>{t(`stage.${s}`)}</option>)}
              </select>
              {errors.Growth_Stage && <p className="mt-1 text-sm font-medium text-danger">{errors.Growth_Stage}</p>}
            </div>
            <NumberInput
              name="Soil_Temperature" label={featureLabel("Soil_Temperature")} value={soilTemp} onChange={setSoilTemp}
              error={errors.Soil_Temperature} optional
            />
            {formError && <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-danger">{formError}</p>}
            <button type="submit" disabled={pending} aria-busy={pending} className={cx(buttonStyles.primary, "w-full")}>
              {pending && <Icon icon={LoaderCircle} size="sm" className="animate-spin motion-reduce:animate-none" />}
              {pending ? t("predict.loadingInputs") : t("predict.step1.next")}
            </button>
          </form>
        </Card>
      )}

      {step === 2 && preview && (
        <>
          <Card>
            <h2 className="mb-1 text-lg font-semibold">{t("predict.step2.title")}</h2>
            <p className="text-muted">{t("predict.step2.hint")}</p>
            <WeatherNotice context={preview.context} />
            <p className="mt-3 rounded-xl bg-accent px-3 py-2 text-sm">
              {preview.missing.length === 0
                ? t("prediction.allInputs", { total: FEATURE_COUNT })
                : t("predict.missingSummary", { count: preview.missing.length, total: FEATURE_COUNT })}
            </p>
          </Card>

          {GROUPS.map((group) => {
            const entries = preview.entries.filter((e) => FEATURES[e.name].source === group);
            if (entries.length === 0) return null;
            return (
              <Card key={group}>
                <h3 className="mb-2 font-semibold">{t(`predict.group.${group}`)}</h3>
                <ul className="divide-y divide-border">
                  {entries.map((entry) => (
                    <FeatureRow
                      key={entry.name}
                      entry={entry}
                      value={edits[entry.name] ?? ""}
                      onChange={(v) => setEdits((prev) => ({ ...prev, [entry.name]: v }))}
                      error={errors[entry.name]}
                    />
                  ))}
                </ul>
              </Card>
            );
          })}

          {formError && <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-danger">{formError}</p>}
          <button type="button" onClick={submitStep2} disabled={pending} aria-busy={pending} className={cx(buttonStyles.primary, "w-full")}>
            <Icon icon={pending ? LoaderCircle : Sparkles} size="sm" className={pending ? "animate-spin motion-reduce:animate-none" : undefined} />
            {pending ? t("predict.predicting") : t("predict.step2.submit")}
          </button>
          <button type="button" onClick={() => setStep(1)} disabled={pending} className={cx(buttonStyles.ghost, "w-full")}>
            <Icon icon={ArrowLeft} size="sm" />
            {t("predict.step2.back")}
          </button>
        </>
      )}

      {step === 3 && outcome && (
        <Result outcome={outcome} fieldId={fieldId} context={preview?.context} onRestart={restart} />
      )}
    </div>
  );
}

function NumberInput({
  name, label, value, onChange, error, optional,
}: { name: string; label: string; value: string; onChange: (v: string) => void; error?: string; optional?: boolean }) {
  const id = `p-${name}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-medium">
        {label}
        {optional && <span className="font-normal text-muted"> ({t("common.optional")})</span>}
      </label>
      <input
        id={id} name={name} type="text" inputMode="decimal" autoComplete="off" value={value}
        onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
        className={cx(inputClass, error && "border-danger")}
      />
      {error && <p id={`${id}-error`} className="mt-1 text-sm font-medium text-danger">{error}</p>}
    </div>
  );
}

function OriginBadge({ origin }: { origin: AssembledFeature["origin"] }) {
  const tone = origin === "missing" ? "warn" : origin === "farmer" ? "good" : "neutral";
  return <Badge tone={tone}>{t(`predict.origin.${origin}`)}</Badge>;
}

/** One feature on the confirmation screen: name, where it came from, and its value (editable when allowed). */
function FeatureRow({
  entry, value, onChange, error,
}: { entry: AssembledFeature; value: string; onChange: (v: string) => void; error?: string }) {
  const id = useId();
  const def = FEATURES[entry.name];
  const fixed = FIXED.includes(entry.name);
  const neverSent = "alwaysOmitted" in def && def.alwaysOmitted;
  const automatic = def.source === "system";
  const label = featureLabel(entry.name);

  return (
    <li className="py-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={fixed ? undefined : id} className="font-medium">{label}</label>
        <OriginBadge origin={entry.origin} />
      </div>
      {fixed ? (
        <p className="flex items-center gap-1.5 text-muted">
          <Icon icon={Lock} size="sm" />
          <span className="font-medium text-foreground">{formatFeatureValue(entry.name, entry.value)}</span>
          <span className="text-sm">
            · {neverSent ? t("predict.neverSent") : automatic ? t("predict.autoHint") : t("predict.fixedHint")}
          </span>
        </p>
      ) : def.kind === "category" ? (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          {/* A required feature can't be left for the model to estimate */}
          <option value="" disabled={def.required}>{def.required ? t("select.placeholder") : t("predict.origin.missing")}</option>
          {def.categories.map((c) => (
            <option key={c} value={c}>{entry.name === "Growth_Stage" ? t(`stage.${c}`) : c}</option>
          ))}
        </select>
      ) : (
        <input
          id={id} type="text" inputMode="decimal" autoComplete="off" value={value} placeholder={t("predict.origin.missing")}
          onChange={(e) => onChange(e.target.value)} aria-invalid={!!error}
          className={cx(inputClass, error && "border-danger", entry.origin === "missing" && value === "" && "border-dashed")}
        />
      )}
      {error && <p className="mt-1 text-sm font-medium text-danger">{error}</p>}
    </li>
  );
}

function WeatherNotice({ context }: { context: AssembledFeatures["context"] }) {
  const text = context.weatherFetchFailed && context.weatherSource === "none"
    ? t("predict.weatherNone")
    : context.weatherTooOld
      ? t("predict.weatherOld")
      : context.weatherFetchFailed
        ? t("predict.weatherFailed")
        : context.weatherSource === "none"
          ? t("predict.weatherNone")
          : null;
  if (!text) return null;
  return (
    <p className="mt-3 flex gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
      <Icon icon={CloudOff} size="sm" className="mt-0.5" />
      {text}
    </p>
  );
}

function Result({
  outcome, fieldId, context, onRestart,
}: { outcome: PredictionOutcome; fieldId: string; context?: AssembledFeatures["context"]; onRestart: () => void }) {
  const value = (name: FeatureName) => outcome.entries.find((e) => e.name === name)?.value;
  // The inputs that matter most for a watering decision
  const keyInputs: FeatureName[] = ["Soil_Moisture", "Rainfall_Forecast_24h", "Rainfall_24h", "Evaporation_Demand", "Days_Since_Last_Irrigation"];

  return (
    <>
      <ActionPanel action={outcome.action} />
      {outcome.mode === "mock" && (
        <p className="flex gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
          <Icon icon={FlaskConical} size="sm" className="mt-0.5" />
          {t("prediction.mockExplain")}
        </p>
      )}

      <Card>
        <h2 className="mb-3 text-lg font-semibold">{t("predict.keyInputs")}</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {keyInputs.map((name) => (
            <div key={name}>
              <dt className="text-sm text-muted">{t(`feature.${name}`)}</dt>
              <dd className="font-medium tabular-nums">
                {value(name) === undefined ? t("predict.origin.missing") : formatFeatureValue(name, value(name))}
              </dd>
            </div>
          ))}
          <div>
            <dt className="text-sm text-muted">{t("predict.budgetLeft")}</dt>
            <dd className="font-medium tabular-nums">
              {outcome.remainingBudgetLitres === null ? t("predict.noBudget") : formatLitres(outcome.remainingBudgetLitres)}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-muted">
          {outcome.estimatedCount === 0
            ? t("prediction.allInputs", { total: outcome.totalFeatures })
            : t("prediction.estimatedCount", { count: outcome.estimatedCount, total: outcome.totalFeatures })}
        </p>
        {context && <WeatherNotice context={context} />}
      </Card>

      <div className="grid gap-2">
        {outcome.action !== "No_Irrigation" && outcome.remainingBudgetLitres !== null && (
          <ButtonLink href={`/fields/${fieldId}/water`}>{t("predict.recordIrrigation")}</ButtonLink>
        )}
        <ButtonLink href={`/fields/${fieldId}`} variant="secondary">{t("predict.done")}</ButtonLink>
        <button type="button" onClick={onRestart} className={cx(buttonStyles.ghost, "w-full")}>{t("predict.again")}</button>
      </div>
    </>
  );
}
