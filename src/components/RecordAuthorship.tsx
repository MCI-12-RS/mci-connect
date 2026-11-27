import { useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { DiscardChangesDialog } from "@/components/form/DiscardChangesDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useRecordAuthorship } from "@/hooks/use-record-authorship";
import { authorshipLines, recordHistoryPath, type Authorship, type AuthorshipEntity } from "@/lib/audit/authorship";
import { AUTHORSHIP_TEXTS as TEXTS } from "@/lib/audit/texts";

interface RecordAuthorshipProps {
  entity: AuthorshipEntity;
  recordId: string;
  /** O nome do registro no `aria-label` de "Ver histórico": o membro, o líder da célula ou a data do relatório. */
  recordName: string;
  /** A autoria já lida com o registro ("Ver relatório"); sem ela, o bloco lê por id (com `Skeleton`). */
  authorship?: Authorship | null;
  /** O formulário tem alterações: "Ver histórico" pede antes "Descartar as alterações?" (P31, UX-07). */
  isDirty?: () => boolean;
}

/** As frases (P30): o autor em destaque, só como texto (RN-08). */
function AuthorshipText({ entity, authorship }: { entity: AuthorshipEntity; authorship: Authorship }) {
  return (
    <div className="min-w-0 space-y-0.5 text-sm text-muted-foreground">
      {authorshipLines(entity, authorship).map((line) => (
        <p key={line.kind} className="break-words">
          {line.before}
          {line.author && <span className="font-medium text-foreground">{line.author}</span>}
          {line.after}
        </p>
      ))}
    </div>
  );
}

/**
 * A autoria no registro aberto (E2.05, T1 a T4; P30 e P31): quem cadastrou (ou enviou) e quem alterou
 * por último, no topo do corpo, seguida de um `Separator`, e "Ver histórico" só para quem audita.
 * Só no registro já gravado: o registro novo não usa este componente.
 */
export function RecordAuthorship({ entity, recordId, recordName, authorship: preloaded, isDirty }: RecordAuthorshipProps) {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const query = useRecordAuthorship(entity, recordId, { enabled: preloaded === undefined });
  const authorship = preloaded === undefined ? query.data : preloaded;
  const canAudit = hasPermission("view_audit_log");
  const historyPath = recordHistoryPath(entity, recordId);

  const openHistory = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isDirty?.()) return;
    event.preventDefault();
    setConfirmDiscard(true);
  };

  let body;
  if (preloaded === undefined && query.isPending) {
    body = (
      <div className="flex-1 space-y-2 py-0.5" aria-hidden="true" data-testid="authorship-loading">
        <Skeleton className="h-4 w-full max-w-sm" />
        <Skeleton className="h-4 w-2/3 max-w-xs" />
      </div>
    );
  } else if (preloaded === undefined && query.isError) {
    body = (
      <div className="flex-1 text-sm">
        <p>{TEXTS.loadFailed}</p>
        <Button type="button" variant="link" className="h-auto min-h-11 p-0 md:min-h-0" onClick={() => void query.refetch()}>
          {TEXTS.tryAgain}
        </Button>
      </div>
    );
  } else if (authorship) {
    body = <AuthorshipText entity={entity} authorship={authorship} />;
  } else if (canAudit) {
    // A autoria não veio (excluído no meio tempo ou fora do escopo), mas quem audita ainda chega ao histórico.
    body = <div className="flex-1" />;
  } else {
    // O registro não veio e quem consulta não audita: nada a mostrar.
    return null;
  }

  return (
    <div className="space-y-4" data-testid="record-authorship">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-4">
        {body}
        {canAudit && (
          <Button asChild variant="outline" className="h-11 shrink-0 self-start md:h-9">
            <Link to={historyPath} aria-label={TEXTS.viewHistoryLabel[entity](recordName)} onClick={openHistory}>
              <History className="h-4 w-4" aria-hidden="true" />
              {TEXTS.viewHistory}
            </Link>
          </Button>
        )}
      </div>
      <Separator />

      <DiscardChangesDialog open={confirmDiscard} onOpenChange={setConfirmDiscard} onDiscard={() => navigate(historyPath)} />
    </div>
  );
}
