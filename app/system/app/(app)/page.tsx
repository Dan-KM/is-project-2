import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink, Card, EmptyState, PageHeader, PageLoading } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { requirePageActor } from "@/lib/page";
import { listFarms } from "@/lib/services/farms";

// Home: the farmer's farms. (The full dashboard replaces this in Phase 6.)

export default function HomePage() {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <FarmList />
    </Suspense>
  );
}

async function FarmList() {
  const actor = await requirePageActor();
  const farms = await listFarms(actor);
  return (
    <>
      <PageHeader
        title={t("farm.list.title")}
        action={farms.length > 0 ? <ButtonLink href="/farms/new">+ {t("farm.add")}</ButtonLink> : undefined}
      />
      {farms.length === 0 ? (
        <EmptyState action={<ButtonLink href="/farms/new">{t("farm.add")}</ButtonLink>}>{t("farm.list.empty")}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {farms.map((farm) => (
            <li key={farm.farmId}>
              <Link href={`/farms/${farm.farmId}`} className="block">
                <Card className="transition-colors hover:border-primary">
                  <p className="text-lg font-semibold">{farm.farmName}</p>
                  <p className="text-muted">{farm.farmAddress}</p>
                  <p className="mt-2 text-sm">
                    {formatNumber(farm.area)} ha · {farm.fields} {t("farm.fields").toLowerCase()}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
