import { Sprout } from "lucide-react";
import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { PredictionFlow } from "@/components/prediction/prediction-flow";
import { ButtonLink, EmptyState, PageHeader, PageLoading } from "@/components/ui";
import { t } from "@/lib/i18n";
import { orNotFound, requirePageActor } from "@/lib/page";
import { getField } from "@/lib/services/fields";
import { getActivePlanting, getLatestGrowthRecord } from "@/lib/services/plantings";

// Entry point of the prediction flow for one field.

export default function PredictPage(props: PageProps<"/fields/[fieldId]/predict">) {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <Predict params={props.params} />
    </Suspense>
  );
}

async function Predict({ params }: { params: PageProps<"/fields/[fieldId]/predict">["params"] }) {
  const { fieldId } = await params;
  const actor = await requirePageActor();
  const field = await orNotFound(getField(actor, fieldId));
  const planting = await getActivePlanting(actor, fieldId);
  const latestGrowth = planting ? await getLatestGrowthRecord(planting.fieldCropId) : null;

  return (
    <>
      <PageHeader
        title={t("predict.title")}
        back={{ href: `/fields/${fieldId}`, label: planting ? `${field.fieldName} · ${t(`crop.${planting.crop.cropName}`)}` : field.fieldName }}
      />
      {!planting ? (
        <EmptyState
          icon={<Icon icon={Sprout} size="xl" />}
          action={<ButtonLink href={`/fields/${fieldId}/plant`}>{t("planting.plant")}</ButtonLink>}
        >
          {t("predict.noPlanting")}
        </EmptyState>
      ) : (
        <PredictionFlow fieldId={fieldId} defaultGrowthStage={latestGrowth?.growthStage ?? null} />
      )}
    </>
  );
}
