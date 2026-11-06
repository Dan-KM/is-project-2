import { Suspense } from "react";
import { ReadingForm } from "@/components/forms/reading-forms";
import { Card, PageHeader, PageLoading } from "@/components/ui";
import { inputNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { orNotFound, requirePageActor } from "@/lib/page";
import { parseDbTimestamp, toNairobiLocalInput } from "@/lib/time";
import { getReading } from "@/lib/services/readings";

export default function EditReadingPage(props: PageProps<"/readings/[fieldConditionsId]/edit">) {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <EditReading params={props.params} />
    </Suspense>
  );
}

async function EditReading({ params }: { params: PageProps<"/readings/[fieldConditionsId]/edit">["params"] }) {
  const { fieldConditionsId } = await params;
  const actor = await requirePageActor();
  const { reading, field } = await orNotFound(getReading(actor, fieldConditionsId));
  return (
    <>
      <PageHeader title={t("reading.edit.title")} back={{ href: `/fields/${field.fieldId}`, label: field.fieldName }} />
      <Card>
        <ReadingForm
          fieldId={field.fieldId}
          fieldConditionsId={fieldConditionsId}
          values={{
            dateTime: toNairobiLocalInput(parseDbTimestamp(reading.dateTime)),
            soilMoisture: inputNumber(reading.soilMoisture),
            soilTemperature: inputNumber(reading.soilTemperature),
            soilPh: inputNumber(reading.soilPh),
            soilEc: inputNumber(reading.soilEc),
            waterAvailability: inputNumber(reading.waterAvailability),
            previousIrrigationAmount: inputNumber(reading.previousIrrigationAmount),
            daysSinceLastIrrigation: inputNumber(reading.daysSinceLastIrrigation),
          }}
        />
      </Card>
    </>
  );
}
