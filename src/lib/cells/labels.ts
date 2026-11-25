// Rótulos de célula exibidos nas listas e nos formulários (E1.08, PR 2).
import type { LevelInput } from "@/lib/hierarchy/level";
import { CELLS_LIST_TEXTS } from "@/lib/hierarchy/texts";

export interface CellLabelParts {
  id?: string | null;
  leader_name?: string | null;
  street?: string | null;
  number?: string | null;
  neighborhood?: string | null;
}

export interface StreetLineParts {
  street?: string | null;
  number?: string | null;
  complement?: string | null;
}

export interface G12LabelParts {
  g12_leader_name?: string | null;
  leader_g12_level?: number | null;
  leader_is_pastor?: boolean | null;
  leader_name?: string | null;
}

export interface CellLeaderLevelParts {
  leader_g12_level?: number | null;
  leader_is_pastor?: boolean | null;
  leader_gender?: string | null;
}

/** "Célula de <líder>, em <rua número, bairro>". Sem líder, usa o começo do id. */
export function formatCellLabel(cell: CellLabelParts): string {
  const leader = cell.leader_name ? `Célula de ${cell.leader_name}` : `Célula (${(cell.id ?? "").substring(0, 5)})`;
  const street = [cell.street, cell.number].filter(Boolean).join(" ");
  const address = [street, cell.neighborhood].filter(Boolean).join(", ");
  return address ? `${leader}, em ${address}` : leader;
}

/** "Rua número - complemento", omitindo o que estiver vazio. */
export function formatStreetLine(address: StreetLineParts): string {
  const street = [address.street, address.number].filter(Boolean).join(" ");
  return [street, address.complement].filter(Boolean).join(" - ");
}

/** G12 da célula (RN-11): um nome só, "Pastores" ou nenhum. */
export type CellG12 = { kind: "name"; name: string } | { kind: "pastors" } | { kind: "none" };

/**
 * G12 da célula pelo líder (RN-11): "Pastores" para líder pastor, nenhum para
 * líder sem liderança (nível nulo), o próprio líder quando ele é G12 e, nos
 * demais casos, o G12 vindo da view. Nunca o casal.
 */
export function cellG12(cell: G12LabelParts): CellG12 {
  if (cell.leader_is_pastor === true || cell.leader_g12_level === 0) return { kind: "pastors" };
  if (cell.leader_g12_level == null) return { kind: "none" };
  const name = cell.g12_leader_name || (cell.leader_g12_level === 1 ? cell.leader_name : null);
  return name ? { kind: "name", name } : { kind: "none" };
}

/** O G12 da célula em texto: o nome, "Pastores" ou "—" (RN-11). */
export function formatG12Label(cell: G12LabelParts): string {
  const g12 = cellG12(cell);
  if (g12.kind === "name") return g12.name;
  return g12.kind === "pastors" ? CELLS_LIST_TEXTS.g12Pastors : CELLS_LIST_TEXTS.g12None;
}

/** O nível do líder da célula, para o rótulo do P40: "André Souza (144)". */
export function cellLeaderLevel(cell: CellLeaderLevelParts): LevelInput {
  return { level: cell.leader_g12_level, isPastor: cell.leader_is_pastor, gender: cell.leader_gender };
}

export interface AddressParts {
  street?: string | null;
  number?: string | null;
  neighborhood?: string | null;
}

/** "20:00" a partir do `time` do banco ("20:00:00"); vazio sem horário. */
export function formatMeetingTime(time: string | null | undefined): string {
  return time ? time.substring(0, 5) : "";
}

/**
 * Endereço curto da célula, como nos cards: "Rua das Flores, 120" ("s/n" sem
 * número). Sem rua, o bairro; sem os dois, vazio.
 */
export function formatShortAddress(address: AddressParts): string {
  if (address.street) return `${address.street}, ${address.number || "s/n"}`;
  return address.neighborhood ?? "";
}
