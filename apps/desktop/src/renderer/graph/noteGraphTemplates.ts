import { createUuid } from "@loam/shared/utils/uuid";
import { estimateNoteGraphNodeSize } from "@loam/shared/notes/noteGraphGeometry";
import type {
  NoteGraphEdge,
  NoteGraphNode,
  NoteGraphNodeColor,
  NoteGraphNodeShape,
} from "@loam/shared/notes/noteModel";

/* ------------------------------------------------------------------------ */
/* Templates                                                                 */
/* ------------------------------------------------------------------------ */
type NoteGraphTemplate = {
  id: string;
  label: string;
  description: string;
  build: () => {
    nodes: NoteGraphNode[];
    edges: NoteGraphEdge[];
  };
};

const templateNode = (
  title: string,
  shape: NoteGraphNodeShape,
  color: NoteGraphNodeColor,
  x: number,
  y: number,
  patch?: Partial<NoteGraphNode>,
): NoteGraphNode => ({
  id: createUuid(),
  title,
  color,
  shape,
  size: patch?.size ?? estimateNoteGraphNodeSize({ title, notes: patch?.notes, shape }),
  position: { x, y },
  ...patch,
});

export const noteGraphTemplates: NoteGraphTemplate[] = [
  {
    id: "decision-flow",
    label: "Decision flow",
    description: "Question to review chain with a go / no-go decision fork.",
    build: () => {
      const question = templateNode("Question", "ellipse", "green", 80, 220);
      const criteria = templateNode("Criteria met?", "decision", "orange", 400, 200);
      const plan = templateNode("Plan", "process", "blue", 740, 80);
      const parked = templateNode("Park it", "terminator", "red", 740, 360);
      const work = templateNode("Do the work", "process", "purple", 1080, 80);
      const review = templateNode("Review + lessons", "sticky", "yellow", 1420, 200, {
        notes: "What worked? What changes next time?",
      });
      const nodes = [question, criteria, plan, parked, work, review];
      const link = (
        source: NoteGraphNode,
        target: NoteGraphNode,
        label?: string,
      ): NoteGraphEdge => ({
        id: createUuid(),
        source: source.id,
        target: target.id,
        ...(label ? { label } : {}),
      });
      return {
        nodes,
        edges: [
          link(question, criteria),
          link(criteria, plan, "yes"),
          link(criteria, parked, "no"),
          link(plan, work),
          link(work, review),
        ],
      };
    },
  },
  {
    id: "concept-map",
    label: "Concept map",
    description: "One core idea with four branches and example leaves.",
    build: () => {
      const core = templateNode("Core idea", "ellipse", "blue", 560, 300);
      const branches = [
        templateNode("Branch A", "process", "green", 240, 80),
        templateNode("Branch B", "process", "purple", 880, 80),
        templateNode("Branch C", "process", "orange", 240, 520),
        templateNode("Branch D", "process", "pink", 880, 520),
      ];
      const leaves = branches.map((branch, index) =>
        templateNode(
          `Example ${index + 1}`,
          "sticky",
          branch.color ?? "blue",
          branch.position.x + 40,
          branch.position.y + (index < 2 ? -140 : 220),
        ),
      );
      const nodes = [core, ...branches, ...leaves];
      const edges: NoteGraphEdge[] = [
        ...branches.map((branch): NoteGraphEdge => ({
          id: createUuid(),
          source: core.id,
          target: branch.id,
          direction: "none",
        })),
        ...branches.map((branch, index): NoteGraphEdge => ({
          id: createUuid(),
          source: branch.id,
          target: leaves[index]!.id,
          dashed: true,
        })),
      ];
      return { nodes, edges };
    },
  },
  {
    id: "cornell",
    label: "Cornell frames",
    description: "Cues, notes, and summary frames with starter text blocks.",
    build: () => {
      const cues = templateNode("Cues", "frame", "purple", 80, 80, {
        size: { width: 240, height: 420 },
      });
      const notes = templateNode("Notes", "frame", "blue", 360, 80, {
        size: { width: 560, height: 420 },
      });
      const summary = templateNode("Summary", "frame", "green", 80, 540, {
        size: { width: 840, height: 160 },
      });
      const cueText = templateNode("Key questions", "text", "gray", 110, 140);
      const notesText = templateNode("Main notes", "text", "gray", 400, 140);
      const summaryText = templateNode("One-line takeaway", "text", "gray", 110, 580);
      return {
        nodes: [cues, notes, summary, cueText, notesText, summaryText],
        edges: [],
      };
    },
  },
];
