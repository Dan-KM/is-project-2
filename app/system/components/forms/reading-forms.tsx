"use client";

import { createReadingAction, saveManualWeatherAction, updateReadingAction } from "@/app/actions/readings";
import { ActionForm } from "@/components/form/action-form";
import { HiddenField, NumberField, SelectField, TextField } from "@/components/form/fields";
import { t } from "@/lib/i18n";
import { createReadingSchema, manualWeatherSchema, updateReadingSchema } from "@/lib/validation/schemas";

export type ReadingValues = {
  dateTime: string;
  soilMoisture: string;
  soilTemperature: string;
  soilPh: string;
  soilEc: string;
  waterAvailability: string;
  previousIrrigationAmount: string;
  daysSinceLastIrrigation: string;
};

/**
 * A manual soil reading. The farmer types what they measured; the values the
 * DB already knows (budget, last irrigation, days since) are prefilled and
 * grouped separately so it's clear they don't need retyping.
 */
export function ReadingForm({
  fieldId, values, fieldConditionsId,
}: { fieldId: string; values: ReadingValues; fieldConditionsId?: string }) {
  const editing = !!fieldConditionsId;
  return (
    <ActionForm
      action={editing ? updateReadingAction : createReadingAction}
      schema={editing ? updateReadingSchema : createReadingSchema}
      submitLabel={t("common.save")}
      successHref={`/fields/${fieldId}`}
    >
      {editing ? <HiddenField name="fieldConditionsId" value={fieldConditionsId} /> : <HiddenField name="fieldId" value={fieldId} />}
      <TextField name="dateTime" label={t("label.dateTime")} type="datetime-local" defaultValue={values.dateTime} />
      <NumberField name="soilMoisture" label={t("label.soilMoisture")} defaultValue={values.soilMoisture} />
      <div className="grid grid-cols-2 items-end gap-3">
        <NumberField name="soilPh" label={t("label.soilPh")} defaultValue={values.soilPh} optional />
        <NumberField name="soilEc" label={t("label.soilEc")} defaultValue={values.soilEc} optional />
      </div>
      <NumberField name="soilTemperature" label={t("label.soilTemperature")} defaultValue={values.soilTemperature} optional />

      <fieldset className="space-y-3 rounded-xl border border-border bg-accent/40 p-3">
        <legend className="px-1 font-medium">{t("reading.derivedTitle")}</legend>
        <p className="text-sm text-muted">{t("reading.prefilledHint")}</p>
        <NumberField name="waterAvailability" label={t("label.waterAvailability")} defaultValue={values.waterAvailability} optional />
        <div className="grid grid-cols-2 items-end gap-3">
          <NumberField
            name="previousIrrigationAmount"
            label={t("label.previousIrrigationAmount")}
            defaultValue={values.previousIrrigationAmount}
            optional
          />
          <NumberField
            name="daysSinceLastIrrigation"
            label={t("label.daysSinceLastIrrigation")}
            defaultValue={values.daysSinceLastIrrigation}
            optional
          />
        </div>
      </fieldset>
    </ActionForm>
  );
}

const recordTypes = (["observed", "forecast", "historical"] as const).map((v) => ({ value: v, label: t(`weather.type.${v}`) }));

/** Fallback when the weather service is down: type the values in. Blank = unknown (omitted). */
export function ManualWeatherForm({ farmId, now }: { farmId: string; now: string }) {
  return (
    <ActionForm
      action={saveManualWeatherAction}
      schema={manualWeatherSchema}
      submitLabel={t("common.save")}
      resetOnSuccess
    >
      <HiddenField name="farmId" value={farmId} />
      <div className="grid grid-cols-2 items-end gap-3">
        <TextField name="dateTime" label={t("label.dateTime")} type="datetime-local" defaultValue={now} />
        <SelectField name="recordType" label={t("label.recordType")} options={recordTypes} defaultValue="observed" />
      </div>
      <div className="grid grid-cols-2 items-end gap-3">
        <NumberField name="ambientTemperature" label={t("label.ambientTemperature")} optional />
        <NumberField name="relativeHumidity" label={t("label.relativeHumidity")} optional />
        <NumberField name="rainfall24h" label={t("label.rainfall24h")} optional />
        <NumberField name="rainfallForecast24h" label={t("label.rainfallForecast24h")} optional />
        <NumberField name="windSpeed" label={t("label.windSpeed")} optional />
        <NumberField name="solarRadiation" label={t("label.solarRadiation")} optional />
      </div>
      <NumberField name="evapotranspirationRate" label={t("label.evapotranspirationRate")} optional />
    </ActionForm>
  );
}
