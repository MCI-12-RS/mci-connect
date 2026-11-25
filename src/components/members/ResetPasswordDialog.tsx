import { useEffect, useRef, useState } from "react";
import { Check, Clock, Copy, Loader2, Share2, WifiOff } from "lucide-react";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import LongAlertDialogContent, { DIALOG_FOOTER_BUTTON } from "@/components/LongAlertDialogContent";
import { BlockedActionContent } from "@/components/BlockedActionDialog";
import { usePasswordReset } from "@/hooks/use-password-reset";
import { RESET_TEXTS, resetRefusalMessage, type ResetRefusalCode } from "@/lib/auth/password-texts";
import { displayGroups, formatValidUntil, spellForScreenReader } from "@/lib/auth/temporary-password";
import { cn } from "@/lib/utils";

/** O membro cuja senha é redefinida. */
export interface ResetPasswordTarget {
  id: string;
  name: string;
  /** Para "conectado" ou "conectada" (P-SEN-25). */
  gender: string | null;
}

/** Como o diálogo terminou, para a tela decidir o que fazer depois (T5, T6). */
export type ResetPasswordOutcome =
  | { kind: "cancelled" }
  | { kind: "reset"; resetAt: string }
  | { kind: "refused"; code: ResetRefusalCode };

interface ResetPasswordDialogProps {
  member: ResetPasswordTarget;
  onClose: (outcome: ResetPasswordOutcome) => void;
  /** Ao fechar, o foco volta a quem abriu ("Redefinir senha" ou o "⋯" da linha). */
  onCloseAutoFocus?: (event: Event) => void;
}

type Step =
  | { kind: "confirm"; connectionError: boolean }
  | { kind: "password"; password: string; expiresAt: string; resetAt: string }
  | { kind: "refused"; code: ResetRefusalCode; minutes?: number };

/** Quanto tempo o botão mostra "Senha copiada" (T6). */
const COPIED_MS = 3_000;

/** O compartilhamento do aparelho, quando existe (UX-25). */
function canShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/**
 * "Redefinir senha" (E2.03, T6, P9, P3 e P17): a confirmação e, no sucesso, a
 * senha temporária, mostrada uma vez. Nada fecha durante o envio, e a senha
 * só fecha por "Concluir" (UXD-3). A senha fica só no estado deste diálogo,
 * que some ao fechar.
 */
