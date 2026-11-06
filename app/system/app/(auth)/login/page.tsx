import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/forms/auth-forms";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("auth.login.title") };

export default function LoginPage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">{t("auth.login.title")}</h1>
      <LoginForm />
      <p className="mt-4 text-center text-muted">
        {t("auth.login.noAccount")}{" "}
        <Link href="/register" className="font-medium text-primary underline-offset-2 hover:underline">
          {t("auth.login.registerLink")}
        </Link>
      </p>
    </>
  );
}
