import { Controller, useFormContext } from "react-hook-form";
import { Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RoleFieldView } from "@/lib/access/member-form";
import type { MemberFormFields } from "@/lib/members/form-values";
import { MEMBER_FORM_LAYOUT_TEXTS as TEXTS } from "@/lib/members/texts";
import { MemberRoleField } from "./MemberRoleField";
import { FIELD_BLOCK, errorOf, type MemberFieldsUi } from "./member-form-ui";

interface MemberAccessSectionProps {
  ui: MemberFieldsUi;
  roleView: RoleFieldView;
  roleLoadFailed: boolean;
  /** Cadastro novo: a senha inicial. */
  isNew: boolean;
  /** "Alterar Senha" de outra pessoa. */
  onChangePassword: (() => void) | null;
}

/** Acesso (E2.02, T6): a Função, a senha inicial do cadastro novo e "Alterar Senha". */
export function MemberAccessSection({ ui, roleView, roleLoadFailed, isNew, onChangePassword }: MemberAccessSectionProps) {
  const { register, control } = useFormContext<MemberFormFields>();
  const initialRole = roleView.kind === "select" ? roleView.initialValue : null;

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
            <Label htmlFor="password">{TEXTS.password.initial}</Label>
            <Input id="password" type="password" placeholder={TEXTS.password.initialPlaceholder} {...register("password")} />
          </div>
        )}
        {onChangePassword && (
          <div className={FIELD_BLOCK}>
            <Label>{TEXTS.password.label}</Label>
            <Button type="button" variant="outline" className="w-full" onClick={onChangePassword}>
              <Key className="mr-2 h-4 w-4" aria-hidden="true" />
              {TEXTS.password.change}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
