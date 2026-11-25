import { useState, type Ref } from "react";
import { PaginatedSelect, type PaginatedSelectHandle } from "@/components/select/PaginatedSelect";
import { useMemberName, useMemberOptions, toMemberOption } from "@/hooks/use-member-options";
import { useOptionsPagination, useSelectSearch } from "@/hooks/use-paginated-select";
import { UNNAMED_MEMBER_LABEL } from "@/lib/members/fields";
import type { SelectOption } from "@/lib/selectors";
import { SELECT_TEXTS } from "@/lib/access/texts";

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
  /**
   * O nome do valor com que o campo abriu, vindo da view (`leader_name`,
   * `spouse_name`…; E2.02, DT-23 e P11). Com ele, a pessoa salva aparece pelo
   * nome mesmo fora do ministério de quem edita, sem consultar a
   * `member_names`. Vale só enquanto o valor for o de abertura.
   */
  savedLabel?: string | null;
  /** Id da dica embaixo do campo (por exemplo, o alcance do P11), ligada ao campo de busca. */
  "aria-describedby"?: string;
  /**
   * Texto da busca sem resultado. Quem chama decide pelo acesso, com
   * `memberSearchEmptyLabel` ("Nenhum membro do seu ministério encontrado."
   * para quem não vê a igreja toda, P11). Padrão: "Nenhum membro encontrado".
   */
  noResultsLabel?: string;
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
  savedLabel,
  "aria-describedby": describedBy,
  noResultsLabel = SELECT_TEXTS.noMembers,
}: AsyncMemberSelectProps) => {
  const search = useSelectSearch();
  const options = useMemberOptions({ search: search.term, activeOnly, excludeId, enabled: search.isMenuOpen });
  const pagination = useOptionsPagination(options, toMemberOption);

  // A opção escolhida agora já tem o nome; o valor que veio de fora (edição)
  // busca o nome no banco.
  const [picked, setPicked] = useState<SelectOption | null>(null);
  // O valor de abertura, para o nome salvo valer só para ele.
  const [initialValue] = useState(value);
  const savedName = savedLabel && value === initialValue ? savedLabel : null;
  const knownName = picked && picked.value === value ? picked.label : savedName;
  const { data: fetchedName, isPending } = useMemberName(value, { enabled: !knownName });

  let selected: SelectOption | null = null;
  if (value) {
    const label = knownName ?? (isPending ? "Carregando…" : fetchedName || UNNAMED_MEMBER_LABEL);
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
      noResultsLabel={noResultsLabel}
      aria-describedby={describedBy}
      isClearable
    />
  );
};

export default AsyncMemberSelect;
