import { useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ActionsCell, ActionsHead } from "@/components/ActionsColumn";
import AppLayout from "@/components/AppLayout";
import MemberForm from "@/components/MemberForm";
import { MemberFormById } from "@/components/EditRecordDialogs";
import type { RestoredFromWarning } from "@/components/DeletedMatchesDialog";
import MemberDeletionFlow, { type MemberDeletionTarget } from "@/components/MemberDeletionFlow";
import RowActionsMenu, { type RowAction } from "@/components/RowActionsMenu";
import ListPagination from "@/components/ListPagination";
import DeletedListButton from "@/components/DeletedListButton";
import { BlockedActionDialog } from "@/components/BlockedActionDialog";
import { MemberStatusBadge } from "@/components/StatusBadges";
import LevelBadge from "@/components/hierarchy/LevelBadge";
import LeadershipText from "@/components/hierarchy/LeadershipText";
import TotalsText from "@/components/hierarchy/TotalsText";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Search, Pencil, Trash2, User } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { TABLE_MIN_WIDTH, WIDE_TABLE_MIN_WIDTH, useMinWidth } from "@/hooks/use-min-width";
import { useClampPage, useListSearchParams } from "@/hooks/use-list-search-params";
import { useMembersList } from "@/hooks/use-members-list";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { UNNAMED_MEMBER_LABEL, type MemberRow } from "@/lib/members/fields";
import { DELETED_LIST_TEXTS, MEMBER_DELETION_TEXTS } from "@/lib/deletion/texts";
import { listSubtitle } from "@/lib/access/access";
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

const Members = () => {
  const list = useListSearchParams();

  const [formOpen, setFormOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  // Cadastro novo com dados de um excluído: restaurado pelo aviso, o diálogo passa a editá-lo (RN-18, UX-32).
  const [restoredMember, setRestoredMember] = useState<RestoredFromWarning | null>(null);
  const [deletingMember, setDeletingMember] = useState<MemberDeletionTarget | null>(null);
  // "Novo membro" com a função padrão acima de quem cadastra (RN-19, UXD-2): o bloqueio, e não o formulário.
  const [newMemberBlocked, setNewMemberBlocked] = useState(false);
  const { hasPermission, user, access } = useAuth();
  const isMobile = useIsMobile();
  // Cartões até 1023 px, tabela a partir de 1024 px; foto e Celular a partir de 1280 px (P45).
  const showTable = useMinWidth(TABLE_MIN_WIDTH);
  const showWideColumns = useMinWidth(WIDE_TABLE_MIN_WIDTH);

  const { data, isLoading, isError, isPlaceholderData, isRefetching } = useMembersList(list.params);
  // A lista na tela recarrega (troca de página ou depois de uma gravação): as
  // linhas ficam em `opacity-60` e com `aria-busy` até a resposta (E1.08; E2.06, P44).
  const refreshing = isPlaceholderData || isRefetching;
  const members = data?.rows ?? [];
  const total = data?.total ?? 0;

  useClampPage(list, { data, isPlaceholderData });

  // Ao fechar um diálogo, o foco volta a quem o abriu ou, se o membro saiu da lista, à busca.
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocus = useReturnFocus(searchRef, data);

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
  const showActions = canEditAny || canDeleteAny;
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

  const rowActions = (m: Member): RowAction[] =>
    canDelete(m)
      ? [{ label: MEMBER_DELETION_TEXTS.deleteAction, icon: Trash2, onSelect: (trigger) => startDeletion(m, trigger) }]
      : [];

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

  const renderMobileCards = () => {
    if (isLoading) return <p className="text-center py-8 text-muted-foreground">Carregando...</p>;
    if (isError) return <p className="text-center py-8 text-destructive">Erro ao carregar os membros</p>;
    if (members.length === 0) return <p className="text-center py-8 text-muted-foreground">Nenhum membro encontrado</p>;

    return (
      <div className={`divide-y divide-border ${refreshing ? "opacity-60" : ""}`} aria-busy={refreshing}>
        {members.map((m) => (
          <div key={m.id} className="px-4 py-4 space-y-3">
            {/* Header: Avatar + Name + Actions */}
            <div className="flex items-center gap-3">
              <Avatar className="w-11 h-11 border-2 border-muted shrink-0">
                <AvatarImage src={m.avatar_url || ""} />
                <AvatarFallback className="bg-muted">
                  <User className="w-5 h-5 text-muted-foreground" />
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm break-words">{m.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5 break-words">{contactLine(m)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
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
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold">Membros</h1>
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
                  className="w-full sm:w-auto"
                >
                  <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                  {MEMBER_FORM_TEXTS.newMember}
                </Button>
              )}
            </div>
          )}
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  placeholder="Buscar por nome, e-mail ou CPF..."
                  aria-label="Buscar membros"
                  value={list.searchInput}
                  onChange={(e) => list.setSearchInput(e.target.value)}
                  maxLength={100}
                  className="pl-10"
                />
              </div>
              <Badge variant="secondary">{total.toLocaleString("pt-BR")}</Badge>
            </div>
          </CardHeader>

          {!showTable ? (
            renderMobileCards()
          ) : (
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {showWideColumns && <TableHead className="w-12"></TableHead>}
                    <TableHead>{MEMBERS_LIST_TEXTS.columnName}</TableHead>
                    {showWideColumns && <TableHead>{MEMBERS_LIST_TEXTS.columnMobile}</TableHead>}
                    <TableHead>{MEMBERS_LIST_TEXTS.columnLevel}</TableHead>
                    <TableHead>{MEMBERS_LIST_TEXTS.columnLeadership}</TableHead>
                    <TableHead>{MEMBERS_LIST_TEXTS.columnMinistry}</TableHead>
                    <TableHead>{MEMBERS_LIST_TEXTS.columnStatus}</TableHead>
                    {showActions && <ActionsHead>{MEMBERS_LIST_TEXTS.columnActions}</ActionsHead>}
                  </TableRow>
                </TableHeader>
                <TableBody aria-busy={refreshing}>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={columnCount} className="text-center py-8 text-muted-foreground">Carregando...</TableCell>
                    </TableRow>
                  ) : isError ? (
                    <TableRow>
                      <TableCell colSpan={columnCount} className="text-center py-8 text-destructive">Erro ao carregar os membros</TableCell>
                    </TableRow>
                  ) : members.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={columnCount} className="text-center py-8 text-muted-foreground">Nenhum membro encontrado</TableCell>
                    </TableRow>
                  ) : (
                    members.map((m) => (
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
                          <TableCell className="text-sm">{canSeeSensitive(m) ? (formatPhone(m.mobile_whatsapp) || "—") : "•••••"}</TableCell>
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
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          )}

          {!isLoading && !isError && (
            <ListPagination
              page={list.params.page}
              pageSize={list.params.pageSize}
              total={total}
              itemLabel={["membro", "membros"]}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
            />
          )}
        </Card>

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
