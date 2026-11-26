// Autoria no registro aberto (E2.05, T1 e P30; RN-07 a RN-11): quem cadastrou (ou enviou) e quem
// alterou por último, montado aqui, sem React nem Supabase, e testado por tabela (UX-01).
// A regra de quando há alteração é do servidor (RN-04 d, RN-10 c, RN-12): a tela não compara datas.

import type { Enums } from "@/integrations/supabase/types";
import { formatSpDateTime } from "@/lib/dates/sao-paulo";
import { AUTHORSHIP_TEXTS as TEXTS } from "@/lib/audit/texts";

export type AuthorKind = Enums<"author_kind">;

/** Os registros com autoria na tela (P30). */
export type AuthorshipEntity = "member" | "cell" | "cell_report";

/** As colunas de autoria das views (`members_view`, `cells_view`, `cell_reports_view`; AQ-1). */
export interface Authorship {
  created_at: string | null;
  created_by_kind: AuthorKind | null;
  created_by_name: string | null;
  updated_at: string | null;
  updated_by_kind: AuthorKind | null;
  updated_by_name: string | null;
}

/** As colunas que a tela pede à view para montar o bloco. */
export const AUTHORSHIP_SELECT = "created_at, created_by_kind, created_by_name, updated_at, updated_by_kind, updated_by_name";

/** O nome do legado como a tela mostra: "AdminUser" vira "Administrador" (RN-10 b), mesmo que a view não troque. */
function legacyName(name: string): string {
  return name === "AdminUser" ? TEXTS.legacyAdmin : name;
}

/**
 * O autor como a tela mostra (RN-08 a RN-11): o nome do membro, "Sistema", "{Nome} (sistema anterior)",
 * ou `null` para "autor não registrado". Sem tipo (gravação em `replica`, DT-23), vale o nome, se houver.
 */
export function authorLabel(kind: AuthorKind | null | undefined, name: string | null | undefined): string | null {
  const trimmed = name?.trim() || null;
  switch (kind) {
    case "system":
      return TEXTS.system;
    case "legacy":
      return trimmed ? TEXTS.legacy(legacyName(trimmed)) : null;
    case "unknown":
      return null;
    default:
      return trimmed;
  }
}

/** Uma frase do bloco, com o autor separado para a tela destacá-lo (P30: o nome em `font-medium`). */
export interface AuthorshipLine {
  kind: "created" | "updated";
  /** "Cadastrado por " ou, sem autor, a frase inteira. */
  before: string;
  /** O autor; `null` sem autor. */
  author: string | null;
  /** O que vem depois do autor (" em 18/11/2026 às 19:40", as marcas). */
  after: string;
  /** A frase inteira, para os testes e para quem lê o texto corrido. */
  text: string;
}

function line(
  kind: AuthorshipLine["kind"],
  verb: string,
  author: string | null,
  instant: string | null,
): AuthorshipLine {
  const when = formatSpDateTime(instant);
  const at = when ? TEXTS.at(when.date, when.time) : "";
  const marks = `${author ? "" : TEXTS.authorNotRecorded}${when ? "" : TEXTS.dateNotRecorded}`;
  if (!author) {
    const text = `${verb}${at}${marks}`;
    return { kind, before: text, author: null, after: "", text };
  }
  const before = `${verb}${TEXTS.by("")}`;
  const after = `${at}${marks}`;
  return { kind, before, author, after, text: `${before}${author}${after}` };
}

/**
 * As frases do bloco (T1): "Cadastrado por {Autor} em {data} às {hora}" e, só quando o registro foi
 * alterado, "Alterado por …". O verbo vem da entidade (RN-07, P-AUD-18); a data e a hora são as de
 * Brasília (UX-02); sem autor, "· autor não registrado"; sem data, "· data não registrada".
 */
export function authorshipLines(entity: AuthorshipEntity, authorship: Authorship): AuthorshipLine[] {
  const verbs = TEXTS.verbs[entity];
  const lines = [
    line("created", verbs.created, authorLabel(authorship.created_by_kind, authorship.created_by_name), authorship.created_at),
  ];
  if (authorship.updated_at !== null || authorship.updated_by_kind !== null) {
    lines.push(
      line("updated", verbs.updated, authorLabel(authorship.updated_by_kind ?? "unknown", authorship.updated_by_name), authorship.updated_at),
    );
  }
  return lines;
}

/** O destino de "Ver histórico" (P31, RN-19): a Auditoria filtrada pelo registro. */
export function recordHistoryPath(entity: AuthorshipEntity, recordId: string): string {
  const params = new URLSearchParams({ record_type: entity, record_id: recordId });
  return `/events?${params.toString()}`;
}
