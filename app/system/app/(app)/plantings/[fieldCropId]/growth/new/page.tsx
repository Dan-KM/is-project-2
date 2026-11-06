import { Suspense } from "react";
import { GrowthForm } from "@/components/forms/planting-forms";
import { Card, PageHeader, PageLoading } from "@/components/ui";
import { t } from "@/lib/i18n";
import { orNotFound, requirePageActor } from "@/lib/page";
import { toNairobiLocalInput } from "@/lib/time";
import { getGrowthDefaults, getPlanting } from "@/lib/services/plantings";

export default function NewGrowthPage(props: PageProps<"/plantings/[fieldCropId]/growth/new">) {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <NewGrowth params={props.params} />
    </Suspense>
  );
}

async function NewGrowth({ params }: { params: PageProps<"/plantings/[fieldCropId]/growth/new">["params"] }) {
  const { fieldCropId } = await params;
  const actor = await requirePageActor();
  const { field } = await orNotFound(getPlanting(actor, fieldCropId));
  const defaults = await getGrowthDefaults(actor, fieldCropId);
  return (
    <>
      <PageHeader title={t("growth.new.title")} back={{ href: `/fields/${field.fieldId}`, label: field.fieldName }} />
      <Card>
        <GrowthForm
          fieldCropId={fieldCropId}
          fieldId={field.fieldId}
          now={toNairobiLocalInput(new Date())}
          defaults={{ growthStage: defaults.growthStage, daysSincePlanting: defaults.daysSincePlanting }}
        />
      </Card>
    </>
  );
}
