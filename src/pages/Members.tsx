import { useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import MemberForm from "@/components/MemberForm";
import MemberDeletionFlow, { type MemberDeletionTarget } from "@/components/MemberDeletionFlow";
import RowActionsMenu, { type RowAction } from "@/components/RowActionsMenu";
import ListPagination from "@/components/ListPagination";
import DeletedListButton from "@/components/DeletedListButton";
import { MemberStatusBadge, NoLeadershipBadge } from "@/components/StatusBadges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Search, Pencil, Trash2, User } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useClampPage, useListSearchParams } from "@/hooks/use-list-search-params";
import { useMembersList } from "@/hooks/use-members-list";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { UNNAMED_MEMBER_LABEL, type MemberRow } from "@/lib/members/fields";
import { DELETED_LIST_TEXTS, MEMBER_DELETION_TEXTS } from "@/lib/deletion/texts";

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
  const [deletingMember, setDeletingMember] = useState<MemberDeletionTarget | null>(null);
  const { hasPermission, user } = useAuth();
  const isMobile = useIsMobile();

  const { data, isLoading, isError, isPlaceholderData } = useMembersList(list.params);
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
  };

  const getLevelLabel = (level: number) => {
    if (level === 0) return "Pastor";
    return Math.pow(12, level).toString();
  };

  const canEditAny = hasPermission("edit_member") || hasPermission("edit_own_data");
  const canDeleteAny = hasPermission("delete_member");
  const showActions = canEditAny || canDeleteAny;

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

  const LevelBadge = ({ m }: { m: Member }) => {
    if (m.is_pastor) return <Badge variant="default">Pastor</Badge>;
    if (!m.leader_id) return <NoLeadershipBadge />;
    return <Badge variant="outline">{getLevelLabel(m.g12_level)}</Badge>;
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

  const renderMobileCards = () => {
    if (isLoading) return <p className="text-center py-8 text-muted-foreground">Carregando...</p>;
    if (isError) return <p className="text-center py-8 text-destructive">Erro ao carregar os membros</p>;
    if (members.length === 0) return <p className="text-center py-8 text-muted-foreground">Nenhum membro encontrado</p>;

    return (
      <div className={`divide-y divide-border ${isPlaceholderData ? "opacity-60" : ""}`}>
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
                <p className="text-xs text-muted-foreground mt-0.5">
                  {m.instagram || (canSeeSensitive(m) && m.email && !m.email.endsWith("@mci12fakemail.com") ? m.email : canSeeSensitive(m) ? formatPhone(m.mobile_whatsapp) || "—" : "—")}
                </p>
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

            {/* Info row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LevelBadge m={m} />
                <MemberStatusBadge active={m.is_active === true} />
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{m.total_disciples} disc.</span>
                <span>{m.total_cells} cél.</span>
              </div>
            </div>

            {/* Leader */}
            {m.leader_name && (
              <p className="text-xs text-muted-foreground">
                Líder: <span className="font-medium text-foreground">{m.leader_name}</span>
              </p>
            )}
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
              <p className="text-muted-foreground text-sm">Gerenciar membros da igreja</p>
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
                    setFormOpen(true);
                  }}
                  className="w-full sm:w-auto"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Novo Membro
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

          {isMobile ? (
            renderMobileCards()
          ) : (
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Celular</TableHead>
                    <TableHead>Nível G12</TableHead>
                    <TableHead>Ministério</TableHead>
                    <TableHead>Líder</TableHead>
                    <TableHead>Status</TableHead>
                    {showActions && <TableHead className="w-24">Ações</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={showActions ? 8 : 7} className="text-center py-8 text-muted-foreground">Carregando...</TableCell>
                    </TableRow>
                  ) : isError ? (
                    <TableRow>
                      <TableCell colSpan={showActions ? 8 : 7} className="text-center py-8 text-destructive">Erro ao carregar os membros</TableCell>
                    </TableRow>
                  ) : members.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={showActions ? 8 : 7} className="text-center py-8 text-muted-foreground">Nenhum membro encontrado</TableCell>
                    </TableRow>
                  ) : (
                    members.map((m) => (
                      <TableRow key={m.id} className={isPlaceholderData ? "opacity-60" : undefined}>
                        <TableCell>
                          <Avatar className="w-10 h-10 border">
                            <AvatarImage src={m.avatar_url || ""} />
                            <AvatarFallback className="bg-muted">
                              <User className="w-5 h-5 text-muted-foreground" />
                            </AvatarFallback>
                          </Avatar>
                        </TableCell>
                        <TableCell>
                          <div>
                            <span className="font-medium">{m.name}</span>
                            {m.instagram && <p className="text-xs text-primary font-medium">{m.instagram}</p>}
                            {!m.instagram && canSeeSensitive(m) && m.email && !m.email.endsWith("@mci12fakemail.com") && (
                              <p className="text-xs text-muted-foreground">{m.email}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{canSeeSensitive(m) ? (formatPhone(m.mobile_whatsapp) || "—") : "•••••"}</TableCell>
                        <TableCell><LevelBadge m={m} /></TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{m.total_disciples} Discípulo{m.total_disciples !== 1 ? "s" : ""}</span>
                            <span className="text-sm text-muted-foreground">{m.total_cells} Célula{m.total_cells !== 1 ? "s" : ""}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{m.leader_name || "—"}</TableCell>
                        <TableCell>
                          <MemberStatusBadge active={m.is_active === true} />
                        </TableCell>
                        {showActions && (
                          <TableCell>
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
                          </TableCell>
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

        <Dialog open={formOpen} onOpenChange={handleClose}>
          <DialogContent
            className="max-w-3xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full"
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          >
            <DialogHeader>
              <DialogTitle>{editingMember ? "Editar Membro" : "Novo Membro"}</DialogTitle>
            </DialogHeader>
            <MemberForm member={editingMember} onClose={handleClose} />
          </DialogContent>
        </Dialog>

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
