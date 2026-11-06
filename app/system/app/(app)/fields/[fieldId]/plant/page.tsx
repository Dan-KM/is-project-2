import { Suspense } from "react";
import { PlantCropForm } from "@/components/forms/planting-forms";
import { Card, PageHeader, PageLoading } from "@/components/ui";
import { t } from "@/lib/i18n";
import { orNotFound, requirePageActor } from "@/lib/page";
import { localDateString } from "@/lib/time";
import { listCrops } from "@/lib/services/crops";
import { getField } from "@/lib/services/fields";
import { getActivePlanting } from "@/lib/services/plantings";

export default function PlantPage(props: PageProps<"/fields/[fieldId]/plant">) {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <Plant params={props.params} />
    </Suspense>
  );
}

async function Plant({ params }: { params: PageProps<"/fields/[fieldId]/plant">["params"] }) {
  const { fieldId } = await params;
  const actor = await requirePageActor();
  const field = await orNotFound(getField(actor, fieldId));
  const [crops, active] = await Promise.all([listCrops(actor), getActivePlanting(actor, fieldId)]);
  return (
    <>
      <PageHeader title={active ? t("planting.replace") : t("planting.plant")} back={{ href: `/fields/${fieldId}`, label: field.fieldName }} />
      <Card>
        <PlantCropForm
          fieldId={fieldId}
          crops={crops.map((c) => ({ cropId: c.cropId, cropName: c.cropName }))}
          today={localDateString()}
          hasActive={!!active}
        />
      </Card>
    </>
  );
}
