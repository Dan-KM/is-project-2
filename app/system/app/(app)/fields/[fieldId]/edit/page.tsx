import { Suspense } from "react";
import { FieldForm } from "@/components/forms/field-form";
import { Card, PageHeader, PageLoading } from "@/components/ui";
import { inputNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { orNotFound, requirePageActor } from "@/lib/page";
import { getField } from "@/lib/services/fields";

export default function EditFieldPage(props: PageProps<"/fields/[fieldId]/edit">) {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <EditField params={props.params} />
    </Suspense>
  );
}

async function EditField({ params }: { params: PageProps<"/fields/[fieldId]/edit">["params"] }) {
  const { fieldId } = await params;
  const actor = await requirePageActor();
  const field = await orNotFound(getField(actor, fieldId));
  return (
    <>
      <PageHeader title={t("field.edit.title")} back={{ href: `/fields/${fieldId}`, label: field.fieldName }} />
      <Card>
        <FieldForm
          farmId={field.farmId}
          field={{
            fieldId,
            fieldName: field.fieldName,
            soilType: field.soilType,
            area: inputNumber(field.area),
            fieldSlope: inputNumber(field.fieldSlope),
          }}
        />
      </Card>
    </>
  );
}
