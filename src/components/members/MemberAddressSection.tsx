import { Controller, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CepField } from "@/components/address/CepField";
import { applyCepAddress, type CepAddress } from "@/lib/address/cep";
import { BRAZILIAN_STATES } from "@/lib/address/texts";
import type { MemberFormFields } from "@/lib/members/form-values";
import { MEMBER_FORM_LAYOUT_TEXTS } from "@/lib/members/texts";
import { cn } from "@/lib/utils";
import { FIELD_BLOCK } from "./member-form-ui";

const TEXTS = MEMBER_FORM_LAYOUT_TEXTS.address;

type AddressField = "street" | "neighborhood" | "city" | "state" | "complement";

/** Os campos que o CEP preenche (E2.08, RN-09): nunca número e complemento. */
const CEP_FIELDS = ["street", "neighborhood", "city", "state"] as const;

/** Endereço: o CEP comum (E2.08, DA-11) preenche rua, bairro, cidade e estado. */
export function MemberAddressSection({ readOnly }: { readOnly: boolean }) {
  const { register, control, getValues, setValue } = useFormContext<MemberFormFields>();

  const fillFromCep = (found: CepAddress) => {
    const current = { street: getValues("street"), neighborhood: getValues("neighborhood"), city: getValues("city"), state: getValues("state") };
    const next = applyCepAddress(current, found);
    for (const field of CEP_FIELDS) {
      if (next[field] !== current[field]) setValue(field, next[field], { shouldDirty: true });
    }
  };

  const textField = (field: Exclude<AddressField, "state"> | "number", label: string, className?: string) => (
    <div className={cn(FIELD_BLOCK, className)}>
      <Label htmlFor={field}>{label}</Label>
      <Input id={field} readOnly={readOnly} {...register(field)} />
    </div>
  );

  return (
    <section className="space-y-4">
      <h3 className="text-lg font-semibold">{MEMBER_FORM_LAYOUT_TEXTS.sections.address}</h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Controller
          name="zip_code"
          control={control}
          render={({ field }) => (
            <CepField
              id="zip_code"
              name={field.name}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              onFound={fillFromCep}
              readOnly={readOnly}
            />
          )}
        />
        {textField("street", TEXTS.street, "md:col-span-2")}
        {textField("number", TEXTS.number)}
        {textField("complement", TEXTS.complement)}
        {textField("neighborhood", TEXTS.neighborhood)}
        {textField("city", TEXTS.city)}
        <div className={FIELD_BLOCK}>
          <Label htmlFor="state">{TEXTS.state}</Label>
          {readOnly ? (
            <Input id="state" readOnly {...register("state")} />
          ) : (
            <Controller
              name="state"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="state" ref={field.ref}>
                    <SelectValue placeholder={TEXTS.statePlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {BRAZILIAN_STATES.map((state) => (
                      <SelectItem key={state} value={state}>
                        {state}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          )}
        </div>
      </div>
    </section>
  );
}
