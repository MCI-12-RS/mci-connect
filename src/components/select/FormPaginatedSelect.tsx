import { useFormField } from "@/components/ui/form";
import { PaginatedSelect, type PaginatedSelectProps } from "./PaginatedSelect";

/**
 * `PaginatedSelect` dentro de um `FormItem` do react-hook-form: marca o campo
 * como inválido e aponta a mensagem de erro (`FormMessage`) quando a validação
 * falha. Passe o `field.ref` em `focusRef` para o foco vir ao seletor.
 */
export function FormPaginatedSelect<IsMulti extends boolean = false>(props: PaginatedSelectProps<IsMulti>) {
  const { error, formMessageId } = useFormField();
  return <PaginatedSelect {...props} aria-invalid={!!error} aria-errormessage={error ? formMessageId : undefined} />;
}
