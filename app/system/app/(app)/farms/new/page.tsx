import type { Metadata } from "next";
import { AuthGate } from "@/components/auth-gate";
import { FarmForm } from "@/components/forms/farm-form";
import { Card, PageHeader } from "@/components/ui";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("farm.new.title") };

export default function NewFarmPage() {
  return (
    <>
      <AuthGate />
      <PageHeader title={t("farm.new.title")} back={{ href: "/", label: t("nav.home") }} />
      <Card>
        <FarmForm />
      </Card>
    </>
  );
}
