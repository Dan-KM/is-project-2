import { Suspense } from "react";
import { ReadingForm } from "@/components/forms/reading-forms";
import { Card, PageHeader, PageLoading } from "@/components/ui";
import { inputNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { orNotFound, requirePageActor } from "@/lib/page";
import { toNairobiLocalInput } from "@/lib/time";
import { getField } from "@/lib/services/fields";
import { getReadingDefaults } from "@/lib/services/readings";

export default function NewReadingPage(props: PageProps<"/fields/[fieldId]/readings/new">) {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <NewReading params={props.params} />
    </Suspense>
  );
}

async function NewReading({ params }: { params: PageProps<"/fields/[fieldId]/readings/new">["params"] }) {
  const { fieldId } = await params;
  const actor = await requirePageActor();
  const field = await orNotFound(getField(actor, fieldId));
  // Values the DB can work out are prefilled, so the farmer doesn't retype them
  const defaults = await getReadingDefaults(actor, fieldId);
  return (
    <>
      <PageHeader title={t("reading.new.title")} back={{ href: `/fields/${fieldId}`, label: field.fieldName }} />
      <Card>
        <ReadingForm
          fieldId={fieldId}
          values={{
            dateTime: toNairobiLocalInput(new Date()),
            soilMoisture: "",
            soilTemperature: "",
            soilPh: inputNumber(defaults.soilPh),
            soilEc: inputNumber(defaults.soilEc),
            waterAvailability: inputNumber(defaults.waterAvailability),
            previousIrrigationAmount: inputNumber(defaults.previousIrrigationAmount),
            daysSinceLastIrrigation: inputNumber(defaults.daysSinceLastIrrigation),
          }}
        />
      </Card>
    </>
  );
}
