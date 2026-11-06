"use client";

import { changePasswordAction, deleteAccountAction, updateProfileAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/form/action-form";
import { TextField } from "@/components/form/fields";
import { t } from "@/lib/i18n";
import { changePasswordSchema, updateProfileSchema } from "@/lib/validation/schemas";

export function ProfileForm({
  user,
}: { user: { firstName: string; lastName: string; email: string; phone: string | null } }) {
  return (
    <ActionForm action={updateProfileAction} schema={updateProfileSchema} submitLabel={t("common.save")}>
      <div className="grid grid-cols-2 items-end gap-3">
        <TextField name="firstName" label={t("label.firstName")} defaultValue={user.firstName} autoComplete="given-name" />
        <TextField name="lastName" label={t("label.lastName")} defaultValue={user.lastName} autoComplete="family-name" />
      </div>
      <TextField name="email" label={t("label.email")} type="email" defaultValue={user.email} autoComplete="email" />
      <TextField name="phone" label={t("label.phone")} type="tel" defaultValue={user.phone ?? ""} optional />
    </ActionForm>
  );
}

export function PasswordForm() {
  return (
    <ActionForm
      action={changePasswordAction}
      schema={changePasswordSchema}
      submitLabel={t("profile.password")}
      successMessage={t("profile.passwordChanged")}
      resetOnSuccess
      submitVariant="secondary"
    >
      <TextField name="currentPassword" label={t("label.currentPassword")} type="password" autoComplete="current-password" />
      <TextField
        name="newPassword" label={t("label.newPassword")} type="password" autoComplete="new-password" hint={t("hint.password")}
      />
    </ActionForm>
  );
}

/** Typing DELETE is required (checked again on the server). */
export function DeleteAccountForm() {
  return (
    <ActionForm action={deleteAccountAction} submitLabel={t("profile.delete")} submitVariant="dangerSolid">
      <p className="text-sm text-danger">{t("profile.deleteWarning")}</p>
      <TextField name="confirm" label={t("label.confirmDelete")} autoComplete="off" />
    </ActionForm>
  );
}
