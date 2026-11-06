import { Suspense } from "react";
import { deletePlantingAction, updatePlantingAction } from "@/app/actions/plantings";
import { ConfirmButton } from "@/components/form/confirm-button";
import { PlantingDateForm } from "@/components/forms/planting-forms";
import { Badge, Card, EmptyState, PageHeader, PageLoading } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { orNotFound, requirePageActor } from "@/lib/page";
import { getField } from "@/lib/services/fields";
import { listPlantings } from "@/lib/services/plantings";

// Every crop ever planted on the field: fix a date, end the current crop, or delete one.

export default function PlantingsPage(props: PageProps<"/fields/[fieldId]/plantings">) {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <Plantings params={props.params} />
    </Suspense>
  );
}

async function Plantings({ params }: { params: PageProps<"/fields/[fieldId]/plantings">["params"] }) {
  const { fieldId } = await params;
  const actor = await requirePageActor();
  const field = await orNotFound(getField(actor, fieldId));
  const plantings = await listPlantings(actor, fieldId);
  return (
    <>
      <PageHeader title={t("planting.history")} back={{ href: `/fields/${fieldId}`, label: field.fieldName }} />
      {plantings.length === 0 ? (
        <EmptyState>{t("field.noCrop")}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {plantings.map((p) => (
            <li key={p.fieldCropId}>
              <Card>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-semibold">{t(`crop.${p.crop.cropName}`)}</p>
                    <p className="text-sm text-muted">{formatDate(p.plantingDate)}</p>
                  </div>
                  <Badge tone={p.isActive ? "good" : "neutral"}>{p.isActive ? t("planting.active") : t("planting.ended")}</Badge>
                </div>
                <PlantingDateForm fieldCropId={p.fieldCropId} plantingDate={p.plantingDate} />
                <div className="mt-3 grid gap-2">
                  {p.isActive && (
                    <ConfirmButton
                      action={updatePlantingAction}
                      payload={{ fieldCropId: p.fieldCropId, isActive: false }}
                      label={t("planting.end")}
                      confirmLabel={t("planting.endConfirm")}
                      pendingLabel={t("common.saving")}
                      variant="secondary"
                    />
                  )}
                  <ConfirmButton
                    action={deletePlantingAction}
                    payload={{ fieldCropId: p.fieldCropId }}
                    label={t("common.delete")}
                    warning={t("planting.delete.warning")}
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
