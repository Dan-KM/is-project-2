import { Suspense } from "react";
import { FarmForm } from "@/components/forms/farm-form";
import { Card, PageHeader, PageLoading } from "@/components/ui";
import { inputNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { orNotFound, requirePageActor } from "@/lib/page";
import { getFarm } from "@/lib/services/farms";

export default function EditFarmPage(props: PageProps<"/farms/[farmId]/edit">) {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <EditFarm params={props.params} />
    </Suspense>
  );
}

async function EditFarm({ params }: { params: PageProps<"/farms/[farmId]/edit">["params"] }) {
  const { farmId } = await params;
  const actor = await requirePageActor();
  const farm = await orNotFound(getFarm(actor, farmId));
  return (
    <>
      <PageHeader title={t("farm.edit.title")} back={{ href: `/farms/${farmId}`, label: farm.farmName }} />
      <Card>
        <FarmForm
          farm={{
            farmId,
            farmName: farm.farmName,
            farmAddress: farm.farmAddress,
            latitude: inputNumber(farm.latitude),
            longitude: inputNumber(farm.longitude),
            area: inputNumber(farm.area),
          }}
        />
      </Card>
    </>
  );
}
