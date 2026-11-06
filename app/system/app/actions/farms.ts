"use server";

import { runAction, type ActionInput } from "@/lib/actions/run";
import * as farms from "@/lib/services/farms";
import * as fields from "@/lib/services/fields";
import {
  createFarmSchema, createFieldSchema, farmIdSchema, fieldIdSchema, updateFarmSchema, updateFieldSchema,
} from "@/lib/validation/schemas";

// Farms and fields: plain CRUD (the DB still enforces area limits).

export async function createFarmAction(input: ActionInput) {
  return runAction(createFarmSchema, input, async (actor, data) => {
    const farm = await farms.createFarm(actor, data);
    return { farmId: farm.farmId };
  });
}

export async function updateFarmAction(input: ActionInput) {
  return runAction(updateFarmSchema, input, async (actor, data) => {
    await farms.updateFarm(actor, data);
    return { farmId: data.farmId };
  });
}

export async function deleteFarmAction(input: ActionInput) {
  return runAction(farmIdSchema, input, (actor, data) => farms.deleteFarm(actor, data.farmId));
}

export async function createFieldAction(input: ActionInput) {
  return runAction(createFieldSchema, input, async (actor, data) => {
    const field = await fields.createField(actor, data);
    return { fieldId: field.fieldId };
  });
}

export async function updateFieldAction(input: ActionInput) {
  return runAction(updateFieldSchema, input, async (actor, data) => {
    await fields.updateField(actor, data);
    return { fieldId: data.fieldId };
  });
}

export async function deleteFieldAction(input: ActionInput) {
  return runAction(fieldIdSchema, input, (actor, data) => fields.deleteField(actor, data.fieldId));
}
