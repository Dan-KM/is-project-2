import type { Metadata } from "next";
import { Suspense } from "react";
import { DeleteAccountForm, PasswordForm, ProfileForm } from "@/components/forms/profile-forms";
import { Card, PageHeader, PageLoading, SectionTitle } from "@/components/ui";
import { t } from "@/lib/i18n";
import { requirePageActor } from "@/lib/page";
import { getProfile } from "@/lib/services/users";

export const metadata: Metadata = { title: t("profile.title") };

export default function ProfilePage() {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <Profile />
    </Suspense>
  );
}

async function Profile() {
  const actor = await requirePageActor();
  const user = await getProfile(actor);
  return (
    <>
      <PageHeader title={t("profile.title")} back={{ href: "/", label: t("nav.home") }} />
      <p className="mb-4 text-sm text-muted">{t("profile.role", { role: user.userRole })}</p>

      <SectionTitle>{t("profile.details")}</SectionTitle>
      <Card className="mb-5">
        <ProfileForm user={{ firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone }} />
      </Card>

      <SectionTitle>{t("profile.password")}</SectionTitle>
      <Card className="mb-5">
        <PasswordForm />
      </Card>

      <SectionTitle>{t("profile.delete")}</SectionTitle>
      <Card className="border-danger/40">
        <DeleteAccountForm />
      </Card>
    </>
  );
}
