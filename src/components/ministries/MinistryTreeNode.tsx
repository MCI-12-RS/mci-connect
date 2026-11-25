import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Heart, Loader2 } from "lucide-react";
import LevelBadge from "@/components/hierarchy/LevelBadge";
import TotalsText from "@/components/hierarchy/TotalsText";
import { useMinistryTree } from "@/hooks/use-ministry-tree";
import { prefersReducedMotion } from "@/lib/a11y";
import {
  ministryNodeAccessibleName,
  ministryNodeKey,
  ministryNodeParentIds,
  type MinistryCoupleNode,
  type MinistryTreeItem,
} from "@/lib/ministries/tree";
import { cn } from "@/lib/utils";
import SpouseReferenceRow from "./SpouseReferenceRow";
import RetryLine from "./RetryLine";
import { LOADING_MESSAGE, NESTED_LIST, ROW, ROW_ICON_SLOT, type TreePathEntry } from "./tree-shared";

const SPINNER = "h-4 w-4 animate-spin motion-reduce:animate-none";
/** Quanto tempo o nó fica destacado depois do "Ir para o casal" (P43). */
const HIGHLIGHT_MS = 2_000;

/**
 * Nomes do casal; o coração é decorativo. Vai junto do 1º nome, para não
 * ficar sozinho numa linha.
 */
const CoupleNames = ({ node }: { node: MinistryCoupleNode }) => (
  <span className="flex min-w-0 basis-full flex-wrap items-center gap-x-1.5 font-medium text-foreground sm:basis-auto sm:flex-1">
    <span className="break-words">
      {node.member_name}
      {node.spouse_name && (
        <Heart className="ml-1.5 inline h-3.5 w-3.5 align-[-0.125em] text-destructive/60" aria-hidden="true" />
      )}
    </span>
    {node.spouse_name && <span className="break-words">{node.spouse_name}</span>}
  </span>
);

/**
 * Nomes, nível e totais (T3). No celular, o nível e os totais ficam na 2ª
 * linha; a partir de 640 px, tudo numa linha, com eles à direita.
 */
const NodeDetails = ({ node }: { node: MinistryCoupleNode }) => (
  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 sm:flex-nowrap">
    <CoupleNames node={node} />
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground sm:shrink-0 sm:justify-end">
      <LevelBadge {...node.level} className="text-xs" />
      <TotalsText disciples={node.total_disciples} cells={node.total_cells} />
    </span>
  </span>
);

interface TreeLevelProps {
  items: readonly MinistryTreeItem[];
  /** Os nós abertos, da raiz ao pai destes itens. */
  path: readonly TreePathEntry[];
}

/** Os itens de um nível: nós (que abrem) e referências (P43). */
export const TreeLevel = ({ items, path }: TreeLevelProps) => (
  <>
    {items.map((item) =>
      item.kind === "spouse_above" ? (
        <SpouseReferenceRow key={ministryNodeKey(item)} reference={item} path={path} />
      ) : (
        <MinistryTreeNode key={ministryNodeKey(item)} node={item} path={path} />
      ),
    )}
  </>
);

interface MinistryTreeNodeProps {
  node: MinistryCoupleNode;
  path: readonly TreePathEntry[];
}

const MinistryTreeNode = ({ node, path }: MinistryTreeNodeProps) => {
  const [expanded, setExpanded] = useState(false);
  const [highlighted, setHighlighted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const highlightTimer = useRef<number | undefined>(undefined);
  const hasChildren = node.direct_disciples > 0;
  // Uma chamada por nó aberto; recolher e reabrir usa o cache.
  const children = useMinistryTree(ministryNodeParentIds(node), { enabled: hasChildren && expanded });
  const loading = expanded && children.isFetching && !children.data;

  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  // "Ir para o casal" (P43): rola, foca e destaca por 2 s, sem abrir nem fechar nada.
  const reveal = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    button.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    button.focus({ preventScroll: true });
    setHighlighted(true);
    window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlighted(false), HIGHLIGHT_MS);
  }, []);

  const childPath = useMemo(() => [...path, { node, reveal }], [path, node, reveal]);

  if (!hasChildren) {
    return (
      <li>
        <div className={ROW}>
          <span className={ROW_ICON_SLOT} aria-hidden="true">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
          </span>
          <NodeDetails node={node} />
        </div>
      </li>
    );
  }

  return (
    <li>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={expanded}
        aria-label={ministryNodeAccessibleName(node)}
        onClick={() => setExpanded((open) => !open)}
        className={cn(
          ROW,
          "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          // O destaque não depende de `:focus-visible`: depois de um toque, o navegador não mostra o anel.
          highlighted && "ring-2 ring-ring",
        )}
      >
        <span className={cn(ROW_ICON_SLOT, "text-muted-foreground")} aria-hidden="true">
          {loading ? (
            <Loader2 className={SPINNER} />
          ) : expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>
        <NodeDetails node={node} />
      </button>
      {expanded && (
        <div className={NESTED_LIST} aria-busy={loading}>
          {loading ? (
            <span role="status" className="sr-only">
              {LOADING_MESSAGE}
            </span>
          ) : children.isError ? (
            <RetryLine
              message="Não foi possível carregar os discípulos."
              onRetry={() => {
                // A linha do erro some enquanto carrega: o foco volta para o nó.
                buttonRef.current?.focus();
                void children.refetch();
              }}
              className="px-2 py-2 sm:px-4"
            />
          ) : (
            <ul>
              <TreeLevel items={children.data ?? []} path={childPath} />
            </ul>
          )}
        </div>
      )}
    </li>
  );
};

export default MinistryTreeNode;
