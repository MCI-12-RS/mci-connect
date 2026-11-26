import { Link } from "react-router-dom";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recordHistoryPath } from "@/lib/audit/authorship";
import type { RecordType } from "@/lib/audit/events";
import { AUDIT_TEXTS } from "@/lib/audit/texts";

/** "Ver histórico deste membro" (desta célula, deste relatório) no painel do evento (UXD-8, UX-24). */
export function HistoryLink({ type, id, onNavigate }: { type: RecordType; id: string; onNavigate?: () => void }) {
  return (
    <Button asChild variant="outline" className="h-auto min-h-11 w-full whitespace-normal md:min-h-9">
      <Link to={recordHistoryPath(type, id)} onClick={onNavigate}>
        <History className="h-4 w-4" aria-hidden="true" />
        {AUDIT_TEXTS.sheet.viewHistory[type]}
      </Link>
    </Button>
  );
}
