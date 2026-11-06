"use client";

import { createGrowthAction, plantCropAction, updateGrowthAction, updatePlantingAction } from "@/app/actions/plantings";
import { ActionForm } from "@/components/form/action-form";
import { HiddenField, NumberField, SelectField, TextField } from "@/components/form/fields";
import { GROWTH_STAGES } from "@/lib/features/catalog";
import { t } from "@/lib/i18n";
import { createGrowthSchema, plantCropSchema, updateGrowthSchema, updatePlantingSchema } from "@/lib/validation/schemas";

const stageOptions = GROWTH_STAGES.map((s) => ({ value: s, label: t(`stage.${s}`) }));

/** Plant a crop (replace_field_crop ends the current one in the same step). */
export function PlantCropForm({
  fieldId, crops, today, hasActive,
}: { fieldId: string; crops: Array<{ cropId: string; cropName: string }>; today: string; hasActive: boolean }) {
  return (
    <ActionForm
      action={plantCropAction}
      schema={plantCropSchema}
      submitLabel={hasActive ? t("planting.replace") : t("planting.plant")}
      successHref={`/fields/${fieldId}`}
    >
      <HiddenField name="fieldId" value={fieldId} />
      <SelectField
        name="cropId"
        label={t("label.crop")}
        options={crops.map((c) => ({ value: c.cropId, label: t(`crop.${c.cropName}`) }))}
      />
      <TextField name="plantingDate" label={t("label.plantingDate")} type="date" defaultValue={today} max={today} />
      {hasActive && <p className="rounded-xl bg-warning-soft px-3 py-2 text-warning">{t("planting.replaceWarning")}</p>}
    </ActionForm>
  );
}

/** Correct a planting's date (inline on the history page). */
export function PlantingDateForm({ fieldCropId, plantingDate }: { fieldCropId: string; plantingDate: string }) {
  return (
    <ActionForm action={updatePlantingAction} schema={updatePlantingSchema} submitLabel={t("common.save")} submitVariant="secondary">
      <HiddenField name="fieldCropId" value={fieldCropId} />
      <TextField name="plantingDate" label={t("label.plantingDate")} type="date" defaultValue={plantingDate} />
    </ActionForm>
  );
}

type GrowthValues = {
  evolutionId: string;
  recordedAt: string;
  growthStage: string;
  rootZoneDepth: string;
  leafAreaIndex: string;
  daysSincePlanting: string;
};

/**
 * Record (or edit) a growth stage. Days since planting is prefilled from the
 * planting date; root depth and LAI are optional (most farmers won't know them).
 */
export function GrowthForm({
  fieldCropId, fieldId, now, defaults, record,
}: {
  fieldCropId: string;
  fieldId: string;
  now: string;
  defaults?: { growthStage: string | null; daysSincePlanting: number };
  record?: GrowthValues;
}) {
  const editing = !!record;
  return (
    <ActionForm
      action={editing ? updateGrowthAction : createGrowthAction}
      schema={editing ? updateGrowthSchema : createGrowthSchema}
      submitLabel={t("common.save")}
      successHref={`/fields/${fieldId}`}
    >
      {record ? <HiddenField name="evolutionId" value={record.evolutionId} /> : <HiddenField name="fieldCropId" value={fieldCropId} />}
      <SelectField
        name="growthStage"
        label={t("label.growthStage")}
        options={stageOptions}
        defaultValue={record?.growthStage ?? defaults?.growthStage ?? undefined}
      />
      <TextField name="recordedAt" label={t("label.recordedAt")} type="datetime-local" defaultValue={record?.recordedAt ?? now} />
      <NumberField
        name="daysSincePlanting"
        label={t("label.daysSincePlanting")}
        hint={t("hint.daysSincePlanting")}
        defaultValue={record?.daysSincePlanting ?? String(defaults?.daysSincePlanting ?? "")}
        optional
      />
      <div className="grid grid-cols-2 items-end gap-3">
        <NumberField name="rootZoneDepth" label={t("label.rootZoneDepth")} defaultValue={record?.rootZoneDepth} optional />
        <NumberField name="leafAreaIndex" label={t("label.leafAreaIndex")} defaultValue={record?.leafAreaIndex} optional />
      </div>
    </ActionForm>
  );
}
