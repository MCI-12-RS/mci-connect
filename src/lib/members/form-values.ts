// Os valores do formulário de membro (E2.04, T1 a T7) e as conversões entre
// eles, o cadastro gravado e o que vai para o banco. Sem React e sem Supabase.
//
// - O formulário mostra o celular e o CPF com a máscara (P23); o celular
//   ilegível aparece como está, e o e-mail fictício nunca aparece (UX-24).
// - Os três interruptores dos dados ministeriais seguem o `leadership.ts`
//   (P20): os valores visíveis ficam nos campos, e o que eles escondem, em
//   `ministry_memory`.

import { leadershipValues, type MinistryFieldsView } from "@/lib/access/member-form";
import { cpfDisplayValue, maskCep, mobileDisplayValue } from "@/lib/masks";
import { changedMemberFields, hasMemberChanges } from "./changes";
import type { MemberFormValues, MemberRow, MemberWriteOptions } from "./fields";
import { isPlaceholderEmail } from "./identifiers";
import { initialMinistrySwitches, setLeader, type LeaderRef, type MinistrySwitches, type MinistrySwitchMemory } from "./leadership";
import type { MemberRuleValues } from "./validation";

/** Sexo no formulário: vazio até a pessoa escolher (RN-03, nenhuma opção marcada no cadastro novo). */
export type GenderChoice = "M" | "F" | "";

/** Os valores do formulário (react-hook-form). Datas em "aaaa-mm-dd". */
export interface MemberFormFields {
  name: string;
  gender: GenderChoice;
  birth_date: string;
  /**
   * O grupo Identificação (RN-08). Não é um campo: existe só para o erro do
   * grupo ter lugar entre os erros do formulário. Nunca é gravado.
   */
  identification: null;
  mobile_whatsapp: string;
  email: string;
  cpf: string;
  phone: string;
  instagram: string;
  notes: string;
  spouse_id: string | null;
  is_pastor: boolean;
  has_leadership: boolean;
  leader_id: string | null;
  /** O nome do líder escolhido, para o aviso do P20. */
  leader_name: string | null;
  is_active: boolean;
  is_baptized: boolean;
  baptism_date: string | null;
  /** O que os interruptores esconderam e devolvem se voltarem (P20). */
  ministry_memory: MinistrySwitchMemory;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
  /** A função escolhida; `null` até a pessoa escolher (vale a inicial de `role_options`). */
  role_id: string | null;
  /** Só no cadastro novo. */
  password: string;
}

/** Os campos dos interruptores e dos valores que eles escondem. */
export type MinistrySwitchFields = Pick<
  MemberFormFields,
  "is_pastor" | "has_leadership" | "leader_id" | "leader_name" | "is_baptized" | "baptism_date" | "ministry_memory"
>;

const text = (value: string | null | undefined): string => value ?? "";

/** O e-mail real gravado; o fictício (de antes do E2.04) conta como vazio (RN-05, UX-24). */
export function realEmail(email: string | null | undefined): string | null {
  return email && !isPlaceholderEmail(email) ? email : null;
}

/** Os campos dos interruptores a partir do estado do `leadership.ts`. */
export function switchFields({ state, memory }: MinistrySwitches): MinistrySwitchFields {
  return {
    is_pastor: state.is_pastor,
    has_leadership: state.has_leadership,
    leader_id: state.leader?.id ?? null,
    leader_name: state.leader?.name ?? null,
    is_baptized: state.is_baptized,
    baptism_date: state.baptism_date,
    ministry_memory: memory,
  };
}

/** O estado do `leadership.ts` a partir dos campos. */
export function switchesOf(fields: MinistrySwitchFields): MinistrySwitches {
  const leader: LeaderRef | null = fields.leader_id ? { id: fields.leader_id, name: fields.leader_name ?? "" } : null;
  return {
    state: {
      is_pastor: fields.is_pastor,
      has_leadership: fields.has_leadership,
      leader,
      is_baptized: fields.is_baptized,
      baptism_date: fields.baptism_date,
    },
    memory: fields.ministry_memory,
  };
}

export interface InitialMemberFormOptions {
  /**
   * O líder com que o cadastro novo abre: quem cadastra, para quem vê só o
   * ministério (E2.02, UXD-3).
   */
  prefilledLeader?: LeaderRef | null;
  /** "Definir líder" (E2.01, T5): "Tem Liderança?" ligado. */
  defineLeader?: boolean;
}

/**
 * Os valores com que o formulário abre:
 * - cadastro novo: vazios, Sexo sem escolha, "Ativo" e "Tem Liderança?" ligados (RN-03, RN-12);
 * - edição: o gravado, com o celular e o CPF na máscara (P23) e sem o e-mail fictício (UX-24).
 */
export function initialMemberFormFields(member: MemberRow | null, options: InitialMemberFormOptions = {}): MemberFormFields {
  let switches = initialMinistrySwitches(
    member
      ? {
          is_pastor: member.is_pastor === true,
          has_leadership: member.has_leadership === true || options.defineLeader === true,
          leader: member.leader_id ? { id: member.leader_id, name: member.leader_name ?? "" } : null,
          is_baptized: member.is_baptized === true,
          baptism_date: member.baptism_date,
        }
      : null,
  );
  if (!member && options.prefilledLeader) switches = setLeader(switches, options.prefilledLeader);
  const gender = member?.gender === "M" || member?.gender === "F" ? member.gender : "";
  return {
    name: text(member?.name),
    gender,
    birth_date: text(member?.birth_date),
    identification: null,
    mobile_whatsapp: mobileDisplayValue(member?.mobile_whatsapp),
    email: text(realEmail(member?.email)),
    cpf: cpfDisplayValue(member?.cpf),
    phone: text(member?.phone),
    instagram: text(member?.instagram),
    notes: text(member?.notes),
    spouse_id: member?.spouse_id ?? null,
    ...switchFields(switches),
    is_active: member ? member.is_active !== false : true,
    street: text(member?.street),
    number: text(member?.number),
    complement: text(member?.complement),
    neighborhood: text(member?.neighborhood),
    city: text(member?.city),
    state: text(member?.state),
    zip_code: maskCep(text(member?.zip_code)),
    role_id: null,
    password: "",
  };
}

