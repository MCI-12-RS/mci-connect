import { useId, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import ResponsiveDialogContent from "@/components/ResponsiveDialogContent";
import { PasswordChangeFields } from "@/components/auth/PasswordChangeFields";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { usePasswordChangeForm } from "@/hooks/use-password-change-form";
import type { PasswordPersonalData } from "@/lib/auth/password-policy";
import { OWN_CHANGE_TEXTS, PASSWORD_CHANGE_TEXTS } from "@/lib/auth/password-texts";

interface ChangeOwnPasswordDialogProps {
  /** Fecha o diálogo (o pai o desmonta: da próxima vez, os campos voltam vazios). */
  onClose: () => void;
  /** Ao fechar, leva o foco a quem abriu: o ☰, o item do menu ou o botão do cadastro (T3). */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * "Alterar minha senha" (E2.03, T3, RN-11): diálogo responsivo (P1), com a
 * senha atual. Fecha sem perguntar (UXD-9), menos durante o envio.
 */
export function ChangeOwnPasswordDialog({ onClose, onCloseAutoFocus }: ChangeOwnPasswordDialogProps) {
  const { member } = useAuth();
  const { toast } = useToast();
  const formId = `${useId()}-own-password`;
  const closedRef = useRef(false);

  // Os dados pessoais do próprio cadastro, para a tela conferir a regra (g) (AQ-6).
  const personal: PasswordPersonalData | null = member
    ? { cpf: member.cpf, mobile: member.mobile_whatsapp, birth_date: member.birth_date, email: member.email }
    : null;

  const form = usePasswordChangeForm({
    mode: "voluntary",
    personal,
    onSuccess: () => {
      closedRef.current = true;
      onClose();
      toast({ title: OWN_CHANGE_TEXTS.success });
    },
  });
  const busy = form.submitting;

  const close = () => {
    if (busy || closedRef.current) return;
    closedRef.current = true;
    onClose();
  };

  const blockWhileBusy = (event: Event) => {
    if (busy) event.preventDefault();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <ResponsiveDialogContent
        title={OWN_CHANGE_TEXTS.title}
        closeLabel={OWN_CHANGE_TEXTS.close}
        className="md:max-w-md"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // A pessoa pediu para trocar: o foco vai para "Senha atual", e o teclado abre.
          event.preventDefault();
          form.refs.current_password.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={blockWhileBusy}
        onPointerDownOutside={blockWhileBusy}
        onInteractOutside={blockWhileBusy}
        footer={
          <>
            <Button type="button" variant="outline" className="h-11 md:h-10" onClick={close} disabled={busy}>
              {PASSWORD_CHANGE_TEXTS.cancel}
            </Button>
            <Button type="submit" form={formId} className="h-11 md:h-10" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  {PASSWORD_CHANGE_TEXTS.submitting}
                </>
              ) : (
                PASSWORD_CHANGE_TEXTS.submit
              )}
            </Button>
          </>
        }
      >
        {/* O envio não sobe pela árvore do React até o formulário do cadastro, quando aberto de lá (T5). */}
        <form
          id={formId}
          onSubmit={(event) => {
            event.stopPropagation();
            void form.handleSubmit(event);
          }}
          noValidate
          className="space-y-4"
        >
          <PasswordChangeFields idPrefix={formId} form={form} />
        </form>
      </ResponsiveDialogContent>
    </Dialog>
  );
}

export default ChangeOwnPasswordDialog;
