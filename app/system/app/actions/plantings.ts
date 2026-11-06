"use server";

import { runAction, type ActionInput } from "@/lib/actions/run";
import * as plantings from "@/lib/services/plantings";
import {
  createGrowthSchema, growthIdSchema, plantCropSchema, plantingIdSchema, updateGrowthSchema, updatePlantingSchema,
} from "@/lib/validation/schemas";

// Plantings (via replace_field_crop) and growth stage records.

export async function plantCropAction(input: ActionInput) {
  return runAction(plantCropSchema, input, (actor, data) => plantings.plantCrop(actor, data));
}

export async function updatePlantingAction(input: ActionInput) {
  return runAction(updatePlantingSchema, input, async (actor, data) => {
    await plantings.updatePlanting(actor, data);
    return { fieldCropId: data.fieldCropId };
  });
}

export async function deletePlantingAction(input: ActionInput) {
  return runAction(plantingIdSchema, input, (actor, data) => plantings.deletePlanting(actor, data.fieldCropId));
}

export async function createGrowthAction(input: ActionInput) {
  return runAction(createGrowthSchema, input, async (actor, data) => {
    const record = await plantings.createGrowthRecord(actor, data);
    return { evolutionId: record.evolutionId };
  });
}

export async function updateGrowthAction(input: ActionInput) {
  return runAction(updateGrowthSchema, input, async (actor, data) => {
    await plantings.updateGrowthRecord(actor, data);
    return { evolutionId: data.evolutionId };
  });
}

export async function deleteGrowthAction(input: ActionInput) {
  return runAction(growthIdSchema, input, (actor, data) => plantings.deleteGrowthRecord(actor, data.evolutionId));
}
