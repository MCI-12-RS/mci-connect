import { useState, type ReactNode, type RefObject } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertCircle, ArchiveRestore, Search } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import ListPagination from "@/components/ListPagination";
import { UNAVAILABLE_WHILE_SAVING } from "@/components/ConfirmDeleteDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import type { ListSearchState } from "@/hooks/use-list-search-params";
import type { ListResult } from "@/lib/list-query";
import { returnPathFrom } from "@/lib/navigation";
import { DELETED_LIST_TEXTS, DELETION_TEXTS } from "@/lib/deletion/texts";
import { cn } from "@/lib/utils";

// Listas de excluídos (E2.01, T4 e padrão P7): a página, com o "← {Lista}" e
// a guarda de `manage_roles`, e o corpo da lista, com a busca, os estados, os
// cards (celular) ou a tabela (a partir de 768 px) e a paginação.

/** Quantos cards ou linhas o carregamento mostra ("Estados"). */
const SKELETON_ITEMS = 5;

export interface DeletedListPageTexts {
  title: string;
  /** "← Membros". */
  back: string;
  /** "Voltar para Membros", na tela sem acesso. */
  backTo: string;
}

interface DeletedListPageProps {
  texts: DeletedListPageTexts;
  /** A lista principal: `/members`. */
  listPath: string;
  /** A lista de excluídos. Só é montada (e só consulta o banco) com `manage_roles`. */
  children: ReactNode;
}

/**
 * Página de uma lista de excluídos. Sem `manage_roles`, mostra só o aviso e
 * "Voltar para {Lista}", sem consultar nenhum dado (UX-17). O "← {Lista}"
 * volta para a lista com a busca e a página de antes (UX-19).
 */