/**
 * Os dados ministeriais que vão para o banco:
 * - com os interruptores (igreja toda), o estado visível: o líder e a data do batismo escondidos vão vazios (P20);
 * - sem eles (só o ministério, E2.02), "Tem Liderança?" segue o líder escolhido, e manter não é marcar (PO-UX-7).
 */
function ministryWriteValues(fields: MinistrySwitchFields, view: MinistryFieldsView) {
  const { state } = switchesOf(fields);
  const leadership =
    view.leadership === "switch" && state.is_pastor
      ? { has_leadership: false, leader_id: null }
      : leadershipValues(view, { has_leadership: state.has_leadership, leader_id: state.leader?.id ?? null });
  return {
    is_pastor: state.is_pastor,
    ...leadership,
    is_baptized: state.is_baptized,
    baptism_date: state.is_baptized ? state.baptism_date : null,
  };
}

/**
 * O que o formulário grava (antes da lista branca de `toMemberWritePayload`):
 * os valores da tela, com os interruptores aplicados e a função escolhida.
 */
export function memberWriteValues(fields: MemberFormFields, view: MinistryFieldsView, roleId: string | null): MemberFormValues {
  return {
    name: fields.name,
    gender: fields.gender || null,
    birth_date: fields.birth_date || null,
    mobile_whatsapp: fields.mobile_whatsapp,
    email: fields.email,
    cpf: fields.cpf,
    phone: fields.phone,
    instagram: fields.instagram,
    notes: fields.notes,
    spouse_id: fields.spouse_id,
    is_active: fields.is_active,
    ...ministryWriteValues(fields, view),
    street: fields.street,
    number: fields.number,
    complement: fields.complement,
    neighborhood: fields.neighborhood,
    city: fields.city,
    state: fields.state,
    zip_code: fields.zip_code,
    role_id: roleId,
  };
}

/** O cadastro gravado, para comparar com o formulário (DT-19). O e-mail fictício conta como vazio. */
export function storedMemberValues(member: MemberRow, roleId: string | null): MemberFormValues {
  return {
    name: member.name,
    gender: member.gender,
    birth_date: member.birth_date,
    mobile_whatsapp: member.mobile_whatsapp,
    email: realEmail(member.email),
    cpf: member.cpf,
    phone: member.phone,
    instagram: member.instagram,
    notes: member.notes,
    spouse_id: member.spouse_id,
    is_active: member.is_active,
    is_pastor: member.is_pastor,
    has_leadership: member.has_leadership,
    leader_id: member.leader_id,
    is_baptized: member.is_baptized,
    baptism_date: member.baptism_date,
    street: member.street,
    number: member.number,
    complement: member.complement,
    neighborhood: member.neighborhood,
    city: member.city,
    state: member.state,
    zip_code: member.zip_code,
    role_id: roleId,
  };
}

const textOrNull = (value: string | boolean | null | undefined): string | null => (typeof value === "string" ? value : null);
const flagOrNull = (value: string | boolean | null | undefined): boolean | null => (typeof value === "boolean" ? value : null);

/** Os campos que as regras leem (`validation.ts`), a partir do que vai para o banco. */
export function memberRuleValues(values: MemberFormValues): MemberRuleValues {
  return {
    name: textOrNull(values.name),
    gender: textOrNull(values.gender),
    birth_date: textOrNull(values.birth_date),
    mobile_whatsapp: textOrNull(values.mobile_whatsapp),
    email: textOrNull(values.email),
    cpf: textOrNull(values.cpf),
    spouse_id: textOrNull(values.spouse_id),
    is_pastor: flagOrNull(values.is_pastor),
    has_leadership: flagOrNull(values.has_leadership),
    leader_id: textOrNull(values.leader_id),
    is_baptized: flagOrNull(values.is_baptized),
    baptism_date: textOrNull(values.baptism_date),
  };
}

/** O cadastro gravado como as regras o leem (o e-mail fictício como vazio). */
export function storedRuleValues(member: MemberRow): MemberRuleValues {
  return { ...member, email: realEmail(member.email) };
}

/**
 * Algo mudou desde a abertura (UXD-14, UX-26)? Compara pelo que seria
 * gravado, lido pela regra de cada campo (DT-19): digitar e apagar, ou ligar
 * e desligar um interruptor, não conta. A senha digitada conta.
 */
export function isMemberFormDirty(
  initial: MemberFormFields,
  current: MemberFormFields,
  view: MinistryFieldsView,
  options: MemberWriteOptions,
): boolean {
  if (current.password !== initial.password) return true;
  const before = memberWriteValues(initial, view, initial.role_id);
  const after = memberWriteValues(current, view, current.role_id);
  return hasMemberChanges(changedMemberFields(before, after, options));
}
