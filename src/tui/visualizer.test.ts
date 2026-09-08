import { describe, it, expect, vi } from "vitest";
import { VisualizerComponent } from "./visualizer.js";
import { buildSessionTree } from "../model/graph.js";
import type { SessionEntry } from "../types/index.js";

describe("VisualizerComponent TUI Component", () => {
  const metadata = { sessionId: "sess-12345678", cwd: "/test", version: 3 };

  const entries: SessionEntry[] = [
    {
      type: "message",
      id: "turn1",
      parentId: null,
      timestamp: "2026-09-08T20:00:00Z",
      message: { role: "user", content: "Initial prompt", timestamp: 1000 },
    },
    {
      type: "message",
      id: "turn2",
      parentId: "turn1",
      timestamp: "2026-09-08T20:01:00Z",
      message: { role: "user", content: "Second prompt", timestamp: 2000 },
    },
  ];

  it("renders a split-screen layout constrained to width", () => {
    const tree = buildSessionTree(entries, metadata, "turn2");
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    const visualizer = new VisualizerComponent({
      tree,
      onSelect,
      onCancel,
    });

    const lines = visualizer.render(80);
    expect(lines.length).toBeGreaterThan(10);
    expect(lines[1]).toBe("\x1b[1mUndo Tree\x1b[22m");
    expect(lines[2]).toContain("─"); // Header separator
    expect(lines.some((l) => l.includes("│"))).toBe(true); // Split separator
    expect(lines[lines.length - 2]).toContain("Enter jump"); // Controls at bottom
    expect(lines[lines.length - 1]).toContain("─"); // Bottom border
  });

  it("navigates with keyboard keys and handles selection", () => {
    const tree = buildSessionTree(entries, metadata, "turn2");
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const onRequestRender = vi.fn();

    const visualizer = new VisualizerComponent({
      tree,
      onSelect,
      onCancel,
      onRequestRender,
    });

    // Move up to turn1
    visualizer.handleInput("k");
    expect(onRequestRender).toHaveBeenCalled();

    // Select with Enter
    visualizer.handleInput("\r");
    expect(onSelect).toHaveBeenCalledWith({
      targetId: "turn1",
      rawTargetId: "turn1",
      summarize: false,
      forkPrompt: false,
    });

    // Select with Shift+Enter / S
    visualizer.handleInput("s");
    expect(onSelect).toHaveBeenCalledWith({
      targetId: "turn1",
      rawTargetId: "turn1",
      summarize: true,
      forkPrompt: false,
    });

    // Edit prompt with e
    visualizer.handleInput("e");
    expect(onSelect).toHaveBeenCalledWith({
      targetId: "turn1",
      rawTargetId: "turn1",
      summarize: false,
      forkPrompt: true,
      editorText: "Initial prompt",
    });

    // Cancel with Escape
    visualizer.handleInput("\x1b");
    expect(onCancel).toHaveBeenCalled();
  });

  it("horizontally centers the tree in the left pane", () => {
    const tree = buildSessionTree(entries, metadata, "turn2");
    const visualizer = new VisualizerComponent({
      tree,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const lines = visualizer.render(120);
    // Find body lines with the separator │
    const bodyLines = lines.filter((l) => l.includes("│"));
    expect(bodyLines.length).toBeGreaterThan(0);

    // Find a line containing the tree node (x or o)
    const nodeLine = bodyLines.find((l) => {
      const [leftPane] = l.split("│");
      return leftPane.includes("x") || leftPane.includes("o");
    });
    expect(nodeLine).toBeDefined();

    const [leftPane] = nodeLine!.split("│");
    const nodeIndex = Math.max(leftPane.indexOf("x"), leftPane.indexOf("o"));

    // The left pane width is around 30-45 cols. The node should be near center (e.g. index 10-25),
    // NOT stuck at index 0-3.
    expect(nodeIndex).toBeGreaterThan(5);
    expect(nodeIndex).toBeLessThan(leftPane.length - 5);
  });

  it("dynamically highlights active branch and dims other branches when navigating siblings", () => {
    const splitEntries: SessionEntry[] = [
      {
        type: "message",
        id: "root",
        parentId: null,
        timestamp: "2026-09-08T20:00:00Z",
        message: { role: "user", content: "Root prompt", timestamp: 1000 },
      },
      {
        type: "message",
        id: "branchA",
        parentId: "root",
        timestamp: "2026-09-08T20:01:00Z",
        message: { role: "user", content: "Branch A prompt", timestamp: 2000 },
      },
      {
        type: "message",
        id: "branchB",
        parentId: "root",
        timestamp: "2026-09-08T20:02:00Z",
        message: { role: "user", content: "Branch B prompt", timestamp: 3000 },
      },
    ];

    const tree = buildSessionTree(splitEntries, metadata, "branchB");
    const visualizer = new VisualizerComponent({
      tree,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    // Initially at branchB (the active leaf)
    let lines = visualizer.render(100);
    expect(lines.some((l) => l.includes("Branch B prompt"))).toBe(true);
    expect(lines.some((l) => l.includes("[active leaf]"))).toBe(true);

    // Switch to left sibling (branchA)
    visualizer.handleInput("h");
    lines = visualizer.render(100);

    // Now branchA is the active branch and active leaf!
    expect(lines.some((l) => l.includes("Branch A prompt"))).toBe(true);
    expect(lines.some((l) => l.includes("[active leaf]"))).toBe(true);
  });

  it("toggles fullscreen mode with 'f' key", () => {
    const tree = buildSessionTree(entries, metadata, "turn2");
    const onRequestRender = vi.fn();
    const visualizer = new VisualizerComponent({
      tree,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
      onRequestRender,
    });

    const defaultLines = visualizer.render(80);
    expect(defaultLines.length).toBe(20);

    // Toggle fullscreen on
    visualizer.handleInput("f");
    expect(onRequestRender).toHaveBeenCalledTimes(1);

    const fullLines = visualizer.render(80);
    expect(fullLines.length).toBeGreaterThan(20);

    // Toggle fullscreen off
    visualizer.handleInput("f");
    expect(onRequestRender).toHaveBeenCalledTimes(2);

    const revertedLines = visualizer.render(80);
    expect(revertedLines.length).toBe(20);
  });
});
