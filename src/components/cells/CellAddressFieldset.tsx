import { forwardRef, useEffect, useRef } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CepField } from "@/components/address/CepField";
import { applyCepAddress, type CepAddress } from "@/lib/address/cep";
import { ADDRESS_TEXTS, BRAZILIAN_STATES } from "@/lib/address/texts";
import { CELL_FORM_TEXTS as TEXTS } from "@/lib/cells/texts";
import type { CellFormValues } from "@/lib/cells/write";
import { cn } from "@/lib/utils";
import { FIELD_BLOCK, LEGEND } from "./cell-form-ui";

type TextField = "street" | "number" | "complement" | "neighborhood" | "city";

const CEP_FIELDS = ["street", "neighborhood", "city", "state"] as const;

/**
 * "Endereço da célula" (E2.08, T4; RN-09): todos opcionais e com
 * `autoComplete="off"` (o endereço é o da reunião, e não o de quem cadastra).
 * O CEP digitado preenche rua, bairro, cidade e estado (`CepField`); o CEP que
 * vem do anfitrião não dispara a busca.
 */
interface CellAddressFieldsetProps {
  /** O formulário está gravando: o CEP fica desabilitado, e a resposta de uma busca em voo é ignorada. */
  busy: boolean;
  /** O CEP mudou o endereço: o aviso do anfitrião deixa de valer (UXD-8). */
  onCepFilled: () => void;
}

export const CellAddressFieldset = forwardRef<HTMLFieldSetElement, CellAddressFieldsetProps>(({ busy, onCepFilled }, ref) => {
  const { control, register, getValues, setValue } = useFormContext<CellFormValues>();
  // A busca do CEP pode voltar durante o envio: o valor atual, e não o da digitação.
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const fillFromCep = (found: CepAddress) => {
    if (busyRef.current) return;
    const current = { street: getValues("street"), neighborhood: getValues("neighborhood"), city: getValues("city"), state: getValues("state") };
    const next = applyCepAddress(current, found);
    const changed = CEP_FIELDS.filter((field) => next[field] !== current[field]);
    for (const field of changed) setValue(field, next[field], { shouldDirty: true });
    if (changed.length > 0) onCepFilled();
  };

  const textField = (field: TextField, label: string, className?: string) => (
    <div className={cn(FIELD_BLOCK, className)}>
      <Label htmlFor={field}>{label}</Label>
      <Input id={field} autoComplete="off" {...register(field)} />
    </div>
  );

  return (
    <fieldset ref={ref} className="min-w-0">
      <legend className={LEGEND}>{TEXTS.groups.address}</legend>
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
              disabled={busy}
            />
          )}
        />
        <div className="hidden md:block" aria-hidden="true" />
        {textField("street", ADDRESS_TEXTS.street, "md:col-span-2")}
        {textField("number", ADDRESS_TEXTS.number)}
        {textField("complement", ADDRESS_TEXTS.complement)}
        {textField("neighborhood", ADDRESS_TEXTS.neighborhood)}
        {textField("city", ADDRESS_TEXTS.city)}
        <div className={FIELD_BLOCK}>
          <Label htmlFor="state">{ADDRESS_TEXTS.state}</Label>
          <Controller
            name="state"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="state" ref={field.ref}>
                  <SelectValue placeholder={ADDRESS_TEXTS.statePlaceholder} />
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
        </div>
      </div>
    </fieldset>
  );
});
CellAddressFieldset.displayName = "CellAddressFieldset";
