import type { ChangeItem } from "@/lib/audit/events";
import { AUDIT_TEXTS } from "@/lib/audit/texts";

/**
 * Os campos mudados (P32): "{Campo}: {antes} → {depois}", ou só "{Campo}" nos campos sem valor. A seta
 * é `aria-hidden`, e o leitor de tela ouve "{Campo}: de {antes} para {depois}".
 */
export function ChangeList({ items }: { items: ChangeItem[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item) => (
        <li key={item.field} className="break-words">
          {item.values ? (
            <>
              {item.label}:{" "}
              <span aria-hidden="true">
                {item.values.from} → {item.values.to}
              </span>
              <span className="sr-only">{AUDIT_TEXTS.change.srFromTo(item.values.from, item.values.to)}</span>
            </>
          ) : (
            item.label
          )}
        </li>
      ))}
    </ul>
  );
}
