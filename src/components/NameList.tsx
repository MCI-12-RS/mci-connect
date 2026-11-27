import { useId } from "react";

interface NameListProps {
  /** "Participantes (8)". */
  heading: string;
  names: readonly string[];
  /** A frase da lista vazia ("Nenhum visitante."). */
  emptyText: string;
}

/**
 * Lista de nomes sem corte (P94, E2.12): um `h3` com o número e uma `ul` ligada a ele, em colunas
 * que se ajustam à largura (`columns-[9rem]`), lidas de cima para baixo na ordem do DOM. Com zoom ou
 * fonte grande, uma coluna só. Os nomes quebram linha e são só texto.
 */
export function NameList({ heading, names, emptyText }: NameListProps) {
  const headingId = useId();
  return (
    <section className="space-y-1">
      <h3 id={headingId} className="text-sm text-muted-foreground">
        {heading}
      </h3>
      {names.length > 0 ? (
        <ul aria-labelledby={headingId} className="columns-[9rem] gap-x-6 text-sm">
          {names.map((name, index) => (
            // Nomes podem se repetir; a lista não muda de ordem enquanto está na tela.
            <li key={index} className="break-inside-avoid break-words py-0.5">
              {name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">{emptyText}</p>
      )}
    </section>
  );
}
