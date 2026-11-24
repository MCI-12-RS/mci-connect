import type { LucideIcon } from "lucide-react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** Uma ação do menu "⋯": "Excluir cadastro", "Excluir célula"… */
export interface RowAction {
  label: string;
  /** Decorativo: o item já tem o texto. */
  icon?: LucideIcon;
  onSelect: () => void;
}

export interface RowActionsMenuProps {
  /** Rótulo do botão para leitor de tela: "Ações de {Nome}". */
  label: string;
  /** Ações que o usuário pode fazer na linha. Sem nenhuma, o "⋯" não aparece (UX-03). */
  actions: readonly RowAction[];
}

/**
 * Menu "⋯" do card no celular (T1, padrão P8): guarda as ações destrutivas
 * longe da ação frequente. O botão tem 44×44 px, e os itens usam a cor do
 * texto; o vermelho fica só no botão que confirma.
 */
const RowActionsMenu = ({ label, actions }: RowActionsMenuProps) => {
  if (actions.length === 0) return null;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={label}>
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map(({ label: itemLabel, icon: Icon, onSelect }) => (
          <DropdownMenuItem key={itemLabel} className="min-h-11 gap-2 text-foreground" onSelect={onSelect}>
            {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
            {itemLabel}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default RowActionsMenu;
