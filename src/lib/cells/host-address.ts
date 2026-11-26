// Endereço da célula a partir do cadastro do anfitrião (E2.08, RN-10, DT-11,
// P61; E1.08). Sem React e sem Supabase.
import type { MemberAddress } from "@/lib/members/fields";

export interface CellAddressFields {
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
}

/**
 * - `full`: os sete campos vieram do anfitrião (com os dados sensíveis);
 * - `partial`: bairro, cidade e estado vieram, e CEP, rua, número e complemento ficaram vazios;
 * - `unavailable`: nada visível; o endereço não mudou.
 */
export type HostAddressOutcome = "full" | "partial" | "unavailable";

const text = (value: string | null | undefined): string => value ?? "";
const filled = (value: string | null | undefined): boolean => !!value && value.trim() !== "";

/**
 * Substitui o endereço pelo do anfitrião (P-CEL-07: nunca uma mistura):
 * - com `sensitive_visible`, os sete campos passam a ser os dele, inclusive vazios;
 * - sem, bairro, cidade e estado vêm dele, e CEP, rua, número e complemento ficam vazios;
 * - com os campos visíveis todos vazios (ou sem o anfitrião), o endereço não muda. O resultado
 *   é o mesmo para o endereço vazio e o mascarado, para não revelar qual é (RN-10).
 */
export function applyHostAddress<T extends CellAddressFields>(
  address: T,
  host: MemberAddress | null,
): { address: T; outcome: HostAddressOutcome } {
  if (!host) return { address, outcome: "unavailable" };
  const sensitive = host.sensitive_visible === true;
  const visible = sensitive
    ? [host.street, host.number, host.complement, host.neighborhood, host.city, host.state, host.zip_code]
    : [host.neighborhood, host.city, host.state];
  if (!visible.some(filled)) return { address, outcome: "unavailable" };
  return {
    address: {
      ...address,
      street: sensitive ? text(host.street) : "",
      number: sensitive ? text(host.number) : "",
      complement: sensitive ? text(host.complement) : "",
      zip_code: sensitive ? text(host.zip_code) : "",
      neighborhood: text(host.neighborhood),
      city: text(host.city),
      state: text(host.state),
    },
    outcome: sensitive ? "full" : "partial",
  };
}
