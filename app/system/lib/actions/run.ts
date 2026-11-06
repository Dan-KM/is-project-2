import "server-only";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import type { Actor } from "@/lib/auth/actor";
import { requireActor } from "@/lib/auth/current-user";
import { toAppError } from "@/lib/errors";
import { t } from "@/lib/i18n";

// The shared pipeline every server action runs:
//   1. validate the input with the operation's Zod schema (never trust the client)
//   2. load the logged-in user from the session cookie
//   3. call the service, which checks permissions and ownership
//   4. turn any failure into a translated message: no stack traces, no SQL
//   5. refresh the pages so they show the change

/** What a server action returns to the form. Field errors are already translated. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Forms post FormData; other callers (buttons, fetch-like calls) post plain objects. */
export type ActionInput = FormData | Record<string, unknown>;

function toObject(input: ActionInput): Record<string, unknown> {
  if (!(input instanceof FormData)) return input;
  const out: Record<string, unknown> = {};
  for (const [key, value] of input.entries()) {
    if (key.startsWith("$ACTION")) continue; // React's internal fields
    out[key] = typeof value === "string" ? value : undefined; // no file uploads in this app
  }
  return out;
}

/** Zod issues → one translated message per field (the first problem per field). */
function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!(key in errors)) errors[key] = t(issue.message);
  }
  return errors;
}

type Options = {
  /** Skip the login check (sign-up and login only). */
  public?: boolean;
  /** Re-render pages after a successful change (default true). */
  revalidate?: boolean;
};

export async function runAction<S extends z.ZodType, T>(
  schema: S,
  input: ActionInput,
  fn: (actor: Actor, data: z.infer<S>) => Promise<T>,
  options: Options = {},
): Promise<ActionResult<T>> {
  const parsed = schema.safeParse(toObject(input));
  if (!parsed.success) {
    return { ok: false, error: t("errors.invalidInput"), fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  try {
    // Public actions get a placeholder actor; their services don't use it
    const actor: Actor = options.public ? { userId: "", role: "farmer" } : await requireActor();
    const data = await fn(actor, parsed.data);
    if (options.revalidate !== false) revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    unstable_rethrow(e); // let Next.js handle redirect() / notFound()
    const appError = toAppError(e);
    return { ok: false, error: t(appError.key, appError.params) };
  }
}
