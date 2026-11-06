"use server";

import { runAction, type ActionInput } from "@/lib/actions/run";
import * as readings from "@/lib/services/readings";
import * as weather from "@/lib/services/weather";
import {
  createReadingSchema, farmIdSchema, manualWeatherSchema, readingIdSchema, updateReadingSchema, weatherIdSchema,
} from "@/lib/validation/schemas";

// Soil readings, weather refresh (Open-Meteo) and manual weather entries.

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

/** "Refresh" / "Try again" on the weather card: skips the cache and calls Open-Meteo. */
export async function refreshWeatherAction(input: ActionInput) {
  return runAction(farmIdSchema, input, async (actor, data) => {
    const snap = await weather.getFarmWeather(actor, data.farmId, { force: true });
    return { source: snap.source, fetchFailed: snap.fetchFailed, observedAt: snap.observedAt?.toISOString() ?? null };
  });
}

export async function saveManualWeatherAction(input: ActionInput) {
  return runAction(manualWeatherSchema, input, (actor, data) => weather.saveManualWeather(actor, data));
}

export async function deleteWeatherAction(input: ActionInput) {
  return runAction(weatherIdSchema, input, (actor, data) => weather.deleteWeather(actor, data.weatherId));
}
