import { LowTechAccess } from "@/components/low-tech-access";
import { getPublicChannelAccess } from "@/lib/channels/access";

export function LowTechAccessServer({ compact = false }: { compact?: boolean }) {
  return <LowTechAccess access={getPublicChannelAccess()} compact={compact} />;
}
