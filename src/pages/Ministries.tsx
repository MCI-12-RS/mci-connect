import { useRef } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { canSeeRoute } from "@/lib/access/access";
import { MINISTRIES_TEXTS } from "@/lib/access/texts";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TreeLevel } from "@/components/ministries/MinistryTreeNode";
import RetryLine from "@/components/ministries/RetryLine";
import { LOADING_MESSAGE } from "@/components/ministries/tree-shared";
import { useMinistryTree } from "@/hooks/use-ministry-tree";
import { MINISTRIES_TEXTS as TREE_TEXTS } from "@/lib/hierarchy/texts";

// Árvore de ministérios (E1.08, RN-10; E2.06, T3, T4): abrir a tela é uma
// chamada (as raízes) e abrir um nó é outra (os filhos do casal), já com o
// nível e os totais.

// Linhas exibidas enquanto as raízes carregam.
const ROOT_PLACEHOLDERS = 4;
// As raízes não têm nó aberto acima delas.
const NO_PATH = [] as const;

const RootsLoading = () => (
  <div aria-busy="true" className="space-y-1 p-2">
    <span role="status" className="sr-only">
      {LOADING_MESSAGE}
    </span>
    {Array.from({ length: ROOT_PLACEHOLDERS }, (_, index) => (
      <Skeleton key={index} className="h-16 w-full sm:h-11" />
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
        <TreeLevel items={roots.data} path={NO_PATH} />
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
            <p className="text-sm text-muted-foreground">{TREE_TEXTS.help}</p>
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
