import { useRef, type ChangeEvent, type Ref } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldWarning } from "@/components/members/FieldMessages";
import { useCepLookup } from "@/hooks/use-cep-lookup";
import { cepDigits, isCompleteCep, maskCep, type CepAddress } from "@/lib/address/cep";
import { ADDRESS_TEXTS as TEXTS } from "@/lib/address/texts";
import { applyMask } from "@/lib/masks";
import { cn } from "@/lib/utils";

interface CepFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** O serviço achou o CEP: quem usa preenche rua, bairro, cidade e estado (`applyCepAddress`). */
  onFound: (address: CepAddress) => void;
  inputRef?: Ref<HTMLInputElement>;
  name?: string;
  /** "Meus dados" só para leitura: sem máscara, sem busca e sem placeholder. */
  readOnly?: boolean;
  className?: string;
}

/**
 * O CEP dos formulários de membro e de célula (E2.08, RN-09, T4, UX-18):
 * máscara de 8 dígitos, teclado numérico e a busca do endereço.
 *
 * A busca sai só quando a pessoa digita ou cola o 8º dígito, no `onChange`,
 * e nunca por um efeito sobre o valor: o CEP que vem do anfitrião não a
 * dispara (UXD-9). Não encontrado e falha são avisos (P21): não marcam o campo
 * como inválido, não entram no resumo e somem quando o CEP muda.
 */
export function CepField({ id, value, onChange, onBlur, onFound, inputRef, name, readOnly = false, className }: CepFieldProps) {
  const { status, lookup, reset } = useCepLookup();
  const lastLookedUp = useRef<string | null>(null);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const masked = applyMask(input.value, input.selectionStart ?? input.value.length, maskCep);
    if (masked.value !== input.value) {
      input.value = masked.value;
      input.setSelectionRange(masked.caret, masked.caret);
    }
    onChange(masked.value);

    const digits = cepDigits(masked.value);
    if (!isCompleteCep(digits)) {
      lastLookedUp.current = null;
      if (status !== "idle") reset();
      return;
    }
    if (digits === lastLookedUp.current) return;
    lastLookedUp.current = digits;
    void lookup(digits).then((result) => {
      if (result?.kind === "found") onFound(result.address);
    });
  };

  const warning = status === "not_found" ? TEXTS.notFound : status === "failed" ? TEXTS.failed : null;
  const warningId = `${id}-warning`;

  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Label htmlFor={id}>{TEXTS.zipCode}</Label>
        {/* Sempre na página, para o leitor de tela anunciar a busca e o preenchimento. */}
        <span role="status" className="inline-flex items-center gap-1 text-sm text-muted-foreground empty:hidden">
          {status === "loading" && (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {TEXTS.searching}
            </>
          )}
          {status === "found" && <span className="sr-only">{TEXTS.filled}</span>}
        </span>
      </div>
      <Input
        id={id}
        name={name}
        ref={inputRef}
        inputMode="numeric"
        autoComplete="off"
        maxLength={9}
        readOnly={readOnly}
        placeholder={readOnly ? undefined : TEXTS.zipCodePlaceholder}
        value={value}
        onChange={readOnly ? undefined : handleChange}
        onBlur={onBlur}
        aria-describedby={warning ? warningId : undefined}
      />
      {warning && <FieldWarning id={warningId}>{warning}</FieldWarning>}
    </div>
  );
}
