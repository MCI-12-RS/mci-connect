// Os eventos da Auditoria como a tela mostra (E2.05, T7 a T10; RN-15, RN-18 a RN-20): rótulos de
// ação e de entidade, o autor, a leitura de `changes` por type guards (sem `any`), a segunda linha
// (UXD-6) e o conteúdo do painel (P32). Os eventos de login e de senha seguem `auth-events.ts`.

import type { Enums, Json, Tables } from "@/integrations/supabase/types";
import { AUTH_ACTION_LABELS, authEventSecondLine, isAuthEvent } from "@/lib/audit/auth-events";
import { auditField, formatAuditValue, isAuditFieldEntity, type AuditFieldEntity } from "@/lib/audit/fields";
import { AUDIT_TEXTS, AUTHORSHIP_TEXTS } from "@/lib/audit/texts";
import { formatSpDateTime } from "@/lib/dates/sao-paulo";
import { permissionLabelOf } from "@/lib/access/permissions";
import type { AuthorshipEntity } from "@/lib/audit/authorship";

export type EventAction = Enums<"event_action">;
export type EventEntity = Enums<"event_entity">;
/** A entidade "Participante" não aparece (RN-20 f): os eventos antigos de participante viraram do relatório. */
export type ShownEntity = Exclude<EventEntity, "cell_report_participant">;
export type EventActorKind = Enums<"event_actor_kind">;

/** As ações, na ordem do filtro (T7): as de registro e depois as de login e de senha (E1.04, E2.03). */
export const ACTION_LABELS: Record<EventAction, string> = {
  create: "Criação",
  update: "Alteração",
  delete: "Exclusão",
  restore: "Restauração",
  export: "Exportação",
  ...AUTH_ACTION_LABELS,
};

/** As entidades, na ordem do filtro (T7). */
export const ENTITY_LABELS: Record<ShownEntity, string> = {
  member: "Membro",
  cell: "Célula",
  cell_report: "Relatório",
  role: "Função",
  auth: "Autenticação",
};

/** As ações do histórico de um registro (RN-19). */
export const HISTORY_ACTIONS = ["create", "update", "delete", "restore"] as const satisfies readonly EventAction[];
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

/** Os registros com histórico (RN-19, AQ-9). */
export const RECORD_TYPES = ["member", "cell", "cell_report"] as const satisfies readonly AuthorshipEntity[];
export type RecordType = (typeof RECORD_TYPES)[number];

export function isEventAction(value: string): value is EventAction {
  return Object.prototype.hasOwnProperty.call(ACTION_LABELS, value);
}

export function isShownEntity(value: string): value is ShownEntity {
  return Object.prototype.hasOwnProperty.call(ENTITY_LABELS, value);
}

export function isHistoryAction(value: string): value is HistoryAction {
  return HISTORY_ACTIONS.some((action) => action === value);
}

export function isRecordType(value: string): value is RecordType {
  return RECORD_TYPES.some((type) => type === value);
}

/** Um evento lido da `events_view`, com os campos que a tela usa já conferidos. */
export interface AuditEvent {
  id: string;
  occurred_at: string;
  seq: number | null;
  actor_kind: EventActorKind | null;
  actor_label: string | null;
  action: EventAction;
  entity: EventEntity;
  entity_id: string | null;
  entity_label: string | null;
  description: string | null;
  changed_fields: string[] | null;
  changes: Json | null;
  metadata: Json | null;
  success: boolean;
  error_reason: string | null;
}

/** As colunas que a lista pede (sem `search_text`, que só serve à busca). */
export const AUDIT_EVENT_SELECT =
  "id, occurred_at, seq, actor_kind, actor_label, action, entity, entity_id, entity_label, description, changed_fields, changes, metadata, success, error_reason";

export type AuditEventViewRow = Pick<
  Tables<"events_view">,
  | "id"
  | "occurred_at"
  | "seq"
  | "actor_kind"
  | "actor_label"
  | "action"
  | "entity"
  | "entity_id"
  | "entity_label"
  | "description"
  | "changed_fields"
  | "changes"
  | "metadata"
  | "success"
  | "error_reason"
>;

/** A linha da view, que vem com tudo anulável, como evento; `null` se faltar o essencial. */
export function toAuditEvent(row: AuditEventViewRow): AuditEvent | null {
  const { id, occurred_at, action, entity } = row;
  if (!id || !occurred_at || !action || !entity) return null;
  return {
    id,
    occurred_at,
    seq: row.seq,
    actor_kind: row.actor_kind,
    actor_label: row.actor_label,
    action,
    entity,
    entity_id: row.entity_id,
    entity_label: row.entity_label,
    description: row.description,
    changed_fields: row.changed_fields,
    changes: row.changes,
    metadata: row.metadata,
    success: row.success !== false,
    error_reason: row.error_reason,
  };
}

