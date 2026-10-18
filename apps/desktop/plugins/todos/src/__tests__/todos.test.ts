import { describe, expect, it } from "vitest";

import {
  addTodo,
  checklistMarkdown,
  clearDone,
  doneTodos,
  dueState,
  openTodos,
  readTodos,
  removeTodo,
  setDone,
  updateTodo,
} from "../todos";

describe("todos", () => {
  it("adds, edits, checks off, deletes and clears todos", () => {
    let todos = addTodo([], "  Buy milk ", null, 1);
    todos = addTodo(todos, "File taxes", "2026-10-20", 2);
    todos = addTodo(todos, "   ", null, 3);
    expect(todos.map((todo) => [todo.text, todo.due, todo.done])).toEqual([
      ["Buy milk", null, false],
      ["File taxes", "2026-10-20", false],
    ]);

    const [milk, taxes] = todos;
    todos = updateTodo(todos, milk!.id, { text: "Buy oat milk", due: "2026-10-19" });
    todos = setDone(todos, taxes!.id, true, 10);
    expect(openTodos(todos).map((todo) => todo.text)).toEqual(["Buy oat milk"]);
    expect(doneTodos(todos)).toEqual([expect.objectContaining({ text: "File taxes", doneAt: 10 })]);

    expect(clearDone(todos).map((todo) => todo.text)).toEqual(["Buy oat milk"]);
    expect(removeTodo(todos, milk!.id).map((todo) => todo.text)).toEqual(["File taxes"]);
  });

  it("orders open todos by due date, undated ones last in the order they were added", () => {
    let todos = addTodo([], "Later", null, 1);
    todos = addTodo(todos, "Next week", "2026-10-25", 2);
    todos = addTodo(todos, "Soon", "2026-10-19", 3);
    todos = addTodo(todos, "Also later", null, 4);
    expect(openTodos(todos).map((todo) => todo.text)).toEqual([
      "Soon",
      "Next week",
      "Later",
      "Also later",
    ]);
  });

  it("reads back only well-formed todos from storage", () => {
    expect(
      readTodos([
        { id: "a", text: "Kept", done: true, due: "2026-10-20", createdAt: 1, doneAt: 2 },
        { id: "b", text: "Bad date", due: "tomorrow" },
        { text: "No id" },
        "junk",
      ]),
    ).toEqual([
      { id: "a", text: "Kept", done: true, due: "2026-10-20", createdAt: 1, doneAt: 2 },
      { id: "b", text: "Bad date", done: false, due: null, createdAt: 0, doneAt: null },
    ]);
    expect(readTodos(null)).toEqual([]);
  });

  it("writes the open todos as a Markdown checklist", () => {
    let todos = addTodo([], "Call Sam", null, 1);
    todos = addTodo(todos, "Pay rent", "2026-11-01", 2);
    todos = setDone(addTodo(todos, "Done already", null, 3), todos[0]!.id, false, 4);
    todos = setDone(todos, todos[2]!.id, true, 5);
    expect(checklistMarkdown(todos)).toBe("- [ ] Pay rent (due 2026-11-01)\n- [ ] Call Sam");
  });

  it("says whether a due date is past, today or ahead", () => {
    expect(dueState("2026-10-17", "2026-10-18")).toBe("overdue");
    expect(dueState("2026-10-18", "2026-10-18")).toBe("today");
    expect(dueState("2026-10-19", "2026-10-18")).toBe("later");
  });
});
