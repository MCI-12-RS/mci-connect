import { Controller, useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/auth/PasswordInput";
import type { RoleFieldView } from "@/lib/access/member-form";
import { describedBy } from "@/lib/a11y";
import { INITIAL_PASSWORD_TEXTS, REVEAL_LABELS } from "@/lib/auth/password-texts";
import type { MemberFormFields } from "@/lib/members/form-values";
import type { PasswordRowView } from "@/lib/members/password-row";
import { MEMBER_FORM_LAYOUT_TEXTS as TEXTS } from "@/lib/members/texts";
import { MemberRoleField } from "./MemberRoleField";
import { MemberPasswordRow } from "./MemberPasswordRow";
import { FieldError } from "./FormFieldParts";
import type { ResetPasswordOutcome, ResetPasswordTarget } from "./ResetPasswordDialog";
import { FIELD_BLOCK, errorOf, invalidBorder, type MemberFieldsUi } from "./member-form-ui";

/** A linha "Senha" da edição (E2.03, T5). */
export interface MemberPasswordRowProps {
  view: PasswordRowView;
  member: ResetPasswordTarget;
  onResetOutcome: (outcome: ResetPasswordOutcome) => void;
}

interface MemberAccessSectionProps {
  ui: MemberFieldsUi;
  roleView: RoleFieldView;
  roleLoadFailed: boolean;
  /** Cadastro novo: a senha inicial (RN-07). */
  isNew: boolean;
  /** Na edição: a linha "Senha"; `null` quando ela não aparece. */
  passwordRow: MemberPasswordRowProps | null;
  /** Confere a senha inicial ao sair do campo (P16), com os dados do formulário. */
  onPasswordBlur: () => void;
}

/**
 * Acesso (E2.02, T6; E2.03, T5): a Função e, ao lado no desktop, a senha
 * inicial do cadastro novo ou a linha "Senha" da edição.
 */
export function MemberAccessSection({ ui, roleView, roleLoadFailed, isNew, passwordRow, onPasswordBlur }: MemberAccessSectionProps) {
  const { register, control } = useFormContext<MemberFormFields>();
  const initialRole = roleView.kind === "select" ? roleView.initialValue : null;
  const passwordError = errorOf(ui, "password");
  const passwordField = register("password", { onBlur: onPasswordBlur });

  return (
    <section className="space-y-4">
      <h3 className="text-lg font-semibold">{TEXTS.sections.access}</h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Controller
          name="role_id"
          control={control}
          render={({ field }) => (
            <MemberRoleField
              view={roleView}
              loadFailed={roleLoadFailed}
              value={field.value ?? initialRole}
              onChange={field.onChange}
              error={errorOf(ui, "role_id")}
              triggerRef={field.ref}
            />
          )}
        />
        {isNew && (
          <div className={FIELD_BLOCK}>
            <Label htmlFor="password">{INITIAL_PASSWORD_TEXTS.label}</Label>
            {/* As dicas entre o rótulo e o campo, sem o ícone ao vivo: o campo é opcional (P16). */}
            <div className="space-y-1 text-sm text-muted-foreground">
              <p id="password-default-hint">{INITIAL_PASSWORD_TEXTS.defaultHint}</p>
              <p id="password-rules-hint">{INITIAL_PASSWORD_TEXTS.rules}</p>
            </div>
            {/* A senha de outra pessoa: os gerenciadores de quem cadastra não sugerem nem salvam (UX-30). */}
            <PasswordInput
              id="password"
              revealLabels={REVEAL_LABELS.single}
              autoComplete="off"
              data-1p-ignore=""
              data-lpignore="true"
              data-bwignore=""
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={describedBy("password-default-hint", "password-rules-hint", passwordError && "password-error")}
              className={invalidBorder(!!passwordError)}
              {...passwordField}
            />
            {passwordError && <FieldError id="password-error">{passwordError}</FieldError>}
          </div>
        )}
        {passwordRow && <MemberPasswordRow {...passwordRow} />}
      </div>
    </section>
  );
}
