// O que o formulário de membro (T6) mostra conforme o acesso de quem edita e o
// cadastro aberto (E2.02, RN-09, RN-10, RN-11, RN-18, RN-19, UXD-1, UXD-3,
// UXD-12, P12), e como ele lê as recusas do servidor (T11). Sem React e sem
// Supabase.
//
// Tudo aqui só mostra, esconde ou adianta uma validação: quem decide é o banco
// (triggers de `members`, `check_member_insert` e `role_options`).

import { isPermissionDenied, isJsonObject, parseAppError, type AppError } from "@/lib/errors";
import { refusalField } from "./codes";
import {
  isMemberRuleCode,
  memberRefusalFromCheckViolation,
  memberRefusalMessages,
  valueInUseFromUniqueViolation,
} from "@/lib/members/codes";
import type { MemberFormErrorField } from "@/lib/members/form-errors";
import { ACCESS_TEXTS, MEMBER_FORM_TEXTS, MENU_TEXTS } from "./texts";
import { SAVE_TEXTS } from "@/lib/hierarchy/texts";
import { isPasswordPolicyCode } from "@/lib/auth/password-policy";
import { initialPasswordErrorMessage } from "@/lib/auth/password-texts";

// --- `role_options` (AQ-3) ---

export interface RoleRef {
  id: string;
  name: string;
}

export interface RoleChoice extends RoleRef {
  is_default: boolean;
}

export const ROLE_OPTIONS_REASONS = ["self", "role_above", "no_permission", "not_found"] as const;

export type RoleOptionsReason = (typeof ROLE_OPTIONS_REASONS)[number];

/** O retorno de `role_options(_member_id?)`, já conferido. */
export interface RoleOptions {
  current: RoleRef | null;
  editable: boolean;
  reason: RoleOptionsReason | null;
  options: RoleChoice[];
  default_role: RoleRef | null;
}

function isRoleRef(value: unknown): value is RoleRef {
  return isJsonObject(value) && typeof value.id === "string" && typeof value.name === "string";
}

function isRoleChoice(value: unknown): value is RoleChoice {
  return isRoleRef(value) && isJsonObject(value) && typeof value.is_default === "boolean";
}

function isReason(value: unknown): value is RoleOptionsReason {
  return typeof value === "string" && ROLE_OPTIONS_REASONS.some((reason) => reason === value);
}

/**
 * Lê o JSON de `role_options`. `null` se faltar o essencial (`editable` e a
 * lista de opções). Opções fora do formato ficam de fora.
 */
export function parseRoleOptions(value: unknown): RoleOptions | null {
  if (!isJsonObject(value) || typeof value.editable !== "boolean" || !Array.isArray(value.options)) return null;
  return {
    current: isRoleRef(value.current) ? { id: value.current.id, name: value.current.name } : null,
    editable: value.editable,
    reason: isReason(value.reason) ? value.reason : null,
    options: value.options.filter(isRoleChoice).map(({ id, name, is_default }) => ({ id, name, is_default })),
    default_role: isRoleRef(value.default_role) ? { id: value.default_role.id, name: value.default_role.name } : null,
  };
}

// --- Campo Função (RN-18, RN-19, UXD-1, UXD-12, UX-21) ---

export interface RoleFieldInput {
  /** Cadastro novo. */
  isNew: boolean;
  /** O cadastro aberto é o de quem edita (inclui "Meus dados"). */
  isSelf: boolean;
  /** `my_access().can_assign_roles`. */
  canAssignRoles: boolean;
  /** `my_access().role_name`: a própria função, que a pessoa sempre vê (RN-23). */
  ownRoleName: string | null;
  /** `role_options`, quando já lido. */
  options?: RoleOptions | null;
}

export interface RoleSelectOption {
  value: string;
  label: string;
}

export type RoleFieldView =
  /** O campo não aparece (edição de outra pessoa por quem não atribui funções, UXD-12). */
  | { kind: "hidden" }
  /** Esperando `role_options`. */
  | { kind: "pending" }
  /** O seletor, só com as funções que quem edita pode atribuir; a padrão leva "(padrão)". */
  | { kind: "select"; options: RoleSelectOption[]; initialValue: string | null }
  /** Valor como texto (P12): rótulo, valor e o motivo ou a dica. */
  | { kind: "text"; value: string; note: string };

