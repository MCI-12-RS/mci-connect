/** Junta os ids de `aria-describedby`, sem os vazios. `undefined` se não sobrar nenhum. */
export function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(" ");
  return joined || undefined;
}

/** As mensagens embaixo de um campo (P21 do E2.04); vazias ou ausentes não aparecem. */
export interface FieldMessageTexts {
  error?: string | null;
  warning?: string | null;
  hint?: string | null;
}

/** Os ids das mensagens de um campo, na ordem erro, aviso e dica (P21), a partir do id do campo. */
export function fieldMessageIds(id: string, { error, warning, hint }: FieldMessageTexts): string | undefined {
  return describedBy(error && `${id}-error`, warning && `${id}-warning`, hint && `${id}-hint`);
}

/** As mensagens de um grupo de campos (Identificação, P21): ligadas a cada campo do grupo. */
export interface FieldGroupMessages {
  /** Os ids das mensagens do grupo. */
  ids?: string;
  /** O erro do grupo marca cada campo. */
  invalid?: boolean;
}

/** `aria-invalid` e `aria-describedby` de um campo com as mensagens dele e as do grupo (P21). */
export function fieldA11yProps(
  id: string,
  texts: FieldMessageTexts,
  group: FieldGroupMessages = {},
): { "aria-invalid": true | undefined; "aria-describedby": string | undefined } {
  return {
    "aria-invalid": texts.error || group.invalid ? true : undefined,
    "aria-describedby": describedBy(fieldMessageIds(id, texts), group.ids),
  };
}
