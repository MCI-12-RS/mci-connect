import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { authEventDetailFields, isAuthEvent } from "@/lib/audit/auth-events";
import {
  actionLabel,
  actorText,
  changeItems,
  entityLabel,
  eventDateTime,
  eventNameLists,
  eventRecord,
  type AuditEvent,
} from "@/lib/audit/events";
import type { AuditRecordRef } from "@/lib/audit/url-params";
import { AUDIT_TEXTS } from "@/lib/audit/texts";
import { ChangeList } from "./ChangeList";
import { HistoryLink } from "./HistoryLink";

const TEXTS = AUDIT_TEXTS.sheet;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

interface EventDetailsProps {
  event: AuditEvent;
  historyRecord: AuditRecordRef | null;
  onClose: () => void;
}

function EventDetails({ event, historyRecord, onClose }: EventDetailsProps) {
  const auth = isAuthEvent(event);
  const changes = changeItems(event);
  const lists = eventNameLists(event);
  const record = eventRecord(event);
  const sameRecord = !!record && !!historyRecord && record.type === historyRecord.type && record.id === historyRecord.id;
  return (
    <div className="mt-6 space-y-6 text-sm">
      <dl className="space-y-4">
        <Field label={TEXTS.actor}>{actorText(event) ?? AUDIT_TEXTS.noActor}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={TEXTS.action}>{actionLabel(event.action)}</Field>
          <Field label={TEXTS.entity}>{entityLabel(event.entity)}</Field>
        </div>
        {!auth && event.entity_label && <Field label={TEXTS.record}>{event.entity_label}</Field>}
        {event.description && <Field label={TEXTS.description}>{event.description}</Field>}
        {auth &&
          authEventDetailFields(event).map((field) => (
            <Field key={field.key} label={field.label}>
              {field.value}
            </Field>
          ))}
        {changes.length > 0 && (
          <Field label={TEXTS.changedFields}>
            <ChangeList items={changes} />
          </Field>
        )}
        {lists.map((list) => (
          <Field key={list.key} label={list.title}>
            <ul className="list-disc space-y-1 pl-5">
              {list.items.map((item, index) => (
                // Nomes podem se repetir; a lista não muda com o painel aberto.
                <li key={index} className="break-words">
                  {item}
                </li>
              ))}
            </ul>
          </Field>
        ))}
      </dl>
      {record && !sameRecord && <HistoryLink type={record.type} id={record.id} onNavigate={onClose} />}
    </div>
  );
}

interface AuditEventSheetProps {
  event: AuditEvent | null;
  /** O registro do histórico aberto: o painel não oferece o histórico do mesmo registro (UX-24). */
  historyRecord: AuditRecordRef | null;
  onClose: () => void;
  /** Devolve o foco ao card ou ao botão que abriu o painel (P34). */
  onCloseAutoFocus: (event: Event) => void;
}

/** O painel de detalhes do evento (E2.05, T10; P32): legível, sem JSON nem identificadores (RN-20 d). */
export function AuditEventSheet({ event, historyRecord, onClose, onCloseAutoFocus }: AuditEventSheetProps) {
  return (
    <Sheet open={!!event} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="w-full overflow-y-auto sm:max-w-lg motion-reduce:animate-none"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {event && (
          <>
            <SheetHeader className="pr-8 text-left">
              <SheetTitle>{TEXTS.title}</SheetTitle>
              <SheetDescription>{eventDateTime(event.occurred_at).long}</SheetDescription>
            </SheetHeader>
            <EventDetails event={event} historyRecord={historyRecord} onClose={onClose} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
