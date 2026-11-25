import type { ReactNode } from "react";
import { LEADERSHIP_TEXTS } from "@/lib/hierarchy/texts";
import { leadershipSpokenText, leadershipText, type Leadership } from "@/lib/hierarchy/leadership";
import { cn } from "@/lib/utils";

export interface LeadershipTextProps {
  leadership: Leadership;
  className?: string;
}

/**
 * Liderança de uma pessoa (P41): o G12 em `font-medium`, a "/" e o "—" fora
 * do leitor de tela, que ouve "G12 Pedro Alves, líder André Souza" ou
 * "Nenhuma". Os nomes quebram linha e não são links (nomes de referência).
 */
const LeadershipText = ({ leadership, className }: LeadershipTextProps) => {
  let visible: ReactNode;
  if (leadership.kind === "chain") {
    visible = (
      <>
        <span className="font-medium">{leadership.g12}</span> {LEADERSHIP_TEXTS.separator} {leadership.leader}
      </>
    );
  } else if (leadership.kind === "g12_is_leader") {
    visible = <span className="font-medium">{leadership.g12}</span>;
  } else {
    visible = leadershipText(leadership);
  }
  return (
    <span className={cn("break-words", className)}>
      <span aria-hidden="true">{visible}</span>
      <span className="sr-only">{leadershipSpokenText(leadership)}</span>
    </span>
  );
};

export default LeadershipText;
