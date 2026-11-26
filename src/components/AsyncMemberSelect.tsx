import { useState, type Ref } from "react";
import { PaginatedSelect, type PaginatedSelectHandle } from "@/components/select/PaginatedSelect";
import { useMemberName, useMemberOptions, toMarkedMemberOption, toMemberOption } from "@/hooks/use-member-options";
import type { MemberStatus } from "@/hooks/use-member-statuses";
import { personLabel } from "@/lib/members/labels";
import { useOptionsPagination, useSelectSearch } from "@/hooks/use-paginated-select";
import { UNNAMED_MEMBER_LABEL } from "@/lib/members/fields";
import type { SelectOption } from "@/lib/selectors";
import { SELECT_TEXTS } from "@/lib/access/texts";
import { LOADING_LABEL } from "@/components/select/select-a11y";

interface AsyncMemberSelectProps {
  value: string | null;
  /** O id escolhido e o nome dele (para avisos que citam a pessoa, como o P20 do E2.04). */
  onChange: (value: string | null, label: string | null) => void;
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
  /** Ids das mensagens embaixo do campo (erro, aviso e dica, P21), ligadas ao campo de busca. */
  "aria-describedby"?: string;
  /** O campo tem erro; o texto dele vai em `aria-describedby`, na ordem do P21. */
  "aria-invalid"?: boolean;
  /**
   * O cadastro cujo líder se escolhe (E2.04, AQ-4): os discípulos dele
   * aparecem desabilitados, com o motivo (P5).
   */
  descendantOf?: string | null;
  /**
   * Texto da busca sem resultado. Quem chama decide pelo acesso, com
   * `memberSearchEmptyLabel` ("Nenhum membro do seu ministério encontrado."
   * para quem não vê a igreja toda, P11). Padrão: "Nenhum membro encontrado".
   */
  noResultsLabel?: string;
  /** Botão de limpar a escolha. Padrão: com. Seletor obrigatório: sem (P64). */
  isClearable?: boolean;
  /** Campo obrigatório para o leitor de tela (`aria-required`). */
  "aria-required"?: boolean;
  /**
   * A marca "(inativo)" ou "(inativa)" nas opções e no valor (E2.08, P63). O
   * valor de abertura recebe a marca pela situação lida em `useMemberStatuses`
   * (`valueStatus`); quem está fora do escopo fica só com o nome.
   */
  markInactive?: boolean;
  /**
   * A situação da pessoa do valor de abertura, com `markInactive`: `undefined`
   * enquanto carrega (o nome fica LOADING_LABEL), `null` fora do escopo.
   */
  valueStatus?: MemberStatus | null;
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
  "aria-invalid": ariaInvalid,
  noResultsLabel = SELECT_TEXTS.noMembers,
  descendantOf = null,
  isClearable = true,
  "aria-required": ariaRequired,
  markInactive = false,
  valueStatus,
}: AsyncMemberSelectProps) => {
  const search = useSelectSearch();
  const options = useMemberOptions({ search: search.term, activeOnly, excludeId, enabled: search.isMenuOpen, descendantOf });
  const pagination = useOptionsPagination(options, markInactive ? toMarkedMemberOption : toMemberOption);

  // A opção escolhida agora já tem o nome; o valor que veio de fora (edição)
  // busca o nome no banco.
  const [picked, setPicked] = useState<SelectOption | null>(null);
  // O valor de abertura, para o nome salvo valer só para ele.
  const [initialValue] = useState(value);
  const savedName = savedLabel && value === initialValue ? savedLabel : null;
  const knownName = picked && picked.value === value ? picked.label : savedName;
  const { data: fetchedName, isPending } = useMemberName(value, { enabled: !knownName });

  // A escolha feita agora já traz a marca na opção; o valor que veio de fora espera a situação (P63).
  const pickedNow = !!picked && picked.value === value;
  const awaitingStatus = markInactive && !pickedNow && valueStatus === undefined;
  let selected: SelectOption | null = null;
  if (value) {
    const name = knownName ?? (isPending ? null : fetchedName || UNNAMED_MEMBER_LABEL);
    const label =
      name === null || awaitingStatus
        ? LOADING_LABEL
        : markInactive && !pickedNow && valueStatus
          ? personLabel({ name, is_active: valueStatus.is_active, gender: valueStatus.gender })
          : name;
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
        onChange(option?.value ?? null, option?.label ?? null);
      }}
      placeholder={placeholder}
      noResultsLabel={noResultsLabel}
      aria-describedby={describedBy}
      aria-invalid={ariaInvalid}
      aria-required={ariaRequired}
      isClearable={isClearable}
    />
  );
};

export default AsyncMemberSelect;
