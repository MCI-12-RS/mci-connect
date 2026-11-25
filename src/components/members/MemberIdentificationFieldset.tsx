import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fieldA11yProps, fieldMessageIds } from "@/lib/a11y";
import { maskCpf, maskMobileOnBlur, maskMobileTyping } from "@/lib/masks";
import type { MemberFormFields } from "@/lib/members/form-values";
import { MEMBER_FORM_LAYOUT_TEXTS as TEXTS, MEMBER_HINT_TEXTS } from "@/lib/members/texts";
import { cn } from "@/lib/utils";
import { FieldMessages } from "./FieldMessages";
import { maskedRegister } from "./masked-register";
import { FIELD_BLOCK, errorOf, invalidBorder, type MemberFieldsUi } from "./member-form-ui";

/**
 * O grupo Identificação (E2.04, T3; UXD-2, RN-04 a RN-08, P23): Celular,
 * E-mail e CPF, com que a pessoa entra no sistema. A mensagem do grupo (dica,
 * erro da RN-08 ou aviso de dado antigo) fica ligada aos três campos.
 */
export function MemberIdentificationFieldset({ ui }: { ui: MemberFieldsUi }) {
  const { register, getValues, setValue } = useFormContext<MemberFormFields>();
  const { readOnly, warnings, onBlurCheck } = ui;

  // A mensagem do grupo toma o lugar da dica: o erro da RN-08 ou, sem ele, o aviso (T3, T6).
  const groupError = errorOf(ui, "identification");
  const groupWarning = groupError ? null : (warnings.identification ?? null);
  const groupHint = groupError || groupWarning ? null : MEMBER_HINT_TEXTS.identification;
  const groupMessages = { error: groupError, warning: groupWarning, hint: groupHint };
  const group = { ids: fieldMessageIds("identification", groupMessages), invalid: !!groupError };

  const mobile = { error: errorOf(ui, "mobile_whatsapp"), warning: warnings.mobile_whatsapp ?? null };
  const email = { error: errorOf(ui, "email") };
  const cpf = { error: errorOf(ui, "cpf") };

  return (
    <fieldset className="min-w-0 space-y-4 md:col-span-2">
      <legend className="text-base font-semibold">{TEXTS.sections.identification}</legend>
      <FieldMessages id="identification" {...groupMessages} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={FIELD_BLOCK}>
          <Label htmlFor="mobile_whatsapp">{TEXTS.labels.mobile}</Label>
          <Input
            id="mobile_whatsapp"
            type="tel"
            autoComplete="off"
            readOnly={readOnly}
            placeholder={readOnly ? undefined : TEXTS.placeholders.mobile}
            {...fieldA11yProps("mobile_whatsapp", mobile, group)}
            className={invalidBorder(!!mobile.error || group.invalid)}
            {...maskedRegister(register, "mobile_whatsapp", { typing: maskMobileTyping, pasted: maskMobileOnBlur }, {
              onBlur: () => {
                // Ao sair, o número lido aparece na forma lida (sem o +55 e sem o zero, T3).
                setValue("mobile_whatsapp", maskMobileOnBlur(getValues("mobile_whatsapp")));
                onBlurCheck("mobile_whatsapp");
              },
            })}
          />
          <FieldMessages id="mobile_whatsapp" {...mobile} />
        </div>
        <div className={FIELD_BLOCK}>
          <Label htmlFor="email">{TEXTS.labels.email}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            readOnly={readOnly}
            {...fieldA11yProps("email", email, group)}
            className={invalidBorder(!!email.error || group.invalid)}
            {...register("email", {
              onBlur: () => {
                // Os espaços das pontas saem; as maiúsculas ficam (o servidor grava em minúsculas).
                setValue("email", getValues("email").trim());
                onBlurCheck("email");
              },
            })}
          />
          <FieldMessages id="email" {...email} />
        </div>
        <div className={cn(FIELD_BLOCK, "md:col-span-2 md:max-w-[calc(50%-0.5rem)]")}>
          <Label htmlFor="cpf">{TEXTS.labels.cpf}</Label>
          <Input
            id="cpf"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            readOnly={readOnly}
            placeholder={readOnly ? undefined : TEXTS.placeholders.cpf}
            {...fieldA11yProps("cpf", cpf, group)}
            className={invalidBorder(!!cpf.error || group.invalid)}
            {...maskedRegister(register, "cpf", { typing: maskCpf }, { onBlur: () => onBlurCheck("cpf") })}
          />
          <FieldMessages id="cpf" {...cpf} />
        </div>
      </div>
    </fieldset>
  );
}
