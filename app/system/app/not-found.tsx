import { Sprout } from "lucide-react";
import { Icon } from "@/components/icon";
import { ButtonLink } from "@/components/ui";
import { t } from "@/lib/i18n";

// Shown for unknown URLs and for records the farmer can't access (services
// report other farmers' data as "not found").
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
      <div className="mb-3 text-primary">
        <Icon icon={Sprout} size="xl" />
      </div>
      <h1 className="mb-2 text-2xl font-semibold">{t("notFound.title")}</h1>
      <p className="mb-5 text-muted">{t("notFound.body")}</p>
      <ButtonLink href="/">{t("notFound.home")}</ButtonLink>
    </main>
  );
}