/**
 * O campo Função precisa de `role_options`? No próprio cadastro a função vem
 * do acesso, e na edição de outra pessoa por quem não atribui funções o campo
 * nem aparece: nos dois casos, nenhuma leitura.
 */
export function needsRoleOptions({ isNew, isSelf, canAssignRoles }: RoleFieldInput): boolean {
  if (isNew) return true;
  return !isSelf && canAssignRoles;
}

const roleLabel = (role: RoleChoice): string => (role.is_default ? MEMBER_FORM_TEXTS.defaultRole(role.name) : role.name);

/** O que o campo Função mostra (T6, UX-21). */
export function roleFieldView(input: RoleFieldInput): RoleFieldView {
  if (!input.isNew && input.isSelf) {
    return { kind: "text", value: input.ownRoleName ?? MENU_TEXTS.noRole, note: MEMBER_FORM_TEXTS.ownRole };
  }
  if (!needsRoleOptions(input)) return { kind: "hidden" };

  const options = input.options;
  if (!options) return { kind: "pending" };

  if (options.editable) {
    const choices = options.options.map((role) => ({ value: role.id, label: roleLabel(role) }));
    const wanted = input.isNew ? options.default_role?.id : options.current?.id;
    const initialValue = choices.some((choice) => choice.value === wanted) ? (wanted ?? null) : null;
    return { kind: "select", options: choices, initialValue };
  }

  switch (options.reason) {
    case "self":
      return {
        kind: "text",
        value: options.current?.name ?? MENU_TEXTS.noRole,
        note: MEMBER_FORM_TEXTS.ownRole,
      };
    case "role_above":
      return {
        kind: "text",
        value: options.current?.name ?? MENU_TEXTS.noRole,
        note: MEMBER_FORM_TEXTS.roleChangeNotAllowed,
      };
    case "no_permission":
      // Cadastro novo por quem não atribui funções: recebe a padrão (RN-19).
      return input.isNew && options.default_role
        ? {
            kind: "text",
            value: MEMBER_FORM_TEXTS.defaultRole(options.default_role.name),
            note: MEMBER_FORM_TEXTS.defaultRoleHint,
          }
        : { kind: "hidden" };
    default:
      return { kind: "hidden" };
  }
}

// --- Dados ministeriais (RN-10, UXD-1, UXD-3, P12, UX-17 a UX-19) ---

export interface MinistryFieldsInput {
  /** `my_access().sees_whole_church`. */
  seesWholeChurch: boolean;
  isNew: boolean;
  /** O cadastro como abriu (edição). */
  saved?: { is_pastor: boolean | null; leader_id: string | null } | null;
}

export interface MinistryFieldsView {
  /** "É Pastor(a)?": interruptor (igreja toda), texto com o motivo (pastor, para os demais) ou nada. */
  pastor: "switch" | "text" | "hidden";
  /** "Tem Liderança?": interruptor (igreja toda), "Sem liderança" como texto ou nada. */
  leadership: "switch" | "text" | "hidden";
  /**
   * Campo Líder:
   * - "toggle": aparece com "Tem Liderança?" ligado, opcional (como antes, igreja toda);
   * - "required": sempre visível, "Líder *", validado no envio;
   * - "optional": visível e opcional (quem já está sem liderança, PO-UX-7);
   * - "hidden": não aparece (pastor, para quem não vê a igreja toda; DA-2).
   */
  leader: "toggle" | "required" | "optional" | "hidden";
  /** Dica embaixo do Líder (P11), ligada por `aria-describedby`. */
  leaderHint: string | null;
  /** Dica embaixo do Cônjuge (P11). */
  spouseHint: string | null;
}

