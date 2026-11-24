// Rótulos de célula exibidos nas listas e nos formulários (E1.08, PR 2).

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

/**
 * G12 da célula: o nome vindo da view; sem ele, "Pastores" quando o líder é
 * de nível 0 e "—" nos demais casos.
 */
export function formatG12Label(cell: G12LabelParts): string {
  if (cell.g12_leader_name) return cell.g12_leader_name;
  return cell.leader_g12_level === 0 ? "Pastores" : "—";
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
