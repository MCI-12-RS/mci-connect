import { Controller, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import AsyncMemberSelect from "@/components/AsyncMemberSelect";
import { fieldA11yProps } from "@/lib/a11y";
import { maskMobileTyping } from "@/lib/masks";
import { ageLabel, birthDateBounds } from "@/lib/members/birth-date";
import type { MemberFormFields } from "@/lib/members/form-values";
import { genderLabel } from "@/lib/members/gender";
import { MEMBER_FORM_LAYOUT_TEXTS as TEXTS } from "@/lib/members/texts";
import { cn } from "@/lib/utils";
import { FieldMessages } from "./FieldMessages";
import { MemberIdentificationFieldset } from "./MemberIdentificationFieldset";
import { maskedRegister } from "./masked-register";
import { FIELD_BLOCK, errorOf, invalidBorder, type MemberFieldsUi } from "./member-form-ui";

const GENDERS = [
  { value: "M", label: TEXTS.labels.male },
  { value: "F", label: TEXTS.labels.female },
] as const;

interface SpouseField {
  /** O próprio cadastro, que não pode ser o cônjuge dele (RN-14). */
  memberId?: string;
  /** O nome do cônjuge com que o formulário abriu (DT-23 do E2.02). */
  savedLabel?: string | null;
  /** A busca sem resultado (P11). */
  noResultsLabel: string;
  /** Para quem vê só o ministério (P11). */
  hint: string | null;
}

interface MemberPersonalSectionProps {
  ui: MemberFieldsUi;
  /** O "hoje" de Brasília (RN-15). */
  today: string;
  /** Celular, E-mail, CPF e Telefone: só para quem vê os dados sensíveis (E1.08). */
  sensitiveVisible: boolean;
  /** O Cônjuge: só com "Editar Membro" (E1.08). */
  spouse: SpouseField | null;
}

/**
 * Dados pessoais (E2.04, T1 a T3): Nome, Sexo, Data de nascimento,
 * Identificação, Telefone, Instagram, Cônjuge e Observações, nessa ordem.
 */
export function MemberPersonalSection({ ui, today, sensitiveVisible, spouse }: MemberPersonalSectionProps) {
  const { register, control, watch } = useFormContext<MemberFormFields>();
  const { readOnly, warnings, onBlurCheck } = ui;

  const name = { error: errorOf(ui, "name"), warning: warnings.name ?? null };
  const genderError = errorOf(ui, "gender");
  const birthDate = watch("birth_date");
  const bounds = birthDateBounds(today);
  const birth = {
    error: errorOf(ui, "birth_date"),
    warning: warnings.birth_date ?? null,
    // A idade só com uma data aceita, sem erro nem aviso (RN-15, UXD-11).
    hint: errorOf(ui, "birth_date") || warnings.birth_date ? null : ageLabel(birthDate, today),
  };
  const spouseError = errorOf(ui, "spouse_id");

  return (
    <section className="space-y-4">
      <h3 className="text-lg font-semibold">{TEXTS.sections.personal}</h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={cn(FIELD_BLOCK, "md:col-span-2")}>
          <Label htmlFor="name">{TEXTS.labels.name}</Label>
          <Input
            id="name"
            required
            autoComplete="off"
            autoCapitalize="words"
            readOnly={readOnly}
            {...fieldA11yProps("name", name)}
            className={invalidBorder(!!name.error)}
            {...register("name", { onBlur: () => onBlurCheck("name") })}
          />
          <FieldMessages id="name" {...name} />
        </div>

        <div className={FIELD_BLOCK}>
          {readOnly ? (
            <>
              <Label htmlFor="gender">{TEXTS.labels.gender}</Label>
              <Input id="gender" readOnly value={genderLabel(watch("gender") || null)} />
            </>
          ) : (
            <>
              <Label id="gender-label">{TEXTS.labels.gender}</Label>
              <Controller
                name="gender"
                control={control}
                render={({ field }) => (
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    aria-labelledby="gender-label"
                    aria-required="true"
                    {...fieldA11yProps("gender", { error: genderError })}
                    className="flex flex-wrap gap-2"
                  >
                    {GENDERS.map((gender, index) => (
                      <Label
                        key={gender.value}
                        htmlFor={`gender-${gender.value}`}
                        className={cn(
                          "flex min-h-11 min-w-[8rem] flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 font-normal",
                          field.value === gender.value && "border-primary",
                          genderError && "border-destructive",
                        )}
                      >
                        <RadioGroupItem
                          id={`gender-${gender.value}`}
                          value={gender.value}
                          ref={index === 0 ? field.ref : undefined}
                          onBlur={field.onBlur}
                        />
                        {gender.label}
                      </Label>
                    ))}
                  </RadioGroup>
                )}
              />
            </>
          )}
          <FieldMessages id="gender" error={genderError} />
        </div>

        <div className={FIELD_BLOCK}>
          <Label htmlFor="birth_date">{TEXTS.labels.birthDate}</Label>
          <Input
            id="birth_date"
            type="date"
            autoComplete="off"
            readOnly={readOnly}
            min={bounds.min}
            max={bounds.max}
            {...fieldA11yProps("birth_date", birth)}
            className={invalidBorder(!!birth.error)}
            {...register("birth_date", { onBlur: () => onBlurCheck("birth_date") })}
          />
          <FieldMessages id="birth_date" {...birth} />
        </div>

        {sensitiveVisible && <MemberIdentificationFieldset ui={ui} />}

        {sensitiveVisible && (
          <div className={FIELD_BLOCK}>
            <Label htmlFor="phone">{TEXTS.labels.phone}</Label>
            <Input
              id="phone"
              type="tel"
              autoComplete="off"
              readOnly={readOnly}
              placeholder={readOnly ? undefined : TEXTS.placeholders.phone}
              {...maskedRegister(register, "phone", { typing: maskMobileTyping })}
            />
          </div>
        )}

        <div className={FIELD_BLOCK}>
          <Label htmlFor="instagram">{TEXTS.labels.instagram}</Label>
          <Input
            id="instagram"
            readOnly={readOnly}
            placeholder={readOnly ? undefined : TEXTS.placeholders.instagram}
            {...register("instagram", {
              setValueAs: (value: string) => (value && !value.startsWith("@") ? `@${value}` : value),
            })}
          />
        </div>

        {spouse && (
          <div className={cn(FIELD_BLOCK, "md:col-span-2")}>
            <Label htmlFor="spouse">{TEXTS.labels.spouse}</Label>
            <Controller
              name="spouse_id"
              control={control}
              render={({ field }) => (
                <AsyncMemberSelect
                  inputId="spouse"
                  focusRef={field.ref}
                  value={field.value}
                  onChange={(value) => field.onChange(value)}
                  excludeId={spouse.memberId}
                  placeholder={TEXTS.placeholders.spouse}
                  savedLabel={spouse.savedLabel}
                  noResultsLabel={spouse.noResultsLabel}
                  // O erro vai no `aria-describedby`, na ordem do P21 (erro, aviso e dica), e não no `aria-errormessage`.
                  {...fieldA11yProps("spouse", { error: spouseError, hint: spouse.hint })}
                />
              )}
            />
            <FieldMessages id="spouse" error={spouseError} hint={spouse.hint} />
          </div>
        )}

        <div className={cn(FIELD_BLOCK, "md:col-span-2")}>
          <Label htmlFor="notes">{TEXTS.labels.notes}</Label>
          <Textarea id="notes" className="text-base md:text-sm" readOnly={readOnly} {...register("notes")} />
        </div>
      </div>
    </section>
  );
}
