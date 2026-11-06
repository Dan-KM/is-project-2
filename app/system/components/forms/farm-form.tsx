"use client";

import { useState } from "react";
import { createFarmAction, updateFarmAction } from "@/app/actions/farms";
import { ActionForm } from "@/components/form/action-form";
import { HiddenField, NumberField, TextField } from "@/components/form/fields";
import { buttonStyles } from "@/components/ui";
import { t } from "@/lib/i18n";
import { createFarmSchema, updateFarmSchema } from "@/lib/validation/schemas";

type FarmValues = {
  farmId: string;
  farmName: string;
  farmAddress: string;
  latitude: string;
  longitude: string;
  area: string;
};

/** Create (no `farm`) or edit (with `farm`) a farm. */
export function FarmForm({ farm }: { farm?: FarmValues }) {
  const editing = !!farm;
  return (
    <ActionForm
      action={editing ? updateFarmAction : createFarmAction}
      schema={editing ? updateFarmSchema : createFarmSchema}
      submitLabel={t("common.save")}
      successHref={(data: { farmId: string }) => `/farms/${data.farmId}`}
    >
      {farm && <HiddenField name="farmId" value={farm.farmId} />}
      <TextField name="farmName" label={t("label.farmName")} defaultValue={farm?.farmName} />
      <TextField name="farmAddress" label={t("label.farmAddress")} defaultValue={farm?.farmAddress} />
      <NumberField name="area" label={t("label.farmArea")} defaultValue={farm?.area} />
      <LocationFields latitude={farm?.latitude} longitude={farm?.longitude} />
    </ActionForm>
  );
}

/**
 * Latitude/longitude with a "use my location" button, so a farmer standing on
 * the farm doesn't have to look up coordinates. The weather lookup needs them.
 */
function LocationFields({ latitude, longitude }: { latitude?: string; longitude?: string }) {
  const [status, setStatus] = useState<"idle" | "locating" | "failed">("idle");

  function fillMyLocation() {
    if (!navigator.geolocation) return setStatus("failed");
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Inputs are uncontrolled, so write the values straight into them
        const lat = document.getElementById("f-latitude") as HTMLInputElement | null;
        const lon = document.getElementById("f-longitude") as HTMLInputElement | null;
        if (lat) lat.value = position.coords.latitude.toFixed(6);
        if (lon) lon.value = position.coords.longitude.toFixed(6);
        setStatus("idle");
      },
      () => setStatus("failed"),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  return (
    <fieldset className="space-y-3 rounded-xl border border-border p-3">
      <button type="button" onClick={fillMyLocation} disabled={status === "locating"} className={`${buttonStyles.secondary} w-full`}>
        📍 {status === "locating" ? t("farm.locating") : t("farm.useMyLocation")}
      </button>
      {status === "failed" && <p className="text-sm text-warning">{t("farm.locationFailed")}</p>}
      <div className="grid grid-cols-2 items-end gap-3">
        <NumberField name="latitude" id="f-latitude" label={t("label.latitude")} defaultValue={latitude} />
        <NumberField name="longitude" id="f-longitude" label={t("label.longitude")} defaultValue={longitude} />
      </div>
      <p className="text-sm text-muted">{t("hint.coordinates")}</p>
    </fieldset>
  );
}
