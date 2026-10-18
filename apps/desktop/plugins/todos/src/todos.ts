/*
 * The todo list as it is stored, under one key in the plugin's storage, and the changes made to
 * it. What is read back is checked, so a hand-edited or older file can't break the pane.
 */

export type Todo = {
  id: string;
  text: string;
  done: boolean;
  /** YYYY-MM-DD, or null for none. */
  due: string | null;
  createdAt: number;
  doneAt: number | null;
};

const DUE = /^\d{4}-\d{2}-\d{2}$/;

// What a checkbox label holds.
const MAX_TEXT = 200;

/** The todos in a stored value, dropping anything that isn't one. */
export const readTodos = (value: unknown): Todo[] =>
  Array.isArray(value)
    ? value.flatMap((item): Todo[] => {
        if (!item || typeof item !== "object") return [];
        const todo = item as Record<string, unknown>;
        if (typeof todo.id !== "string" || typeof todo.text !== "string") return [];
        return [
          {
            id: todo.id,
            text: todo.text.slice(0, MAX_TEXT),
            done: todo.done === true,
            due: typeof todo.due === "string" && DUE.test(todo.due) ? todo.due : null,
            createdAt: typeof todo.createdAt === "number" ? todo.createdAt : 0,
            doneAt: typeof todo.doneAt === "number" ? todo.doneAt : null,
          },
        ];
      })
    : [];

/** A due date as given by a date field: YYYY-MM-DD, or null for anything else. */
export const dueOf = (value: unknown) =>
  typeof value === "string" && DUE.test(value) ? value : null;

export const addTodo = (todos: Todo[], text: string, due: string | null, now: number): Todo[] => {
  const trimmed = text.trim().slice(0, MAX_TEXT);
  if (!trimmed) return todos;
  const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return [...todos, { id, text: trimmed, done: false, due, createdAt: now, doneAt: null }];
};

export const updateTodo = (todos: Todo[], id: string, change: Partial<Omit<Todo, "id">>) =>
  todos.map((todo) => (todo.id === id ? { ...todo, ...change } : todo));

export const setDone = (todos: Todo[], id: string, done: boolean, now: number) =>
  updateTodo(todos, id, { done, doneAt: done ? now : null });

export const removeTodo = (todos: Todo[], id: string) => todos.filter((todo) => todo.id !== id);

export const clearDone = (todos: Todo[]) => todos.filter((todo) => !todo.done);

/** Open todos, soonest due first, then those without a date in the order they were added. */
export const openTodos = (todos: Todo[]) =>
  todos
    .filter((todo) => !todo.done)
    .sort(
      (a, b) =>
        (a.due ?? "9999-99-99").localeCompare(b.due ?? "9999-99-99") || a.createdAt - b.createdAt,
    );

/** Done todos, most recently finished first. */
export const doneTodos = (todos: Todo[]) =>
  todos.filter((todo) => todo.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));

/** Whether a due date is past, today or ahead of `today` (YYYY-MM-DD). */
export const dueState = (due: string, today: string) =>
  due < today ? "overdue" : due === today ? "today" : "later";

/** The open todos as a Markdown checklist, for the slash menu. */
export const checklistMarkdown = (todos: Todo[]) =>
  openTodos(todos)
    .map((todo) => `- [ ] ${todo.text.replace(/\s+/g, " ")}${todo.due ? ` (due ${todo.due})` : ""}`)
    .join("\n");
