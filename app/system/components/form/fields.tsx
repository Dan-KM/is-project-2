"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { t } from "@/lib/i18n";
import { cx, focusRing } from "@/components/ui";
import { useFormState } from "./action-form";

// Labelled inputs that read their error from the surrounding ActionForm.
// Every input gets a visible label, a hint when useful, and an error message
// linked with aria-describedby for screen readers.

type BaseProps = {
  name: string;
  /** Fixed element id; by default a unique one is generated (several forms can share a page). */
  id?: string;
  label: string;
  hint?: string;
  optional?: boolean;
};

const inputClass =
  "block w-full min-h-12 rounded-xl border bg-surface px-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary";

function FieldShell({ name, id: fixedId, label, hint, optional, children }: BaseProps & { children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode }) {
  const { fieldErrors } = useFormState();
  const error = fieldErrors[name];
  const generatedId = useId();
  const id = fixedId ?? `f-${name}-${generatedId}`;
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-medium">
        {label}
        {optional && <span className="font-normal text-muted"> ({t("common.optional")})</span>}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type TextFieldProps = BaseProps &
  Pick<InputHTMLAttributes<HTMLInputElement>, "type" | "defaultValue" | "autoComplete" | "inputMode" | "step" | "placeholder" | "min" | "max">;

export function TextField({ type = "text", ...props }: TextFieldProps) {
  const { pending } = useFormState();
  const { name, id, label, hint, optional, ...inputProps } = props;
  // Password fields get a show/hide toggle, so farmers on small keyboards can
  // check what they typed (ui-ux-pro-max: password-toggle)
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  return (
    <FieldShell name={name} id={id} label={label} hint={hint} optional={optional}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <input
            id={id}
            name={name}
            type={isPassword && revealed ? "text" : type}
            readOnly={pending}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className={cx(inputClass, invalid ? "border-danger" : "border-input-border", isPassword && "pr-12")}
            {...inputProps}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              aria-label={revealed ? t("common.hidePassword") : t("common.showPassword")}
              aria-pressed={revealed}
              className={cx(
                "absolute inset-y-0 right-0 flex w-12 cursor-pointer items-center justify-center rounded-r-xl text-muted hover:text-foreground",
                focusRing,
              )}
            >
              <Icon icon={revealed ? EyeOff : Eye} />
            </button>
          )}
        </div>
      )}
    </FieldShell>
  );
}

/** Decimal number input; shows the numeric keypad on phones. */
export function NumberField(props: Omit<TextFieldProps, "type" | "inputMode">) {
  return <TextField type="text" inputMode="decimal" autoComplete="off" {...props} />;
}

export function SelectField({
  name, label, hint, optional, options, defaultValue,
}: BaseProps & { options: Array<{ value: string; label: string }>; defaultValue?: string }) {
  return (
    <FieldShell name={name} label={label} hint={hint} optional={optional}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          name={name}
          defaultValue={defaultValue ?? ""}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={cx(inputClass, invalid ? "border-danger" : "border-input-border")}
        >
          <option value="" disabled={!optional}>
            {t("select.placeholder")}
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

export function TextAreaField({ name, label, hint, optional, defaultValue }: BaseProps & { defaultValue?: string }) {
  return (
    <FieldShell name={name} label={label} hint={hint} optional={optional}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          name={name}
          rows={3}
          defaultValue={defaultValue}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={cx(inputClass, "py-2", invalid ? "border-danger" : "border-input-border")}
        />
      )}
    </FieldShell>
  );
}

export function HiddenField({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}
