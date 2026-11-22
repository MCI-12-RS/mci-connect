// Endereço da célula a partir do cadastro do anfitrião (E1.08, RN-11).
import type { MemberAddress } from "@/lib/members/fields";

export interface CellAddressFields {
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
}

/**
 * Preenche o endereço com o do anfitrião, mantendo o valor atual onde o do
 * anfitrião estiver vazio. Sem acesso aos dados sensíveis do anfitrião
 * (`sensitive_visible` falso), só bairro, cidade e UF são copiados.
 */
export function applyHostAddress<T extends CellAddressFields>(form: T, host: MemberAddress): T {
  const sensitive = host.sensitive_visible === true;
  return {
    ...form,
    street: (sensitive && host.street) || form.street,
    number: (sensitive && host.number) || form.number,
    complement: (sensitive && host.complement) || form.complement,
    zip_code: (sensitive && host.zip_code) || form.zip_code,
    neighborhood: host.neighborhood || form.neighborhood,
    city: host.city || form.city,
    state: host.state || form.state,
  };
}
