import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Search, X, Loader2 } from "lucide-react";

interface AsyncMemberSelectProps {
  value: string | null;
  onChange: (value: string | null) => void;
  excludeId?: string;
  placeholder?: string;
}

interface MemberOption {
  id: string;
  name: string;
}

const AsyncMemberSelect = ({ value, onChange, excludeId, placeholder = "Buscar membro..." }: AsyncMemberSelectProps) => {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<MemberOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedName, setSelectedName] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  // Load selected member name on mount
  useEffect(() => {
    if (value) {
      supabase
        .from("members")
        .select("id, name")
        .eq("id", value)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setSelectedName(data.name);
        });
    } else {
      setSelectedName("");
    }
  }, [value]);

  const searchMembers = useCallback(
    async (search: string) => {
      setIsLoading(true);
      let q = supabase
        .from("members")
        .select("id, name")
        .order("name")
        .limit(20);

      if (search.trim()) {
        q = q.ilike("name", `%${search}%`);
      }

      if (excludeId) {
        q = q.neq("id", excludeId);
      }

      const { data } = await q;
      setOptions(data || []);
      setIsLoading(false);
    },
    [excludeId]
  );

  const handleInputChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchMembers(val), 300);
  };

  const handleFocus = () => {
    setIsOpen(true);
    searchMembers(query);
  };

  const handleSelect = (member: MemberOption) => {
    onChange(member.id);
    setSelectedName(member.name);
    setQuery("");
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange(null);
    setSelectedName("");
    setQuery("");
  };

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      {selectedName && !isOpen ? (
        <div className="flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm">
          <span>{selectedName}</span>
          <button type="button" onClick={handleClear} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={handleFocus}
            placeholder={placeholder}
            className="pl-9"
          />
          {isLoading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
          )}
        </div>
      )}

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
            onClick={() => { onChange(null); setSelectedName(""); setIsOpen(false); }}
          >
            Nenhum
          </button>
          {options.map((m) => (
            <button
              key={m.id}
              type="button"
              className={cn(
                "w-full px-3 py-2 text-left text-sm hover:bg-accent",
                value === m.id && "bg-accent font-medium"
              )}
              onClick={() => handleSelect(m)}
            >
              {m.name}
            </button>
          ))}
          {!isLoading && options.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">Nenhum resultado</div>
          )}
        </div>
      )}
    </div>
  );
};

export default AsyncMemberSelect;
