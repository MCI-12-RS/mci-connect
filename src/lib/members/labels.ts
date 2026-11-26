// O nome da pessoa com a marca de situação (E2.08, P63; usado também no
// bloqueio da exclusão do E2.01). Sem React e sem Supabase.
import { PERSON_MARK_TEXTS } from "./texts";
import { UNNAMED_MEMBER_LABEL } from "./fields";

/** "(inativa)" para mulher e "(inativo)" para os demais, inclusive sem o sexo registrado. */
export function inactiveMark(gender: string | null | undefined): string {
  return gender === "F" ? PERSON_MARK_TEXTS.inactiveFemale : PERSON_MARK_TEXTS.inactiveMale;
}

export interface PersonLabelParts {
  name: string | null | undefined;
  is_active?: boolean | null;
  gender?: string | null;
}

/**
 * "Fábio Lima (inativo)": o nome com a marca quando a pessoa está inativa. A
 * marca é texto, faz parte do nome acessível e não impede a escolha (RN-04).
 * Sem a situação (`is_active` nulo ou ausente), só o nome.
 */
export function personLabel({ name, is_active, gender }: PersonLabelParts): string {
  const label = name || UNNAMED_MEMBER_LABEL;
  return is_active === false ? `${label} ${inactiveMark(gender)}` : label;
}
