"use client";

import { loginAction, registerAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/form/action-form";
import { TextField } from "@/components/form/fields";
import { t } from "@/lib/i18n";
import { loginSchema, registerSchema } from "@/lib/validation/schemas";

// On success the server actions set the session cookie and redirect home.

export function LoginForm() {
  return (
    <ActionForm action={loginAction} schema={loginSchema} submitLabel={t("auth.login.submit")}>
      <TextField name="email" label={t("label.email")} type="email" autoComplete="email" inputMode="email" />
      <TextField name="password" label={t("label.password")} type="password" autoComplete="current-password" />
    </ActionForm>
  );
}

export function RegisterForm() {
  return (
    <ActionForm action={registerAction} schema={registerSchema} submitLabel={t("auth.register.submit")}>
      <div className="grid grid-cols-2 items-end gap-3">
        <TextField name="firstName" label={t("label.firstName")} autoComplete="given-name" />
        <TextField name="lastName" label={t("label.lastName")} autoComplete="family-name" />
      </div>
      <TextField name="email" label={t("label.email")} type="email" autoComplete="email" inputMode="email" />
      <TextField name="phone" label={t("label.phone")} type="tel" autoComplete="tel" optional placeholder="+2547…" />
      <TextField
        name="password" label={t("label.password")} type="password" autoComplete="new-password" hint={t("hint.password")}
      />
    </ActionForm>
  );
}
