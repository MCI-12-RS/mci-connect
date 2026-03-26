import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown, Users, Heart } from "lucide-react";
import { Database } from "@/integrations/supabase/types";

type Member = Database["public"]["Tables"]["members"]["Row"];

interface TreeNodeData {
  member: Member;
  spouse?: Member;
  childCount: number;
}

const getLevelLabel = (level: number) => {
  if (level === 0) return "Pastor(a)";
  if (level === 1) return "12";
  if (level === 2) return "144";
  if (level === 3) return "1.728";
  return `Nível ${level}`;
};

const TreeNode = ({ node, level }: { node: TreeNodeData; level: number }) => {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<TreeNodeData[]>([]);
  const [loading, setLoading] = useState(false);

  const loadChildren = useCallback(async () => {
    if (children.length > 0) {
      setExpanded(!expanded);
      return;
    }

    setLoading(true);
    try {
      // Get direct reports for this member (and spouse if applicable)
      const leaderIds = [node.member.id];
      if (node.spouse) leaderIds.push(node.spouse.id);

      const { data: directReports } = await supabase
        .from("members")
        .select("*")
        .in("leader_id", leaderIds)
        .eq("is_active", true)
        .order("name");

      if (!directReports) {
        setLoading(false);
        return;
      }

      // Get all members to resolve spouses
      const spouseIds = directReports
        .map((m) => m.spouse_id)
        .filter(Boolean) as string[];

      let spouseMap: Record<string, Member> = {};
      if (spouseIds.length > 0) {
        const { data: spouses } = await supabase
          .from("members")
          .select("*")
          .in("id", spouseIds);
        if (spouses) {
          spouseMap = Object.fromEntries(spouses.map((s) => [s.id, s]));
        }
      }

      // Build tree nodes, pairing spouses together
      const processedIds = new Set<string>();
      const nodes: TreeNodeData[] = [];

      for (const member of directReports) {
        if (processedIds.has(member.id)) continue;
        processedIds.add(member.id);

        let spouse: Member | undefined;
        if (member.spouse_id && spouseMap[member.spouse_id]) {
          spouse = spouseMap[member.spouse_id];
          processedIds.add(spouse.id);
        }

        // Count direct reports for this node
        const countIds = [member.id];
        if (spouse) countIds.push(spouse.id);

        const { count } = await supabase
          .from("members")
          .select("*", { count: "exact", head: true })
          .in("leader_id", countIds)
          .eq("is_active", true);

        nodes.push({ member, spouse, childCount: count || 0 });
      }

      setChildren(nodes);
      setExpanded(true);
    } finally {
      setLoading(false);
    }
  }, [node, children.length, expanded]);

  const hasChildren = node.childCount > 0;
  const indentPx = level * 24;

  return (
    <div>
      <button
        onClick={hasChildren ? loadChildren : undefined}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors rounded-lg group ${
          hasChildren
            ? "hover:bg-muted/60 cursor-pointer"
            : "cursor-default"
        }`}
        style={{ paddingLeft: `${16 + indentPx}px` }}
        disabled={loading}
      >
        <span className="w-5 h-5 flex items-center justify-center shrink-0 text-muted-foreground">
          {loading ? (
            <span className="w-4 h-4 border-2 border-muted-foreground/40 border-t-primary rounded-full animate-spin" />
          ) : hasChildren ? (
            expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
          )}
        </span>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground truncate">
              {node.member.name}
            </span>
            {node.spouse && (
              <>
                <Heart className="w-3.5 h-3.5 text-destructive/60 shrink-0" />
                <span className="font-medium text-foreground truncate">
                  {node.spouse.name}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasChildren && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="w-3.5 h-3.5" />
              {node.childCount}
            </span>
          )}
          <Badge
            variant={node.member.g12_level === 0 ? "default" : "outline"}
            className="text-xs"
          >
            {getLevelLabel(node.member.g12_level)}
          </Badge>
        </div>
      </button>

      {expanded && children.length > 0 && (
        <div className="relative">
          <div
            className="absolute top-0 bottom-0 border-l border-border/50"
            style={{ left: `${28 + indentPx}px` }}
          />
          {children.map((child) => (
            <TreeNode
              key={child.member.id}
              node={child}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const Ministries = () => {
  const { data: roots = [], isLoading } = useQuery({
    queryKey: ["ministry-tree-roots"],
    queryFn: async () => {
      // Get pastors (top level)
      const { data: pastors } = await supabase
        .from("members")
        .select("*")
        .eq("is_pastor", true)
        .eq("is_active", true)
        .order("name");

      if (!pastors) return [];

      // Resolve spouses
      const spouseIds = pastors
        .map((m) => m.spouse_id)
        .filter(Boolean) as string[];

      let spouseMap: Record<string, Member> = {};
      if (spouseIds.length > 0) {
        const { data: spouses } = await supabase
          .from("members")
          .select("*")
          .in("id", spouseIds);
        if (spouses) {
          spouseMap = Object.fromEntries(spouses.map((s) => [s.id, s]));
        }
      }

      const processedIds = new Set<string>();
      const nodes: TreeNodeData[] = [];

      for (const pastor of pastors) {
        if (processedIds.has(pastor.id)) continue;
        processedIds.add(pastor.id);

        let spouse: Member | undefined;
        if (pastor.spouse_id && spouseMap[pastor.spouse_id]) {
          spouse = spouseMap[pastor.spouse_id];
          processedIds.add(spouse.id);
        }

        const countIds = [pastor.id];
        if (spouse) countIds.push(spouse.id);

        const { count } = await supabase
          .from("members")
          .select("*", { count: "exact", head: true })
          .in("leader_id", countIds)
          .eq("is_active", true);

        nodes.push({ member: pastor, spouse, childCount: count || 0 });
      }

      return nodes;
    },
  });

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold">Ministérios</h1>
          <p className="text-muted-foreground">
            Árvore hierárquica G12 — clique para expandir
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="w-5 h-5 text-primary" />
              Estrutura G12
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            {isLoading ? (
              <div className="py-12 text-center text-muted-foreground">
                Carregando...
              </div>
            ) : roots.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                Nenhum pastor cadastrado
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {roots.map((node) => (
                  <TreeNode key={node.member.id} node={node} level={0} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Ministries;
