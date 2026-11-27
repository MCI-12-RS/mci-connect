import { addressLines, type AddressSource } from "@/lib/cells/detail";
import { CELL_DETAIL_TEXTS as TEXTS } from "@/lib/cells/detail-texts";
import { DetailSection } from "./DetailSection";

/** Endereço da célula (RN-15 d, T8): até quatro linhas, sem as vazias, ou "Sem endereço". */
export const CellAddressSection = ({ cell }: { cell: AddressSource }) => {
  const lines = addressLines(cell);
  return (
    <DetailSection title={TEXTS.sections.address}>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{TEXTS.noAddress}</p>
      ) : (
        <address className="space-y-0.5 text-sm not-italic">
          {lines.map((line, index) => (
            <p key={index} className="break-words">
              {line}
            </p>
          ))}
        </address>
      )}
    </DetailSection>
  );
};
