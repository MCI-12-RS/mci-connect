// A senha temporária na tela (E2.03, T6 e P17). Sem React e sem Supabase.

import { RESET_TEXTS, type ResetRefusalCode } from "@/lib/auth/password-texts";

/** Os dois grupos de 4, só para o visual: o texto da senha não ganha espaço (UXD-4). */
export function displayGroups(password: string): string[] {
  const chars = Array.from(password);
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += 4) groups.push(chars.slice(i, i + 4).join(""));
  return groups;
}

/** "Senha: k, 7, m, 2, x, 9, p, a." para o leitor de tela (UX-29). */
export function spellForScreenReader(password: string): string {
  return RESET_TEXTS.spelled(Array.from(password));
}

const SAO_PAULO_DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function saoPauloParts(isoUtc: string): Record<"day" | "month" | "year" | "hour" | "minute", string> | null {
  const instant = new Date(isoUtc);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = SAO_PAULO_DATE_TIME.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: part("day"), month: part("month"), year: part("year"), hour: part("hour"), minute: part("minute") };
}

/** "05/12/2026 às 23:50", no horário de Brasília, qualquer que seja o fuso do aparelho (UX-23). */
export function formatValidUntil(isoUtc: string): string {
  const p = saoPauloParts(isoUtc);
  return p ? `${p.day}/${p.month}/${p.year} às ${p.hour}:${p.minute}` : "";
}

/** "21:50", no horário de Brasília (a linha "Senha redefinida às…", T5). */
export function formatResetTime(isoUtc: string): string {
  const p = saoPauloParts(isoUtc);
  return p ? `${p.hour}:${p.minute}` : "";
}

/**
 * O que a tela faz depois de fechar o diálogo de uma recusa (T6):
 * - `close_record`: o cadastro fecha, e a lista recarrega (não existe ou foi excluído);
 * - `reread_access`: relê o acesso, e a ação some (sem a permissão);
 * - `show_text`: a linha "Senha" vira o texto da recusa (T5);
 * - `none`: nada muda (limite, ou a própria senha numa corrida).
 */
export type RefusalNextStep = "close_record" | "reread_access" | "show_text" | "none";

export function nextStepForRefusal(code: ResetRefusalCode): RefusalNextStep {
  switch (code) {
    case "not_found":
      return "close_record";
    case "no_permission":
      return "reread_access";
    case "role_not_covered":
    case "no_account":
      return "show_text";
    case "rate_limited":
    case "self":
      return "none";
  }
}
