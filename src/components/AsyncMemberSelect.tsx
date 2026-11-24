import { useState, type Ref } from "react";
import { PaginatedSelect, type PaginatedSelectHandle } from "@/components/select/PaginatedSelect";
import { useMemberName, useMemberOptions, toMemberOption } from "@/hooks/use-member-options";
import { useOptionsPagination, useSelectSearch } from "@/hooks/use-paginated-select";
import { UNNAMED_MEMBER_LABEL } from "@/lib/members/fields";
import type { SelectOption } from "@/lib/selectors";

interface AsyncMemberSelectProps {
  value: string | null;
  onChange: (value: string | null) => void;
  /** Membro que não pode ser escolhido (o próprio, ao escolher líder ou cônjuge). */
  excludeId?: string;
  placeholder?: string;
  /** Só membros ativos. Padrão: ativos e inativos. */
  activeOnly?: boolean;
  /** Id do campo de busca, para o `<Label htmlFor>`. */
  inputId?: string;
  /** Leva o foco ao campo de busca (por exemplo, o Líder em "Definir líder", E2.01 T5). */
  focusRef?: Ref<PaginatedSelectHandle>;
}

/**
 * Seletor de um membro visível, com busca e paginação no servidor (E1.08,
 * RN-07). O nome do membro já escolhido vem da `member_names`, que também
 * resolve quem está fora do escopo de quem edita.
 */
const AsyncMemberSelect = ({
  value,
  onChange,
  excludeId,
  placeholder = "Buscar membro…",
  activeOnly = false,
  inputId,
  focusRef,
}: AsyncMemberSelectProps) => {
  const search = useSelectSearch();
  const options = useMemberOptions({ search: search.term, activeOnly, excludeId, enabled: search.isMenuOpen });
  const pagination = useOptionsPagination(options, toMemberOption);

  // A opção escolhida agora já tem o nome; o valor que veio de fora (edição)
  // busca o nome no banco.
  const [picked, setPicked] = useState<SelectOption | null>(null);
  const knownName = picked && picked.value === value ? picked.label : null;
  const { data: savedName, isPending } = useMemberName(value, { enabled: !knownName });

  let selected: SelectOption | null = null;
  if (value) {
    const label = knownName ?? (isPending ? "Carregando…" : savedName || UNNAMED_MEMBER_LABEL);
    selected = { value, label };
  }

  return (
    <PaginatedSelect
      inputId={inputId}
      focusRef={focusRef}
      search={search}
      pagination={pagination}
      value={selected}
      onChange={(option) => {
        setPicked(option);
        onChange(option?.value ?? null);
      }}
      placeholder={placeholder}
      noResultsLabel="Nenhum membro encontrado"
      isClearable
    />
  );
};

export default AsyncMemberSelect;
