/** Um filtro ativo como chip (P50): a chave (única entre os chips) e o texto ("Situação: Ativo"). */
export interface FilterChip<K extends string = string> {
  key: K;
  text: string;
}