export function ResetPasswordDialog({ member, onClose, onCloseAutoFocus }: ResetPasswordDialogProps) {
  const reset = usePasswordReset();
  const [step, setStep] = useState<Step>({ kind: "confirm", connectionError: false });
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const outcome = useRef<ResetPasswordOutcome>({ kind: "cancelled" });
  const cancelRef = useRef<HTMLButtonElement>(null);
  const resultTitleRef = useRef<HTMLHeadingElement>(null);
  const passwordRef = useRef<HTMLParagraphElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const busy = reset.isPending;

  // A senha temporária leva o foco ao título; a recusa, a "Fechar" (T6).
  useEffect(() => {
    if (step.kind === "password") resultTitleRef.current?.focus();
    if (step.kind === "refused") closeRef.current?.focus();
  }, [step.kind]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const finish = (result: ResetPasswordOutcome) => {
    outcome.current = result;
    setOpen(false);
  };

  const confirm = async () => {
    const result = await reset.reset(member.id);
    if (!result) return;
    if (result.result === "ok") {
      setStep({ kind: "password", password: result.password, expiresAt: result.expiresAt, resetAt: result.resetAt });
    } else if (result.result === "refused") {
      outcome.current = { kind: "refused", code: result.code };
      setStep({ kind: "refused", code: result.code, minutes: result.minutes });
    } else {
      setStep({ kind: "confirm", connectionError: true });
    }
  };

  const copy = async (password: string) => {
    try {
      await navigator.clipboard.writeText(password);
      setCopyFailed(false);
      setCopied(true);
    } catch {
      // A senha fica selecionada, para a pessoa copiar à mão.
      const node = passwordRef.current;
      const selection = window.getSelection();
      if (node && selection) {
        selection.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.addRange(range);
      }
      setCopyFailed(true);
    }
  };

  const share = async (password: string) => {
    try {
      // Só os 8 caracteres, sem mais texto (P-SEN-18).
      await navigator.share({ text: password });
    } catch {
      // Desistir do compartilhamento não é erro.
    }
  };

  // Enquanto envia e na senha temporária, `Esc` e o toque fora não fecham (UXD-3).
  const locked = busy || step.kind === "password";
  const preventWhenLocked = (event: Event) => {
    if (locked) event.preventDefault();
  };

  const handleOpenChange = (next: boolean) => {
    if (next || locked) return;
    setOpen(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <LongAlertDialogContent
        onOpenAutoFocus={(event) => {
          // A confirmação começa em "Cancelar" (P9).
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          onClose(outcome.current);
        }}
        onEscapeKeyDown={preventWhenLocked}
      >
        {step.kind === "confirm" && (
          <>
            <AlertDialogHeader className="text-left">
              <AlertDialogTitle className="break-words">{RESET_TEXTS.confirmTitle(member.name)}</AlertDialogTitle>
              {/* A cor vai num elemento de dentro: o `asChild` só concatena as classes, e o cinza da descrição prevaleceria. */}
              <AlertDialogDescription asChild>
                <div>
                  <div className="space-y-3 text-sm text-foreground">
                    {step.connectionError && (
                      <Alert role="alert" variant="destructive" className="text-foreground dark:[&>svg]:text-foreground">
                        <WifiOff className="h-4 w-4" aria-hidden="true" />
                        <AlertDescription>{RESET_TEXTS.connection}</AlertDescription>
                      </Alert>
                    )}
                    <ul className="list-disc space-y-1 pl-5">
                      {RESET_TEXTS.confirmTopics(member.name, member.gender).map((topic) => (
                        <li key={topic}>{topic}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:gap-0">
              <Button
                ref={cancelRef}
                type="button"
                variant="outline"
                className={DIALOG_FOOTER_BUTTON}
                disabled={busy}
                onClick={() => finish({ kind: "cancelled" })}
              >
                {RESET_TEXTS.cancel}
              </Button>
              <Button type="button" className={DIALOG_FOOTER_BUTTON} disabled={busy} onClick={() => void confirm()}>
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    {RESET_TEXTS.confirming}
                  </>
                ) : (
                  RESET_TEXTS.confirm
                )}
              </Button>
            </AlertDialogFooter>
          </>
        )}

        {step.kind === "password" && (
          <>
            <AlertDialogHeader className="text-left">
              <AlertDialogTitle ref={resultTitleRef} tabIndex={-1} className="break-words focus:outline-none">
                {RESET_TEXTS.resultTitle(member.name)}
              </AlertDialogTitle>
              {/* A cor vai num elemento de dentro: o `asChild` só concatena as classes, e o cinza da descrição prevaleceria. */}
              <AlertDialogDescription asChild>
                <div>
                  <div className="space-y-3 text-sm text-foreground">
                    <p
                      ref={passwordRef}
                      translate="no"
                      aria-hidden="true"
                      data-testid="temporary-password"
                      className="flex select-all flex-wrap justify-center gap-3 rounded-md bg-muted px-3 py-3 font-mono text-3xl tracking-widest text-foreground"
                    >
                      {displayGroups(step.password).map((group, i) => (
                        <span key={i}>{group}</span>
                      ))}
                    </p>
                    <span className="sr-only">{spellForScreenReader(step.password)}</span>
                    <p className="text-sm text-muted-foreground">{RESET_TEXTS.onlyLowercase}</p>
                    <p className="flex items-start gap-1.5 text-sm">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{RESET_TEXTS.validUntil(formatValidUntil(step.expiresAt))}</span>
                    </p>
                    <p>
                      {RESET_TEXTS.passOn(member.name)} <strong className="font-semibold">{RESET_TEXTS.notShownAgain}</strong>
                    </p>
                    <p>{RESET_TEXTS.howToEnter(member.name)}</p>
                    {copyFailed && <p className="text-sm">{RESET_TEXTS.copyFailed}</p>}
                    <p role="status" className="sr-only">
                      {copied ? RESET_TEXTS.copiedStatus : ""}
                    </p>
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
              <Button type="button" className={cn(DIALOG_FOOTER_BUTTON, "h-11")} onClick={() => void copy(step.password)}>
                {copied ? (
                  <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                {/* As duas frases ocupam o mesmo espaço: o botão não muda de tamanho (UX-24). */}
                <span className="grid">
                  <span className={cn("col-start-1 row-start-1", copied && "invisible")} aria-hidden={copied}>
                    {RESET_TEXTS.copy}
                  </span>
                  <span className={cn("col-start-1 row-start-1", !copied && "invisible")} aria-hidden={!copied}>
                    {RESET_TEXTS.copied}
                  </span>
                </span>
              </Button>
              {canShare() && (
                <Button type="button" variant="outline" className={cn(DIALOG_FOOTER_BUTTON, "h-11")} onClick={() => void share(step.password)}>
                  <Share2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  {RESET_TEXTS.share}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className={cn(DIALOG_FOOTER_BUTTON, "h-11")}
                onClick={() => finish({ kind: "reset", resetAt: step.resetAt })}
              >
                {RESET_TEXTS.done}
              </Button>
            </div>
          </>
        )}

        {step.kind === "refused" && (
          <BlockedActionContent title={RESET_TEXTS.refusedTitle} closeRef={closeRef}>
            <p>{resetRefusalMessage(step.code, step.minutes)}</p>
          </BlockedActionContent>
        )}
      </LongAlertDialogContent>
    </AlertDialog>
  );
}

export default ResetPasswordDialog;
