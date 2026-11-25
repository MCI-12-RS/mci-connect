import type { MinistryCoupleNode } from "@/lib/ministries/tree";

/** Leitor de tela, enquanto um nível da árvore carrega. */
export const LOADING_MESSAGE = "Carregando…";

// Linha do nó e da referência. O recuo de cada nível vem da lista aninhada
// (`NESTED_LIST`), menor no celular para não espremer os nomes.
export const ROW = "flex w-full items-start gap-2 rounded-lg px-2 py-3 text-left sm:items-center sm:gap-3 sm:px-4";
export const NESTED_LIST = "ml-4 border-l border-border/50 sm:ml-6";

/** O espaço da seta (ou do ponto, ou do ícone da referência), alinhado à 1ª linha do nome. */
export const ROW_ICON_SLOT = "flex h-6 w-5 shrink-0 items-center justify-center sm:h-5";

/**
 * Um nó aberto no caminho até a linha atual. A referência (P43) sobe por ele
 * até o nó do casal e chama `reveal`, que rola, foca e destaca o nó.
 */
export interface TreePathEntry {
  node: MinistryCoupleNode;
  reveal: () => void;
}
