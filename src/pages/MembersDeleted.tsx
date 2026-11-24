import { useRef, useState } from "react";
import { DeletedListBody, DeletedListPage, RestoreButton } from "@/components/DeletedListLayout";
import RestoreMemberDialog from "@/components/RestoreMemberDialog";
import { MemberStatusBadge } from "@/components/StatusBadges";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";
import { useClampPage, useListSearchParams } from "@/hooks/use-list-search-params";
import { useDeletedMembersList } from "@/hooks/use-deleted-members-list";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { deletionInfo, personName, withDeletedMark, type DeletedMemberRow } from "@/lib/deletion/deleted-lists";
import { DELETED_LIST_TEXTS, MEMBER_RESTORE_TEXTS } from "@/lib/deletion/texts";

const TEXTS = DELETED_LIST_TEXTS.members;

/** O líder do membro excluído, com "(cadastro excluído)" se ele também foi excluído; sem líder, `null`. */
function leaderOf(member: DeletedMemberRow): string | null {
  if (member.leader_name === null && member.leader_deleted !== true) return null;
  return withDeletedMark(personName(member.leader_name), member.leader_deleted === true);
}

/** A lista em si: só é montada para quem tem `manage_roles` (UX-17). */
const MembersDeletedList = () => {
  const list = useListSearchParams();
  const query = useDeletedMembersList(list.params);
  useClampPage(list, query);
  const isMobile = useIsMobile();
  const [restoring, setRestoring] = useState<DeletedMemberRow | null>(null);

  // Ao fechar a restauração, o foco volta ao "Restaurar" ou, se o membro saiu da lista, à busca.
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocus = useReturnFocus(searchRef, query.data);

  const startRestore = (member: DeletedMemberRow, button: HTMLElement) => {
    returnFocus.setOpener(button);
    setRestoring(member);
  };

  const renderRestore = (member: DeletedMemberRow) => (
    <RestoreButton
      label={MEMBER_RESTORE_TEXTS.restoreLabel(personName(member.name))}
      onRestore={(button) => startRestore(member, button)}
    />
  );

  const renderCard = (member: DeletedMemberRow) => {
    const info = deletionInfo(member, TEXTS.deletedAt);
    const leader = leaderOf(member);
    return (
      <>
        <p className="font-semibold text-sm break-words">{personName(member.name)}</p>
        <div className="text-xs text-muted-foreground">
          <p>{info.deletedAt}</p>
          <p>{info.deletedBy}</p>
        </div>
        <p className="text-xs break-words">
          {leader ? DELETED_LIST_TEXTS.personLine(TEXTS.columns.leader, leader) : DELETED_LIST_TEXTS.noLeader}
        </p>
        <div className="flex items-center justify-between gap-2">
          <MemberStatusBadge active={member.is_active === true} />
          {renderRestore(member)}
        </div>
      </>
    );
  };

  const renderRow = (member: DeletedMemberRow, className: string | undefined) => {
    const info = deletionInfo(member, TEXTS.deletedAt);
    return (
      <TableRow key={member.id} className={className}>
        <TableCell className="font-medium break-words">{personName(member.name)}</TableCell>
        <TableCell className="text-sm break-words">{leaderOf(member) ?? "—"}</TableCell>
        <TableCell>
          <MemberStatusBadge active={member.is_active === true} />
        </TableCell>
        <TableCell className="text-sm whitespace-nowrap">{info.deletedAtShort}</TableCell>
        <TableCell className="text-sm">{info.deletedByShort}</TableCell>
        <TableCell className="text-right">{renderRestore(member)}</TableCell>
      </TableRow>
    );
  };

  return (
    <>
      <DeletedListBody
        texts={TEXTS}
        list={list}
        query={query}
        searchRef={searchRef}
        isMobile={isMobile}
        rowKey={(member) => member.id}
        renderCard={renderCard}
        tableHead={
          <>
            <TableHead>{TEXTS.columns.name}</TableHead>
            <TableHead>{TEXTS.columns.leader}</TableHead>
            <TableHead>{TEXTS.columns.status}</TableHead>
            <TableHead>{TEXTS.columns.deletedAt}</TableHead>
            <TableHead>{TEXTS.columns.deletedBy}</TableHead>
          </>
        }
        renderRow={renderRow}
      />
      {restoring && (
        <RestoreMemberDialog
          key={restoring.id}
          member={restoring}
          onClose={() => setRestoring(null)}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        />
      )}
    </>
  );
};

/** Membros excluídos (E2.01, T4 e T5): `/members/deleted`, só para administradores. */
const MembersDeleted = () => (
  <DeletedListPage texts={TEXTS} listPath="/members">
    <MembersDeletedList />
  </DeletedListPage>
);

export default MembersDeleted;
