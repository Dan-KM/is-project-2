"use server";

import { runAction } from "@/lib/actions/run";
import * as predictions from "@/lib/services/predictions";
import { predictionIdSchema, predictionInputSchema, type PredictionInput } from "@/lib/validation/schemas";

// Prediction flow. The features object is nested, so these take plain objects
// (not FormData). The server rebuilds the features itself on every call.

/** Step 1: assemble and show the features. Writes nothing. */
export async function previewPredictionAction(input: PredictionInput) {
  return runAction(
    predictionInputSchema,
    input,
    async (actor, data) => {
      const assembled = await predictions.previewPrediction(actor, data);
      // Send only what the confirmation screen renders
      return { entries: assembled.entries, missing: assembled.missing, context: assembled.context };
    },
    { revalidate: false },
  );
}

/** Step 2: predict and store the result with today's reading. */
export async function createPredictionAction(input: PredictionInput) {
  return runAction(predictionInputSchema, input, (actor, data) => predictions.createPrediction(actor, data));
}

export async function deletePredictionAction(input: { predictionId: string }) {
  return runAction(predictionIdSchema, input, (actor, data) => predictions.deletePrediction(actor, data.predictionId));
}
