"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  checkIrrigationAction, editLedgerEntryAction, recordInitialWaterAction, recordIrrigationAction,
  recordRefillAction, setAllocationAction, topUpFieldBudgetAction, updateIrrigationNotesAction,
} from "@/app/actions/water";
import { ActionForm } from "@/components/form/action-form";
import { HiddenField, NumberField, TextAreaField, TextField } from "@/components/form/fields";
import { cx } from "@/components/ui";
import { formatLitres, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  allocationSchema, editLedgerEntrySchema, initialWaterSchema, irrigationNotesSchema, irrigationSchema, refillSchema,
  topUpSchema,
} from "@/lib/validation/schemas";

// Water forms. Each submits to a server action that calls the matching SQL
// function (record_initial_water_entry, record_water_refill, set_field_allocation,
// record_irrigation), so balance and budget rules are always enforced by the DB.

/** First-ever entry for a farm (an empty tank, 0, is allowed). */
export function InitialWaterForm({ farmId, now }: { farmId: string; now: string }) {
  return (
    <ActionForm
      action={recordInitialWaterAction}
      schema={initialWaterSchema}
      submitLabel={t("water.initial.submit")}
      successMessage={(d: { balanceLitres: number }) => t("water.initial.done", { litres: formatLitres(d.balanceLitres) })}
    >
      <HiddenField name="farmId" value={farmId} />
      <NumberField name="quantityLitres" label={t("label.quantityLitres")} />
      <TextField name="date" label={t("label.when")} type="datetime-local" defaultValue={now} />
      <TextAreaField name="notes" label={t("common.notes")} optional />
    </ActionForm>
  );
}

/** Add water to the farm supply; fields waiting at 0 are topped up by the DB. */
export function RefillForm({ farmId, now }: { farmId: string; now: string }) {
  return (
    <ActionForm
      action={recordRefillAction}
      schema={refillSchema}
      submitLabel={t("water.refill.submit")}
      successMessage={(d: { balanceLitres: number }) => t("water.refill.done", { litres: formatLitres(d.balanceLitres) })}
      resetOnSuccess
    >
      <HiddenField name="farmId" value={farmId} />
      <NumberField name="quantityLitres" label={t("label.quantityLitres")} />
      <TextField name="date" label={t("label.when")} type="datetime-local" defaultValue={now} />
      <TextAreaField name="notes" label={t("common.notes")} optional />
    </ActionForm>
  );
}

/** Set or change a field's allocation %. Removal is a separate confirm button. */
export function AllocationForm({ fieldId, percentage }: { fieldId: string; percentage: string }) {
  return (
    <ActionForm
      action={setAllocationAction}
      schema={allocationSchema.refine((v) => v.percentage !== undefined, {
        // In this form a blank value is a mistake; removing has its own button
        path: ["percentage"],
        error: "validation.required",
      })}
      submitLabel={t("water.allocation.save")}
      successMessage={(d: { remainingBudgetLitres: number | null }) =>
        t("water.allocation.saved", { litres: formatLitres(d.remainingBudgetLitres) })}
    >
      <HiddenField name="fieldId" value={fieldId} />
      <NumberField name="percentage" label={t("label.percentage")} defaultValue={percentage} hint={t("water.allocation.hint")} />
    </ActionForm>
  );
}

/**
 * Move water from the farm reserve (unallocated pool) into this field's budget.
 * No water enters the farm, so this is not a refill.
 */
export function TopUpForm({ fieldId, reserveLitres }: { fieldId: string; reserveLitres: number }) {
  if (reserveLitres <= 0) return <p className="text-muted">{t("water.topUp.empty")}</p>;
  return (
    <ActionForm
      action={topUpFieldBudgetAction}
      schema={topUpSchema}
      submitLabel={t("water.topUp.submit")}
      successMessage={(d: { addedLitres: number; remainingBudgetLitres: number }) =>
        t("water.topUp.done", { added: formatLitres(d.addedLitres), litres: formatLitres(d.remainingBudgetLitres) })}
      resetOnSuccess
    >
      <HiddenField name="fieldId" value={fieldId} />
      <NumberField
        name="quantityLitres"
        label={t("label.quantityLitres")}
        hint={t("water.topUp.hint", { reserve: formatLitres(reserveLitres) })}
      />
    </ActionForm>
  );
}

type CheckState = { tone: "ok" | "warn"; text: string; reserveShortfall: number | null } | null;

