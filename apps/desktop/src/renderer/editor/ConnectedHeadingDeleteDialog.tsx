import {
  headingTargetKindLabel,
  type NoteHeadingConnectionOption,
  type NoteHeadingConnectionTarget,
} from "./noteHeadingConnections";
import type { PendingHeadingDeletion } from "./useHeadingDeletionGuard";
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/Dialog";

const ACTION_WORDS = {
  delete: { label: "Delete", doing: "Deleting" },
  convert: { label: "Convert", doing: "Converting" },
  change: { label: "Change", doing: "Changing" },
} as const;

const count = (amount: number, one: string, many: string) => (amount === 1 ? one : many);

export type ConnectedHeadingDeleteImpact = {
  action: PendingHeadingDeletion["action"];
  headings: NoteHeadingConnectionOption[];
  targets: NoteHeadingConnectionTarget[];
};

export function ConnectedHeadingDeleteDialog({
  impact,
  onCancel,
  onConfirm,
}: {
  impact: ConnectedHeadingDeleteImpact | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const headingCount = impact?.headings.length ?? 0;
  const targetCount = impact?.targets.length ?? 0;
  const pluralHeading = count(headingCount, "heading", "headings");
  const { label: actionLabel, doing } = ACTION_WORDS[impact?.action ?? "delete"];

  return (
    <Dialog
      open={Boolean(impact)}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        className="max-w-[30rem]"
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onCancel();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {actionLabel} connected {pluralHeading}?
          </DialogTitle>
          <DialogDescription className="text-xs">
            {count(headingCount, "This heading is", "These headings are")} connected to{" "}
            {targetCount} {count(targetCount, "target", "targets")}. {doing}{" "}
            {count(headingCount, "it", "them")} will remove those connections.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-(--app-border)/70 bg-(--app-page-2)/45 p-3">
          {impact?.headings.map((heading) => {
            const headingTargets =
              impact.targets.filter((target) =>
                target.headingBlockIds.includes(heading.headingBlockId),
              ) ?? [];
            return (
              <section key={heading.headingBlockId} className="grid gap-1">
                <h3 className="text-xs font-semibold text-(--app-text)">{heading.title}</h3>
                <p className="text-[11px] text-(--app-muted)">
                  {heading.tabTitle} · {headingTargets.length}{" "}
                  {count(headingTargets.length, "connection", "connections")}
                </p>
                {headingTargets.length > 0 ? (
                  <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-(--app-muted)">
                    {headingTargets.map((target) => (
                      <li key={target.id}>
                        {headingTargetKindLabel(target.kind)}: {target.title} · {target.tabTitle}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" autoFocus onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={onConfirm}>
            {actionLabel} {pluralHeading} and disconnect {targetCount}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
