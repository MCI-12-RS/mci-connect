// Árvore de ministérios (E1.08, RN-10): cada nó é um casal devolvido pela RPC
// `ministry_tree_nodes`, com o homem como integrante principal.
import { formatCount } from "@/lib/format";

/** Os ids de um nó: o integrante principal e o cônjuge exibido (nulo quando não há). */
export interface MinistryCoupleIds {
  member_id: string;
  spouse_id: string | null;
}

/**
 * Chave do nó entre os irmãos. O `member_id` sozinho não basta: um vínculo de
 * cônjuge assimétrico pode repetir um membro em dois nós do mesmo nível.
 */
export function ministryNodeKey(node: MinistryCoupleIds): string {
  return `${node.member_id}|${node.spouse_id ?? ""}`;
}

/** Ids passados à RPC para abrir o nó: o principal e o cônjuge, sem nulos. */
export function ministryNodeParentIds(node: MinistryCoupleIds): string[] {
  return node.spouse_id ? [node.member_id, node.spouse_id] : [node.member_id];
}

/** Rótulo do nível ministerial (`g12_level`): Pastor(a), 12, 144, 1.728 e, abaixo disso, "Nível N". */
export function getLevelLabel(level: number): string {
  if (level === 0) return "Pastor(a)";
  if (level === 1) return "12";
  if (level === 2) return "144";
  if (level === 3) return "1.728";
  return `Nível ${level}`;
}

/** Texto da contagem do nó para o leitor de tela: "1 discípulo direto", "1.234 discípulos diretos". */
export function directDisciplesLabel(count: number): string {
  return count === 1 ? "1 discípulo direto" : `${formatCount(count)} discípulos diretos`;
}
