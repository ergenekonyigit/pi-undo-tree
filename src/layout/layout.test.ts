import { describe, it, expect } from "vitest";
import { buildTreeLayout, computeSubtreeWidths } from "./layout.js";
import { buildSessionTree } from "../model/graph.js";
import type { SessionEntry } from "../types/index.js";

describe("Emacs Undo-Tree 2D Layout Engine", () => {
  const metadata = { sessionId: "s1", cwd: "/test", version: 3 };

  it("lays out linear history vertically without horizontal drift", () => {
    const entries: SessionEntry[] = [
      {
        type: "message",
        id: "n1",
        parentId: null,
        timestamp: "2026-09-08T20:00:00Z",
        message: { role: "user", content: "Prompt 1", timestamp: 1000 },
      },
      {
        type: "message",
        id: "n2",
        parentId: "n1",
        timestamp: "2026-09-08T20:01:00Z",
        message: { role: "user", content: "Prompt 2", timestamp: 2000 },
      },
      {
        type: "message",
        id: "n3",
        parentId: "n2",
        timestamp: "2026-09-08T20:02:00Z",
        message: { role: "user", content: "Prompt 3", timestamp: 3000 },
      },
    ];

    const tree = buildSessionTree(entries, metadata, "n3");
    const { layout, canvas } = buildTreeLayout(tree);

    expect(layout.size).toBe(3);
    const p1 = layout.get("n1")!;
    const p2 = layout.get("n2")!;
    const p3 = layout.get("n3")!;

    // Linear path must stay on the exact same column
    expect(p1.col).toBe(p2.col);
    expect(p2.col).toBe(p3.col);

    // Each turn advances by 3 rows
    expect(p2.row).toBe(p1.row + 3);
    expect(p3.row).toBe(p2.row + 3);

    // Connecting stem cells exist
    expect(canvas.getCell(p1.col, p1.row + 1)?.char).toBe("|");
    expect(canvas.getCell(p1.col, p1.row + 2)?.char).toBe("|");
  });

  it("lays out a 2-way split with non-overlapping sibling branches", () => {
    const entries: SessionEntry[] = [
      {
        type: "message",
        id: "root",
        parentId: null,
        timestamp: "2026-09-08T20:00:00Z",
        message: { role: "user", content: "Root", timestamp: 1000 },
      },
      {
        type: "message",
        id: "branchA",
        parentId: "root",
        timestamp: "2026-09-08T20:01:00Z",
        message: { role: "user", content: "Branch A", timestamp: 2000 },
      },
      {
        type: "message",
        id: "branchB",
        parentId: "root",
        timestamp: "2026-09-08T20:02:00Z",
        message: { role: "user", content: "Branch B", timestamp: 3000 },
      },
    ];

    const tree = buildSessionTree(entries, metadata, "branchB");
    const { layout, canvas } = buildTreeLayout(tree);

    const rootPos = layout.get("root")!;
    const posA = layout.get("branchA")!;
    const posB = layout.get("branchB")!;

    expect(posA.col).toBeLessThan(rootPos.col);
    expect(posB.col).toBeGreaterThan(rootPos.col);
    expect(posA.row).toBe(rootPos.row + 3);
    expect(posB.row).toBe(rootPos.row + 3);

    // Connectors are drawn
    expect(canvas.getCell(posA.col + 1, rootPos.row + 2)?.char).toBe("/");
    expect(canvas.getCell(posB.col - 1, rootPos.row + 2)?.char).toBe("\\");

    // Active branch (branchB) is bright, historical branch (branchA) is dim
    expect(posB.isOnActivePath).toBe(true);
    expect(posA.isOnActivePath).toBe(false);
    expect(canvas.getCell(posB.col - 1, rootPos.row + 2)?.color).toBe("text");
    expect(canvas.getCell(posA.col + 1, rootPos.row + 2)?.color).toBe("dim");

    // When switching selection to branchA, branchA becomes active and branchB becomes dim
    const layoutA = buildTreeLayout(tree, { selectedId: "branchA" });
    const posA2 = layoutA.layout.get("branchA")!;
    const posB2 = layoutA.layout.get("branchB")!;
    expect(posA2.isOnActivePath).toBe(true);
    expect(posB2.isOnActivePath).toBe(false);
    expect(layoutA.canvas.getCell(posA.col + 1, rootPos.row + 2)?.color).toBe("text");
    expect(layoutA.canvas.getCell(posB.col - 1, rootPos.row + 2)?.color).toBe("dim");
  });

  it("renders a viewport window properly with VirtualCanvas", () => {
    const entries: SessionEntry[] = [
      {
        type: "message",
        id: "root",
        parentId: null,
        timestamp: "2026-09-08T20:00:00Z",
        message: { role: "user", content: "Root", timestamp: 1000 },
      },
      {
        type: "message",
        id: "child",
        parentId: "root",
        timestamp: "2026-09-08T20:01:00Z",
        message: { role: "user", content: "Child", timestamp: 2000 },
      },
    ];

    const tree = buildSessionTree(entries, metadata, "child");
    const { canvas } = buildTreeLayout(tree);

    const lines = canvas.renderViewport(0, 0, 20, 10);
    expect(lines.length).toBe(10);
    expect(lines.some((l) => l.includes("o") || l.includes("x"))).toBe(true);
  });
});
