import { useId, useRef, useState } from "react";
import { Check, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChangeOwnPasswordDialog } from "@/components/auth/ChangeOwnPasswordDialog";
import { ResetPasswordDialog, type ResetPasswordOutcome, type ResetPasswordTarget } from "@/components/members/ResetPasswordDialog";
import { OWN_CHANGE_TEXTS, PASSWORD_ROW_TEXTS } from "@/lib/auth/password-texts";
import { formatResetTime } from "@/lib/auth/temporary-password";
import type { PasswordRowView } from "@/lib/members/password-row";
import { FIELD_BLOCK } from "./member-form-ui";

interface MemberPasswordRowProps {
  view: PasswordRowView;
  /** O membro do cadastro (para a redefinição). */
  member: ResetPasswordTarget;
  /** Uma redefinição terminou (recusa ou sucesso): o cadastro decide o que fazer depois (T6). */
  onResetOutcome: (outcome: ResetPasswordOutcome) => void;
}

/**
 * A linha "Senha" da seção Acesso na edição (E2.03, T5, UXD-6 e UXD-7):
 * "Redefinir senha", "Alterar minha senha" ou o texto da recusa previsível
 * (P12). O rótulo é um `<p>`, porque não há campo.
 */
export function MemberPasswordRow({ view, member, onResetOutcome }: MemberPasswordRowProps) {
  const [dialog, setDialog] = useState<"reset" | "own" | null>(null);
  const [resetAt, setResetAt] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const resetAtId = `${useId()}-reset-at`;

  if (view.kind === "hidden") return null;

  const returnFocus = (event: Event) => {
    if (!buttonRef.current?.isConnected) return;
    event.preventDefault();
    buttonRef.current.focus();
  };

  const finishReset = (outcome: ResetPasswordOutcome) => {
    setDialog(null);
    if (outcome.kind === "reset") setResetAt(outcome.resetAt);
    onResetOutcome(outcome);
  };

  const buttonClass = "h-11 w-full md:w-auto";

  return (
    <div className={FIELD_BLOCK}>
      <p className="text-sm font-medium">{PASSWORD_ROW_TEXTS.label}</p>
      {view.kind === "loading" && <Skeleton className="h-11 w-full" data-testid="password-row-loading" />}
      {view.kind === "no_account" && <p className="text-sm text-muted-foreground">{PASSWORD_ROW_TEXTS.noAccount}</p>}
      {view.kind === "role_not_covered" && (
        <p className="text-sm text-muted-foreground">{PASSWORD_ROW_TEXTS.roleNotCovered}</p>
      )}
      {view.kind === "change_own" && (
        <Button ref={buttonRef} type="button" variant="outline" size="lg" className={buttonClass} onClick={() => setDialog("own")}>
          <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
          {OWN_CHANGE_TEXTS.action}
        </Button>
      )}
      {view.kind === "reset" && (
        <>
          <Button
            ref={buttonRef}
            type="button"
            variant="outline"
            size="lg"
            className={buttonClass}
            aria-describedby={resetAt ? resetAtId : undefined}
            onClick={() => setDialog("reset")}
          >
            <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
            {PASSWORD_ROW_TEXTS.reset}
          </Button>
          {resetAt && (
            <p id={resetAtId} className="flex items-start gap-1.5 text-sm text-foreground">
              <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{PASSWORD_ROW_TEXTS.resetAt(formatResetTime(resetAt))}</span>
            </p>
          )}
        </>
      )}

      {dialog === "reset" && <ResetPasswordDialog member={member} onClose={finishReset} onCloseAutoFocus={returnFocus} />}
      {dialog === "own" && <ChangeOwnPasswordDialog onClose={() => setDialog(null)} onCloseAutoFocus={returnFocus} />}
    </div>
  );
}

export default MemberPasswordRow;
