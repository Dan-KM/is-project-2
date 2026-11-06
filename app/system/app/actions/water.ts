"use server";

import { runAction, type ActionInput } from "@/lib/actions/run";
import { t } from "@/lib/i18n";
import * as water from "@/lib/services/water";
import {
  allocationSchema, checkIrrigationSchema, editLedgerEntrySchema, farmIdSchema, initialWaterSchema,
  irrigationNotesSchema, irrigationSchema, refillSchema,
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
      return {
        ...check,
        message: t(`water.check.${check.reasonCode}`, { max: check.maxLitres }),
      };
    },
    { revalidate: false },
  );
}

export async function recordIrrigationAction(input: ActionInput) {
  return runAction(irrigationSchema, input, async (actor, data) => {
    const result = await water.recordIrrigation(actor, data);
    return { ...result, message: t(`water.status.${result.statusCode}`, { litres: result.replenishedLitres }) };
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

export async function updateIrrigationNotesAction(input: ActionInput) {
  return runAction(irrigationNotesSchema, input, async (actor, data) => {
    await water.updateIrrigationNotes(actor, data);
    return { eventId: data.eventId };
  });
}
