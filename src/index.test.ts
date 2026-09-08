import { describe, it, expect, vi } from "vitest";
import undoTreeExtension, { openUndoTree } from "./index.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

describe("undoTreeExtension registration", () => {
  it("registers /undo-tree command and keyboard shortcut", () => {
    const registeredCommands: Record<string, unknown> = {};
    const registeredShortcuts: unknown[] = [];

    const mockPi = {
      registerCommand: vi.fn((name, options) => {
        registeredCommands[name] = options;
      }),
      registerShortcut: vi.fn((shortcut, options) => {
        registeredShortcuts.push({ shortcut, options });
      }),
    } as unknown as ExtensionAPI;

    undoTreeExtension(mockPi);

    expect(mockPi.registerCommand).toHaveBeenCalledWith(
      "undo-tree",
      expect.objectContaining({
        description: expect.stringContaining("undo-tree"),
      })
    );
    expect(mockPi.registerShortcut).toHaveBeenCalledTimes(1);
  });

  it("warns when invoked outside of TUI mode", async () => {
    const notifyMock = vi.fn();
    const mockCtx = {
      mode: "rpc",
      ui: { notify: notifyMock },
    } as unknown as ExtensionContext;

    await openUndoTree(mockCtx);

    expect(notifyMock).toHaveBeenCalledWith(
      expect.stringContaining("only available in interactive TUI mode"),
      "error"
    );
  });

  it("warns when agent is busy", async () => {
    const notifyMock = vi.fn();
    const mockCtx = {
      mode: "tui",
      isIdle: () => false,
      ui: { notify: notifyMock },
    } as unknown as ExtensionContext;

    await openUndoTree(mockCtx);

    expect(notifyMock).toHaveBeenCalledWith(
      expect.stringContaining("Cannot navigate tree while agent is busy"),
      "warning"
    );
  });

  it("notifies when session entries are empty", async () => {
    const notifyMock = vi.fn();
    const mockCtx = {
      mode: "tui",
      isIdle: () => true,
      sessionManager: {
        getEntries: () => [],
      },
      ui: { notify: notifyMock },
    } as unknown as ExtensionContext;

    await openUndoTree(mockCtx);

    expect(notifyMock).toHaveBeenCalledWith("Session tree is empty", "info");
  });

  it("opens visualizer in TUI mode and executes navigateTree on selection", async () => {
    const notifyMock = vi.fn();
    const navigateTreeMock = vi.fn().mockResolvedValue({ cancelled: false });
    const customUiMock = vi.fn((factory) => {
      // Simulate user selecting a node
      return factory(
        { requestRender: vi.fn() },
        { fg: (_: string, t: string) => t, bg: (_: string, t: string) => t },
        {},
        (val: unknown) => val
      );
    });

    const entries = [
      {
        type: "message",
        id: "msg-1",
        parentId: null,
        timestamp: "2026-09-08T20:00:00Z",
        message: { role: "user", content: "Hello", timestamp: 1000 },
      },
      {
        type: "message",
        id: "msg-2",
        parentId: "msg-1",
        timestamp: "2026-09-08T20:01:00Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hi there!" }],
          timestamp: 2000,
        },
      },
    ];

    const mockCtx = {
      mode: "tui",
      isIdle: () => true,
      sessionManager: {
        getLeafId: () => "msg-2",
        getEntries: () => entries,
        getSessionId: () => "sess-12345",
        getCwd: () => "/test",
        getHeader: () => ({ timestamp: "2026-09-08T20:00:00Z" }),
      },
      ui: {
        notify: notifyMock,
        custom: vi.fn().mockResolvedValue({
          targetId: "msg-1",
          rawTargetId: "msg-2",
          summarize: false,
          forkPrompt: false,
        }),
      },
      navigateTree: navigateTreeMock,
    } as unknown as ExtensionCommandContext;

    await openUndoTree(mockCtx);

    expect(mockCtx.ui.custom).toHaveBeenCalled();
    expect(navigateTreeMock).toHaveBeenCalledWith("msg-2", { summarize: false });
    expect(notifyMock).toHaveBeenCalledWith(
      expect.stringContaining("Switched branch to #msg-2"),
      "info"
    );
  });

  it("handles prompt editing by setting editor text", async () => {
    const notifyMock = vi.fn();
    const setEditorTextMock = vi.fn();
    const navigateTreeMock = vi.fn().mockResolvedValue({ cancelled: false });

    const mockCtx = {
      mode: "tui",
      isIdle: () => true,
      sessionManager: {
        getLeafId: () => "msg-2",
        getEntries: () => [
          {
            type: "message",
            id: "msg-1",
            parentId: null,
            timestamp: "2026-09-08T20:00:00Z",
            message: { role: "user", content: "Custom Prompt", timestamp: 1000 },
          },
        ],
        getSessionId: () => "sess-12345",
        getCwd: () => "/test",
        getHeader: () => null,
      },
      ui: {
        notify: notifyMock,
        setEditorText: setEditorTextMock,
        custom: vi.fn().mockResolvedValue({
          targetId: "msg-1",
          rawTargetId: "msg-1",
          summarize: false,
          forkPrompt: true,
          editorText: "Custom Prompt",
        }),
      },
      navigateTree: navigateTreeMock,
    } as unknown as ExtensionCommandContext;

    await openUndoTree(mockCtx);

    expect(navigateTreeMock).toHaveBeenCalledWith("msg-1", { summarize: false });
    expect(setEditorTextMock).toHaveBeenCalledWith("Custom Prompt");
  });

  it("falls back to sessionManager.branch when navigateTree is not available", async () => {
    const notifyMock = vi.fn();
    const branchMock = vi.fn();

    const mockCtx = {
      mode: "tui",
      isIdle: () => true,
      sessionManager: {
        getLeafId: () => "msg-1",
        getEntries: () => [
          {
            type: "message",
            id: "msg-1",
            parentId: null,
            timestamp: "2026-09-08T20:00:00Z",
            message: { role: "user", content: "Test", timestamp: 1000 },
          },
        ],
        getSessionId: () => "sess-12345",
        getCwd: () => "/test",
        getHeader: () => null,
        branch: branchMock,
      },
      ui: {
        notify: notifyMock,
        custom: vi.fn().mockResolvedValue({
          targetId: "msg-1",
          rawTargetId: "msg-1",
          summarize: false,
          forkPrompt: false,
        }),
      },
    } as unknown as ExtensionContext;

    await openUndoTree(mockCtx);

    expect(branchMock).toHaveBeenCalledWith("msg-1");
    expect(notifyMock).toHaveBeenCalledWith(
      expect.stringContaining("Switched branch to #msg-1"),
      "info"
    );
  });
});
