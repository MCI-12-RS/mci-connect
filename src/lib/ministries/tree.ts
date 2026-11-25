// Árvore de ministérios (E1.08, RN-10; E2.06, RN-09, T3, T4): cada linha da
// RPC `ministry_tree_nodes` é um nó (um casal, com o homem como principal, e
// os totais) ou a referência de quem aparece com o cônjuge num nó mais acima
// (`kind = 'spouse_above'`, sem totais).
import type { LevelInput } from "@/lib/hierarchy/level";
import { levelLabel } from "@/lib/hierarchy/level";
import { MINISTRIES_TEXTS, TOTALS_TEXTS } from "@/lib/hierarchy/texts";
import { totalsSpokenText } from "@/lib/hierarchy/totals";

/**
 * Uma linha da RPC, como chega. Os campos aceitam nulo: o `types.ts` gerado
 * não marca as colunas anuláveis (o cônjuge, o nível de quem está sem
 * liderança e os totais da referência).
 */
export interface MinistryTreeRow {
  member_id: string;
  member_name: string;
  g12_level: number | null;
  is_pastor: boolean | null;
  spouse_id: string | null;
  spouse_name: string | null;
  direct_disciples: number | null;
  total_disciples: number | null;
  total_cells: number | null;
  kind: string | null;
  level_gender: string | null;
  level_is_pastor: boolean | null;
  spouse_is_pastor: boolean | null;
}

/** Um nó: o casal (ou uma pessoa só), o nível da posição e os totais (RN-09). */
export interface MinistryCoupleNode {
  kind: "node";
  member_id: string;
  member_name: string;
  /** Nulo quando não há cônjuge visível e ativo. */
  spouse_id: string | null;
  spouse_name: string | null;
  level: LevelInput;
  /** Decide se o nó abre (E1.08): maior que zero garante ao menos um filho. */
  direct_disciples: number;
  total_disciples: number;
  total_cells: number;
}

/**
 * Referência (P43): a pessoa aparece com o cônjuge, `spouse_id`, num nó mais
 * acima. Não abre e não tem totais (já estão no nó do casal).
 */
export interface MinistrySpouseReference {
  kind: "spouse_above";
  member_id: string;
  member_name: string;
  spouse_id: string;
  spouse_name: string;
  /** O nível da própria pessoa, na posição dela. */
  level: LevelInput;
}

export type MinistryTreeItem = MinistryCoupleNode | MinistrySpouseReference;

/** O nível da posição, para o P40. "Pastores" só quando os dois integrantes são pastores. */
function rowLevel(row: MinistryTreeRow): LevelInput {
  return {
    level: row.g12_level,
    isPastor: row.level_is_pastor,
    gender: row.level_gender,
    bothPastors: row.is_pastor === true && row.spouse_id !== null && row.spouse_is_pastor === true,
  };
}

/** A linha da RPC vira um nó ou uma referência. Uma referência sem o cônjuge vira nó, sem esconder ninguém. */
export function toMinistryTreeItem(row: MinistryTreeRow): MinistryTreeItem {
  if (row.kind === "spouse_above" && row.spouse_id && row.spouse_name) {
    return {
      kind: "spouse_above",
      member_id: row.member_id,
      member_name: row.member_name,
      spouse_id: row.spouse_id,
      spouse_name: row.spouse_name,
      level: { level: row.g12_level, isPastor: row.level_is_pastor, gender: row.level_gender },
    };
  }
  return {
    kind: "node",
    member_id: row.member_id,
    member_name: row.member_name,
    spouse_id: row.spouse_id,
    spouse_name: row.spouse_id ? row.spouse_name : null,
    level: rowLevel(row),
    direct_disciples: row.direct_disciples ?? 0,
    total_disciples: row.total_disciples ?? 0,
    total_cells: row.total_cells ?? 0,
  };
}

/**
 * Chave entre os irmãos. O `member_id` sozinho não basta: um vínculo de
 * cônjuge assimétrico pode repetir um membro em dois nós do mesmo nível.
 */
export function ministryNodeKey(item: MinistryTreeItem): string {
  const key = `${item.member_id}|${item.spouse_id ?? ""}`;
  return item.kind === "spouse_above" ? `ref|${key}` : key;
}

/** Ids passados à RPC para abrir o nó: o principal e o cônjuge, sem nulos. */
export function ministryNodeParentIds(node: Pick<MinistryCoupleNode, "member_id" | "spouse_id">): string[] {
  return node.spouse_id ? [node.member_id, node.spouse_id] : [node.member_id];
}

/** Os nomes do nó para o leitor de tela: "Diego Reis e Olga Reis", ou só um nome. */
export function ministryNodeNames(node: Pick<MinistryCoupleNode, "member_name" | "spouse_name">): string {
  return node.spouse_name ? MINISTRIES_TEXTS.coupleNames(node.member_name, node.spouse_name) : node.member_name;
}

/**
 * Nome acessível do nó (UX-12): "Diego Reis e Olga Reis, 144, 2 discípulos,
 * 3 células". O rótulo do nível vai como aparece, sem o prefixo "nível".
 */
export function ministryNodeAccessibleName(node: MinistryCoupleNode): string {
  return [
    ministryNodeNames(node),
    levelLabel(node.level),
    totalsSpokenText({ disciples: node.total_disciples, cells: node.total_cells }),
  ].join(TOTALS_TEXTS.spokenSeparator);
}

/**
 * "Ir para o casal" (AQ-3): sobe pelo caminho já aberto, do nó mais próximo à
 * raiz, até o nó que tem `spouseId` como principal ou cônjuge. O caminho vai
 * da raiz ao pai da referência.
 */
export function findCoupleInPath<T extends { node: MinistryCoupleNode }>(
  path: readonly T[],
  spouseId: string,
): T | undefined {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const { node } = path[index];
    if (node.member_id === spouseId || node.spouse_id === spouseId) return path[index];
  }
  return undefined;
}
