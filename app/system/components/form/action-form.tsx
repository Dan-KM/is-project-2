"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, use, useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import type { z } from "zod";
import type { ActionResult } from "@/lib/actions/run";
import { t } from "@/lib/i18n";
import { nairobiLocalToIso } from "@/lib/time";
import { Icon } from "@/components/icon";
import { buttonStyles, cx } from "@/components/ui";

// One form wrapper for every create/edit form:
//   * validates with the same Zod schema the server uses, before sending
//   * shows a loading state, field errors and a success/error message
//   * keeps what the farmer typed when something fails
// It submits through onSubmit (not <form action>) because React resets a form
// after a form action completes, which would wipe the farmer's input on error.

type FormState = { fieldErrors: Record<string, string>; pending: boolean };
const FormContext = createContext<FormState>({ fieldErrors: {}, pending: false });

/** Used by the input components to show their error and disable while saving. */
export function useFormState() {
  return use(FormContext);
}

type Props<T> = {
  action: (input: FormData) => Promise<ActionResult<T>>;
  schema?: z.ZodType;
  submitLabel: string;
  children: ReactNode;
  /** Where to go after success (a path, or built from the action's result). */
  successHref?: string | ((data: T) => string);
  /** Message shown after success when staying on the page. */
  successMessage?: string | ((data: T) => string);
  /** Clear the inputs after success (e.g. "add another" forms). */
  resetOnSuccess?: boolean;
  /** Called after a successful save (e.g. to clear extra UI the form owns). */
  onSuccess?: (data: T) => void;
  submitVariant?: keyof typeof buttonStyles;
};

export function ActionForm<T>({
  action, schema, submitLabel, children, successHref, successMessage, resetOnSuccess, onSuccess, submitVariant = "primary",
}: Props<T>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Bumped on every failed submit, so the focus effect runs even when the
  // same errors come back twice
  const [failedSubmits, setFailedSubmits] = useState(0);

  // After a failed submit, move focus to the first invalid field so keyboard
  // and screen-reader users land on the problem (ui-ux-pro-max: focus-management)
  useEffect(() => {
    if (failedSubmits === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [failedSubmits]);

  // A success note goes stale once anything else changes (e.g. "tank now has
  // 1,800 L" after an undo), so it fades after a few seconds. Errors stay.
  useEffect(() => {
    if (message?.tone !== "success") return;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    // Date-time inputs are entered in Nairobi time; send an exact ISO moment
    form.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]').forEach((input) => {
      if (input.name && input.value) formData.set(input.name, nairobiLocalToIso(input.value));
    });

    // Validate in the browser first, with the server's own schema
    if (schema) {
      const parsed = schema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) {
        const errors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = issue.path.join(".");
          if (!(key in errors)) errors[key] = t(issue.message);
        }
        setFieldErrors(errors);
        setMessage({ tone: "error", text: t("common.fixErrors") });
        setFailedSubmits((n) => n + 1);
        return;
      }
    }

    setMessage(null);
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setMessage({ tone: "error", text: result.error });
        if (result.fieldErrors) setFailedSubmits((n) => n + 1);
        return;
      }
      setFieldErrors({});
      onSuccess?.(result.data);
      if (successHref) {
        router.push(typeof successHref === "function" ? successHref(result.data) : successHref);
        return;
      }
      if (resetOnSuccess) form.reset();
      const text = typeof successMessage === "function" ? successMessage(result.data) : (successMessage ?? t("common.saved"));
      setMessage({ tone: "success", text });
    });
  }

  return (
    <FormContext value={{ fieldErrors, pending }}>
      <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-4">
        {children}
        {message && (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={cx(
              "rounded-xl px-4 py-3 text-base",
              message.tone === "error" ? "bg-danger-soft text-danger" : "bg-success-soft text-primary",
            )}
          >
            {message.text}
          </p>
        )}
        <button type="submit" disabled={pending} aria-busy={pending} className={cx(buttonStyles[submitVariant], "w-full")}>
          {pending && <Icon icon={LoaderCircle} size="sm" className="animate-spin motion-reduce:animate-none" />}
          {pending ? t("common.saving") : submitLabel}
        </button>
      </form>
    </FormContext>
  );
}