/** Os dados ministeriais do formulário, para quem tem "Editar Membro". */
export function ministryFieldsView({ seesWholeChurch, isNew, saved }: MinistryFieldsInput): MinistryFieldsView {
  if (seesWholeChurch) {
    return { pastor: "switch", leadership: "switch", leader: "toggle", leaderHint: null, spouseHint: null };
  }
  const spouseHint = MEMBER_FORM_TEXTS.spouseHint;
  if (!isNew && saved?.is_pastor) {
    return { pastor: "text", leadership: "hidden", leader: "hidden", leaderHint: null, spouseHint };
  }
  if (!isNew && !saved?.leader_id) {
    return { pastor: "hidden", leadership: "text", leader: "optional", leaderHint: null, spouseHint };
  }
  return { pastor: "hidden", leadership: "hidden", leader: "required", leaderHint: MEMBER_FORM_TEXTS.leaderHint, spouseHint };
}

/** Quem cadastra, para o líder já preenchido (E2.07, RN-16). */
export interface PrefillViewer {
  /** `my_access().member_id`: sem cadastro de membro (a conta X do E2.02), nada é preenchido. */
  memberId: string | null;
  /** O nome do próprio cadastro (`AuthContext`). */
  memberName: string | null;
  /** `my_access().sees_whole_church`. */
  seesWholeChurch: boolean;
}

/**
 * O líder com que o cadastro novo abre: quem cadastra, para todos que têm cadastro de membro (E2.07,
 * RN-16; MEM-15), inclusive quem vê a igreja toda. Só um valor inicial na tela: pela API, nada é
 * preenchido (DT-13). Na edição, o líder é o gravado.
 */
export function initialLeader(viewer: PrefillViewer, isNew: boolean): { id: string; name: string } | null {
  if (!isNew || !viewer.memberId) return null;
  return { id: viewer.memberId, name: viewer.memberName ?? "" };
}

/**
 * O aviso "O líder já vem preenchido com você." (E2.07, P55, UXD-11): só no cadastro novo de quem vê
 * a igreja toda, enquanto o Líder é a própria pessoa e está à vista ("Tem Liderança?" ligado e
 * "É Pastor(a)?" desligado). Volta se o Líder voltar a ser ela.
 */
export function showPrefilledLeaderNotice(
  viewer: PrefillViewer,
  isNew: boolean,
  form: { is_pastor: boolean; has_leadership: boolean; leader_id: string | null },
): boolean {
  if (!isNew || !viewer.seesWholeChurch || !viewer.memberId) return false;
  return !form.is_pastor && form.has_leadership && form.leader_id === viewer.memberId;
}

/**
 * "Tem Liderança?" e o líder que vão para o banco:
 * - com o interruptor (igreja toda), desligado apaga o líder. Sem isso, o
 *   banco religaria a marca pelo líder que ficou (DA-11);
 * - sem o interruptor, a marca segue o líder escolhido, e "manter não é
 *   marcar": sem líder, fica como estava (PO-UX-7).
 */
export function leadershipValues(
  view: MinistryFieldsView,
  form: { has_leadership?: boolean | null; leader_id?: string | null },
): { has_leadership: boolean; leader_id: string | null } {
  const leaderId = form.leader_id ?? null;
  if (view.leadership === "switch") {
    const hasLeadership = form.has_leadership === true;
    return { has_leadership: hasLeadership, leader_id: hasLeadership ? leaderId : null };
  }
  return { has_leadership: leaderId ? true : form.has_leadership === true, leader_id: leaderId };
}

// --- Recusas do servidor (T11 do E2.02; T5 e AQ-1 do E2.04) ---

export interface MemberFormRefusal {
  message: string;
  /**
   * Os campos em que a recusa aparece, cada um com a sua mensagem (E2.04,
   * T5): embaixo do campo, no resumo e com o foco. Vazio: no `Alert` do topo.
   */
  fields: Partial<Record<MemberFormErrorField, string>>;
  /** A tela relê o acesso (P13): no 42501 e na RN-10 do E2.02. */
  rereadAccess: boolean;
}

const ROLE_REFUSALS: ReadonlySet<string> = new Set(["own_role", "role_change_not_allowed", "role_not_assignable"]);

function personField(field: string | null): "leader_id" | "spouse_id" | null {
  return field === "leader_id" || field === "spouse_id" ? field : null;
}

