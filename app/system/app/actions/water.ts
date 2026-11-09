"use server";

import { runAction, type ActionInput } from "@/lib/actions/run";
import { t } from "@/lib/i18n";
import * as water from "@/lib/services/water";
import {
  allocationSchema, checkIrrigationSchema, editLedgerEntrySchema, farmIdSchema, initialWaterSchema,
  irrigationNotesSchema, irrigationSchema, refillSchema, topUpSchema,
} from "@/lib/validation/schemas";

// Water operations. Each one calls a SQL function through the water service;
// failures such as "Not enough water in the farm supply" come back as messages.

export async function recordInitialWaterAction(input: ActionInput) {
  return runAction(initialWaterSchema, input, (actor, data) => water.recordInitialEntry(actor, data));
}

export async function recordRefillAction(input: ActionInput) {
  return runAction(refillSchema, input, (actor, data) => water.recordRefill(actor, data));
}

/** Live pre-check for the irrigation form; changes nothing, so no page refresh. */
export async function checkIrrigationAction(input: ActionInput) {
  return runAction(
    checkIrrigationSchema,
    input,
    async (actor, data) => {
      const check = await water.checkIrrigation(actor, data);
      // Over the field budget: say whether the farm reserve can make up the rest
      const overBudget = check.reasonCode === "EXCEEDS_FIELD_BUDGET";
      const message = !overBudget
        ? t(`water.check.${check.reasonCode}`, { max: check.maxLitres })
        : check.canUseReserve
          ? t("water.check.RESERVE_AVAILABLE", { budget: check.fieldBudgetLitres ?? 0, shortfall: check.shortfallLitres })
          : t("water.check.RESERVE_TOO_SMALL", { budget: check.fieldBudgetLitres ?? 0, reserve: check.unallocatedLitres });
      return { ...check, message };
    },
    { revalidate: false },
  );
}

export async function recordIrrigationAction(input: ActionInput) {
  return runAction(irrigationSchema, input, async (actor, data) => {
    const result = await water.recordIrrigation(actor, data);
    const status = t(`water.status.${result.statusCode}`, { litres: result.replenishedLitres });
    const message = result.borrowedLitres > 0
      ? `${t("water.status.borrowed", { litres: result.borrowedLitres })} ${status}`
      : status;
    return { ...result, message };
  });
}

export async function editLedgerEntryAction(input: ActionInput) {
  return runAction(editLedgerEntrySchema, input, async (actor, data) => {
    await water.editLedgerEntry(actor, data);
    return { transactionId: data.transactionId };
  });
}

export async function undoLatestWaterEntryAction(input: ActionInput) {
  return runAction(farmIdSchema, input, async (actor, data) => {
    const { undone } = await water.undoLatestEntry(actor, data.farmId);
    return { transactionId: undone.transactionId, transactionType: undone.transactionType };
  });
}

export async function setAllocationAction(input: ActionInput) {
  return runAction(allocationSchema, input, (actor, data) => water.setAllocation(actor, data));
}

/** Move water from the farm reserve (unallocated pool) into one field's budget. */
export async function topUpFieldBudgetAction(input: ActionInput) {
  return runAction(topUpSchema, input, (actor, data) => water.topUpFieldBudget(actor, data));
}

export async function updateIrrigationNotesAction(input: ActionInput) {
  return runAction(irrigationNotesSchema, input, async (actor, data) => {
    await water.updateIrrigationNotes(actor, data);
    return { eventId: data.eventId };
  });
}
