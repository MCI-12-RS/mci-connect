// Cadastro de membro novo com o e-mail, o celular ou o CPF de um membro
// excluído (E2.01, RN-18, T9): a leitura das correspondências que a
// `create-user-admin` devolve no 409 e o que a tela mostra com elas.
import { formatDateTimeInBrasilia, formatList } from "@/lib/format";
import { isJsonObject } from "@/lib/errors";
import { DELETED_MATCHES_TEXTS } from "@/lib/deletion/texts";

/** Os dados comparados, na ordem em que aparecem nas frases (e-mail, celular, CPF). */
export const MATCHED_FIELDS = ["email", "mobile", "cpf"] as const;

export type MatchedField = (typeof MATCHED_FIELDS)[number];

const isMatchedField = (value: unknown): value is MatchedField =>
  typeof value === "string" && MATCHED_FIELDS.some((field) => field === value);

/**
 * Um cadastro excluído que combina com o cadastro novo. `memberId`, `name` e
 * `deletedAt` vêm nulos do banco para quem não é administrador e para o
 * excluído fora do escopo do administrador (DA-8).
 */
export interface DeletedMatch {
  memberId: string | null;
  name: string | null;
  deletedAt: string | null;
  matchedFields: MatchedField[];
  /** O e-mail combinou com a conta de acesso do excluído: o cadastro novo não passa. */
  isAccountEmail: boolean;
}

const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

function parseDeletedMatch(value: unknown): DeletedMatch | null {
  if (!isJsonObject(value)) return null;
  const fields = Array.isArray(value.matched_fields) ? value.matched_fields.filter(isMatchedField) : [];
  return {
    memberId: textOrNull(value.member_id),
    name: textOrNull(value.name),
    deletedAt: textOrNull(value.deleted_at),
    // Na ordem das frases, sem repetir.
    matchedFields: MATCHED_FIELDS.filter((field) => fields.includes(field)),
    isAccountEmail: value.is_account_email === true,
  };
}

/** Lê o `matches` da resposta (até 10 itens). Itens fora do formato ficam de fora. */
export function parseDeletedMatches(value: unknown): DeletedMatch[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseDeletedMatch).filter((match): match is DeletedMatch => match !== null);
}

/** Um cadastro que o administrador pode restaurar dali, com o nome e a data. */
export interface RestorableMatch {
  memberId: string;
  name: string;
  /** "Já existe um cadastro excluído com este e-mail: Bruno, excluído em 10/11/2026." */
  message: string;
  /** "Restaurar Bruno" */
  restoreLabel: string;
}

/** Os cadastros sem nome: só o aviso, sem dizer quem é. */
export interface AnonymousMatches {
  /** Com cadastros restauráveis no mesmo aviso, a linha que apresenta estes; sozinhos, o título já diz. */
  heading: string | null;
  text: string;
}

/** O diálogo da T9. */
export interface DeletedMatchesDialogModel {
  title: string;
  restorable: RestorableMatch[];
  anonymous: AnonymousMatches | null;
  /** "Ao restaurar, …": só com cadastros restauráveis. */
  explanation: string | null;
  /** "Para cadastrar outra pessoa, volte e use outro e-mail.": só no caso do e-mail da conta. */
  accountEmailHint: string | null;
  /** "Cadastrar mesmo assim": some no caso do e-mail da conta. */
  canRegisterAnyway: boolean;
}

/** O que a tela faz com as correspondências: o diálogo, ou o erro embaixo do campo E-mail (UXD-9). */
export type DeletedMatchesWarning =
  | { kind: "dialog"; dialog: DeletedMatchesDialogModel }
  | { kind: "emailError"; message: string };

export interface DeletedMatchesOptions {
  /** Quem cadastra tem `manage_roles` (RN-15). */
  isAdmin: boolean;
  /** O servidor recusou pelo e-mail da conta (`deleted_account_email`). */
  accountEmail: boolean;
}

/** "este e-mail", "este celular e este CPF"…; sem dado, "estes dados". */
function fieldsPhrase(fields: readonly MatchedField[]): string {
  if (fields.length === 0) return DELETED_MATCHES_TEXTS.anyField;
  return formatList(fields.map((field) => DELETED_MATCHES_TEXTS.fieldPhrases[field]));
}

/** Os dados que combinaram em algum dos cadastros, na ordem das frases. */
const unionOfFields = (matches: readonly DeletedMatch[]): MatchedField[] =>
  MATCHED_FIELDS.filter((field) => matches.some((match) => match.matchedFields.includes(field)));

/** O cadastro que o administrador vê na lista Excluídos (DA-8): com id e nome. Quem não é administrador nunca vê. */
function restorableMatch(match: DeletedMatch, isAdmin: boolean): RestorableMatch | null {
  const name = match.name?.trim();
  if (!isAdmin || !match.memberId || !name) return null;
  const date = formatDateTimeInBrasilia(match.deletedAt)?.date ?? null;
  return {
    memberId: match.memberId,
    name,
    message: DELETED_MATCHES_TEXTS.adminMatch(fieldsPhrase(match.matchedFields), name, date),
    restoreLabel: DELETED_MATCHES_TEXTS.restore(name),
  };
}

