// Visitantes, um nome por campo (E2.11, RN-12, P102). Sem React e sem
// Supabase. A mesma leitura de `private.report_input`: espaços das pontas
// fora, os repetidos viram um, vazios descartados, a ordem fica; nomes
// repetidos ficam e "Silva, João" é um nome só.

/** "  João   Silva " → "João Silva". */
export function normalizeVisitorName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Os nomes enviados: lidos e sem os vazios. */
export function visitorsToSend(names: readonly string[]): string[] {
  return names.map(normalizeVisitorName).filter((name) => name !== "");
}

/** "Visitantes: {N}": só os nomes preenchidos. */
export const visitorsCount = (names: readonly string[]): number => visitorsToSend(names).length;

/** Os campos da edição: um por nome gravado e, sem nenhum, um vazio. */
export function visitorFields(stored: readonly string[] | null | undefined): string[] {
  return stored && stored.length > 0 ? [...stored] : [""];
}
