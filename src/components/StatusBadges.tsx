import { Ban, Check, CheckCircle2, MinusCircle, PauseCircle, X } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import { CELL_REPORT_DELETION_TEXTS } from "@/lib/deletion/texts";
import { STATUS_TEXTS } from "@/lib/status";
import { cn } from "@/lib/utils";

// Badges de situação das listas (padrão P6): ícone e texto, com contraste nos
// dois temas, nunca só a cor.

/** Ativo ou Inativo, no cadastro de um membro ("Inativo" com o `PauseCircle`, E2.06, T1). */
export const MemberStatusBadge = ({ active }: { active: boolean }) =>
  active ? (
    <StatusBadge tone="success" icon={CheckCircle2}>
      {STATUS_TEXTS.memberActive}
    </StatusBadge>
  ) : (
    <StatusBadge tone="muted" icon={PauseCircle}>
      {STATUS_TEXTS.memberInactive}
    </StatusBadge>
  );

/** Ativa ou Inativa, numa célula. */
export const CellStatusBadge = ({ active }: { active: boolean }) =>
  active ? (
    <StatusBadge tone="success" icon={CheckCircle2}>
      {STATUS_TEXTS.cellActive}
    </StatusBadge>
  ) : (
    <StatusBadge tone="muted" icon={MinusCircle}>
      {STATUS_TEXTS.cellInactive}
    </StatusBadge>
  );

/** Realizada ou Não realizada, num relatório; o motivo aparece ao passar o mouse. */
export const HeldStatusBadge = ({ held, reason }: { held: boolean; reason?: string | null }) =>
  held ? (
    <StatusBadge tone="success" icon={Check}>
      {STATUS_TEXTS.held}
    </StatusBadge>
  ) : (
    <StatusBadge tone="destructive" icon={X} title={reason ?? undefined}>
      {STATUS_TEXTS.notHeld}
    </StatusBadge>
  );

/** "Célula excluída" (T7): o relatório de uma célula excluída (UX-25). */
export const CellDeletedBadge = ({ className }: { className?: string }) => (
  <StatusBadge tone="muted" icon={Ban} className={cn("w-fit", className)}>
    {CELL_REPORT_DELETION_TEXTS.cellDeleted}
  </StatusBadge>
);
