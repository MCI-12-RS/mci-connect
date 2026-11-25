// Leitura do corpo da create-user-admin (E2.04, "Fluxo da `create-user-admin`",
// passo 3). Código puro: sem imports de URL nem globais do Deno, para ser
// testado com Vitest (lib/request.test.ts).
import { invalidRequest, isRecord } from './errors.ts'

/**
 * Colunas de `members` que podem vir do formulário. As demais são controladas
 * pelo servidor: `id` e `auth_user_id` são o `attemptId` (DT-01, DT-11), e
 * as datas são do banco. Nível, cadeia, G12 e totais não são colunas de
 * `members`: ficam em `private.member_hierarchy`, calculados pelo banco (E2.06).
 */
export const MEMBER_FIELDS = [
  'name', 'email', 'cpf', 'gender', 'birth_date', 'mobile_whatsapp', 'phone', 'notes',
  'instagram', 'avatar_url', 'is_pastor', 'has_leadership', 'leader_id', 'spouse_id',
  'is_baptized', 'baptism_date', 'is_active', 'street', 'number', 'complement',
  'neighborhood', 'city', 'state', 'zip_code', 'role_id',
] as const

// UUID v4, o formato que o Auth aceita como id de conta.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** O pedido já conferido. */
export interface CreateMemberRequest {
  /** Id do membro e da conta. Gerado aqui quando o corpo não traz (sem idempotência). */
  attemptId: string
  /** O corpo trouxe o `attemptId` (a tentativa pode ser repetida). */
  attemptIdFromClient: boolean
  password: string
  /** Linha de `members`, só com as colunas de MEMBER_FIELDS, sem `id` nem `auth_user_id`. */
  memberRow: Record<string, unknown>
  confirmDeletedMatches: boolean
}

/**
 * Confere o corpo: `{ attemptId?, password, memberData, confirmDeletedMatches? }`.
 *
 * - `attemptId` ausente (ou nulo) → gerado com `newId`; presente e fora do UUID v4 → `invalid_request`;
 * - `memberData` precisa ser um objeto; as colunas fora da lista branca são descartadas;
 * - o e-mail vem só de `memberData.email`, como veio: o banco normaliza e recusa o
 *   fictício (`email_placeholder`). Um `email` no topo do corpo é ignorado;
 * - `has_leadership` vai só se veio (o banco resolve a omitida, DT-06);
 * - `role_id` vazio vira nulo (sem pedido de função: o banco usa a padrão).
 *
 * As regras do cadastro (nome, sexo, identificação…) ficam no banco: o ensaio
 * devolve a recusa com o campo.
 */
export function parseCreateMemberRequest(raw: unknown, newId: () => string): CreateMemberRequest {
  if (!isRecord(raw)) throw invalidRequest()

  const rawAttempt = raw.attemptId
  const attemptIdFromClient = rawAttempt !== undefined && rawAttempt !== null
  let attemptId: string
  if (!attemptIdFromClient) {
    attemptId = newId().toLowerCase()
  } else if (typeof rawAttempt === 'string' && UUID_V4.test(rawAttempt)) {
    attemptId = rawAttempt.toLowerCase()
  } else {
    throw invalidRequest()
  }

  const memberData = raw.memberData
  if (!isRecord(memberData)) throw invalidRequest()

  if (typeof raw.password !== 'string' || raw.password === '') {
    throw invalidRequest('Informe a senha.')
  }

  const memberRow: Record<string, unknown> = {}
  for (const field of MEMBER_FIELDS) {
    if (field in memberData) memberRow[field] = memberData[field]
  }
  if (memberRow.role_id === '') memberRow.role_id = null

  return {
    attemptId,
    attemptIdFromClient,
    password: raw.password,
    memberRow,
    confirmDeletedMatches: raw.confirmDeletedMatches === true,
  }
}
