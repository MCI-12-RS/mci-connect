// Liderança de uma pessoa na lista de Membros (E2.06, P41, RN-10): o G12 e o
// líder direto, derivados do nível, sem a própria pessoa e sem repetir nome.
// Nunca mais de dois nomes: o caminho inteiro não aparece (P-HIE-10).
//
// Não confundir com `src/lib/members/leadership.ts` (E2.04), que trata a
// situação de liderança no formulário.
import { levelTone, type LevelInput } from "./level";
import { LEADERSHIP_TEXTS } from "./texts";

export interface LeadershipInput {
  level: LevelInput["level"];
  isPastor?: boolean | null;
  /** O líder direto (nome de referência). */
  leaderName?: string | null;
  /** O G12 da pessoa (nome de referência); no G12, é ele mesmo. */
  g12Name?: string | null;
}

export type Leadership =
  /** Pastor: "—", lido como "Nenhuma". */
  | { kind: "none" }
  | { kind: "no_leadership" }
  /** G12, ou nível 3 ou mais sem o nome do G12: só o líder direto. */
  | { kind: "leader"; leader: string }
  /** Nível 2: o líder direto é o G12. */
  | { kind: "g12_is_leader"; g12: string }
  /** Nível 3 ou mais: "{G12} / {líder}". */
  | { kind: "chain"; g12: string; leader: string };

/** A liderança pelo nível (P41). */
export function leadershipOf({ level, isPastor, leaderName, g12Name }: LeadershipInput): Leadership {
  const tone = levelTone({ level, isPastor });
  if (tone === "pastor") return { kind: "none" };
  if (tone === "no_leadership" || level == null) return { kind: "no_leadership" };
  const leader = leaderName?.trim() || null;
  const g12 = g12Name?.trim() || null;
  if (level === 2) {
    const name = g12 ?? leader;
    return name ? { kind: "g12_is_leader", g12: name } : { kind: "none" };
  }
  if (!leader) return { kind: "none" };
  if (level >= 3 && g12 && g12 !== leader) return { kind: "chain", g12, leader };
  return { kind: "leader", leader };
}

/** O texto da tabela: "Pedro Alves / André Souza", "Pedro Alves", "—" ou "Sem liderança". */
export function leadershipText(leadership: Leadership): string {
  switch (leadership.kind) {
    case "none":
      return LEADERSHIP_TEXTS.none;
    case "no_leadership":
      return LEADERSHIP_TEXTS.noLeadership;
    case "leader":
      return leadership.leader;
    case "g12_is_leader":
      return leadership.g12;
    case "chain":
      return `${leadership.g12} ${LEADERSHIP_TEXTS.separator} ${leadership.leader}`;
  }
}

/** O que o leitor de tela ouve: "G12 Pedro Alves, líder André Souza", "Nenhuma"… */
export function leadershipSpokenText(leadership: Leadership): string {
  switch (leadership.kind) {
    case "none":
      return LEADERSHIP_TEXTS.noneSpoken;
    case "no_leadership":
      return LEADERSHIP_TEXTS.noLeadership;
    case "leader":
      return LEADERSHIP_TEXTS.spokenLeader(leadership.leader);
    case "g12_is_leader":
      return LEADERSHIP_TEXTS.spokenG12IsLeader(leadership.g12);
    case "chain":
      return LEADERSHIP_TEXTS.spokenChain(leadership.g12, leadership.leader);
  }
}

/** No cartão do celular, a linha "Liderança" só aparece para quem tem líder (UXD-2, P-HIE-15). */
export function showsLeadershipOnCard(leadership: Leadership): boolean {
  return leadership.kind === "leader" || leadership.kind === "g12_is_leader" || leadership.kind === "chain";
}

/** As colunas da `members_view` que dão a liderança de um membro. */
export interface MemberLeadershipParts {
  g12_level?: number | null;
  is_pastor?: boolean | null;
  leader_name?: string | null;
  g12_name?: string | null;
}

/** A liderança de um membro da `members_view` (P41). */
export function memberLeadership(member: MemberLeadershipParts): Leadership {
  return leadershipOf({
    level: member.g12_level,
    isPastor: member.is_pastor,
    leaderName: member.leader_name,
    g12Name: member.g12_name,
  });
}
