import { describe, it, expect } from "vitest";
import { buildSessionTree, classifyRawEntryKind } from "./graph.js";
import type { SessionEntry, SessionMessageEntry, CompactionEntry, LabelEntry, BranchSummaryEntry } from "../types/index.js";

describe("Session Graph Builder", () => {
  const metadata = {
    sessionId: "test-session-1",
    cwd: "/Users/dev/test",
    version: 3,
  };

  it("classifies entry kinds correctly", () => {
    const userMsg: SessionMessageEntry = {
      type: "message",
      id: "u1",
      parentId: null,
      timestamp: "2026-09-08T20:00:00Z",
      message: { role: "user", content: "Hello", timestamp: 1000 },
    };
    expect(classifyRawEntryKind(userMsg)).toBe("user");

    const compEntry: CompactionEntry = {
      type: "compaction",
      id: "c1",
      parentId: "u1",
      timestamp: "2026-09-08T20:01:00Z",
      summary: "Summary text",
      firstKeptEntryId: "u1",
      tokensBefore: 1000,
    };
    expect(classifyRawEntryKind(compEntry)).toBe("compaction");
  });

  it("aggregates linear multi-step interaction into a single TurnNode with metrics", () => {
    const entries: SessionEntry[] = [
      {
        type: "message",
        id: "msg-1",
        parentId: null,
        timestamp: "2026-09-08T20:00:00Z",
        message: { role: "user", content: "Implement feature X in src/app.ts", timestamp: 1000 },
      },
      {
        type: "message",
        id: "msg-2",
        parentId: "msg-1",
        timestamp: "2026-09-08T20:00:01Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Need to read src/app.ts first." },
            {
              type: "toolCall",
              id: "call-1",
              name: "read",
              arguments: { filePath: "src/app.ts" },
            },
          ],
          usage: { input: 100, output: 50, totalTokens: 150 },
          timestamp: 1001,
        },
      },
      {
        type: "message",
        id: "msg-3",
        parentId: "msg-2",
        timestamp: "2026-09-08T20:00:02Z",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "read",
          content: [{ type: "text", text: "export const x = 1;" }],
          isError: false,
          timestamp: 1002,
        },
      },
      {
        type: "message",
        id: "msg-4",
        parentId: "msg-3",
        timestamp: "2026-09-08T20:00:03Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Done reading app.ts." },
            {
              type: "toolCall",
              id: "call-2",
              name: "edit",
              arguments: { filePath: "src/app.ts" },
            },
          ],
          usage: { input: 200, output: 80, totalTokens: 280 },
          timestamp: 1003,
        },
      },
    ];

    const tree = buildSessionTree(entries, metadata, "msg-4");

    expect(tree.rawNodes.size).toBe(4);
    expect(tree.turnNodes.size).toBe(1);

    const turn = tree.turnNodes.get("msg-1")!;
    expect(turn).toBeDefined();
    expect(turn.title).toContain("Implement feature X");
    expect(turn.tools.length).toBe(2);
    expect(turn.tools[0].toolName).toBe("read");
    expect(turn.tools[0].result?.content).toBe("export const x = 1;");
    expect(turn.fileOps.readFiles.has("src/app.ts")).toBe(true);
    expect(turn.fileOps.modifiedFiles.has("src/app.ts")).toBe(true);
    expect(turn.metrics.totalTokens).toBe(430);
    expect(turn.isOnActivePath).toBe(true);
    expect(tree.activeTurnId).toBe("msg-1");
  });

  it("handles branching history and labels", () => {
    const entries: SessionEntry[] = [
      {
        type: "message",
        id: "turn1",
        parentId: null,
        timestamp: "2026-09-08T20:00:00Z",
        message: { role: "user", content: "Prompt 1", timestamp: 1000 },
      },
      // Branch A
      {
        type: "message",
        id: "turn2a",
        parentId: "turn1",
        timestamp: "2026-09-08T20:01:00Z",
        message: { role: "user", content: "Prompt 2 on branch A", timestamp: 2000 },
      },
      // Branch B
      {
        type: "message",
        id: "turn2b",
        parentId: "turn1",
        timestamp: "2026-09-08T20:02:00Z",
        message: { role: "user", content: "Prompt 2 on branch B", timestamp: 3000 },
      },
      // Label on turn2a
      {
        type: "label",
        id: "lbl-1",
        parentId: "turn2b",
        timestamp: "2026-09-08T20:03:00Z",
        targetId: "turn2a",
        label: "stable-checkpoint",
      } as LabelEntry,
    ];

    const tree = buildSessionTree(entries, metadata, "turn2b");

    expect(tree.turnNodes.size).toBe(3);
    const rootTurn = tree.turnNodes.get("turn1")!;
    expect(rootTurn.childrenTurnIds).toEqual(["turn2a", "turn2b"]);

    const turnA = tree.turnNodes.get("turn2a")!;
    expect(turnA.label).toBe("stable-checkpoint");
    expect(turnA.isOnActivePath).toBe(false);

    const turnB = tree.turnNodes.get("turn2b")!;
    expect(turnB.isOnActivePath).toBe(true);
    expect(tree.activeTurnPath).toEqual(["turn1", "turn2b"]);
    expect(tree.activeTurnId).toBe("turn2b");
  });

  it("handles compaction and branch summary entries as distinct turns", () => {
    const entries: SessionEntry[] = [
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-09-08T20:00:00Z",
        message: { role: "user", content: "Start", timestamp: 1000 },
      },
      {
        type: "compaction",
        id: "c1",
        parentId: "u1",
        timestamp: "2026-09-08T20:05:00Z",
        summary: "Context was compacted",
        firstKeptEntryId: "u1",
        tokensBefore: 50000,
      } as CompactionEntry,
      {
        type: "branch_summary",
        id: "b1",
        parentId: "c1",
        timestamp: "2026-09-08T20:06:00Z",
        fromId: "u1",
        summary: "Switched from another branch",
      } as BranchSummaryEntry,
    ];

    const tree = buildSessionTree(entries, metadata, "b1");

    expect(tree.turnNodes.size).toBe(3);
    expect(tree.turnNodes.get("c1")?.kind).toBe("compaction");
    expect(tree.turnNodes.get("b1")?.kind).toBe("branch_summary");
    expect(tree.activeTurnPath).toEqual(["u1", "c1", "b1"]);
  });

  it("extracts and synthesizes FileDiffRecords on TurnNodes during aggregation", () => {
    const entries: SessionEntry[] = [
      {
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-09-08T20:00:00Z",
        message: { role: "user", content: "Fix bug in auth.ts", timestamp: 1000 },
      },
      {
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: "2026-09-08T20:00:01Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-edit-1",
              name: "edit",
              arguments: { filePath: "src/auth.ts" },
            },
          ],
          timestamp: 1001,
        },
      },
      {
        type: "message",
        id: "m3",
        parentId: "m2",
        timestamp: "2026-09-08T20:00:02Z",
        message: {
          role: "toolResult",
          toolCallId: "call-edit-1",
          toolName: "edit",
          content: [{ type: "text", text: "@@ -1,2 +1,3 @@\n+const TOKEN = 123;\n function test() {}" }],
          details: { diff: "@@ -1,2 +1,3 @@\n+const TOKEN = 123;\n function test() {}" },
          isError: false,
          timestamp: 1002,
        },
      },
    ];

    const tree = buildSessionTree(entries, metadata, "m3");
    const turn = tree.turnNodes.get("m1");

    expect(turn).toBeDefined();
    expect(turn?.diffs).toHaveLength(1);
    expect(turn?.diffs?.[0].filePath).toBe("src/auth.ts");
    expect(turn?.diffs?.[0].diffText).toContain("+const TOKEN = 123;");
  });

  it("ingests canonical SessionTreeNode[] hierarchy directly across the seam", () => {
    const sessionTreeNodes = [
      {
        entry: {
          type: "message",
          id: "root-node",
          parentId: null,
          timestamp: "2026-09-08T20:00:00Z",
          message: { role: "user", content: "Root question", timestamp: 1000 },
        } as SessionEntry,
        label: "checkpoint-1",
        children: [
          {
            entry: {
              type: "message",
              id: "child-node",
              parentId: "root-node",
              timestamp: "2026-09-08T20:01:00Z",
              message: { role: "user", content: "Follow-up question", timestamp: 2000 },
            } as SessionEntry,
            children: [],
          },
        ],
      },
    ];

    const tree = buildSessionTree(sessionTreeNodes as any, metadata, "child-node");

    expect(tree.turnNodes.size).toBe(2);
    expect(tree.turnNodes.get("root-node")?.label).toBe("checkpoint-1");
    expect(tree.turnNodes.get("child-node")?.parentTurnId).toBe("root-node");
    expect(tree.activeTurnPath).toEqual(["root-node", "child-node"]);
  });
});