/** O título dos cadastros sem nome: "Há um cadastro excluído com este celular" ou "Há cadastros excluídos com …". */
const anonymousTitle = (matches: readonly DeletedMatch[]): string =>
  DELETED_MATCHES_TEXTS.othersTitle(fieldsPhrase(unionOfFields(matches)), matches.length > 1);

/**
 * Monta o aviso da T9 a partir das correspondências e de quem cadastra.
 *
 * - O administrador vê cada cadastro que ele veria na lista Excluídos, com o
 *   nome, a data e "Restaurar {Nome}". Os demais aparecem como para quem não é
 *   administrador, sem nome (DA-8).
 * - O e-mail da conta de um excluído nunca deixa seguir ("Cadastrar mesmo
 *   assim" some). Quando quem cadastra não pode restaurar esse cadastro, ele
 *   vira um erro embaixo do campo E-mail, sem diálogo, e os outros avisos
 *   ficam para o próximo "Criar membro" (T9, "Vários avisos").
 */
export function deletedMatchesWarning(
  matches: readonly DeletedMatch[],
  { isAdmin, accountEmail }: DeletedMatchesOptions,
): DeletedMatchesWarning {
  const isAccountEmail = accountEmail || matches.some((match) => match.isAccountEmail);
  const visible = matches.flatMap((match) => {
    const restorable = restorableMatch(match, isAdmin);
    return restorable ? [restorable] : [];
  });

  if (isAccountEmail) {
    const accountMatch = matches.find((match) => match.isAccountEmail);
    if (!accountMatch || !restorableMatch(accountMatch, isAdmin)) {
      return { kind: "emailError", message: DELETED_MATCHES_TEXTS.accountEmailError };
    }
    // Sem "Cadastrar mesmo assim", os cadastros sem nome não têm o que oferecer: aparecem depois de trocar o e-mail.
    return {
      kind: "dialog",
      dialog: {
        title: DELETED_MATCHES_TEXTS.adminTitle(visible.length),
        restorable: visible,
        anonymous: null,
        explanation: DELETED_MATCHES_TEXTS.explanation,
        accountEmailHint: DELETED_MATCHES_TEXTS.accountEmailHint,
        canRegisterAnyway: false,
      },
    };
  }

  const hidden = matches.filter((match) => !restorableMatch(match, isAdmin));
  const anonymousCount = matches.length === 0 ? 1 : hidden.length;
  const hiddenTitle = anonymousTitle(hidden);
  const hasVisible = visible.length > 0;

  return {
    kind: "dialog",
    dialog: {
      title: hasVisible ? DELETED_MATCHES_TEXTS.adminTitle(visible.length + hidden.length) : hiddenTitle,
      restorable: visible,
      anonymous:
        anonymousCount > 0 && (hidden.length > 0 || !hasVisible)
          ? { heading: hasVisible ? hiddenTitle : null, text: DELETED_MATCHES_TEXTS.othersText }
          : null,
      explanation: hasVisible ? DELETED_MATCHES_TEXTS.explanation : null,
      accountEmailHint: null,
      canRegisterAnyway: true,
    },
  };
}

/** Os dois 409 da `create-user-admin` com correspondências (DT-18). */
const DELETED_MATCHES_CODE = "deleted_matches";
const DELETED_ACCOUNT_EMAIL_CODE = "deleted_account_email";

/** A recusa da `create-user-admin`, lida do corpo da resposta de erro. */
export type CreateMemberRefusal =
  /** Há cadastro excluído com os dados: o aviso da T9 (ou o erro no campo E-mail). */
  | { kind: "deletedMatches"; matches: DeletedMatch[]; accountEmail: boolean }
  /** Qualquer outra recusa: a mensagem pronta do servidor e, se houver, o código e o campo. */
  | { kind: "message"; message: string; code: string | null; field: string | null };

/**
 * Lê o corpo `{ error, code?, field?, matches? }` de uma resposta de erro da
 * `create-user-admin`. `null` se o corpo não tiver a mensagem (`error`).
 *
 * O `deleted_account_email` também vem do banco, sem `matches`, quando o
 * cadastro escapou da conferência da função: vira o mesmo erro no campo.
 */
export function parseCreateMemberRefusal(body: unknown): CreateMemberRefusal | null {
  if (!isJsonObject(body) || typeof body.error !== "string") return null;
  if (body.code === DELETED_MATCHES_CODE || body.code === DELETED_ACCOUNT_EMAIL_CODE) {
    return {
      kind: "deletedMatches",
      matches: parseDeletedMatches(body.matches),
      accountEmail: body.code === DELETED_ACCOUNT_EMAIL_CODE,
    };
  }
  return {
    kind: "message",
    message: body.error,
    code: typeof body.code === "string" ? body.code : null,
    field: typeof body.field === "string" ? body.field : null,
  };
}
