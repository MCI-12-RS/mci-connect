// Ranking "Células por G12" do Dashboard.
//
// `male_cells` e `female_cells` de cada membro já são o total da subárvore
// dele (células ativas lideradas por ele ou por qualquer discípulo, em todos os
// níveis, separadas pelo gênero do líder; anfitrião e timóteo não contam). Por
// isso o casal soma só os totais dos seus integrantes de nível 1, sem descer na
// árvore: descer contaria a mesma célula uma vez por ancestral.
// O E1.08 (PR 3) leva este cálculo para o banco (dashboard_g12_ranking).

export interface G12RankingMember {
  id: string;
  name: string;
  gender: string | null;
  spouse_id: string | null;
  g12_level: number;
  male_cells: number | null;
  female_cells: number | null;
}

export interface G12CoupleRow {
  id: string;
  name: string;
  spouseName?: string;
  maleCells: number;
  femaleCells: number;
}

const isMale = (gender: string | null) => gender === "M" || gender === "Masculino";

/** Casais G12 (homem primeiro) com as células da subárvore, do maior total para o menor. */
export function rankG12Couples(members: G12RankingMember[]): G12CoupleRow[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const couples = new Map<string, G12CoupleRow>();

  for (const member of members) {
    if (member.g12_level !== 1) continue;
    const spouse = member.spouse_id ? byId.get(member.spouse_id) : undefined;
    const key = spouse ? [member.id, spouse.id].sort().join("|") : member.id;

    let row = couples.get(key);
    if (!row) {
      const [first, second] = spouse && !isMale(member.gender) && isMale(spouse.gender) ? [spouse, member] : [member, spouse];
      row = { id: key, name: first.name, spouseName: second?.name, maleCells: 0, femaleCells: 0 };
      couples.set(key, row);
    }
    row.maleCells += member.male_cells ?? 0;
    row.femaleCells += member.female_cells ?? 0;
  }

  return Array.from(couples.values()).sort(
    (a, b) => b.maleCells + b.femaleCells - (a.maleCells + a.femaleCells) || a.name.localeCompare(b.name, "pt-BR"),
  );
}
