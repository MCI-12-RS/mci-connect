import { AlertCircle, Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import StatusBadge from "@/components/StatusBadge";
import { actionLabel } from "@/lib/audit/events";
import { AUDIT_TEXTS } from "@/lib/audit/texts";
import { cn } from "@/lib/utils";

/** A ação do evento em texto (`outline`). */
export const ActionBadge = ({ action }: { action: string }) => <Badge variant="outline">{actionLabel(action)}</Badge>;

/** "Erro" (P6): ícone e texto, sem depender da cor. */
export const ErrorBadge = ({ className }: { className?: string }) => (
  <StatusBadge tone="destructive" icon={AlertCircle} className={cn("w-fit", className)}>
    {AUDIT_TEXTS.statusError}
  </StatusBadge>
);

/** "OK" em `outline` (E1.04). */
export const OkBadge = () => <Badge variant="outline">{AUDIT_TEXTS.statusOk}</Badge>;

/** "Cadastro excluído", "Célula excluída" ou "Relatório excluído" no título do histórico (T9, P6). */
export const RecordDeletedBadge = ({ text }: { text: string }) => (
  <StatusBadge tone="muted" icon={Ban} className="w-fit">
    {text}
  </StatusBadge>
);
