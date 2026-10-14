import {
  BookIcon,
  BoxIcon,
  BriefcaseIcon,
  CalendarIcon,
  CameraIcon,
  ChartColumnIcon,
  CodeIcon,
  CoffeeIcon,
  FlagIcon,
  FlaskConicalIcon,
  Gamepad2Icon,
  GlobeIcon,
  HeartIcon,
  HouseIcon,
  LeafIcon,
  LightbulbIcon,
  LockIcon,
  MoonIcon,
  MusicIcon,
  PaletteIcon,
  PencilIcon,
  PlaneIcon,
  PuzzleIcon,
  RocketIcon,
  SchoolIcon,
  StarIcon,
  SunIcon,
  TargetIcon,
  TerminalIcon,
  UsersIcon,
  WrenchIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

import { noteGraphColorHex } from "@loam/shared/notes/noteGraphColors";
import type { NoteProjectIcon as ProjectIcon } from "@loam/shared/notes/noteModel";
import type { NoteProjectSymbol } from "@loam/shared/notes/noteProjects";

import { cn } from "../ui/cn";

const projectSymbolIcons: Record<NoteProjectSymbol, LucideIcon> = {
  box: BoxIcon,
  briefcase: BriefcaseIcon,
  book: BookIcon,
  lightbulb: LightbulbIcon,
  code: CodeIcon,
  rocket: RocketIcon,
  star: StarIcon,
  heart: HeartIcon,
  home: HouseIcon,
  school: SchoolIcon,
  flask: FlaskConicalIcon,
  palette: PaletteIcon,
  music: MusicIcon,
  camera: CameraIcon,
  plane: PlaneIcon,
  globe: GlobeIcon,
  chart: ChartColumnIcon,
  calendar: CalendarIcon,
  target: TargetIcon,
  flag: FlagIcon,
  leaf: LeafIcon,
  coffee: CoffeeIcon,
  wrench: WrenchIcon,
  pencil: PencilIcon,
  users: UsersIcon,
  lock: LockIcon,
  moon: MoonIcon,
  sun: SunIcon,
  bolt: ZapIcon,
  puzzle: PuzzleIcon,
  gamepad: Gamepad2Icon,
  terminal: TerminalIcon,
};

/** What a project without an icon of its own shows. */
export const DEFAULT_PROJECT_ICON: ProjectIcon = { kind: "symbol", value: "box", color: "blue" };

/** A project's emoji or colored line icon, sized like the tree's other icons. */
export function NoteProjectIcon({ icon, className }: { icon?: ProjectIcon; className?: string }) {
  const shown = icon ?? DEFAULT_PROJECT_ICON;
  if (shown.kind === "emoji")
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center text-[13px] leading-none",
          className,
        )}
      >
        {shown.value}
      </span>
    );
  const Icon = projectSymbolIcons[shown.value as NoteProjectSymbol] ?? BoxIcon;
  return (
    <Icon
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
      style={shown.color ? { color: noteGraphColorHex[shown.color] } : undefined}
    />
  );
}