/**
 * Record water used on the field's current crop. While the farmer types, the
 * amount is checked with check_irrigation_request() (read-only), so they see
 * "more than the budget" before submitting. record_irrigation() re-checks
 * under a lock when they do submit.
 */
export function IrrigationForm({ fieldCropId, now }: { fieldCropId: string; now: string }) {
  const [check, setCheck] = useState<CheckState>(null);
  const [checking, setChecking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Each check gets a number; an answer for an older number is ignored, so a
  // slow reply can't overwrite a newer one or reappear after the form is saved.
  const latestCheck = useRef(0);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function onAmountInput(event: FormEvent<HTMLDivElement>) {
    const target = event.target as HTMLInputElement;
    if (target.name !== "quantityLitres") return;
    if (timer.current) clearTimeout(timer.current);
    const value = target.value.trim();
    const amount = Number(value);
    const requestId = ++latestCheck.current;
    if (value === "" || !Number.isFinite(amount) || amount <= 0) {
      setCheck(null);
      return;
    }
    // Wait until the farmer stops typing, then ask the DB
    timer.current = setTimeout(async () => {
      setChecking(true);
      const result = await checkIrrigationAction({ fieldCropId, quantityLitres: amount });
      if (requestId !== latestCheck.current) return;
      setChecking(false);
      if (result.ok) {
        setCheck({
          tone: result.data.allowed ? "ok" : "warn",
          text: result.data.message,
          reserveShortfall: result.data.canUseReserve ? result.data.shortfallLitres : null,
        });
      }
    }, 400);
  }

  return (
    <ActionForm
      action={recordIrrigationAction}
      schema={irrigationSchema}
      submitLabel={t("water.irrigate.submit")}
      successMessage={(d: { message: string }) => d.message}
      resetOnSuccess
      onSuccess={() => {
        // The amount was cleared, so drop any pending or shown pre-check
        if (timer.current) clearTimeout(timer.current);
        latestCheck.current++;
        setChecking(false);
        setCheck(null);
      }}
    >
      <HiddenField name="fieldCropId" value={fieldCropId} />
      <div onInput={onAmountInput}>
        <NumberField name="quantityLitres" label={t("label.quantityLitres")} hint={t("water.irrigate.hint")} />
      </div>
      {(checking || check) && (
        <p
          aria-live="polite"
          className={cx(
            "rounded-xl px-3 py-2 text-sm",
            checking ? "bg-accent text-muted" : check?.tone === "ok" ? "bg-success-soft text-primary" : "bg-warning-soft text-warning",
          )}
        >
          {checking ? t("water.irrigate.checking") : check?.text}
        </p>
      )}
      {/* Over budget but the reserve can cover it: the farmer must opt in.
          Keyed by the shortfall so a new amount starts unticked again. */}
      {!checking && check?.reserveShortfall != null && (
        <label key={check.reserveShortfall} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-border px-3 py-3">
          <input
            type="checkbox"
            name="useReserve"
            value="true"
            className="mt-0.5 size-5 shrink-0 accent-primary"
          />
          <span>
            <span className="block font-medium">
              {t("water.irrigate.useReserve", { shortfall: formatNumber(check.reserveShortfall) })}
            </span>
            <span className="block text-sm text-muted">{t("water.irrigate.useReserveHint")}</span>
          </span>
        </label>
      )}
      <TextField name="irrigationDate" label={t("label.when")} type="datetime-local" defaultValue={now} />
      <TextAreaField name="notes" label={t("common.notes")} optional />
    </ActionForm>
  );
}

/** Ledger rows: only notes can change (the DB guard keeps amounts immutable). */
export function LedgerNoteForm({ transactionId, notes }: { transactionId: string; notes: string }) {
  return (
    <ActionForm action={editLedgerEntryAction} schema={editLedgerEntrySchema} submitLabel={t("water.saveNote")} submitVariant="secondary">
      <HiddenField name="transactionId" value={transactionId} />
      <TextAreaField name="notes" label={t("common.notes")} defaultValue={notes} optional />
    </ActionForm>
  );
}

export function IrrigationNoteForm({ eventId, notes }: { eventId: string; notes: string }) {
  return (
    <ActionForm action={updateIrrigationNotesAction} schema={irrigationNotesSchema} submitLabel={t("water.saveNote")} submitVariant="secondary">
      <HiddenField name="eventId" value={eventId} />
      <TextAreaField name="notes" label={t("common.notes")} defaultValue={notes} optional />
    </ActionForm>
  );
}
