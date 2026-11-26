import { actorText, entityLabel, eventDateTime, eventSecondLine, type AuditEvent } from "@/lib/audit/events";
import { cn } from "@/lib/utils";
import { ActionBadge, ErrorBadge } from "./EventBadges";

interface AuditEventListProps {
  events: AuditEvent[];
  /** No histórico de um registro, a entidade não aparece (T9). */
  showEntity: boolean;
  onOpen: (event: AuditEvent, opener: HTMLElement) => void;
}

/**
 * A lista em cards no celular (E2.05, T7, UXD-3 e P34): cada evento é um botão de largura toda que abre
 * o painel, com a descrição primeiro, a segunda linha, o autor e a data, a ação e a entidade, e "Erro"
 * só no que falhou.
 */
export function AuditEventList({ events, showEntity, onOpen }: AuditEventListProps) {
  return (
    <ul className="divide-y" data-testid="audit-event-cards">
      {events.map((event) => {
        const second = eventSecondLine(event);
        const actor = actorText(event);
        const when = eventDateTime(event.occurred_at).long;
        return (
          <li key={event.id}>
            <button
              type="button"
              className={cn(
                "flex min-h-11 w-full flex-col items-start gap-1 px-4 py-3 text-left",
                "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              )}
              onClick={(e) => onOpen(event, e.currentTarget)}
            >
              <span className="break-words font-medium">{event.description}</span>
              {second && <span className="break-words text-sm text-muted-foreground">{second}</span>}
              <span className="text-sm">{actor ? `${actor} · ${when}` : when}</span>
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <ActionBadge action={event.action} />
                {showEntity && <span>{entityLabel(event.entity)}</span>}
                {!event.success && <ErrorBadge />}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
