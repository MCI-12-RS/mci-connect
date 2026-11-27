// O registro de um filtro vindo de outra tela, como o chip o mostra (E2.10, P84). Sem React.

export type RecordFilterChipState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "unavailable" }
  | { kind: "ready"; text: string };

export interface RecordFilterChipTexts {
  /** "Célula: carregando…" */
  loading: string;
  /** "Célula: não carregada" */
  failed: string;
  /** "Célula indisponível", sem nome e sem id. */
  unavailable: string;
  /** "Esta célula não está disponível para você." */
  unavailableHint: string;
}

/** O texto do chip em cada estado. */
export function recordFilterChipText(state: RecordFilterChipState, texts: RecordFilterChipTexts): string {
  switch (state.kind) {
    case "loading":
      return texts.loading;
    case "failed":
      return texts.failed;
    case "unavailable":
      return texts.unavailable;
    case "ready":
      return state.text;
  }
}
