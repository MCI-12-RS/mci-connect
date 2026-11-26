// CEP comum aos formulários de membro e de célula (E2.08, RN-09, DA-11, DT-12).
// Sem React e sem Supabase: a máscara, a leitura da resposta do serviço de CEP
// e o preenchimento dos campos.

import { isJsonObject } from "@/lib/errors";

/** Quantos dígitos tem um CEP completo. */
export const CEP_LENGTH = 8;

/** Só os dígitos do CEP, no máximo 8. */
export function cepDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "").slice(0, CEP_LENGTH);
}

/** "90010-000" enquanto a pessoa digita: o hífen depois do 5º dígito. */
export function maskCep(value: string): string {
  const digits = cepDigits(value);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

/** O CEP tem os 8 dígitos: a busca pode sair. */
export function isCompleteCep(value: string | null | undefined): boolean {
  return cepDigits(value).length === CEP_LENGTH;
}

/** O que o serviço de CEP devolve e o formulário usa (P-CEL-20: nunca número e complemento). */
export interface CepAddress {
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

export type CepLookup = { kind: "found"; address: CepAddress } | { kind: "not_found" } | { kind: "failed" };

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/**
 * A resposta do serviço de CEP (ViaCEP): `erro` é "não encontrado"; um objeto
 * com os campos é "encontrado"; qualquer outra coisa é falha.
 */
export function parseCepLookup(body: unknown): CepLookup {
  if (!isJsonObject(body)) return { kind: "failed" };
  if (body.erro === true || body.erro === "true") return { kind: "not_found" };
  const address: CepAddress = {
    street: text(body.logradouro),
    neighborhood: text(body.bairro),
    city: text(body.localidade),
    state: text(body.uf),
  };
  return { kind: "found", address };
}

/** Os campos de endereço que o CEP preenche. */
export interface CepFillable {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
}

/**
 * Preenche rua, bairro, cidade e estado onde o serviço trouxe valor; o resto
 * fica como está. Número e complemento nunca mudam (RN-09, P-CEL-20).
 */
export function applyCepAddress<T extends CepFillable>(current: T, found: CepAddress): T {
  return {
    ...current,
    street: found.street ?? current.street,
    neighborhood: found.neighborhood ?? current.neighborhood,
    city: found.city ?? current.city,
    state: found.state ?? current.state,
  };
}
