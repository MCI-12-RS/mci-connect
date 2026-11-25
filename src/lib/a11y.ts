/** Junta os ids de `aria-describedby`, sem os vazios. `undefined` se não sobrar nenhum. */
export function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(" ");
  return joined || undefined;
}
