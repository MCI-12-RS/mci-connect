// Pessoa escolhida num filtro (E2.07, P53; E2.10, RN-06): como ela aparece no campo e no chip. Sem
// React e sem Supabase. O nome vem só da leitura das pessoas que quem consulta pode ver por id (a
// `members_view` em Membros, a `cell_filter_names` em Células); nunca da `member_names`.

/** Como uma pessoa escolhida aparece (P53). */
export interface PersonLabel {
  label: string;
  /** Fora do que quem consulta vê, excluída ou inexistente: sem nome e sem id. */
  unavailable: boolean;
}

/** A leitura das pessoas por id: os ids lidos e os nomes dos que voltaram. */
export interface VisiblePersonNames {
  /** Os ids que a leitura conferiu. Um id fora daqui ainda está carregando. */
  checked: ReadonlySet<string>;
  names: ReadonlyMap<string, string>;
}

export interface PersonNameSources {
  /** Os nomes das pessoas escolhidas agora no seletor (vieram das opções). */
  picked: ReadonlyMap<string, string>;
  /**
   * A leitura por id: `undefined` enquanto carrega. Ao pôr ou tirar uma pessoa, a leitura anterior
   * continua valendo para os ids que ela conferiu (sem voltar a "Carregando…").
   */
  visible: VisiblePersonNames | undefined;
  /** A leitura por id falhou. */
  failed: boolean;
}

/** Os textos de quem ainda não tem nome. */
export interface PersonLabelTexts {
  loadingName: string;
  nameNotLoaded: string;
  unavailableName: string;
}

/** O rótulo de uma pessoa escolhida: o nome lido, "Carregando…", "nome não carregado" ou "Pessoa indisponível". */
export function resolvePersonLabel(
  id: string,
  { picked, visible, failed }: PersonNameSources,
  texts: PersonLabelTexts,
): PersonLabel {
  const pickedName = picked.get(id);
  if (pickedName !== undefined) return { label: pickedName, unavailable: false };
  if (failed) return { label: texts.nameNotLoaded, unavailable: false };
  if (!visible || !visible.checked.has(id)) return { label: texts.loadingName, unavailable: false };
  const name = visible.names.get(id);
  return name === undefined ? { label: texts.unavailableName, unavailable: true } : { label: name, unavailable: false };
}
