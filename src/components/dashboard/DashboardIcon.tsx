import {
  CalendarX,
  CheckCircle2,
  Church,
  Droplets,
  FileText,
  Handshake,
  House,
  HousePlus,
  Link2Off,
  Shield,
  TriangleAlert,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { DashboardIconKey } from "@/lib/dashboard/cards";
import { cn } from "@/lib/utils";

/** O ícone de cada chave do catálogo (T3). */
const ICONS: Readonly<Record<DashboardIconKey, LucideIcon>> = {
  "file-text": FileText,
  "triangle-alert": TriangleAlert,
  "check-circle": CheckCircle2,
  handshake: Handshake,
  "calendar-x": CalendarX,
  "user-plus": UserPlus,
  "house-plus": HousePlus,
  users: Users,
  "user-check": UserCheck,
  "user-x": UserX,
  church: Church,
  droplets: Droplets,
  shield: Shield,
  "link-off": Link2Off,
  house: House,
};

/** Ícone decorativo de um card: o título e o número dizem tudo (P111). */
const DashboardIcon = ({ icon, className }: { icon: DashboardIconKey; className?: string }) => {
  const Icon = ICONS[icon];
  return <Icon className={cn("h-5 w-5 shrink-0", className)} aria-hidden="true" />;
};

export default DashboardIcon;
