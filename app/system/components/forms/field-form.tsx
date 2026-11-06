"use client";

import { createFieldAction, updateFieldAction } from "@/app/actions/farms";
import { ActionForm } from "@/components/form/action-form";
import { HiddenField, NumberField, SelectField, TextField } from "@/components/form/fields";
import { SOIL_TYPES } from "@/lib/features/catalog";
import { t } from "@/lib/i18n";
import { createFieldSchema, updateFieldSchema } from "@/lib/validation/schemas";

type FieldValues = { fieldId: string; fieldName: string; soilType: string; area: string; fieldSlope: string };

// Soil type is a dropdown of the dataset's labels only, so the value always
// matches what the model was trained on.
const soilOptions = SOIL_TYPES.map((s) => ({ value: s, label: t(`soil.${s}`) }));

/** Create a field on `farmId`, or edit `field`. */
export function FieldForm({ farmId, field }: { farmId: string; field?: FieldValues }) {
  const editing = !!field;
  return (
    <ActionForm
      action={editing ? updateFieldAction : createFieldAction}
      schema={editing ? updateFieldSchema : createFieldSchema}
      submitLabel={t("common.save")}
      successHref={(data: { fieldId: string }) => `/fields/${data.fieldId}`}
    >
      {field ? <HiddenField name="fieldId" value={field.fieldId} /> : <HiddenField name="farmId" value={farmId} />}
      <TextField name="fieldName" label={t("label.fieldName")} defaultValue={field?.fieldName} />
      <SelectField name="soilType" label={t("label.soilType")} options={soilOptions} defaultValue={field?.soilType} />
      <div className="grid grid-cols-2 items-end gap-3">
        <NumberField name="area" label={t("label.fieldArea")} defaultValue={field?.area} />
        <NumberField name="fieldSlope" label={t("label.fieldSlope")} defaultValue={field?.fieldSlope} optional />
      </div>
    </ActionForm>
  );
}
