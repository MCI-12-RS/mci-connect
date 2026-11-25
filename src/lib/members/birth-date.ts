// Data de nascimento (E2.04, RN-15, DA-13). `birthDateProblem` é a gêmea de
// `public.birth_date_problem`, conferida pela tabela de casos
// `supabase/tests/fixtures/member-validation-cases.json` (seções `birthDate` e
// `age`). O "hoje" é sempre o de Brasília (`spToday`), passado por quem chama.

import { addOneDay, parseIsoDate, subtractYears } from "@/lib/dates/sao-paulo";
import { MEMBER_RULE_TEXTS } from "./texts";

export type BirthDateProblem = "birth_date_future" | "birth_date_too_old";

/** RN-15: a pessoa teria esta idade ou mais. */
const MAX_AGE_YEARS = 100;

/**
 * Os limites do campo (`min` e `max` do `<input type="date">`): `max` é hoje,
 * e `min` é o dia seguinte ao de 100 anos atrás.
 */
export function birthDateBounds(today: string): { min: string; max: string } {
  return { min: addOneDay(subtractYears(today, MAX_AGE_YEARS)), max: today };
}

/**
 * RN-15: `null` (vazia ou aceita), `birth_date_future` ou
 * `birth_date_too_old` (no mesmo dia de 100 anos atrás ou antes). Uma data
 * que não existe conta como vazia: o campo nativo nunca a entrega.
 */
export function birthDateProblem(birth: string | null | undefined, today: string): BirthDateProblem | null {
  if (birth == null || !parseIsoDate(birth)) return null;
  if (birth > today) return "birth_date_future";
  if (birth <= subtractYears(today, MAX_AGE_YEARS)) return "birth_date_too_old";
  return null;
}

/** A idade em anos completos, pelo calendário da DA-13. `null` sem uma data aceita. */
export function ageInYears(birth: string | null | undefined, today: string): number | null {
  if (birth == null || birthDateProblem(birth, today) !== null || !parseIsoDate(birth)) return null;
  let years = 0;
  while (years < MAX_AGE_YEARS && subtractYears(today, years + 1) >= birth) years++;
  return years;
}

/** A idade embaixo do campo (P-VAL-24): "{N} anos", "1 ano" ou "Menos de 1 ano". `null` sem uma data aceita. */
export function ageLabel(birth: string | null | undefined, today: string): string | null {
  const years = ageInYears(birth, today);
  return years === null ? null : MEMBER_RULE_TEXTS.age(years);
}
