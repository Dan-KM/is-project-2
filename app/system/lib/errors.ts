import type { MessageKey, MessageParams } from "@/lib/i18n";

/**
 * An expected, farmer-facing failure. Services throw it; server actions turn it
 * into a translated message. It never carries stack traces or SQL to the UI.
 */
export class AppError extends Error {
  constructor(
    public readonly key: MessageKey,
    public readonly params?: MessageParams,
    /** The original error, kept for server logs only. */
    public readonly original?: unknown,
  ) {
    super(key);
    this.name = "AppError";
  }
}

/** Shape of the error Prisma 8 raises for a failed SQL statement. */
type SqlQueryErrorLike = {
  name?: string;
  sqlState?: string;
  constraint?: string;
  message?: string;
  cause?: { hint?: string };
};

function isSqlError(e: unknown): e is SqlQueryErrorLike {
  return typeof e === "object" && e !== null && "sqlState" in e;
}

// Pulls a number that follows a phrase in a DB message, e.g. "remaining budget of 120.50 L".
function numberAfter(message: string, phrase: string): string | undefined {
  const match = message.match(new RegExp(`${phrase}\\s*(-?[\\d.]+)`));
  // "11.0000" → "11", "500.50" → "500.5": DB numerics carry trailing zeros
  return match ? String(Number(match[1])) : undefined;
}

/**
 * Plain `RAISE EXCEPTION` calls in the SQL functions have no custom SQLSTATE
 * (they arrive as P0001), so we recognise them by their stable message text.
 * Order matters: the first match wins.
 */
const messageRules: Array<{ test: RegExp; key: MessageKey; params?: (m: string) => MessageParams }> = [
  { test: /already has (an initial entry|water records)/, key: "water.alreadyInitial" },
  { test: /has no (initial water entry|INITIAL_ENTRY) yet/, key: "water.noInitialEntry" },
  { test: /Only the latest transaction/, key: "water.undoOnlyLatest" },
  { test: /Cannot undo: budget granted/, key: "water.undoBudgetUsed" },
  { test: /Ledger amounts are immutable/, key: "water.immutable" },
  { test: /is no longer active/, key: "planting.inactive" },
  { test: /must be greater than 0/, key: "validation.positive" },
  { test: /(Farm|Field|Planting) \S+ not found/, key: "errors.notFound" },
  {
    test: /Active allocations for farm/,
    key: "water.allocationOver100",
    params: (m) => ({ total: numberAfter(m, "would total") ?? "?" }),
  },
  {
    test: /would cover/,
    key: "field.areaExceedsFarm",
    params: (m) => ({ used: numberAfter(m, "would cover") ?? "?", farmArea: numberAfter(m, "farm is only") ?? "?" }),
  },
  {
    test: /cannot shrink/,
    key: "farm.cannotShrink",
    params: (m) => ({ used: numberAfter(m, "already cover") ?? "?" }),
  },
];

/** Unique constraints → message, by constraint name from the schema. */
const uniqueRules: Record<string, MessageKey> = {
  field_farm_id_field_name_key: "field.nameTaken",
  users_email_key: "auth.emailTaken",
  uq_users_email_lower: "auth.emailTaken",
  uq_water_txn_one_initial: "water.alreadyInitial",
};

/**
 * Convert any thrown value into an AppError the farmer can understand.
 * Unknown errors are logged on the server and shown as a generic message.
 */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;

  if (isSqlError(e)) {
    const message = e.message ?? "";
    switch (e.sqlState) {
      // Custom codes raised by the water functions (see 02-schema.sql header)
      case "IR001":
        return new AppError("water.insufficientFarm", undefined, e);
      case "IR002": {
        const budget = numberAfter(message, "remaining budget of") ?? "0";
        return Number(budget) === 0
          ? new AppError("water.budgetExhausted", undefined, e)
          : new AppError("water.exceedsFieldBudget", { budget }, e);
      }
      case "IR003":
        return new AppError("water.noAllocation", undefined, e);
      case "IR004":
        // The undo guard uses IR004 when the smaller balance can't cover budgets
        return /Cannot undo/.test(message)
          ? new AppError("water.undoAllocated", undefined, e)
          : new AppError("errors.integrity", undefined, e);
      case "IR005":
        return new AppError("errors.integrity", undefined, e);
      case "23505": {
        const key = e.constraint ? uniqueRules[e.constraint] : undefined;
        if (key) return new AppError(key, undefined, e);
        break;
      }
      case "23503":
        // RESTRICT on field_crop.crop_id = crop still planted
        if (e.constraint === "field_crop_crop_id_fkey") return new AppError("crop.inUse", undefined, e);
        break;
      case "23514":
      case "P0001":
        break;
    }
    for (const rule of messageRules) {
      if (rule.test.test(message)) return new AppError(rule.key, rule.params?.(message), e);
    }
    // A CHECK constraint we didn't map (e.g. moisture > 100) is still bad input
    if (e.sqlState === "23514") return new AppError("errors.invalidInput", undefined, e);
    if (e.sqlState === "23503") return new AppError("errors.notFound", undefined, e);
  }

  console.error("[unexpected error]", e);
  return new AppError("errors.unexpected", undefined, e);
}
