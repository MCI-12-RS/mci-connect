import type { Ref } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MEMBER_FORM_TEXTS } from "@/lib/access/texts";
import type { RoleFieldView } from "@/lib/access/member-form";
import { FieldError, ReadOnlyValue } from "./FormFieldParts";
import { describedBy } from "@/lib/a11y";

interface MemberRoleFieldProps {
  view: RoleFieldView;
  /** A leitura de `role_options` falhou. */
  loadFailed: boolean;
  value: string | null;
  onChange: (roleId: string) => void;
  /** Recusa ou validação embaixo do campo (RN-18, T11). */
  error: string | null;
  triggerRef?: Ref<HTMLButtonElement>;
}

/**
 * Campo Função do cadastro (T6, RN-18, UXD-12, UX-21). O Select só é montado
 * com as opções já lidas: dentro de um <form>, o Select do Radix mantém um
 * <select> nativo oculto, e um valor sem a <option> correspondente vira "" e
 * apaga a função escolhida.
 */
export function MemberRoleField({ view, loadFailed, value, onChange, error, triggerRef }: MemberRoleFieldProps) {
  switch (view.kind) {
    case "hidden":
      return null;
    case "pending":
      return (
        <ReadOnlyValue
          label={MEMBER_FORM_TEXTS.roleTextLabel}
          value={loadFailed ? MEMBER_FORM_TEXTS.roleLoadFailed : MEMBER_FORM_TEXTS.roleLoading}
        />
      );
    case "text":
      return (
        <div className="space-y-2">
          <ReadOnlyValue label={MEMBER_FORM_TEXTS.roleTextLabel} value={view.value} note={view.note} />
          {error && <FieldError id="role-error">{error}</FieldError>}
        </div>
      );
    case "select":
      return (
        <div className="space-y-2">
          <Label htmlFor="role">{MEMBER_FORM_TEXTS.roleLabel}</Label>
          <Select value={value ?? ""} onValueChange={onChange}>
            <SelectTrigger
              ref={triggerRef}
              id="role"
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy(error && "role-error")}
              className={error ? "border-destructive" : undefined}
            >
              <SelectValue placeholder="Selecione a função" />
            </SelectTrigger>
            <SelectContent>
              {view.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error && <FieldError id="role-error">{error}</FieldError>}
        </div>
      );
  }
}
