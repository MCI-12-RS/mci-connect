import { Link, useLocation } from "react-router-dom";
import { ArchiveX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toReturnToState } from "@/lib/navigation";

interface DeletedListButtonProps {
  /** A lista de excluídos: `/members/deleted`. */
  to: string;
  /** "Excluídos" (ou "Excluídas"). */
  text: string;
  /** "Ver membros excluídos" (rótulo para leitor de tela). */
  label: string;
  isMobile: boolean;
}

/**
 * "Excluídos" no cabeçalho de uma lista, só para quem restaura (E2.01, T4,
 * UX-13). No celular, `ghost` de 44 px na linha do título; no desktop,
 * `outline`, ao lado da ação principal. Leva a busca e a página da lista no
 * estado da navegação, para o "← {Lista}" voltar a elas (UX-19).
 */
const DeletedListButton = ({ to, text, label, isMobile }: DeletedListButtonProps) => {
  const location = useLocation();
  return (
    <Button asChild variant={isMobile ? "ghost" : "outline"} className={isMobile ? "h-11 shrink-0" : undefined}>
      <Link to={to} state={toReturnToState(location.pathname, location.search)} aria-label={label}>
        <ArchiveX className="h-4 w-4" aria-hidden="true" />
        {text}
      </Link>
    </Button>
  );
};

export default DeletedListButton;
