// "Célula ativa" no formulário de edição (E2.08, RN-11, P60) e o toast de
// cada gravação (T6). Sem React e sem Supabase.
import type { CellPatch } from "./changes";
import { CELL_FORM_TEXTS } from "./texts";

const TEXTS = CELL_FORM_TEXTS.situation;

/** A dica embaixo de "Célula ativa", pela situação gravada (não muda com o interruptor). */
export function situationHint(storedActive: boolean): string {
  return storedActive ? TEXTS.hintActive : TEXTS.hintInactive;
}

/** O aviso do que muda ao salvar, só quando o interruptor está diferente do gravado. */
export function situationNotice(storedActive: boolean, active: boolean): string | null {
  if (storedActive === active) return null;
  return active ? TEXTS.willReactivate : TEXTS.willInactivate;
}

export type CellSaveOutcome = "created" | "updated" | "inactivated" | "reactivated" | "unchanged";

/**
 * O que a gravação fez, para o toast (T6): `stored` é a situação gravada (`null`
 * na célula nova) e `patch`, o que vai ao servidor na edição.
 */
export function saveOutcome(stored: boolean | null, patch: CellPatch): CellSaveOutcome {
  if (stored === null) return "created";
  if (Object.keys(patch).length === 0) return "unchanged";
  if (patch.is_active === false && stored) return "inactivated";
  if (patch.is_active === true && !stored) return "reactivated";
  return "updated";
}

/** O texto do toast de cada resultado. */
export function saveOutcomeToast(outcome: CellSaveOutcome): string {
  return CELL_FORM_TEXTS.toasts[outcome];
}
