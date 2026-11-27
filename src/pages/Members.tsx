import { useRef, useState } from "react";
import { AlertCircle, Info } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { ActionsCell, ActionsHead } from "@/components/ActionsColumn";
import AppLayout from "@/components/AppLayout";
import MemberForm from "@/components/MemberForm";
import { MemberFormById } from "@/components/EditRecordDialogs";
import type { RestoredFromWarning } from "@/components/DeletedMatchesDialog";
import MemberDeletionFlow, { type MemberDeletionTarget } from "@/components/MemberDeletionFlow";
import {
  ResetPasswordDialog,
  type ResetPasswordOutcome,
  type ResetPasswordTarget,
} from "@/components/members/ResetPasswordDialog";
import RowActionsMenu, { type RowAction } from "@/components/RowActionsMenu";
import ListPagination from "@/components/ListPagination";
import DeletedListButton from "@/components/DeletedListButton";
import { BlockedActionDialog } from "@/components/BlockedActionDialog";
import { MemberStatusBadge } from "@/components/StatusBadges";
import LevelBadge from "@/components/hierarchy/LevelBadge";
import LeadershipText from "@/components/hierarchy/LeadershipText";
import TotalsText from "@/components/hierarchy/TotalsText";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterChips } from "@/components/filters/FilterChips";
import { FiltersButton } from "@/components/filters/FiltersButton";
import { FiltersPanel } from "@/components/filters/FiltersPanel";
import { FiltersSheet } from "@/components/filters/FiltersSheet";
import { MemberFilters, type MemberFiltersHandle } from "@/components/members/MemberFilters";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { KeyRound, Plus, Search, Pencil, Trash2, User } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { TABLE_MIN_WIDTH, WIDE_TABLE_MIN_WIDTH, useMinWidth } from "@/hooks/use-min-width";
import { useClampPage, useListSearchParams } from "@/hooks/use-list-search-params";
import { useMembersList } from "@/hooks/use-members-list";
import { useMemberFilters } from "@/hooks/use-member-filters";
import { usePanelOpen } from "@/hooks/use-panel-open";
import { useVisibleMemberNames } from "@/hooks/use-visible-member-names";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { refreshAccess } from "@/hooks/use-access";
import { PASSWORD_ROW_TEXTS } from "@/lib/auth/password-texts";
import { nextStepForRefusal } from "@/lib/auth/temporary-password";
import { canResetFromList } from "@/lib/members/password-row";
import { UNNAMED_MEMBER_LABEL, type MemberRow } from "@/lib/members/fields";
import { DELETED_LIST_TEXTS, MEMBER_DELETION_TEXTS } from "@/lib/deletion/texts";
import { listSubtitle, memberSearchEmptyLabel } from "@/lib/access/access";
import { formatCount } from "@/lib/format";
import { FILTER_TEXTS } from "@/lib/filters/texts";
import {
  EMPTY_MEMBER_FILTERS,
  countActiveFilters,
  memberFilterChips,
  resolveLeaderLabel,
  type MemberFilters as Filters,
} from "@/lib/members/filters";
import { MEMBER_FILTER_TEXTS as FILTERS } from "@/lib/members/filter-texts";
import type { SelectOption } from "@/lib/selectors";
import { MEMBER_FORM_TEXTS, RULE_TEXTS } from "@/lib/access/texts";
import { memberLevel } from "@/lib/hierarchy/level";
import { memberLeadership, showsLeadershipOnCard } from "@/lib/hierarchy/leadership";
import { LEADERSHIP_TEXTS, MEMBERS_LIST_TEXTS } from "@/lib/hierarchy/texts";

type Member = MemberRow;

const formatPhone = (value?: string | null): string => {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return value;
};

/** O id do painel de filtros do computador (`aria-controls` do botão "Filtros"). */
const FILTERS_PANEL_ID = "members-filters-panel";

/** Primeira carga (T6, UX-16): 5 `Skeleton` no formato dos cartões ou das linhas da tabela. */
function LoadingRows({ asTable }: { asTable: boolean }) {
  return (
    <div className="space-y-3 p-4" aria-busy="true" data-testid="members-loading">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className={asTable ? "h-12 w-full" : "h-28 w-full"} />
      ))}
    </div>
  );
}