/**
 * A recusa de regra, pelo código:
 * - função (RN-18 do E2.02): embaixo do campo Função;
 * - pessoa fora do que se vê (RN-09 b do E2.02): embaixo do Líder ou do Cônjuge, quando o servidor diz qual;
 * - RN-10 do E2.02: no topo, e a tela relê o acesso;
 * - as regras do E2.04: no campo que o servidor aponta (`field` ou `fields`), cada um com a sua mensagem;
 * - as demais (RN-09 c, RN-11, RN-19 do E2.02, E2.01): no topo.
 */
function ruleRefusal(error: AppError): MemberFormRefusal {
  const { code, message } = error;
  if (ROLE_REFUSALS.has(code)) return { message, fields: { role_id: message }, rereadAccess: false };
  if (code === "person_not_visible") {
    const field = personField(refusalField(error));
    return { message, fields: field ? { [field]: message } : {}, rereadAccess: false };
  }
  if (isMemberRuleCode(code)) return { message, fields: memberRefusalMessages(error), rereadAccess: false };
  return { message, fields: {}, rereadAccess: code === "pastor_or_no_leadership_requires_church" };
}

const permissionRefusal = (): MemberFormRefusal => ({
  message: ACCESS_TEXTS.permissionDenied,
  fields: {},
  rereadAccess: true,
});

/**
 * A recusa de uma gravação em `members` (PostgREST). `null` para o que não é
 * recusa (rede, 40P01, erro técnico): a tela usa o aviso genérico dela.
 * O `23505` e o `23514` crus viram a recusa que o trigger daria (E2.04,
 * "Formato dos erros"), sem o texto técnico.
 */
export function memberRefusalFromError(error: unknown): MemberFormRefusal | null {
  if (isPermissionDenied(error)) return permissionRefusal();
  const appError = parseAppError(error) ?? valueInUseFromUniqueViolation(error) ?? memberRefusalFromCheckViolation(error);
  return appError ? ruleRefusal(appError) : null;
}

/**
 * Por que a gravação falhou sem recusa: queda de conexão (E2.04, T7), falha no
 * recálculo da hierarquia ou falha transitória (E2.06, RN-08 e AQ-5), ou outro
 * erro técnico.
 */
export type MemberSaveFailureCause = "network" | "recalc" | "other";

/**
 * O aviso de uma gravação que falhou sem recusa: só "tente de novo", nunca o
 * texto técnico (UX-30 do E2.04, UX-19 do E2.06). O erro que a tela não
 * reconhece (inclusive a falha da Auditoria, que não tem código próprio) é a
 * mensagem de conexão (E2.05, T5, RN-14 e AQ-8).
 */
export function memberSaveFailureMessage(cause: MemberSaveFailureCause): string {
  switch (cause) {
    case "network":
    case "other":
      return MEMBER_FORM_TEXTS.saveNetworkError;
    case "recalc":
      return SAVE_TEXTS.recalcFailed;
  }
}

/** Códigos da `create-user-admin` que não são recusa de regra: o aviso genérico. */
const CREATE_TECHNICAL_CODES: ReadonlySet<string> = new Set(["unauthenticated", "server_error", "invalid_request"]);

/** Uma recusa da `create-user-admin` (`{ error, code, field, fields }`). */
export interface CreateRefusalBody {
  message: string;
  code: string | null;
  field: string | null;
  fields?: readonly string[];
}

/**
 * A recusa da `create-user-admin`: 403 (`forbidden`) é a falta de permissão;
 * os demais códigos vêm das regras do banco, pelo ensaio
 * (`check_member_insert`). A senha inicial fora da política (E2.03, AQ-8) vai
 * para o campo, com o texto sobre o membro. Sem código, ou com um código
 * técnico, `null`.
 */
export function memberRefusalFromCreate(refusal: CreateRefusalBody): MemberFormRefusal | null {
  if (refusal.code === "forbidden") return permissionRefusal();
  if (isPasswordPolicyCode(refusal.code)) {
    const message = initialPasswordErrorMessage(refusal.code);
    return { message, fields: { password: message }, rereadAccess: false };
  }
  if (!refusal.code || CREATE_TECHNICAL_CODES.has(refusal.code)) return null;
  const detail = { code: refusal.code, field: refusal.field, fields: refusal.fields ? [...refusal.fields] : undefined };
  return ruleRefusal({ code: refusal.code, message: refusal.message, detail });
}
