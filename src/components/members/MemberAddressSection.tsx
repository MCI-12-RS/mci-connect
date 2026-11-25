import { useState, type ChangeEvent } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isJsonObject } from "@/lib/errors";
import { maskCep } from "@/lib/masks";
import type { MemberFormFields } from "@/lib/members/form-values";
import { MEMBER_FORM_LAYOUT_TEXTS } from "@/lib/members/texts";
import { cn } from "@/lib/utils";
import { maskedRegister } from "./masked-register";
import { FIELD_BLOCK } from "./member-form-ui";

const TEXTS = MEMBER_FORM_LAYOUT_TEXTS.address;

const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

type AddressField = "street" | "neighborhood" | "city" | "state" | "complement";

/** Os campos que a resposta do ViaCEP preenche. */
const VIACEP_FIELDS: ReadonlyArray<readonly [AddressField, string]> = [
  ["street", "logradouro"],
  ["neighborhood", "bairro"],
  ["city", "localidade"],
  ["state", "uf"],
  ["complement", "complemento"],
];

/** Endereço (como antes): o CEP preenche o resto pelo ViaCEP. */
export function MemberAddressSection({ readOnly }: { readOnly: boolean }) {
  const { register, control, setValue } = useFormContext<MemberFormFields>();
  const [cepLoading, setCepLoading] = useState(false);

  const fetchAddress = async (cep: string) => {
    const digits = cep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data: unknown = await response.json();
      if (!isJsonObject(data) || data.erro) return;
      for (const [field, key] of VIACEP_FIELDS) {
        const value = data[key];
        if (typeof value === "string" && value) setValue(field, value, { shouldDirty: true });
      }
    } catch {
      // Sem o ViaCEP, a pessoa preenche à mão.
    } finally {
      setCepLoading(false);
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
        <div className={FIELD_BLOCK}>
          <Label htmlFor="zip_code">
            {TEXTS.zipCode} {cepLoading && <span className="ml-1 text-xs text-muted-foreground">{TEXTS.zipCodeLoading}</span>}
          </Label>
          <Input
            id="zip_code"
            inputMode="numeric"
            readOnly={readOnly}
            placeholder={readOnly ? undefined : TEXTS.zipCodePlaceholder}
            {...maskedRegister(register, "zip_code", { typing: maskCep }, {
              onChange: (event: ChangeEvent<HTMLInputElement>) => void fetchAddress(event.target.value),
            })}
          />
        </div>
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
