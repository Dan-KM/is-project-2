import { Suspense } from "react";
import { FieldForm } from "@/components/forms/field-form";
import { Card, PageHeader, PageLoading } from "@/components/ui";
import { t } from "@/lib/i18n";
import { orNotFound, requirePageActor } from "@/lib/page";
import { getFarm } from "@/lib/services/farms";

export default function NewFieldPage(props: PageProps<"/farms/[farmId]/fields/new">) {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <NewField params={props.params} />
    </Suspense>
  );
}

async function NewField({ params }: { params: PageProps<"/farms/[farmId]/fields/new">["params"] }) {
  const { farmId } = await params;
  const actor = await requirePageActor();
  const farm = await orNotFound(getFarm(actor, farmId));
  return (
    <>
      <PageHeader title={t("field.new.title")} back={{ href: `/farms/${farmId}`, label: farm.farmName }} />
      <Card>
        <FieldForm farmId={farmId} />
      </Card>
    </>
  );
}
