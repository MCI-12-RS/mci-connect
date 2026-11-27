import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PREFILLED_LEADER_TEXTS as TEXTS } from "@/lib/members/texts";

/**
 * "O líder já vem preenchido com você." (E2.07, P55, T7): no topo do "Novo membro" de quem vê a igreja
 * toda, com "Ir para o líder". Texto comum, sem `role="alert"`: não muda sozinho.
 */
export function PrefilledLeaderNotice({ onGoToLeader }: { onGoToLeader: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm" data-testid="prefilled-leader-notice">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p>{TEXTS.notice}</p>
        <Button type="button" variant="link" className="h-11 px-0 lg:h-9" onClick={onGoToLeader}>
          {TEXTS.goToLeader}
        </Button>
      </div>
    </div>
  );
}