/** O rótulo da ação; uma ação nova, sem rótulo, não aparece pelo nome técnico. */
export function actionLabel(action: string): string {
  return isEventAction(action) ? ACTION_LABELS[action] : "";
}

/** O rótulo da entidade. Um evento de participante que não foi convertido aparece como do relatório (P-AUD-24). */
export function entityLabel(entity: string): string {
  return isShownEntity(entity) ? ENTITY_LABELS[entity] : ENTITY_LABELS.cell_report;
}

/**
 * O autor (UX-21): "Sistema" na gravação sem pessoa; "—" no login sem sessão (E1.04); o nome de quem
 * fez. `null` quando não há autor (o card mostra só a data).
 */
export function actorText(event: Pick<AuditEvent, "actor_kind" | "actor_label">): string | null {
  if (event.actor_kind === "system") return AUTHORSHIP_TEXTS.system;
  if (event.actor_kind === "none") return null;
  return event.actor_label?.trim() || null;
}

// ---------------------------------------------------------------------------
// Leitura de `changes` (AQ-4)
// ---------------------------------------------------------------------------

type JsonObject = { [key: string]: Json | undefined };

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Um campo mudado. `hasValues` quando o evento traz o antes e o depois (RN-20 b). */
export interface FieldChange {
  field: string;
  hasValues: boolean;
  from: Json | undefined;
  to: Json | undefined;
}

export interface EventChanges {
  fields: FieldChange[];
  /** Os nomes: `sent` no envio; `added` e `removed` na alteração. */
  participants: { sent: string[] | null; added: string[]; removed: string[] } | null;
  /** As chaves das permissões: `all` na criação e na exclusão; `added` e `removed` na alteração. */
  permissions: { all: string[] | null; added: string[]; removed: string[] } | null;
  defaultRole: { current: string | null; previous: string | null } | null;
}

const EMPTY_CHANGES: EventChanges = { fields: [], participants: null, permissions: null, defaultRole: null };

function readFields(value: Json | undefined): FieldChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isObject(item) || typeof item.field !== "string") return [];
    const hasValues = "from" in item || "to" in item;
    return [{ field: item.field, hasValues, from: item.from, to: item.to }];
  });
}

/** Uma lista de nomes (`[{ id, name }]`) ou de textos. */
function readNames(value: Json | undefined): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item) => {
    if (typeof item === "string") return item ? [item] : [];
    if (isObject(item) && typeof item.name === "string" && item.name) return [item.name];
    return [];
  });
}

function readRefName(value: Json | undefined): string | null {
  if (isObject(value) && typeof value.name === "string" && value.name) return value.name;
  return null;
}

/** O `changes` de um evento, lido sem confiar no formato: o que não casa fica de fora. */
export function readChanges(value: Json | null | undefined): EventChanges {
  if (!isObject(value)) return EMPTY_CHANGES;
  const participants = isObject(value.participants) ? value.participants : null;
  const permissions = isObject(value.permissions) ? value.permissions : null;
  const defaultRole = isObject(value.default_role) ? value.default_role : null;
  return {
    fields: readFields(value.fields),
    participants: participants
      ? {
          sent: readNames(participants.sent),
          added: readNames(participants.added) ?? [],
          removed: readNames(participants.removed) ?? [],
        }
      : null,
    permissions: permissions
      ? {
          all: readNames(permissions.all),
          added: readNames(permissions.added) ?? [],
          removed: readNames(permissions.removed) ?? [],
        }
      : null,
    defaultRole: defaultRole
      ? { current: readRefName(defaultRole.current), previous: readRefName(defaultRole.previous) }
      : null,
  };
}

/** A entidade dos campos de um evento (o participante antigo é do relatório). */
function fieldEntity(entity: EventEntity): AuditFieldEntity | null {
  if (entity === "cell_report_participant") return "cell_report";
  return isAuditFieldEntity(entity) ? entity : null;
}

/** Os rótulos dos campos mudados que a tela conhece, na ordem do evento. */
function changedFieldLabels(event: AuditEvent, changes: EventChanges): string[] {
  const entity = fieldEntity(event.entity);
  if (!entity) return [];
  return changes.fields.flatMap(({ field }) => {
    const info = auditField(entity, field);
    return info ? [info.label] : [];
  });
}

/** "Líder, Celular/WhatsApp"; "Nome, Líder, Cônjuge e mais 2" (UXD-6). */
function fieldsSummary(labels: string[]): string | null {
  if (labels.length === 0) return null;
  const shown = labels.slice(0, 3).join(", ");
  return labels.length > 3 ? `${shown}${AUDIT_TEXTS.secondLine.andMore(labels.length - 3)}` : shown;
}

function joinParts(parts: Array<string | null>): string | null {
  const present = parts.filter((part): part is string => !!part);
  return present.length > 0 ? present.join(" · ") : null;
}

const LINE = AUDIT_TEXTS.secondLine;

