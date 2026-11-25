// Rótulo do nível ministerial (E2.06, P40, RN-02). Uma função só para todas
// as telas: listas, Células e a árvore de Ministérios.
import { formatCount } from "@/lib/format";
import { LEVEL_TEXTS } from "./texts";

/** Aparência do rótulo: badge `default`, badge `outline` ou o aviso do P6. */
export type LevelTone = "pastor" | "level" | "no_leadership";

export interface LevelInput {
  /** `g12_level` da view: 0 = pastor, 1 = G12, 2 = 144…; nulo para quem está sem liderança (DA-2). */
  level: number | null | undefined;
  isPastor?: boolean | null;
  /** 'M' ou 'F'; vazio num cadastro antigo. */
  gender?: string | null;
  /** Nó da árvore em que os dois integrantes são pastores: "Pastores". */
  bothPastors?: boolean;
}

/** O rótulo pronto para a tela, com o que o leitor de tela precisa. */
export interface LevelInfo {
  label: string;
  tone: LevelTone;
  /** Prefixo `sr-only` dos rótulos só com número ("nível"), ou nulo. */
  srPrefix: string | null;
  /** O que o leitor de tela ouve na forma entre parênteses: "nível 144", "pastor", "sem liderança". */
  spoken: string;
}

const NUMERIC_LEVELS_FROM = 2;
const NUMERIC_LEVELS_TO = 4;

/** Pastor (nível 0), com nível ou sem liderança (nível nulo e não pastor, DA-2). */
export function levelTone({ level, isPastor }: LevelInput): LevelTone {
  if (isPastor === true || level === 0) return "pastor";
  if (level === null || level === undefined) return "no_leadership";
  return "level";
}

function pastorLabel(gender: string | null | undefined, bothPastors: boolean | undefined): string {
  if (bothPastors) return LEVEL_TEXTS.pastors;
  if (gender === "M") return LEVEL_TEXTS.pastor;
  if (gender === "F") return LEVEL_TEXTS.pastora;
  return LEVEL_TEXTS.pastorUnknownGender;
}

function isNumericLevel(level: number): boolean {
  return level >= NUMERIC_LEVELS_FROM && level <= NUMERIC_LEVELS_TO;
}

/**
 * "Pastor", "Pastora", "Pastor(a)", "Pastores", "G12", "144", "1.728",
 * "20.736", "Nível 5"… ou "Sem liderança". Nunca "12" sozinho nem "Nível 0".
 */
export function levelLabel(input: LevelInput): string {
  const tone = levelTone(input);
  if (tone === "pastor") return pastorLabel(input.gender, input.bothPastors);
  if (tone === "no_leadership" || input.level == null) return LEVEL_TEXTS.noLeadership;
  if (input.level === 1) return LEVEL_TEXTS.g12;
  if (isNumericLevel(input.level)) return formatCount(12 ** input.level);
  return LEVEL_TEXTS.deepLevel(input.level);
}

/** Rótulo, aparência e os textos do leitor de tela (P40). */
export function levelInfo(input: LevelInput): LevelInfo {
  const label = levelLabel(input);
  const tone = levelTone(input);
  const numeric = tone === "level" && input.level != null && isNumericLevel(input.level);
  const srPrefix = numeric ? LEVEL_TEXTS.numericPrefix : null;
  let spoken: string;
  if (numeric) spoken = `${LEVEL_TEXTS.numericPrefix} ${label}`;
  else if (label === LEVEL_TEXTS.g12) spoken = label;
  else spoken = label.charAt(0).toLocaleLowerCase("pt-BR") + label.slice(1);
  return { label, tone, srPrefix, spoken };
}

/** As colunas da `members_view` que dão o nível de um membro. */
export interface MemberLevelParts {
  g12_level?: number | null;
  is_pastor?: boolean | null;
  gender?: string | null;
}

/** O nível de um membro da `members_view`, para o rótulo do P40. */
export function memberLevel(member: MemberLevelParts): LevelInput {
  return { level: member.g12_level, isPastor: member.is_pastor, gender: member.gender };
}
