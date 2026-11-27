import { forwardRef, useId } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUDIT_TEXTS } from "@/lib/audit/texts";

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  historyMode: boolean;
}

/** A busca da Auditoria (T7): vai ao servidor 300 ms depois da última tecla (`useListSearchParams`). */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(({ value, onChange, historyMode }, ref) => {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-sm font-medium">
        {AUDIT_TEXTS.search.label}
      </Label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          ref={ref}
          id={id}
          type="search"
          enterKeyHint="search"
          maxLength={100}
          placeholder={historyMode ? AUDIT_TEXTS.search.historyPlaceholder : AUDIT_TEXTS.search.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 pl-9 lg:h-10"
        />
      </div>
    </div>
  );
});
SearchField.displayName = "SearchField";
