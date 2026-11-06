import { FlaskConical } from "lucide-react";
import { Suspense } from "react";
import { deletePredictionAction } from "@/app/actions/predictions";
import { ConfirmButton } from "@/components/form/confirm-button";
import { Icon } from "@/components/icon";
import { ActionPanel, isIrrigationAction } from "@/components/prediction/action-display";
import { Badge, Card, PageHeader, PageLoading, SectionTitle } from "@/components/ui";
import { FEATURE_COUNT } from "@/lib/features/catalog";
import { formatFeatureValue } from "@/lib/features/display";
import { estimatedCount, storedFeatures } from "@/lib/features/stored";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { orNotFound, requirePageActor } from "@/lib/page";
import { getField } from "@/lib/services/fields";
import { getPlanting } from "@/lib/services/plantings";
import { getPrediction } from "@/lib/services/predictions";

// One stored recommendation: the result and the exact inputs it was based on
// (a NULL feature column = left out of the request, estimated by the model).

export default function PredictionPage(props: PageProps<"/predictions/[predictionId]">) {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <PredictionDetail params={props.params} />
    </Suspense>
  );
}

async function PredictionDetail({ params }: { params: PageProps<"/predictions/[predictionId]">["params"] }) {
  const { predictionId } = await params;
  const actor = await requirePageActor();
  const row = await orNotFound(getPrediction(actor, predictionId));
  const { field } = await getPlanting(actor, row.fieldCropId);
  const fieldInfo = await getField(actor, field.fieldId);
  const features = storedFeatures(row);
  const estimated = estimatedCount(row);
  const action = row.predictedIrrigationAction;

  return (
    <>
      <PageHeader title={t("predict.detail.title")} back={{ href: `/fields/${fieldInfo.fieldId}`, label: fieldInfo.fieldName }} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>{formatDateTime(row.predictedAt)}</span>
        {row.modelVersion === "mock-v1" ? (
          <Badge tone="warn">
            <Icon icon={FlaskConical} size="sm" />
            {t("prediction.mockBadge")}
          </Badge>
        ) : (
          <span>{t("predict.detail.model", { version: row.modelVersion ?? "—" })}</span>
        )}
      </div>

      {isIrrigationAction(action) ? <ActionPanel action={action} /> : <Badge>{action}</Badge>}
      <p className="mt-3 mb-5 text-sm text-muted">
        {estimated === 0
          ? t("prediction.allInputs", { total: FEATURE_COUNT })
          : t("prediction.estimatedCount", { count: estimated, total: FEATURE_COUNT })}
      </p>

      <SectionTitle>{t("predict.detail.inputs")}</SectionTitle>
      <Card className="mb-5">
        <dl className="divide-y divide-border">
          {features.map((f) => (
            <div key={f.name} className="flex items-center justify-between gap-3 py-2">
              <dt className="text-sm">{t(`feature.${f.name}`)}</dt>
              <dd className="text-right font-medium tabular-nums">
                {f.value === null ? <Badge tone="warn">{t("predict.origin.missing")}</Badge> : formatFeatureValue(f.name, f.value)}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <ConfirmButton
        action={deletePredictionAction}
        payload={{ predictionId }}
        label={t("common.delete")}
        redirectTo={`/fields/${fieldInfo.fieldId}`}
      />
    </>
  );
}
