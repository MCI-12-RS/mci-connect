import { Clock, WifiOff } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/members/FormFieldParts";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { PasswordRules } from "@/components/auth/PasswordRules";
import { describedBy } from "@/lib/a11y";
import type { PasswordChangeField } from "@/lib/auth/password-policy";
import { PASSWORD_CHANGE_TEXTS, REVEAL_LABELS, changeBlockedMessage } from "@/lib/auth/password-texts";
import { cn } from "@/lib/utils";
import type { PasswordChangeForm } from "@/hooks/use-password-change-form";

const AUTOCOMPLETE: Record<PasswordChangeField, string> = {
  current_password: "current-password",
  new_password: "new-password",
  confirmation: "new-password",
};

const ENTER_KEY_HINT: Record<PasswordChangeField, "next" | "done"> = {
  current_password: "next",
  new_password: "next",
  confirmation: "done",
};

/** Para o Safari gerar uma senha dentro da política (T2). */
const PASSWORD_RULES_ATTRIBUTE = "minlength: 8; maxlength: 72;";

interface PasswordChangeFieldsProps {
  /** Prefixo dos ids, único na página. */
  idPrefix: string;
  form: PasswordChangeForm;
}

/**
 * O espaço de mensagens e os campos das trocas (T2 e T3): "Senha atual" (só na
 * voluntária), "Nova senha" com as regras (P16) e "Confirmar nova senha". O
 * `aria-describedby` junta as regras, a ajuda e o erro, nessa ordem.
 */
export function PasswordChangeFields({ idPrefix, form }: PasswordChangeFieldsProps) {
  const ids = (field: PasswordChangeField) => ({
    input: `${idPrefix}-${field}`,
    error: `${idPrefix}-${field}-error`,
  });
  const rulesId = `${idPrefix}-rules`;
  const helpId = `${idPrefix}-current-help`;
  const { notice } = form;

  return (
    <>
      {notice && (
        <Alert
          key={form.attempt}
          ref={form.noticeRef}
          role={notice.kind === "connection" ? "alert" : undefined}
          tabIndex={notice.kind === "blocked" ? -1 : undefined}
          variant="destructive"
          className="text-foreground dark:[&>svg]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="password-change-notice"
        >
          {notice.kind === "blocked" ? (
            <Clock className="h-4 w-4" aria-hidden="true" />
          ) : (
            <WifiOff className="h-4 w-4" aria-hidden="true" />
          )}
          <AlertDescription>
            {notice.kind === "blocked" ? changeBlockedMessage(notice.minutes) : PASSWORD_CHANGE_TEXTS.connection}
          </AlertDescription>
        </Alert>
      )}

      {form.fields.map((field) => {
        const { input, error } = ids(field);
        const message = form.errors[field];
        const isNew = field === "new_password";
        const showHelp = field === "current_password" && form.showCurrentHelp;
        return (
          <div key={field} className="space-y-2">
            <Label htmlFor={input}>{PASSWORD_CHANGE_TEXTS.labels[field]}</Label>
            {isNew && <PasswordRules id={rulesId} password={form.values.new_password} />}
            <PasswordInput
              id={input}
              ref={form.refs[field]}
              revealLabels={REVEAL_LABELS[field]}
              hideSignal={form.hideSignal}
              value={form.values[field]}
              onChange={(event) => form.setValue(field, event.target.value)}
              onBlur={() => form.handleBlur(field)}
              onKeyDown={(event) => form.handleKeyDown(field, event)}
              autoComplete={AUTOCOMPLETE[field]}
              enterKeyHint={ENTER_KEY_HINT[field]}
              aria-invalid={message ? true : undefined}
              aria-describedby={describedBy(isNew && rulesId, showHelp && helpId, message && error)}
              className={cn(message && "border-destructive")}
              {...(field === "current_password" ? {} : { passwordrules: PASSWORD_RULES_ATTRIBUTE })}
            />
            {message && <FieldError id={error}>{message}</FieldError>}
            {showHelp && (
              <p id={helpId} className="text-sm text-muted-foreground">
                {PASSWORD_CHANGE_TEXTS.currentHelp}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}

export default PasswordChangeFields;
