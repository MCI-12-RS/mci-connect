import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { FILTER_LABEL_CLASS } from "./filter-options";

interface TextFilterProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  /** No painel do computador, vale 300 ms depois da última tecla; no `Sheet`, a cada tecla (rascunho). */
  debounced: boolean;
  /** O texto como vai para a URL (sem espaços nas pontas, com o limite; vazio é nulo). */
  normalize: (value: string) => string | null;
  maxLength: number;
}

/** Um campo de texto do filtro (Bairro, Cidade, Rua; E2.07 e E2.10, P50). */
export function TextFilter({ label, value, onChange, debounced, normalize, maxLength }: TextFilterProps) {
  const id = useId();
  const [text, setText] = useState(value ?? "");
  const settled = useDebouncedValue(text, 300);

  // A URL mudou por fora (chip, "Limpar filtros", voltar): o campo acompanha.
  useEffect(() => {
    if (normalize(text) !== value) setText(value ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // No painel, só a digitação aplica: a URL mudando por fora não pode devolver o texto antigo.
  useEffect(() => {
    if (debounced && normalize(settled) !== value) onChange(normalize(settled));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  return (
    <div className="min-w-0">
      <Label htmlFor={id} className={FILTER_LABEL_CLASS}>
        {label}
      </Label>
      <Input
        id={id}
        value={text}
        maxLength={maxLength}
        autoComplete="off"
        enterKeyHint="search"
        onChange={(event) => {
          setText(event.target.value);
          if (!debounced) onChange(normalize(event.target.value));
        }}
        className="h-11 lg:h-10"
      />
    </div>
  );
}