/**
 * A segunda linha da descrição (UXD-6 e T7):
 * - alteração de membro, célula ou relatório: os campos (até 3, "e mais N") e, no relatório, os
 *   participantes incluídos e retirados;
 * - envio de relatório: "{N} participantes";
 * - função criada ou excluída: "{N} permissões"; alterada: os campos e as permissões incluídas e retiradas;
 * - login e senha: a do E1.04 e do E2.03;
 * - o resto: nada.
 */
export function eventSecondLine(event: AuditEvent): string | null {
  if (isAuthEvent(event)) return authEventSecondLine(event);
  const changes = readChanges(event.changes);
  if (event.entity === "role") {
    const all = changes.permissions?.all;
    if ((event.action === "create" || event.action === "delete") && all) return LINE.permissions(all.length);
    if (event.action !== "update") return null;
    const added = changes.permissions?.added.length ?? 0;
    const removed = changes.permissions?.removed.length ?? 0;
    return joinParts([
      fieldsSummary(changedFieldLabels(event, changes)),
      added > 0 ? LINE.permissionsAdded(added) : null,
      removed > 0 ? LINE.permissionsRemoved(removed) : null,
    ]);
  }
  if (event.entity === "cell_report_participant") return null;
  if (event.entity === "cell_report" && event.action === "create") {
    const sent = changes.participants?.sent;
    return sent ? LINE.participants(sent.length) : null;
  }
  if (event.action !== "update") return null;
  const added = changes.participants?.added.length ?? 0;
  const removed = changes.participants?.removed.length ?? 0;
  return joinParts([
    fieldsSummary(changedFieldLabels(event, changes)),
    added > 0 ? LINE.participantsAdded(added) : null,
    removed > 0 ? LINE.participantsRemoved(removed) : null,
  ]);
}

/** Um campo mudado no painel (P32): só o rótulo, ou o rótulo com o antes e o depois já formatados. */
export interface ChangeItem {
  field: string;
  label: string;
  values: { from: string; to: string } | null;
}

/** Os campos mudados no painel, na ordem do evento, com os valores só nos campos da RN-20 (b). */
export function changeItems(event: AuditEvent): ChangeItem[] {
  if (isAuthEvent(event)) return [];
  const entity = fieldEntity(event.entity);
  if (!entity) return [];
  return readChanges(event.changes).fields.flatMap((change) => {
    const info = auditField(entity, change.field);
    if (!info) return [];
    const values =
      info.showValues && change.hasValues
        ? { from: formatAuditValue(entity, info, change.from), to: formatAuditValue(entity, info, change.to) }
        : null;
    return [{ field: info.field, label: info.label, values }];
  });
}

/** Uma lista de nomes do painel: participantes ou permissões (P-AUD-24, RN-15). */
export interface NameList {
  key: string;
  title: string;
  items: string[];
}

function permissionLabels(keys: string[]): string[] {
  return keys.flatMap((key) => {
    const label = permissionLabelOf(key);
    return label ? [label] : [];
  });
}

/** As listas do painel, depois dos campos: participantes do relatório e permissões da função. */
export function eventNameLists(event: AuditEvent): NameList[] {
  if (isAuthEvent(event)) return [];
  const changes = readChanges(event.changes);
  const SHEET = AUDIT_TEXTS.sheet;
  const lists: NameList[] = [];
  const push = (key: string, title: string, items: string[] | null | undefined) => {
    if (items && items.length > 0) lists.push({ key, title, items });
  };
  if (changes.participants) {
    push("participants", SHEET.participants, changes.participants.sent);
    push("participantsAdded", SHEET.participantsAdded, changes.participants.added);
    push("participantsRemoved", SHEET.participantsRemoved, changes.participants.removed);
  }
  if (changes.permissions) {
    push("permissions", SHEET.permissions, changes.permissions.all && permissionLabels(changes.permissions.all));
    push("permissionsAdded", SHEET.permissionsAdded, permissionLabels(changes.permissions.added));
    push("permissionsRemoved", SHEET.permissionsRemoved, permissionLabels(changes.permissions.removed));
  }
  return lists;
}

/**
 * O registro do histórico de um evento (UXD-8): membro, célula ou relatório; o participante antigo
 * leva ao relatório quando o evento já traz o relatório como registro. `null` para os outros.
 */
export function eventRecord(event: AuditEvent): { type: RecordType; id: string } | null {
  if (!event.entity_id) return null;
  return isRecordType(event.entity) ? { type: event.entity, id: event.entity_id } : null;
}

/** A data e a hora do evento, sempre no horário de Brasília (UX-02): "dd/mm/aaaa às HH:mm" e "dd/mm/aaaa HH:mm". */
export function eventDateTime(instant: string): { long: string; short: string } {
  const when = formatSpDateTime(instant);
  if (!when) return { long: AUDIT_TEXTS.noActor, short: AUDIT_TEXTS.noActor };
  return { long: AUDIT_TEXTS.dateTime(when.date, when.time), short: AUDIT_TEXTS.dateTimeShort(when.date, when.time) };
}