const Members = () => {
  const list = useListSearchParams();
  const memberFilters = useMemberFilters();
  const { filters } = memberFilters;

  const [formOpen, setFormOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  // Cadastro novo com dados de um excluído: restaurado pelo aviso, o diálogo passa a editá-lo (RN-18, UX-32).
  const [restoredMember, setRestoredMember] = useState<RestoredFromWarning | null>(null);
  const [deletingMember, setDeletingMember] = useState<MemberDeletionTarget | null>(null);
  // "Redefinir senha" pela lista (E2.03, P-SEN-20, UX-39).
  const [resettingMember, setResettingMember] = useState<ResetPasswordTarget | null>(null);
  const queryClient = useQueryClient();
  // "Novo membro" com a função padrão acima de quem cadastra (RN-19, UXD-2): o bloqueio, e não o formulário.
  const [newMemberBlocked, setNewMemberBlocked] = useState(false);
  const { hasPermission, user, access } = useAuth();
  const isMobile = useIsMobile();
  // Cartões até 1023 px, tabela a partir de 1024 px; foto e Celular a partir de 1280 px (P45).
  const showTable = useMinWidth(TABLE_MIN_WIDTH);
  const showWideColumns = useMinWidth(WIDE_TABLE_MIN_WIDTH);

  const listQuery = useMembersList(list.params, filters);
  const { data, isPending, isError, isPlaceholderData, isRefetching } = listQuery;
  // A lista na tela recarrega (troca de página ou depois de uma gravação): as
  // linhas ficam em `opacity-60` e com `aria-busy` até a resposta (E1.08; E2.06, P44).
  const refreshing = isPlaceholderData || isRefetching;
  const members = data?.rows ?? [];
  const total = data?.total ?? 0;

  useClampPage(list, { data, isPlaceholderData });

  // Ao fechar um diálogo, o foco volta a quem o abriu ou, se o membro saiu da lista, à busca.
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocus = useReturnFocus(searchRef, data);

  // Filtros (E2.07, P50): `Sheet` abaixo de 1024 px, painel recolhível a partir daí.
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  const filtersFormRef = useRef<MemberFiltersHandle>(null);
  const [panelOpen, setPanelOpen] = usePanelOpen("members");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(filters);
  // Muda a cada abertura e a cada "Limpar" do `Sheet`: os campos recomeçam, sem erro antigo.
  const [sheetKey, setSheetKey] = useState(0);
  // Os nomes das pessoas escolhidas agora no seletor; as da URL vêm só das pessoas visíveis (P53).
  const [pickedNames, setPickedNames] = useState<ReadonlyMap<string, string>>(new Map());
  const visibleNames = useVisibleMemberNames(filters.leaders);
  const nameSources = {
    picked: pickedNames,
    visible: visibleNames.data,
    failed: visibleNames.isError && !visibleNames.data,
  };
  const leaderOptions = (ids: readonly string[]): SelectOption[] =>
    ids.map((id) => ({ value: id, label: resolveLeaderLabel(id, nameSources).label }));
  const unavailableCount = (ids: readonly string[]) => ids.filter((id) => resolveLeaderLabel(id, nameSources).unavailable).length;
  const pickLeaders = (options: readonly SelectOption[]) => {
    if (options.length === 0) return;
    setPickedNames((current) => new Map([...current, ...options.map((option): [string, string] => [option.value, option.label])]));
  };

  const filterCount = countActiveFilters(filters);
  const hasSearch = list.searchInput.trim() !== "" || list.params.search !== "";
  const hasSearchOrFilters = filterCount > 0 || hasSearch;
  const chips = memberFilterChips(filters, (index) => resolveLeaderLabel(filters.leaders[index], nameSources).label);
  const showChips = !showTable || !panelOpen;
  const appliedUnavailable = unavailableCount(filters.leaders);

  const clearAll = () => {
    memberFilters.clearAll();
    list.setSearchInput("");
    requestAnimationFrame(() => filtersButtonRef.current?.focus());
  };
  const openFilters = () => {
    if (showTable) {
      setPanelOpen(!panelOpen);
      return;
    }
    setDraft(filters);
    setSheetKey((key) => key + 1);
    setSheetOpen(true);
  };
  const applyDraft = () => {
    if (filtersFormRef.current && !filtersFormRef.current.validateDates()) return;
    memberFilters.apply(draft);
    setSheetOpen(false);
  };

  // A view já devolve os dados sensíveis mascarados para quem não pode vê-los.
  const canSeeSensitive = (m: Member) => m.sensitive_visible === true;

  const handleEdit = (member: Member, opener: HTMLElement) => {
    returnFocus.setOpener(opener);
    setEditingMember(member);
    setFormOpen(true);
  };

  const handleClose = () => {
    setFormOpen(false);
    setEditingMember(null);
    setRestoredMember(null);
  };

  const canEditAny = hasPermission("edit_member") || hasPermission("edit_own_data");
  const canDeleteAny = hasPermission("delete_member");
  const canResetAny = hasPermission("change_member_password");
  const showActions = canEditAny || canDeleteAny || canResetAny;
  // Nome, Nível, Liderança, Ministério e Situação; foto e Celular a partir de 1280 px.
  const columnCount = 5 + (showWideColumns ? 2 : 0) + (showActions ? 1 : 0);

  const memberName = (m: Member) => m.name || UNNAMED_MEMBER_LABEL;
  const isSelf = (m: Member) => !!user && m.auth_user_id === user.id;
  const canEdit = (m: Member) => hasPermission("edit_member") || (hasPermission("edit_own_data") && isSelf(m));
  // Ninguém exclui o próprio cadastro (RN-03); o banco também recusa.
  const canDelete = (m: Member) => hasPermission("delete_member") && !isSelf(m);

  const startDeletion = (m: Member, opener: HTMLElement | null) => {
    returnFocus.setOpener(opener);
    setDeletingMember({ id: m.id, name: memberName(m), isActive: m.is_active === true });
  };

  // A coluna da view só diz `allowed` para quem tem a permissão, fora da própria linha, de quem tem conta e função coberta (UX-39).
  const canReset = (m: Member) => canResetAny && canResetFromList(m.password_reset_status);

  const startReset = (m: Member, opener: HTMLElement | null) => {
    returnFocus.setOpener(opener);
    setResettingMember({ id: m.id, name: memberName(m), gender: m.gender });
  };

  /** Depois de uma recusa (T6): a lista recarrega (pelo hook) e, sem a permissão, o acesso é relido. */
  const finishReset = (outcome: ResetPasswordOutcome) => {
    setResettingMember(null);
    if (outcome.kind === "refused" && nextStepForRefusal(outcome.code) === "reread_access") void refreshAccess(queryClient);
  };

  const rowActions = (m: Member): RowAction[] => [
    ...(canReset(m)
      ? [{ label: PASSWORD_ROW_TEXTS.reset, icon: KeyRound, onSelect: (trigger: HTMLButtonElement | null) => startReset(m, trigger) }]
      : []),
    ...(canDelete(m)
      ? [{ label: MEMBER_DELETION_TEXTS.deleteAction, icon: Trash2, onSelect: (trigger: HTMLButtonElement | null) => startDeletion(m, trigger) }]
      : []),
  ];

  // Contato embaixo do nome no cartão e na tabela estreita: Instagram, e-mail ou celular.
  const contactLine = (m: Member) => {
    if (m.instagram) return m.instagram;
    if (!canSeeSensitive(m)) return "—";
    return m.email || formatPhone(m.mobile_whatsapp) || "—";
  };

  // "Excluídos": só para quem restaura (E2.01, UX-13). No celular, na linha do título.
  const deletedButton = hasPermission("manage_roles") && (
    <DeletedListButton
      to="/members/deleted"
      text={DELETED_LIST_TEXTS.members.button}
      label={DELETED_LIST_TEXTS.members.buttonLabel}
      isMobile={isMobile}
    />
  );
  const canCreate = hasPermission("create_member");
  const subtitle = listSubtitle(access, "members");

  /** "Liderança: …" no cartão (P41), só para quem tem líder (UXD-2). */
  const renderCardLeadership = (m: Member) => {
    const leadership = memberLeadership(m);
    if (!showsLeadershipOnCard(leadership)) return null;
    return (
      <p className="text-xs text-muted-foreground">
        {LEADERSHIP_TEXTS.cardLabel} <LeadershipText leadership={leadership} className="text-foreground" />
      </p>
    );
  };

  /** Carregando, erro e vazio (T6), no lugar da lista. `null` quando há linhas para mostrar. */
  const renderListState = () => {
    if (isError) {
      return (
        <div className="p-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription className="space-y-3 text-foreground">
              <p>{FILTERS.loadFailed}</p>
              <Button type="button" variant="outline" className="h-11 lg:h-9" onClick={() => void listQuery.refetch()}>
                {FILTERS.tryAgain}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      );
    }
    if (isPending) return <LoadingRows asTable={showTable} />;
    if (members.length > 0) return null;
    if (!hasSearchOrFilters) return <p className="py-8 text-center text-sm text-muted-foreground">{FILTERS.empty}</p>;
    return (
      <div className="space-y-3 p-6 text-center text-sm">
        <p>{FILTERS.emptyFiltered}</p>
        <Button type="button" variant="outline" className="h-11" onClick={clearAll}>
          {FILTER_TEXTS.clearAll}
        </Button>
      </div>
    );
  };

  const renderMobileCards = () => {
    const state = renderListState();
    if (state) return state;

    return (
      <div className={`divide-y divide-border ${refreshing ? "opacity-60" : ""}`} aria-busy={refreshing}>
        {members.map((m) => (
          <div key={m.id} className="px-4 py-4 space-y-3">
            {/* Header: Avatar + Name + Actions */}
            {/* Com a fonte ampliada, as ações descem para a linha de baixo. */}
            <div className="flex flex-wrap items-center gap-3">
              <Avatar className="w-11 h-11 border-2 border-muted shrink-0">
                <AvatarImage src={m.avatar_url || ""} />
                <AvatarFallback className="bg-muted">
                  <User className="w-5 h-5 text-muted-foreground" />
                </AvatarFallback>
              </Avatar>
              <div className="grow basis-32 min-w-0">
                <p className="font-semibold text-sm break-words">{m.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5 break-all">{contactLine(m)}</p>
              </div>
              <div className="ml-auto flex items-center gap-2 shrink-0">
                {canEdit(m) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    aria-label={MEMBER_DELETION_TEXTS.editLabel(memberName(m))}
                    onClick={(e) => handleEdit(m, e.currentTarget)}
                  >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                  </Button>
                )}
                <RowActionsMenu label={MEMBER_DELETION_TEXTS.actionsLabel(memberName(m))} actions={rowActions(m)} />
              </div>
            </div>

            {/* Nível (P40) e situação (P6): a linha quebra entre os badges. */}
            <div className="flex flex-wrap items-center gap-2">
              <LevelBadge {...memberLevel(m)} />
              <MemberStatusBadge active={m.is_active === true} />
            </div>

            {renderCardLeadership(m)}

            {/* Totais da pessoa (P42), sempre, inclusive com zero. */}
            <TotalsText disciples={m.total_disciples} cells={m.total_cells} className="block text-xs text-muted-foreground" />
          </div>
        ))}
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold break-words">Membros</h1>
              {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
            </div>
            {isMobile && deletedButton}
          </div>
          {(canCreate || (!isMobile && deletedButton)) && (
            <div className="flex flex-col sm:flex-row gap-2">
              {!isMobile && deletedButton}
              {canCreate && (
                <Button
                  onClick={(e) => {
                    returnFocus.setOpener(e.currentTarget);
                    // Sem o acesso lido (AQ-1), o formulário abre e o servidor decide ao salvar.
                    if (access && !access.can_create_member) setNewMemberBlocked(true);
                    else setFormOpen(true);
                  }}
                  className="h-11 w-full sm:w-auto lg:h-10"
                >
                  <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                  {MEMBER_FORM_TEXTS.newMember}
                </Button>
              )}
            </div>
          )}
        </div>

        <Card className="min-w-0">
          <CardHeader className="space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="min-w-0 space-y-1 lg:w-full lg:max-w-sm">
                <Label htmlFor="members-search">{FILTERS.search.label}</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="members-search"
                    ref={searchRef}
                    type="search"
                    enterKeyHint="search"
                    placeholder={FILTERS.search.placeholder}
                    value={list.searchInput}
                    onChange={(e) => list.setSearchInput(e.target.value)}
                    maxLength={100}
                    className="h-11 pl-10 lg:h-10"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                <FiltersButton
                  ref={filtersButtonRef}
                  count={filterCount}
                  mode={showTable ? "panel" : "sheet"}
                  expanded={showTable ? panelOpen : sheetOpen}
                  controlsId={FILTERS_PANEL_ID}
                  onClick={openFilters}
                />
                {hasSearchOrFilters && (
                  <Button type="button" variant="ghost" className="h-11 lg:h-10" onClick={clearAll}>
                    {FILTER_TEXTS.clearAll}
                  </Button>
                )}
              </div>
            </div>

            {showTable && (
              <FiltersPanel id={FILTERS_PANEL_ID} open={panelOpen}>
                <MemberFilters
                  variant="panel"
                  value={filters}
                  onChange={(changes) => memberFilters.apply({ ...filters, ...changes })}
                  leaders={leaderOptions(filters.leaders)}
                  onLeadersPicked={pickLeaders}
                  unavailableCount={appliedUnavailable}
                  noResultsLabel={memberSearchEmptyLabel(access)}
                />
              </FiltersPanel>
            )}

            {showChips && (
              <FilterChips chips={chips} onRemove={memberFilters.removeChip} filtersButtonRef={filtersButtonRef} compact />
            )}
            {showChips && appliedUnavailable > 0 && (
              <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{FILTERS.leaders.unavailable(appliedUnavailable)}</span>
              </p>
            )}
            {showChips && memberFilters.leadersTruncated && (
              <p className="text-sm text-muted-foreground">{FILTERS.leaders.limit}</p>
            )}
            <p role="status" className="text-sm text-muted-foreground">
              {data ? `${formatCount(total)} ${total === 1 ? FILTERS.count[0] : FILTERS.count[1]}` : ""}
            </p>
          </CardHeader>

          {!showTable ? (
            renderMobileCards()
          ) : renderListState() ?? (
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {showWideColumns && <TableHead className="w-12"></TableHead>}
                    <TableHead>{MEMBERS_LIST_TEXTS.columnName}</TableHead>
                    {showWideColumns && <TableHead>{MEMBERS_LIST_TEXTS.columnMobile}</TableHead>}
                    <TableHead aria-sort="ascending">{MEMBERS_LIST_TEXTS.columnLevel}</TableHead>
                    <TableHead>{MEMBERS_LIST_TEXTS.columnLeadership}</TableHead>
                    <TableHead>{MEMBERS_LIST_TEXTS.columnMinistry}</TableHead>
                    <TableHead>{MEMBERS_LIST_TEXTS.columnStatus}</TableHead>
                    {showActions && <ActionsHead>{MEMBERS_LIST_TEXTS.columnActions}</ActionsHead>}
                  </TableRow>
                </TableHeader>
                <TableBody aria-busy={refreshing}>
                  {members.map((m) => (
                      <TableRow key={m.id} className={refreshing ? "opacity-60" : undefined}>
                        {showWideColumns && (
                          <TableCell>
                            <Avatar className="w-10 h-10 border">
                              <AvatarImage src={m.avatar_url || ""} />
                              <AvatarFallback className="bg-muted">
                                <User className="w-5 h-5 text-muted-foreground" />
                              </AvatarFallback>
                            </Avatar>
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="break-words">
                            <span className="font-medium">{m.name}</span>
                            {showWideColumns ? (
                              <>
                                {m.instagram && <p className="text-xs text-primary font-medium">{m.instagram}</p>}
                                {!m.instagram && canSeeSensitive(m) && m.email && (
                                  <p className="text-xs text-muted-foreground">{m.email}</p>
                                )}
                              </>
                            ) : (
                              <p className="text-xs text-muted-foreground">{contactLine(m)}</p>
                            )}
                          </div>
                        </TableCell>
                        {showWideColumns && (
                          <TableCell className="text-sm whitespace-nowrap">{canSeeSensitive(m) ? (formatPhone(m.mobile_whatsapp) || "—") : "•••••"}</TableCell>
                        )}
                        <TableCell><LevelBadge {...memberLevel(m)} /></TableCell>
                        <TableCell className="text-sm">
                          <LeadershipText leadership={memberLeadership(m)} />
                        </TableCell>
                        <TableCell>
                          <TotalsText disciples={m.total_disciples} cells={m.total_cells} layout="stacked" />
                        </TableCell>
                        <TableCell>
                          <MemberStatusBadge active={m.is_active === true} />
                        </TableCell>
                        {showActions && (
                          <ActionsCell>
                            <div className="flex items-center gap-1">
                              {canEdit(m) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={MEMBER_DELETION_TEXTS.editLabel(memberName(m))}
                                  onClick={(e) => handleEdit(m, e.currentTarget)}
                                >
                                  <Pencil className="w-4 h-4" aria-hidden="true" />
                                </Button>
                              )}
                              {canReset(m) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={PASSWORD_ROW_TEXTS.resetRowLabel(memberName(m))}
                                  title={PASSWORD_ROW_TEXTS.reset}
                                  onClick={(e) => startReset(m, e.currentTarget)}
                                >
                                  <KeyRound className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                                </Button>
                              )}
                              {canDelete(m) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={MEMBER_DELETION_TEXTS.deleteLabel(memberName(m))}
                                  onClick={(e) => startDeletion(m, e.currentTarget)}
                                >
                                  <Trash2 className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                                </Button>
                              )}
                            </div>
                          </ActionsCell>
                        )}
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          )}

          {data && !isError && (
            <ListPagination
              page={list.params.page}
              pageSize={list.params.pageSize}
              total={total}
              itemLabel={FILTERS.count}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
            />
          )}
        </Card>

        {!showTable && (
          <FiltersSheet
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            onApply={applyDraft}
            onClear={() => {
              setDraft(EMPTY_MEMBER_FILTERS);
              setSheetKey((key) => key + 1);
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              filtersButtonRef.current?.focus();
            }}
          >
            <MemberFilters
              key={sheetKey}
              ref={filtersFormRef}
              variant="sheet"
              value={draft}
              onChange={(changes) => setDraft((current) => ({ ...current, ...changes }))}
              leaders={leaderOptions(draft.leaders)}
              onLeadersPicked={pickLeaders}
              unavailableCount={unavailableCount(draft.leaders)}
              noResultsLabel={memberSearchEmptyLabel(access)}
            />
          </FiltersSheet>
        )}

        {/* O formulário traz o próprio diálogo (E2.04, T1 e T7: rodapé com o resumo e o descartar). */}
        {formOpen &&
          (restoredMember ? (
            <MemberFormById
              key={restoredMember.memberId}
              memberId={restoredMember.memberId}
              restoredFrom={restoredMember}
              onClose={handleClose}
              onCloseAutoFocus={returnFocus.onCloseAutoFocus}
            />
          ) : (
            <MemberForm
              member={editingMember}
              onClose={handleClose}
              onRestored={setRestoredMember}
              onCloseAutoFocus={returnFocus.onCloseAutoFocus}
            />
          ))}

        <BlockedActionDialog
          open={newMemberBlocked}
          onOpenChange={setNewMemberBlocked}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          title={MEMBER_FORM_TEXTS.newMemberBlockedTitle}
        >
          <p>{RULE_TEXTS.defaultRoleNotCovered}</p>
        </BlockedActionDialog>

        {resettingMember && (
          <ResetPasswordDialog
            key={resettingMember.id}
            member={resettingMember}
            onClose={finishReset}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          />
        )}

        {deletingMember && (
          <MemberDeletionFlow
            key={deletingMember.id}
            member={deletingMember}
            onClose={() => setDeletingMember(null)}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          />
        )}
      </div>
    </AppLayout>
  );
};

export default Members;
