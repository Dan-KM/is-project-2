// Every user-facing string lives here so a Swahili file (sw.ts) with the same
// keys can be added later without touching components or services.
// Placeholders use {name} and are filled by t() in ./index.ts.

export const en = {
  // ---- Generic ----
  "errors.unexpected": "Something went wrong. Please try again.",
  "errors.notFound": "We couldn't find that record. It may have been deleted.",
  "errors.unauthenticated": "Please log in to continue.",
  "errors.forbidden": "You don't have permission to do this.",
  "errors.invalidInput": "Some details are missing or incorrect. Please check the form.",
  "errors.integrity": "The farm's water records don't add up. Please contact support.",

  // ---- Validation (Zod messages are keys from this file) ----
  "validation.required": "This field is required.",
  "validation.number": "Enter a number.",
  "validation.integer": "Enter a whole number.",
  "validation.positive": "Must be greater than 0.",
  "validation.nonNegative": "Can't be negative.",
  "validation.range": "Must be between {min} and {max}.",
  "validation.max": "Must be {max} or less.",
  "validation.tooLong": "Too long (max {max} characters).",
  "validation.email": "Enter a valid email address.",
  "validation.password": "Password must be at least 8 characters.",
  "validation.date": "Enter a valid date.",
  "validation.option": "Choose one of the options.",
  "validation.id": "Invalid reference.",

  // ---- Users / auth ----
  "auth.invalidCredentials": "Wrong email or password.",
  "auth.emailTaken": "An account with this email already exists.",
  "auth.wrongPassword": "Your current password is incorrect.",

  // ---- Farm ----
  "farm.cannotShrink": "The farm can't be smaller than its fields. Its fields already cover {used} ha.",

  // ---- Field ----
  "field.nameTaken": "This farm already has a field with that name.",
  "field.areaExceedsFarm": "The fields would cover {used} ha, but the farm is only {farmArea} ha.",

  // ---- Crops / plantings ----
  "crop.inUse": "This crop is planted on a field, so it can't be deleted.",
  "planting.inactive": "This planting has ended. Plant a new crop first.",
  "planting.none": "This field has no crop planted yet.",

  // ---- Water ----
  "water.insufficientFarm": "Not enough water in the farm supply.",
  "water.exceedsFieldBudget": "That's more than this field's remaining water budget ({budget} L).",
  "water.budgetExhausted": "This field's budget is used up and there is no unallocated water. Add water to the farm first.",
  "water.noAllocation": "This field has no water allocation yet. Give it an allocation first.",
  "water.alreadyInitial": "This farm already has its first water entry. Record a refill instead.",
  "water.noInitialEntry": "This farm has no water recorded yet. Add the first water entry.",
  "water.undoOnlyLatest": "Only the most recent water entry can be undone.",
  "water.undoBudgetUsed": "Can't undo: water from this entry has already been used by a field.",
  "water.undoAllocated": "Can't undo: that water is already allocated to fields.",
  "water.immutable": "Water amounts can't be changed. Undo the latest entry and record it again.",
  "water.allocationOver100": "Allocations on this farm would total {total}%. The maximum is 100%.",
  "water.status.OK": "Irrigation recorded.",
  "water.status.BUDGET_REPLENISHED": "Budget used up and refilled with {litres} L from unallocated water.",
  "water.status.BUDGET_EXHAUSTED": "Budget used up and no unallocated water is left. This field can't irrigate until you add water.",
  "water.check.OK": "OK to irrigate.",
  "water.check.PLANTING_INACTIVE": "This planting has ended.",
  "water.check.NO_WATER_RECORDS": "This farm has no water recorded yet.",
  "water.check.NO_ALLOCATION": "This field has no water allocation.",
  "water.check.INVALID_AMOUNT": "Enter an amount greater than 0.",
  "water.check.EXCEEDS_FIELD_BUDGET": "More than this field's budget. You can use up to {max} L.",
  "water.check.EXCEEDS_FARM_BALANCE": "More than the farm's water. You can use up to {max} L.",

  // ---- Prediction ----
  "prediction.apiUnavailable": "The prediction service isn't responding. Please try again later.",
  "prediction.apiBadResponse": "The prediction service sent an unexpected answer.",
  "prediction.notConfigured": "The prediction service address isn't set up (MODEL_API_URL).",
  "prediction.mockBadge": "Mock prediction",
  "prediction.requiredMissing": "Can't make a prediction yet. Missing: {features}.",
  "prediction.action.No_Irrigation": "No irrigation needed",
  "prediction.action.Low": "Irrigate a little",
  "prediction.action.Medium": "Irrigate a moderate amount",
  "prediction.action.High": "Irrigate a lot",
  "prediction.estimatedCount": "{count} of {total} inputs were missing and estimated by the model.",
} as const;

export type MessageKey = keyof typeof en;
