import { LockIcon, LockOpenIcon, PenLineIcon, type LucideIcon } from "lucide-react";

import type { AiAccessMode } from "@loam/shared/ai/aiChat";

/** How each access mode reads wherever the user picks one. */
export const ACCESS_MODES: Record<
  AiAccessMode,
  { label: string; description: string; icon: LucideIcon }
> = {
  supervised: {
    label: "Supervised",
    description: "Ask before changing notes, reaching the web or acting outside Loam.",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Edit notes freely; ask before creating, moving, deleting or acting outside Loam.",
    icon: PenLineIcon,
  },
  "full-access": {
    label: "Full access",
    description:
      "Do anything without asking, including commands and clicks. Note changes can be undone.",
    icon: LockOpenIcon,
  },
};
