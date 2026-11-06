import { Suspense } from "react";
import { GrowthForm } from "@/components/forms/planting-forms";
import { Card, PageHeader, PageLoading } from "@/components/ui";
import { inputNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { orNotFound, requirePageActor } from "@/lib/page";
import { parseDbTimestamp, toNairobiLocalInput } from "@/lib/time";
import { getGrowthRecord } from "@/lib/services/plantings";

export default function EditGrowthPage(props: PageProps<"/growth/[evolutionId]/edit">) {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <EditGrowth params={props.params} />
    </Suspense>
  );
}

async function EditGrowth({ params }: { params: PageProps<"/growth/[evolutionId]/edit">["params"] }) {
  const { evolutionId } = await params;
  const actor = await requirePageActor();
  const { record, field } = await orNotFound(getGrowthRecord(actor, evolutionId));
  return (
    <>
      <PageHeader title={t("growth.edit.title")} back={{ href: `/fields/${field.fieldId}`, label: field.fieldName }} />
      <Card>
        <GrowthForm
          fieldCropId={record.fieldCropId}
          fieldId={field.fieldId}
          now={toNairobiLocalInput(new Date())}
          record={{
            evolutionId,
            recordedAt: toNairobiLocalInput(parseDbTimestamp(record.recordedAt)),
            growthStage: record.growthStage,
            rootZoneDepth: inputNumber(record.rootZoneDepth),
            leafAreaIndex: inputNumber(record.leafAreaIndex),
            daysSincePlanting: inputNumber(record.daysSincePlanting),
          }}
        />
      </Card>
    </>
  );
}
