import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { canSeeRoute } from "@/lib/access/access";
import { MINISTRIES_TEXTS } from "@/lib/access/texts";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight, Heart, Loader2, Users } from "lucide-react";
import { useMinistryTree, type MinistryTreeNode } from "@/hooks/use-ministry-tree";
import { formatCount } from "@/lib/format";
import {
  directDisciplesLabel,
  getLevelLabel,
  isNumericLevelLabel,
  ministryNodeKey,
  ministryNodeParentIds,
} from "@/lib/ministries/tree";
import { cn } from "@/lib/utils";

// Árvore de ministérios (E1.08, RN-10): abrir a tela é uma chamada (as raízes)
// e abrir um nó é outra (os filhos do casal), já com as contagens.

const LOADING_MESSAGE = "Carregando…";
// Linhas exibidas enquanto as raízes carregam.
const ROOT_PLACEHOLDERS = 4;
const SPINNER = "h-4 w-4 animate-spin motion-reduce:animate-none";

// Linha do nó. O recuo de cada nível vem da lista aninhada (`NESTED_LIST`),
// menor no celular para não espremer os nomes.
const ROW = "flex w-full items-center gap-2 rounded-lg px-2 py-3 text-left sm:gap-3 sm:px-4";
const NESTED_LIST = "ml-4 border-l border-border/50 sm:ml-6";

interface RetryLineProps {
  message: string;
  onRetry: () => void;
  className?: string;
}

const RetryLine = ({ message, onRetry, className }: RetryLineProps) => (
  <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm", className)}>
    <span role="alert" className="text-destructive">
      {message}
    </span>
    <Button type="button" variant="outline" onClick={onRetry}>
      Tentar novamente
    </Button>
  </div>
);

/**
 * Nomes do casal; o coração é decorativo e o leitor de tela ouve "e". O
 * coração vai junto do 1º nome, para não ficar sozinho numa linha.
 */
const CoupleNames = ({ node }: { node: MinistryTreeNode }) => (
  <span className="flex min-w-0 flex-auto flex-wrap items-center gap-x-1.5 font-medium text-foreground sm:flex-1">
    <span className="break-words">
      {node.member_name}
      {node.spouse_name && (
        <Heart className="ml-1.5 inline h-3.5 w-3.5 align-[-0.125em] text-destructive/60" aria-hidden="true" />
      )}
    </span>
    {node.spouse_name && (
      <>
        <span className="sr-only"> e </span>
        <span className="break-words">{node.spouse_name}</span>
      </>
    )}
  </span>
);

const NodeCounts = ({ node }: { node: MinistryTreeNode }) => (
  <span className="flex shrink-0 items-center gap-2">
    {node.direct_disciples > 0 && (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        <span aria-hidden="true">{formatCount(node.direct_disciples)}</span>
        <span className="sr-only">{directDisciplesLabel(node.direct_disciples)}</span>
      </span>
    )}
    <Badge variant={node.g12_level === 0 ? "default" : "outline"} className="text-xs">
      {isNumericLevelLabel(node.g12_level) && <span className="sr-only">nível </span>}
      {getLevelLabel(node.g12_level)}
    </Badge>
  </span>
);

/** Nomes e contagens: no celular, a contagem e o nível descem para baixo dos nomes longos. */
const NodeDetails = ({ node }: { node: MinistryTreeNode }) => (
  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 sm:flex-nowrap">
    <CoupleNames node={node} />
    <NodeCounts node={node} />
  </span>
);

const TreeNode = ({ node }: { node: MinistryTreeNode }) => {
  const [expanded, setExpanded] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hasChildren = node.direct_disciples > 0;
  // Uma chamada por nó aberto; recolher e reabrir usa o cache.
  const children = useMinistryTree(ministryNodeParentIds(node), { enabled: hasChildren && expanded });
  const loading = expanded && children.isFetching && !children.data;

  if (!hasChildren) {
    return (
      <li>
        <div className={ROW}>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
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
        onClick={() => setExpanded((open) => !open)}
        className={cn(
          ROW,
          "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground" aria-hidden="true">
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
              {children.data?.map((child) => (
                <TreeNode key={ministryNodeKey(child)} node={child} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
};

const RootsLoading = () => (
  <div aria-busy="true" className="space-y-1 p-2">
    <span role="status" className="sr-only">
      {LOADING_MESSAGE}
    </span>
    {Array.from({ length: ROOT_PLACEHOLDERS }, (_, index) => (
      <Skeleton key={index} className="h-11 w-full" />
    ))}
  </div>
);

const Ministries = () => {
  const roots = useMinistryTree(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isEmpty = roots.data?.length === 0;
  const { access } = useAuth();
  const canSeeMembers = canSeeRoute(access, "/members");

  let content;
  // Também ao tentar de novo depois de um erro: a consulta segue com erro até responder.
  if (roots.isPending || (roots.isFetching && !roots.data)) {
    content = <RootsLoading />;
  } else if (roots.isError) {
    content = (
      <RetryLine
        message="Não foi possível carregar a árvore."
        onRetry={() => {
          // A linha do erro some enquanto carrega: o foco vai para o título da tela.
          headingRef.current?.focus();
          void roots.refetch();
        }}
        className="justify-center py-12"
      />
    );
  } else if (isEmpty) {
    content = (
      <div className="space-y-1 px-4 py-12 text-center">
        <p className="text-foreground">{MINISTRIES_TEXTS.emptyTitle}</p>
        <p className="text-sm text-muted-foreground">
          {canSeeMembers ? MINISTRIES_TEXTS.emptyDescription : MINISTRIES_TEXTS.emptyDescriptionNoMembers}
        </p>
        {/* Uma saída para a pessoa não ficar sem caminho (T10). */}
        {canSeeMembers && (
          <div className="pt-4">
            <Button asChild variant="outline" className="h-11">
              <Link to="/members">{MINISTRIES_TEXTS.goToMembers}</Link>
            </Button>
          </div>
        )}
      </div>
    );
  } else {
    content = (
      <ul className="divide-y divide-border/30">
        {roots.data.map((node) => (
          <TreeNode key={ministryNodeKey(node)} node={node} />
        ))}
      </ul>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold focus:outline-none md:text-3xl">
            Ministérios
          </h1>
          {!isEmpty && (
            <p className="text-sm text-muted-foreground">
              Toque ou clique num nome para ver os discípulos. O número ao lado de cada nome é o total de discípulos
              diretos.
            </p>
          )}
        </div>

        <Card>
          <CardContent className="p-2">{content}</CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Ministries;
