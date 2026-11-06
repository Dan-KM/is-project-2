import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/components/forms/auth-forms";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("auth.register.title") };

export default function RegisterPage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">{t("auth.register.title")}</h1>
      <RegisterForm />
      <p className="mt-4 text-center text-muted">
        {t("auth.register.haveAccount")}{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-2 hover:underline">
          {t("auth.register.loginLink")}
        </Link>
      </p>
    </>
  );
}
