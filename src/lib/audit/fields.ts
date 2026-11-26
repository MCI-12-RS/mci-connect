// Os campos de dados na Auditoria (E2.05, "Rótulos dos campos na Auditoria"; RN-20, P32): o rótulo
// da tela, se o valor aparece (antes → depois) e como formatá-lo. A lista é a mesma de
// `private.audit_fields` e de supabase/tests/fixtures/audit-fields.json (DT-06): um teste quebra
// se as chaves, a ordem ou o "mostra valor" divergirem.

import { formatCurrency } from "@/lib/format";
import { formatIsoDateBr } from "@/lib/dates/sao-paulo";
import { AUDIT_TEXTS } from "@/lib/audit/texts";

/** As entidades com campos de dados na Auditoria. */
export type AuditFieldEntity = "member" | "cell" | "cell_report" | "role";

/** O tipo do valor gravado em `changes.fields[].from/to` (o `value_type` da lista). */
export type AuditValueType = "text" | "date" | "time" | "number" | "boolean" | "member" | "role" | "cell" | "text_list";

export interface AuditFieldInfo {
  field: string;
  label: string;
  showValues: boolean;
  valueType: AuditValueType;
}

const f = (field: string, label: string, showValues: boolean, valueType: AuditValueType): AuditFieldInfo => ({
  field,
  label,
  showValues,
  valueType,
});

/** Na ordem da lista (é a ordem do painel, P32). */
export const AUDIT_FIELDS: Record<AuditFieldEntity, readonly AuditFieldInfo[]> = {
  member: [
    f("name", "Nome", true, "text"),
    f("gender", "Sexo", true, "text"),
    f("birth_date", "Data de nascimento", false, "date"),
    f("cpf", "CPF", false, "text"),
    f("email", "E-mail", false, "text"),
    f("mobile_whatsapp", "Celular/WhatsApp", false, "text"),
    f("phone", "Telefone", false, "text"),
    f("instagram", "Instagram", false, "text"),
    f("avatar_url", "Foto", false, "text"),
    f("notes", "Observações", false, "text"),
    f("zip_code", "CEP", false, "text"),
    f("street", "Rua", false, "text"),
    f("number", "Número", false, "text"),
    f("complement", "Complemento", false, "text"),
    f("neighborhood", "Bairro", false, "text"),
    f("city", "Cidade", false, "text"),
    f("state", "Estado", false, "text"),
    f("leader_id", "Líder", true, "member"),
    f("has_leadership", "Tem Liderança?", true, "boolean"),
    f("is_pastor", "É Pastor(a)?", true, "boolean"),
    f("spouse_id", "Cônjuge", true, "member"),
    f("is_baptized", "Batizado(a)?", true, "boolean"),
    f("baptism_date", "Data do batismo", false, "date"),
    f("is_active", "Situação", true, "boolean"),
    f("role_id", "Função", true, "role"),
  ],
  cell: [
    f("leader_id", "Líder", true, "member"),
    f("timothy_id", "Timóteo", true, "member"),
    f("host_id", "Anfitrião", true, "member"),
    f("type", "Tipo", true, "text"),
    f("meeting_day", "Dia da semana", true, "text"),
    f("meeting_time", "Horário", true, "time"),
    f("neighborhood", "Bairro", true, "text"),
    f("city", "Cidade", true, "text"),
    f("zip_code", "CEP", false, "text"),
    f("street", "Rua", false, "text"),
    f("number", "Número", false, "text"),
    f("complement", "Complemento", false, "text"),
    f("state", "Estado", false, "text"),
    f("is_active", "Situação", true, "boolean"),
  ],
  cell_report: [
    f("cell_id", "Célula", true, "cell"),
    f("date", "Data", true, "date"),
    f("time", "Horário", true, "time"),
    f("was_held", "Não houve célula", true, "boolean"),
    f("theme", "Tema", true, "text"),
    f("reason_not_held", "Motivo", true, "text"),
    f("offering", "Oferta", true, "number"),
    f("observations", "Observações", false, "text"),
    f("visitors", "Visitantes", false, "text_list"),
  ],
  role: [f("name", "Nome", true, "text"), f("description", "Descrição", false, "text")],
};

const INDEX: Record<AuditFieldEntity, ReadonlyMap<string, AuditFieldInfo>> = {
  member: new Map(AUDIT_FIELDS.member.map((info) => [info.field, info])),
  cell: new Map(AUDIT_FIELDS.cell.map((info) => [info.field, info])),
  cell_report: new Map(AUDIT_FIELDS.cell_report.map((info) => [info.field, info])),
  role: new Map(AUDIT_FIELDS.role.map((info) => [info.field, info])),
};

export function isAuditFieldEntity(value: string): value is AuditFieldEntity {
  return value === "member" || value === "cell" || value === "cell_report" || value === "role";
}

/** O campo na lista; `null` para um campo fora dela (de um passo futuro): a tela não o mostra pelo nome técnico. */
export function auditField(entity: AuditFieldEntity, field: string): AuditFieldInfo | null {
  return INDEX[entity].get(field) ?? null;
}

/** A posição do campo na lista (a ordem do painel). */
export function auditFieldOrder(entity: AuditFieldEntity, field: string): number {
  const position = AUDIT_FIELDS[entity].findIndex((info) => info.field === field);
  return position < 0 ? Number.MAX_SAFE_INTEGER : position;
}

const TEXTS = AUDIT_TEXTS.change;

function formatBoolean(entity: AuditFieldEntity, field: string, value: boolean): string {
  if (field === "is_active" && (entity === "member" || entity === "cell")) {
    return value ? TEXTS.active[entity] : TEXTS.inactive[entity];
  }
  // "Não houve célula" é o inverso do valor gravado (AQ-4).
  const shown = field === "was_held" ? !value : value;
  return shown ? TEXTS.yes : TEXTS.no;
}

/** "19:30:00" → "19:30". */
function formatTime(value: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : value;
}

/**
 * Um valor de `changes.fields[].from/to` legível (RN-20 c): pessoas, célula e função já vêm pelo nome;
 * Sim ou Não, Ativo ou Inativo (Ativa ou Inativa), Masculino ou Feminino, dd/mm/aaaa, HH:mm, R$ 50,00
 * e "(vazio)".
 */
export function formatAuditValue(entity: AuditFieldEntity, info: AuditFieldInfo, value: unknown): string {
  if (value === null || value === undefined || value === "") return TEXTS.empty;
  if (typeof value === "boolean") return formatBoolean(entity, info.field, value);
  if (typeof value === "number") return info.valueType === "number" ? formatCurrency(value) : String(value);
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === "string" && item !== "");
    return items.length > 0 ? items.join(", ") : TEXTS.empty;
  }
  if (typeof value !== "string") return TEXTS.empty;
  if (info.field === "gender" && entity === "member") {
    if (value === "M") return TEXTS.male;
    if (value === "F") return TEXTS.female;
  }
  if (info.valueType === "number") {
    const amount = Number(value);
    return Number.isFinite(amount) ? formatCurrency(amount) : value;
  }
  if (info.valueType === "date") return formatIsoDateBr(value);
  if (info.valueType === "time") return formatTime(value);
  return value;
}
