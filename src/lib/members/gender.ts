// Gênero do cadastro de membro: o banco guarda 'M' ou 'F' (CLAUDE.md,
// "Armadilhas"). Os rótulos da tela ficam só aqui.

export const GENDER_LABELS = { M: "Masculino", F: "Feminino" } as const;

export type Gender = keyof typeof GENDER_LABELS;

function isGender(value: string): value is Gender {
  return Object.prototype.hasOwnProperty.call(GENDER_LABELS, value);
}

/** O rótulo do gênero gravado; vazio quando não há gênero (ou é um valor desconhecido). */
export function genderLabel(value: string | null | undefined): string {
  return value && isGender(value) ? GENDER_LABELS[value] : "";
}
