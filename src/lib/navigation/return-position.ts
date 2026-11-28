// A volta de uma tela na mesma posição (E2.14, DA-4; E2.10, AQ-8): o item
// aberto e a rolagem da janela, por tela, no `sessionStorage`. Um
// armazenamento só para o Dashboard e para a lista de Células. Valor inválido
// é ignorado (e apagado).

export interface ReturnPosition {
  /** O `data-return-key` (Dashboard) ou o id da célula (lista de Células). */
  key: string;
  /** A rolagem vertical da janela no clique. */
  y: number;
}

const PREFIX = "mci:return-position:";

/** O `sessionStorage`, ou `null` quando o navegador o recusa (modo privado, iframe). */
export function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isReturnPosition(value: unknown): value is ReturnPosition {
  return (
    typeof value === "object" &&
    value !== null &&
    "key" in value &&
    "y" in value &&
    typeof value.key === "string" &&
    value.key !== "" &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    value.y >= 0
  );
}

export function readReturnPosition(storage: Storage | null, scope: string): ReturnPosition | null {
  const raw = storage?.getItem(PREFIX + scope) ?? null;
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (isReturnPosition(value)) return { key: value.key, y: value.y };
  } catch {
    // inválido: apagado abaixo
  }
  storage?.removeItem(PREFIX + scope);
  return null;
}

export function writeReturnPosition(storage: Storage | null, scope: string, position: ReturnPosition): void {
  try {
    storage?.setItem(PREFIX + scope, JSON.stringify(position));
  } catch {
    // cota cheia: a volta começa do topo
  }
}

export function clearReturnPosition(storage: Storage | null, scope: string): void {
  storage?.removeItem(PREFIX + scope);
}
