import { Info } from "lucide-react";
import { AUDIT_TEXTS } from "@/lib/audit/texts";

/** A nota de guarda (E2.05, UXD-12 e RN-17), sempre à vista abaixo do subtítulo. */
export function RetentionNote() {
  return (
    <p className="flex items-start gap-1.5 text-sm text-muted-foreground" data-testid="retention-note">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{AUDIT_TEXTS.retention}</span>
    </p>
  );
}
