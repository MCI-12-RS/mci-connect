// Nome do membro (E2.04, RN-02, DA-12). Gêmeas de `public.normalize_person_name`
// e `public.is_valid_person_name`, conferidas pela tabela de casos
// `supabase/tests/fixtures/member-validation-cases.json` (seção `name`).

/**
 * RN-02: os espaços das pontas saem, e os espaços seguidos (tabulações e
 * quebras de linha inclusive) viram um só. Maiúsculas e acentos ficam. Vazio
 * vira `null`. O `\s` do JS inclui espaços Unicode (NBSP, U+FEFF), que o
 * `[[:space:]]` do banco pode não incluir: diferença só em casos exóticos,
 * fora da tabela de casos.
 */
export function normalizePersonName(value: string | null | undefined): string | null {
  if (value == null) return null;
  const name = value.replace(/\s+/gu, " ").replace(/^ +| +$/g, "");
  return name === "" ? null : name;
}

// DA-12: letra de qualquer alfabeto (`[[:alpha:]]` no banco).
const LETTER = /\p{L}/u;

/** RN-02: pelo menos duas palavras com alguma letra. "Ana B." sim; "Ana", "Ana 2" e "Ana ." não. */
export function isValidPersonName(value: string | null | undefined): boolean {
  const name = normalizePersonName(value);
  if (name === null) return false;
  return name.split(" ").filter((word) => LETTER.test(word)).length >= 2;
}