export function DeletedListPage({ texts, listPath, children }: DeletedListPageProps) {
  const { hasPermission, permissionsLoaded } = useAuth();
  const location = useLocation();
  // Lido na chegada: a busca desta lista troca o endereço e não guarda o estado.
  const [backPath] = useState(() => returnPathFrom(location.state, listPath));

  let content: ReactNode;
  if (!permissionsLoaded) {
    content = (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-10 w-full max-w-sm" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  } else if (!hasPermission("manage_roles")) {
    content = (
      <div className="space-y-4">
        <p>{DELETED_LIST_TEXTS.noAccess}</p>
        <Button asChild variant="outline" className="h-11 md:h-10">
          <Link to={listPath}>{texts.backTo}</Link>
        </Button>
      </div>
    );
  } else {
    content = (
      <>
        <p className="text-muted-foreground text-sm">{DELETED_LIST_TEXTS.subtitle}</p>
        {children}
      </>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-4 animate-fade-in">
        <div>
          {permissionsLoaded && hasPermission("manage_roles") && (
            <Link
              to={backPath}
              className="inline-flex min-h-11 items-center rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {texts.back}
            </Link>
          )}
          <h1 className="text-2xl md:text-3xl font-bold">{texts.title}</h1>
        </div>
        {content}
      </div>
    </AppLayout>
  );
}

export interface DeletedListBodyTexts {
  empty: string;
  noResults: string;
  loadFailed: string;
  countLabel: readonly [string, string];
  searchPlaceholder: string;
  searchLabel: string;
}

/** Os campos do resultado do `useQuery` da lista que o corpo usa. */
export interface DeletedListQuery<Row> {
  data?: ListResult<Row>;
  isLoading: boolean;
  isError: boolean;
  isPlaceholderData: boolean;
  refetch: () => unknown;
}

interface DeletedListBodyProps<Row> {
  texts: DeletedListBodyTexts;
  list: ListSearchState;
  query: DeletedListQuery<Row>;
  searchRef: RefObject<HTMLInputElement>;
  isMobile: boolean;
  rowKey: (row: Row) => string;
  /** O card do celular: primeiro o que identifica o item, depois até 3 dados e o "Restaurar" (UX-16). */
  renderCard: (row: Row) => ReactNode;
  /** As colunas da tabela (a partir de 768 px). */
  tableHead: ReactNode;
  /** A linha da tabela (`<TableRow>`), com `className` para a troca de página. */
  renderRow: (row: Row, className: string | undefined) => ReactNode;
}

/** Corpo de uma lista de excluídos: busca, estados, cards ou tabela e paginação no servidor (UX-14, UX-16). */
export function DeletedListBody<Row>({
  texts,
  list,
  query,
  searchRef,
  isMobile,
  rowKey,
  renderCard,
  tableHead,
  renderRow,
}: DeletedListBodyProps<Row>) {
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  // Na troca de página, os dados anteriores ficam esmaecidos.
  const staleClass = query.isPlaceholderData ? "opacity-60" : undefined;

  const clearSearch = () => {
    list.setSearchInput("");
    searchRef.current?.focus();
  };

  let body: ReactNode;
  if (query.isLoading) {
    body = isMobile ? (
      <div className="divide-y divide-border" aria-busy="true">
        {Array.from({ length: SKELETON_ITEMS }, (_, i) => (
          <div key={i} className="space-y-2 px-4 py-4">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        ))}
      </div>
    ) : (
      <div className="space-y-3 px-4 pb-4" aria-busy="true">
        {Array.from({ length: SKELETON_ITEMS }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  } else if (query.isError) {
    body = (
      <div className="px-4 pb-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="space-y-3 text-foreground">
            <p>{texts.loadFailed}</p>
            <Button type="button" variant="outline" className="h-11 md:h-9" onClick={() => void query.refetch()}>
              {DELETION_TEXTS.tryAgain}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  } else if (rows.length === 0 && list.params.search) {
    body = (
      <div className="space-y-3 px-4 py-8 text-center">
        <p className="text-muted-foreground">{texts.noResults}</p>
        <Button type="button" variant="outline" className="h-11 md:h-9" onClick={clearSearch}>
          {DELETED_LIST_TEXTS.clearSearch}
        </Button>
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <div className="space-y-1 px-4 py-8 text-center">
        <p className="font-medium">{texts.empty}</p>
        <p className="text-sm text-muted-foreground">{DELETED_LIST_TEXTS.emptyHint}</p>
      </div>
    );
  } else if (isMobile) {
    body = (
      <ul className={cn("divide-y divide-border", staleClass)}>
        {rows.map((row) => (
          <li key={rowKey(row)} className="space-y-2 px-4 py-4">
            {renderCard(row)}
          </li>
        ))}
      </ul>
    );
  } else {
    body = (
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              {tableHead}
              <TableHead className="w-32">
                <span className="sr-only">{DELETED_LIST_TEXTS.actionsColumn}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{rows.map((row) => renderRow(row, staleClass))}</TableBody>
        </Table>
      </CardContent>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={searchRef}
            placeholder={texts.searchPlaceholder}
            aria-label={texts.searchLabel}
            value={list.searchInput}
            onChange={(e) => list.setSearchInput(e.target.value)}
            maxLength={100}
            className="pl-10"
          />
        </div>
      </CardHeader>
      {body}
      {!query.isLoading && !query.isError && total > 0 && (
        <ListPagination
          page={list.params.page}
          pageSize={list.params.pageSize}
          total={total}
          itemLabel={[texts.countLabel[0], texts.countLabel[1]]}
          onPageChange={list.setPage}
          onPageSizeChange={list.setPageSize}
        />
      )}
    </Card>
  );
}

interface RestoreButtonProps {
  /** "Restaurar Bruno Almeida", "Restaurar a célula de {Líder}", "Restaurar o relatório de {data}". */
  label: string;
  /** Restauração deste item em andamento: "Restaurando…" e indisponível (UX-21). */
  restoring?: boolean;
  /** Recebe o próprio botão, para o foco voltar a ele (ou à busca, se o item sair da lista). */
  onRestore: (button: HTMLButtonElement) => void;
}

/**
 * "Restaurar" de um item (T4): `outline`, com o ícone e o texto visível, 44 px
 * no celular. Enquanto restaura, fica com `aria-disabled` (e não `disabled`),
 * para o foco continuar nele.
 */
export function RestoreButton({ label, restoring = false, onRestore }: RestoreButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn("h-auto min-h-11 shrink-0 whitespace-normal md:min-h-9", UNAVAILABLE_WHILE_SAVING)}
      aria-label={label}
      aria-disabled={restoring || undefined}
      onClick={restoring ? undefined : (event) => onRestore(event.currentTarget)}
    >
      <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
      {restoring ? DELETION_TEXTS.restoring : DELETION_TEXTS.restore}
    </Button>
  );
}
