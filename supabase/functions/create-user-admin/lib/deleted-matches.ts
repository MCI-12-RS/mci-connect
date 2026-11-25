// Aviso de cadastro com dados de um membro excluído (RN-18 e DT-18 do E2.01).
// Código puro: sem imports de URL nem globais do Deno, para ser testado com
// Vitest (lib/deleted-matches.test.ts).
import { HttpError, isRecord } from './errors.ts'

/** Texto do PO (RN-18): o e-mail da conta de um excluído, sem como seguir. */
export const DELETED_ACCOUNT_EMAIL_MESSAGE =
  'Este e-mail pertence a um cadastro excluído. Peça a um administrador para restaurá-lo ou use outro e-mail.'

/**
 * Texto derivado (não está no spec): reserva para o front que ainda não trata o
 * `code: "deleted_matches"` (janela entre o "Deploy: banco" e o promote do PR 5).
 * O front novo monta o aviso a partir de `matches`.
 */
export const DELETED_MATCHES_MESSAGE =
  'Há um cadastro excluído com estes dados. Se for a mesma pessoa, peça a um administrador para restaurá-lo. ' +
  'Se for outra pessoa, você pode cadastrar mesmo assim.'

/** Uma linha de `find_deleted_member_matches`. Nome, id e data vêm nulos para quem não pode vê-los (DA-8). */
export interface DeletedMemberMatch {
  member_id: string | null
  name: string | null
  deleted_at: string | null
  matched_fields: string[]
  is_account_email: boolean
}

/** Parâmetros de `find_deleted_member_matches`. */
export interface DeletedMatchesParams {
  _email: string | null
  _mobile: string | null
  _cpf: string | null
}

// O banco normaliza (normalize_email, normalize_digits); aqui só se descarta o
// que não é texto. Um número vira texto, como o PostgREST faria no INSERT.
function asText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/**
 * Parâmetros da consulta, tirados da linha que vai para `members`: o e-mail, o
 * celular (`mobile_whatsapp`) e o CPF, como vieram.
 *
 * O e-mail fictício (`placeholder_email_domains()`, DT-18 do E2.04) não é
 * filtrado aqui: a consulta só roda depois do ensaio (`check_member_insert`),
 * que recusa esse domínio (RN-05), e o cadastro não o guarda mais (DA-1, DT-01).
 * A lista de domínios fica só no banco e na tabela de casos do front.
 */
export function deletedMatchesParams(memberRow: Readonly<Record<string, unknown>>): DeletedMatchesParams {
  const email = asText(memberRow.email)
  return {
    _email: email || null,
    _mobile: asText(memberRow.mobile_whatsapp),
    _cpf: asText(memberRow.cpf),
  }
}

function isDeletedMemberMatch(value: unknown): value is DeletedMemberMatch {
  if (!isRecord(value)) return false
  const nullableText = (v: unknown) => v === null || typeof v === 'string'
  return nullableText(value.member_id)
    && nullableText(value.name)
    && nullableText(value.deleted_at)
    && Array.isArray(value.matched_fields)
    && value.matched_fields.every((f) => typeof f === 'string')
    && typeof value.is_account_email === 'boolean'
}

/**
 * Confere o formato do resultado da RPC. Um formato inesperado é erro do
 * servidor (a RPC mudou), e não "nenhuma correspondência".
 */
export function toDeletedMatches(data: unknown): DeletedMemberMatch[] {
  if (data === null || data === undefined) return []
  if (!Array.isArray(data) || !data.every(isDeletedMemberMatch)) {
    throw new Error('find_deleted_member_matches: resposta em formato inesperado')
  }
  return data
}

/**
 * A decisão do aviso, antes de criar a conta de acesso:
 * - o e-mail da conta de um excluído → 409 `deleted_account_email`, mesmo com a
 *   confirmação (a conta do excluído ainda tem o e-mail, RN-14);
 * - outra correspondência sem a confirmação → 409 `deleted_matches`;
 * - nenhuma, ou confirmada ("Cadastrar mesmo assim") → `null`, e o cadastro segue.
 *
 * `matches` vai na resposta como a RPC devolveu, na mesma ordem.
 */
export function deletedMatchesRefusal(matches: readonly DeletedMemberMatch[], confirmed: boolean): HttpError | null {
  if (matches.some((match) => match.is_account_email)) {
    return new HttpError(409, DELETED_ACCOUNT_EMAIL_MESSAGE, 'deleted_account_email', { field: 'email', matches })
  }
  if (matches.length > 0 && !confirmed) {
    return new HttpError(409, DELETED_MATCHES_MESSAGE, 'deleted_matches', { matches })
  }
  return null
}

/** A recusa do ensaio ou do INSERT é a do e-mail da conta de um excluído? */
export function isDeletedAccountEmailRefusal(refusal: HttpError): boolean {
  return refusal.code === 'deleted_account_email'
}

/**
 * E2.04: o trigger recusa o e-mail da conta de um excluído no fim das regras
 * (depois de `value_in_use` e das demais, RN-10), então essa recusa chega pelo
 * ensaio, antes do passo do aviso. Para manter o aviso do E2.01 (RN-18, UX-31),
 * que nomeia o excluído e oferece "Restaurar" ao administrador, a resposta
 * leva as correspondências de `find_deleted_member_matches`, como
 * `deletedMatchesRefusal`.
 * - Outra recusa: segue como está (não é deste aviso).
 * - Sem a linha `is_account_email` (por exemplo, o excluído foi restaurado
 *   entre a recusa e a consulta) ou sem a consulta (`null`, ela falhou): a
 *   recusa do banco, só com `field`. Nunca libera o cadastro.
 */
export function deletedAccountEmailWithMatches(
  refusal: HttpError,
  matches: readonly DeletedMemberMatch[] | null,
): HttpError {
  if (!isDeletedAccountEmailRefusal(refusal) || matches === null) return refusal
  if (!matches.some((match) => match.is_account_email)) return refusal
  return deletedMatchesRefusal(matches, false) ?? refusal
}
