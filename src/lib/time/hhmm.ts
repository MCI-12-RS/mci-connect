// Horário digitado "HH:mm", sempre em 24 h (E2.08, P62, DT-16; também o
// horário do relatório no E2.11). Sem React. A tabela de casos é a da T3
// (`supabase/tests/fixtures/cell-rules-cases.json`, `meeting_time`).

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const digitsOf = (value: string): string => value.replace(/\D/g, "");

/**
 * O campo enquanto a pessoa digita ou cola:
 * - sem ":", os dois-pontos entram depois do 2º dígito ("2000" → "20:00", "20" → "20:", "730" → "73:0");
 * - com ":" depois de um dígito só, a hora ganha o zero ("7:30" → "07:30");
 * - no máximo 4 dígitos ("19:30:45" → "19:30").
 *
 * `deleting`: a pessoa está apagando; os dois-pontos do fim não voltam ("20:" apagado fica "20").
 */
export function maskHhmm(value: string, { deleting = false } = {}): string {
  const colon = value.indexOf(":");
  if (colon > 0 && colon <= 2) {
    const hours = digitsOf(value.slice(0, colon)).padStart(2, "0");
    const minutes = digitsOf(value.slice(colon + 1)).slice(0, 2);
    return `${hours}:${minutes}`;
  }
  const digits = digitsOf(value).slice(0, 4);
  if (digits.length < 2) return digits;
  if (digits.length === 2) return deleting ? digits : `${digits}:`;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/**
 * Ao sair do campo: 1 ou 2 dígitos viram a hora cheia ("20" → "20:00",
 * "7" → "07:00"); 4 dígitos, hora e minutos; o resto fica como está, para o
 * erro aparecer sobre o que foi digitado ("73:0").
 */
export function readHhmmOnBlur(value: string): string {
  const trimmed = value.trim();
  const hourOnly = /^(\d{1,2}):?$/.exec(trimmed);
  if (hourOnly) return `${hourOnly[1].padStart(2, "0")}:00`;
  const compact = /^(\d{1,2}):?(\d{2})$/.exec(trimmed);
  if (compact) return `${compact[1].padStart(2, "0")}:${compact[2]}`;
  return trimmed;
}

/** "HH:mm" de 00:00 a 23:59. */
export function isValidHhmm(value: string): boolean {
  return HHMM.test(value);
}

/** O horário gravado ("20:00:00") como o campo mostra ("20:00"); vazio sem horário. */
export function toHhmm(time: string | null | undefined): string {
  if (!time) return "";
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : time;
}
