import { FileTextIcon, type LucideProps } from "lucide-react";

/** The icon that stands for a note. */
export const NoteRouteIcon = FileTextIcon;

export function NoteRouteGlyph({ className = "size-3.5", ...props }: LucideProps) {
  return <FileTextIcon aria-hidden="true" className={className} {...props} />;
}
