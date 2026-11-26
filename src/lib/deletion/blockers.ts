// Bloqueio da exclusão de um membro com ligações (E2.01, RN-04 e T3): lê os
// detalhes de `member_has_links` (da recusa de `delete_member` ou da
// pré-checagem `check_member_deletion`) e monta os grupos do diálogo.
import { isJsonObject, type AppError, type JsonObject } from "@/lib/errors";
import { UNNAMED_MEMBER_LABEL } from "@/lib/members/fields";
import { personLabel } from "@/lib/members/labels";
import { formatCellRoles, isCellRole, type CellRole } from "@/lib/cells/roles";
import { weekdayInSentence } from "@/lib/cells/weekdays";
import type { DeletionErrorCode } from "./codes";
import { MEMBER_LINKS_TEXTS } from "./texts";

const MEMBER_HAS_LINKS: DeletionErrorCode = "member_has_links";

/** Quantos itens cada grupo mostra; o resto vira "e mais N". */
export const BLOCKER_GROUP_LIMIT = 5;

/** Um discípulo não excluído do membro, ativo ou inativo. */
export interface LinkedDisciple {
  id: string;
  name: string | null;
  is_active: boolean;
}

/** Uma célula não excluída em que o membro tem um ou mais papéis. */
export interface LinkedCell {
  id: string;
  roles: CellRole[];
  leader_name: string | null;
  meeting_day: string | null;
  /** "HH:MM". */
  meeting_time: string | null;
  is_active: boolean;
}

/** Detalhes de `member_has_links` (E2.01, "Formato dos erros"). */
export interface MemberLinks {
  member_id: string;
  member_name: string | null;
  disciples_total: number;
  /** Até 5, por nome. */
  disciples: LinkedDisciple[];
  cells_total: number;
  /** Até 5, pelo nome do líder, dia e horário. */
  cells: LinkedCell[];
}

const isText = (value: unknown): value is string => typeof value === "string";
const isOptionalText = (value: unknown): value is string | null => value === null || isText(value);
const isCount = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0;

function toDisciple(value: unknown): LinkedDisciple | null {
  if (!isJsonObject(value)) return null;
  const { id, name, is_active } = value;
  if (!isText(id) || !isOptionalText(name) || typeof is_active !== "boolean") return null;
  return { id, name, is_active };
}

function toCell(value: unknown): LinkedCell | null {
  if (!isJsonObject(value)) return null;
  const { id, roles, leader_name, meeting_day, meeting_time, is_active } = value;
  if (!isText(id) || !Array.isArray(roles) || !roles.every(isCellRole)) return null;
  if (!isOptionalText(leader_name) || !isOptionalText(meeting_day) || !isOptionalText(meeting_time)) return null;
  if (typeof is_active !== "boolean") return null;
  return { id, roles, leader_name, meeting_day, meeting_time, is_active };
}

/** Lê uma lista em que todo item precisa ser válido. */
function toList<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const items: T[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (parsed === null) return null;
    items.push(parsed);
  }
  return items;
}

/**
 * Os detalhes de `member_has_links`, conferidos campo a campo. `null` se
 * algum faltar ou vier num formato inesperado: a tela mostra então a mensagem
 * do servidor como veio (UX-11).
 */
export function parseMemberLinks(detail: JsonObject): MemberLinks | null {
  const { member_id, member_name, disciples_total, cells_total } = detail;
  if (!isText(member_id) || !isOptionalText(member_name)) return null;
  if (!isCount(disciples_total) || !isCount(cells_total)) return null;
  const disciples = toList(detail.disciples, toDisciple);
  const cells = toList(detail.cells, toCell);
  if (!disciples || !cells) return null;
  return { member_id, member_name, disciples_total, disciples, cells_total, cells };
}

/**
 * As ligações de uma recusa `member_has_links`. `null` para outra recusa
 * (próprio cadastro, função acima) ou com detalhes inválidos.
 */
export function memberLinksFromRefusal(refusal: AppError): MemberLinks | null {
  return refusal.code === MEMBER_HAS_LINKS ? parseMemberLinks(refusal.detail) : null;
}

/** Um item do bloqueio: o discípulo ou a célula a reatribuir. */
export interface BlockerItem {
  /** Id do membro (discípulo) ou da célula. */
  id: string;
  /** "Léo Martins (inativo)", "Timóteo na célula de Carlos Lima, quarta, 20:00". */
  label: string;
}

export type BlockerGroupKind = "disciples" | "cells";

/** Um grupo do bloqueio: "4 discípulos", com até 5 itens e "e mais N". */
export interface BlockerGroup {
  kind: BlockerGroupKind;
  title: string;
  items: BlockerItem[];
  /** "e mais 2", ou `null` quando todos aparecem. */
  more: string | null;
}

/** "Léo Martins (inativo)". */
export function formatLinkedDisciple(disciple: LinkedDisciple): string {
  return personLabel({ name: disciple.name, is_active: disciple.is_active });
}

/** "Anfitrião na célula de Marcos Dias, sexta, 19:30 (inativa)". */
export function formatLinkedCell(cell: LinkedCell): string {
  const role = MEMBER_LINKS_TEXTS.cellRole(formatCellRoles(cell.roles), cell.leader_name || UNNAMED_MEMBER_LABEL);
  const schedule = [cell.meeting_day && weekdayInSentence(cell.meeting_day), cell.meeting_time?.slice(0, 5)];
  const label = [role, ...schedule.filter(Boolean)].join(", ");
  return cell.is_active ? label : `${label} ${MEMBER_LINKS_TEXTS.inactiveCell}`;
}

function toGroup(
  kind: BlockerGroupKind,
  total: number,
  items: BlockerItem[],
  title: (total: number) => string,
): BlockerGroup | null {
  const shown = items.slice(0, BLOCKER_GROUP_LIMIT);
  const count = Math.max(total, shown.length);
  if (count === 0) return null;
  const hidden = count - shown.length;
  return { kind, title: title(count), items: shown, more: hidden > 0 ? MEMBER_LINKS_TEXTS.more(hidden) : null };
}

/**
 * Os grupos do bloqueio, na ordem do Negócio: discípulos, depois células.
 * Um grupo vazio não aparece.
 */
export function buildBlockerGroups(links: MemberLinks): BlockerGroup[] {
  const disciples = links.disciples.map((d) => ({ id: d.id, label: formatLinkedDisciple(d) }));
  const cells = links.cells.map((c) => ({ id: c.id, label: formatLinkedCell(c) }));
  return [
    toGroup("disciples", links.disciples_total, disciples, MEMBER_LINKS_TEXTS.disciples),
    toGroup("cells", links.cells_total, cells, MEMBER_LINKS_TEXTS.cells),
  ].filter((group): group is BlockerGroup => group !== null);
}
