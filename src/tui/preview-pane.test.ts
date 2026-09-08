import { describe, it, expect } from "vitest";
import { PreviewPane } from "./preview-pane.js";
import type { PositionedNode } from "../layout/layout.js";

describe("PreviewPane Component", () => {
  const mockNode: PositionedNode = {
    id: "node-12345678",
    parentId: null,
    childrenIds: [],
    row: 0,
    col: 0,
    metrics: { lwidth: 0, cwidth: 1, rwidth: 0, charLwidth: 0, charRwidth: 0 },
    marker: "active_leaf",
    label: "feature-checkpoint",
    isOnActivePath: true,
    timestamp: "2026-09-08T20:30:00.000Z",
    title: "Implement auth token",
    turn: {
      id: "node-12345678",
      parentTurnId: null,
      childrenTurnIds: [],
      rawEntryIds: ["node-12345678"],
      kind: "user_turn",
      status: "completed",
      title: "Implement auth token",
      promptText: "Add JWT authentication support in auth.ts",
      assistantText: "Here is the implementation of JWT authentication.",
      thinkingText: "Checking security constraints first.",
      tools: [
        {
          callId: "call-1",
          toolName: "edit",
          args: { filePath: "src/auth.ts" },
          result: {
            content: "@@ -1,3 +1,4 @@\n+import jwt from 'jsonwebtoken';\n export function auth() {}",
            isError: false,
          },
        },
      ],
      fileOps: {
        readFiles: new Set(["src/config.ts"]),
        modifiedFiles: new Set(["src/auth.ts"]),
      },
      metrics: {
        inputTokens: 500,
        outputTokens: 250,
        totalTokens: 750,
        totalCost: 0.0045,
        toolCallsCount: 1,
      },
      isOnActivePath: true,
      timestamp: "2026-09-08T20:30:00.000Z",
    },
  };

  it("renders overview with prompt, response, metrics, and tools", () => {
    const pane = new PreviewPane();
    const lines = pane.render(mockNode, 60, 20);

    expect(lines.some((l) => l.includes("active leaf"))).toBe(true);
    expect(lines.some((l) => l.includes("feature-checkpoint"))).toBe(true);
    expect(lines.some((l) => l.includes("Add JWT authentication"))).toBe(true);
    expect(lines.some((l) => l.includes("assistant:"))).toBe(true);
    expect(lines.some((l) => l.includes("tools:"))).toBe(true);
    expect(lines.some((l) => l.includes("750 tokens"))).toBe(true);
  });

  it("toggles and renders diff mode with file modifications and unified diffs", () => {
    const pane = new PreviewPane({ showDiff: true });
    const lines = pane.render(mockNode, 60, 20);

    expect(lines.some((l) => l.includes("Diff"))).toBe(true);
    expect(lines.some((l) => l.includes("src/auth.ts"))).toBe(true);
    expect(lines.some((l) => l.includes("+import jwt"))).toBe(true);
  });

  it("renders diffs from tool details.diff and edits array", () => {
    const piToolNode: PositionedNode = {
      ...mockNode,
      turn: {
        ...mockNode.turn!,
        tools: [
          {
            callId: "call-2",
            toolName: "edit",
            args: { path: "src/server.ts" },
            result: {
              content: "",
              isError: false,
              details: {
                diff: "--- a/src/server.ts\n+++ b/src/server.ts\n@@ -10,3 +10,4 @@\n-const PORT = 3000;\n+const PORT = 8080;",
              },
            },
          },
        ],
      },
    };

    const pane = new PreviewPane({ showDiff: true });
    const lines = pane.render(piToolNode, 60, 20);

    expect(lines.some((l) => l.includes("src/server.ts"))).toBe(true);
    expect(lines.some((l) => l.includes("-const PORT = 3000;"))).toBe(true);
    expect(lines.some((l) => l.includes("+const PORT = 8080;"))).toBe(true);
  });

  it("supports scrolling across long outputs", () => {
    const pane = new PreviewPane();
    pane.scrollDown(5);
    expect(pane.scrollRow).toBe(5);

    pane.pageDown(10);
    expect(pane.scrollRow).toBe(15);

    pane.pageUp(5);
    expect(pane.scrollRow).toBe(10);

    pane.resetScroll();
    expect(pane.scrollRow).toBe(0);
  });
});
