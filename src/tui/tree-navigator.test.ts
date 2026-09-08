import { describe, it, expect } from "vitest";
import { TreeNavigator } from "./tree-view.js";
import { buildSessionTree } from "../model/graph.js";
import type { SessionEntry } from "../types/index.js";

describe("TreeNavigator Deep Module", () => {
  const metadata = { sessionId: "sess-nav-1", cwd: "/test", version: 3 };

  const entries: SessionEntry[] = [
    {
      type: "message",
      id: "root",
      parentId: null,
      timestamp: "2026-09-08T20:00:00Z",
      message: { role: "user", content: "Root question", timestamp: 1000 },
    },
    {
      type: "message",
      id: "branchA",
      parentId: "root",
      timestamp: "2026-09-08T20:01:00Z",
      message: { role: "user", content: "Branch A work", timestamp: 2000 },
    },
    {
      type: "message",
      id: "branchB",
      parentId: "root",
      timestamp: "2026-09-08T20:02:00Z",
      message: { role: "user", content: "Branch B work", timestamp: 3000 },
    },
  ];

  it("encapsulates layout, bounds, and viewport rendering behind navigation verbs", () => {
    const tree = buildSessionTree(entries, metadata, "branchB");
    const nav = new TreeNavigator(tree);

    // Initial cursor should be at active leaf (branchB)
    expect(nav.selectedId).toBe("branchB");
    expect(nav.getSelectedNode()?.id).toBe("branchB");

    // Bounds are computed
    const bounds = nav.getTreeBounds();
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);

    // Move up (Undo direction) to root
    const movedUp = nav.moveUp();
    expect(movedUp).toBe(true);
    expect(nav.selectedId).toBe("root");
    expect(nav.getSelectedNode()?.id).toBe("root");

    // Cannot move up past root
    expect(nav.moveUp()).toBe(false);
    expect(nav.selectedId).toBe("root");

    // Move down (Redo direction) follows active branch to branchB
    const movedDown = nav.moveDown();
    expect(movedDown).toBe(true);
    expect(nav.selectedId).toBe("branchB");

    // Switch to sibling branch (moveLeft to branchA)
    const movedLeft = nav.moveLeft();
    expect(movedLeft).toBe(true);
    expect(nav.selectedId).toBe("branchA");

    // Move right back to branchB
    const movedRight = nav.moveRight();
    expect(movedRight).toBe(true);
    expect(nav.selectedId).toBe("branchB");

    // Render viewport lines
    const lines = nav.render(40, 10);
    expect(lines.length).toBe(10);
    expect(lines.some((l) => l.includes("x"))).toBe(true); // selected glyph 'x'
  });

  it("handles filter mode switching cleanly", () => {
    const tree = buildSessionTree(entries, metadata, "branchB");
    const nav = new TreeNavigator(tree);

    expect(nav.getFilterMode()).toBe("turn");
    nav.setFilterMode("raw");
    expect(nav.getFilterMode()).toBe("raw");
    expect(nav.selectedId).toBe("branchB");

    nav.setFilterMode("turn");
    expect(nav.getFilterMode()).toBe("turn");
  });
});
