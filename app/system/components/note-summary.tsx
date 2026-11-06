import { NotebookPen, Plus } from "lucide-react";
import { Icon } from "@/components/icon";
import { t } from "@/lib/i18n";

/** Label for a collapsible note: the note itself, or "Add a note" when empty. */
export function NoteSummary({ notes }: { notes: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon icon={notes ? NotebookPen : Plus} size="sm" />
      {notes || t("common.addNote")}
    </span>
  );
}
