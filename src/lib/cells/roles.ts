// Papéis de uma pessoa numa célula, como o banco os identifica (por exemplo,
// em `roles` das células que impedem a exclusão de um membro, E2.01 RN-04).

export const CELL_ROLES = ["leader", "timothy", "host"] as const;

export type CellRole = (typeof CELL_ROLES)[number];

/** Rótulo do papel, como aparece nas telas. */
export const CELL_ROLE_LABELS: Readonly<Record<CellRole, string>> = {
  leader: "Líder",
  timothy: "Timóteo",
  host: "Anfitrião",
};

const KNOWN_ROLES: ReadonlySet<string> = new Set(CELL_ROLES);

export function isCellRole(value: unknown): value is CellRole {
  return typeof value === "string" && KNOWN_ROLES.has(value);
}

/**
 * Os papéis no começo de uma frase: "Timóteo", "Líder e anfitrião",
 * "Líder, timóteo e anfitrião".
 */
export function formatCellRoles(roles: readonly CellRole[]): string {
  const labels = roles.map((role, index) =>
    index === 0 ? CELL_ROLE_LABELS[role] : CELL_ROLE_LABELS[role].toLocaleLowerCase("pt-BR"),
  );
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
}
