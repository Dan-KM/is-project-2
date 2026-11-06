"use server";

import { runAction, type ActionInput } from "@/lib/actions/run";
import * as readings from "@/lib/services/readings";
import * as weather from "@/lib/services/weather";
import {
  createReadingSchema, manualWeatherSchema, readingIdSchema, updateReadingSchema, weatherIdSchema,
} from "@/lib/validation/schemas";

// Soil readings and manual weather entries (the API fetch comes in Phase 4).

export async function createReadingAction(input: ActionInput) {
  return runAction(createReadingSchema, input, async (actor, data) => {
    const reading = await readings.createReading(actor, data);
    return { fieldConditionsId: reading.fieldConditionsId };
  });
}

export async function updateReadingAction(input: ActionInput) {
  return runAction(updateReadingSchema, input, async (actor, data) => {
    await readings.updateReading(actor, data);
    return { fieldConditionsId: data.fieldConditionsId };
  });
}

export async function deleteReadingAction(input: ActionInput) {
  return runAction(readingIdSchema, input, (actor, data) => readings.deleteReading(actor, data.fieldConditionsId));
}

export async function saveManualWeatherAction(input: ActionInput) {
  return runAction(manualWeatherSchema, input, (actor, data) => weather.saveManualWeather(actor, data));
}

export async function deleteWeatherAction(input: ActionInput) {
  return runAction(weatherIdSchema, input, (actor, data) => weather.deleteWeather(actor, data.weatherId));
}
