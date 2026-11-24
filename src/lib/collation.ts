// Ordem alfabética do português, feita no cliente.

const PT_BR = new Intl.Collator("pt-BR");

/**
 * Os textos em ordem alfabética do português ("Álvaro" antes de "Ana"), sem
 * depender da collation do banco. Textos iguais ficam na ordem em que vieram.
 */
export function sortAlphabetically(values: readonly string[]): string[] {
  return [...values].sort(PT_BR.compare);
}
