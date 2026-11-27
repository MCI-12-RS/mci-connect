import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actorText, entityLabel, eventDateTime, eventSecondLine, type AuditEvent } from "@/lib/audit/events";
import { AUDIT_TEXTS } from "@/lib/audit/texts";
import { ActionBadge, ErrorBadge, OkBadge } from "./EventBadges";

interface AuditEventTableProps {
  events: AuditEvent[];
  /** No histórico de um registro, a coluna Entidade não aparece (T9). */
  showEntity: boolean;
  onOpen: (event: AuditEvent, opener: HTMLElement) => void;
}

const COLUMNS = AUDIT_TEXTS.columns;

/**
 * A tabela no computador (E2.05, T7 e P34): a descrição é o botão que abre o painel pelo teclado; o
 * clique na linha é só um atalho do mouse. Só a partir de 1024 px.
 */
export function AuditEventTable({ events, showEntity, onOpen }: AuditEventTableProps) {
  return (
    <Table data-testid="audit-event-table">
      <TableHeader>
        <TableRow>
          <TableHead className="whitespace-nowrap">{COLUMNS.occurredAt}</TableHead>
          <TableHead>{COLUMNS.actor}</TableHead>
          <TableHead>{COLUMNS.action}</TableHead>
          {showEntity && <TableHead>{COLUMNS.entity}</TableHead>}
          <TableHead>{COLUMNS.description}</TableHead>
          <TableHead>{COLUMNS.status}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => {
          const second = eventSecondLine(event);
          return (
            <TableRow
              key={event.id}
              className="cursor-pointer"
              onClick={(e) => {
                const button = e.currentTarget.querySelector<HTMLButtonElement>("button[data-open-event]");
                if (button && e.target !== button && !button.contains(e.target instanceof Node ? e.target : null)) {
                  onOpen(event, button);
                }
              }}
            >
              <TableCell className="whitespace-nowrap align-top text-sm">{eventDateTime(event.occurred_at).short}</TableCell>
              <TableCell className="align-top text-sm">{actorText(event) ?? AUDIT_TEXTS.noActor}</TableCell>
              <TableCell className="align-top">
                <ActionBadge action={event.action} />
              </TableCell>
              {showEntity && <TableCell className="align-top text-sm">{entityLabel(event.entity)}</TableCell>}
              <TableCell className="align-top text-sm">
                <button
                  type="button"
                  data-open-event=""
                  className="break-words text-left font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(e) => onOpen(event, e.currentTarget)}
                >
                  {event.description}
                </button>
                {second && <span className="block break-words text-sm text-muted-foreground">{second}</span>}
              </TableCell>
              <TableCell className="align-top">{event.success ? <OkBadge /> : <ErrorBadge />}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
