import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

import { buildSessionTree } from "./model/graph.js";
import { VisualizerComponent, type NavigationAction } from "./tui/visualizer.js";

export async function executeNavigation(
  ctx: ExtensionContext | ExtensionCommandContext,
  action: NavigationAction
): Promise<void> {
  const targetId = action.rawTargetId || action.targetId;
  const cmdCtx = ctx as ExtensionCommandContext;

  try {
    if (typeof cmdCtx.navigateTree === "function") {
      const res = await cmdCtx.navigateTree(targetId, {
        summarize: action.summarize,
      });

      if (res.cancelled) {
        ctx.ui.notify("Tree navigation was cancelled", "warning");
        return;
      }

      if (action.forkPrompt && action.editorText) {
        ctx.ui.setEditorText(action.editorText);
      }

      const modeText = action.summarize ? " (with summary)" : "";
      ctx.ui.notify(`Switched branch to #${targetId.slice(0, 8)}${modeText}`, "info");
    } else {
      // Non-command fallback (e.g. shortcut trigger where navigateTree not exposed on ExtensionContext)
      const sm = ctx.sessionManager as any;
      if (typeof sm.branchWithSummary === "function" && action.summarize) {
        sm.branchWithSummary(targetId, "Branched via undo-tree");
      } else if (typeof sm.branch === "function") {
        sm.branch(targetId);
      }
      if (action.forkPrompt && action.editorText) {
        ctx.ui.setEditorText(action.editorText);
      }
      ctx.ui.notify(`Switched branch to #${targetId.slice(0, 8)}`, "info");
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Navigation failed: ${msg}`, "error");
  }
}

export async function openUndoTree(ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("undo-tree is only available in interactive TUI mode", "error");
    return;
  }

  if (typeof ctx.isIdle === "function" && !ctx.isIdle()) {
    ctx.ui.notify("Cannot navigate tree while agent is busy", "warning");
    return;
  }

  const sessionTreeNodes = typeof ctx.sessionManager.getTree === "function" ? ctx.sessionManager.getTree() : undefined;
  const entries = sessionTreeNodes && sessionTreeNodes.length > 0 ? sessionTreeNodes : ctx.sessionManager.getEntries();
  if (!entries || entries.length === 0) {
    ctx.ui.notify("Session tree is empty", "info");
    return;
  }

  const leafId = ctx.sessionManager.getLeafId();
  const tree = buildSessionTree(
    entries as any,
    {
      sessionId: ctx.sessionManager.getSessionId(),
      cwd: ctx.sessionManager.getCwd(),
      createdAt: ctx.sessionManager.getHeader()?.timestamp || new Date().toISOString(),
      version: 3,
    },
    leafId
  );

  const action = await ctx.ui.custom<NavigationAction | null>((tui, theme, _keybindings, done) => {
    return new VisualizerComponent({
      tree,
      theme,
      onSelect: (act) => done(act),
      onCancel: () => done(null),
      onRequestRender: () => tui.requestRender(),
    });
  });

  if (!action) {
    return;
  }

  await executeNavigation(ctx, action);
}

export default function undoTreeExtension(pi: ExtensionAPI): void {
  // Register /undo-tree slash command
  pi.registerCommand("undo-tree", {
    description: "Open the interactive Emacs-style visual undo-tree navigator",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await openUndoTree(ctx);
    },
  });

  // Register Ctrl+Shift+U shortcut (matches preset/extension conventions)
  pi.registerShortcut(Key.ctrlShift("u"), {
    description: "Open undo-tree visualizer",
    handler: async (ctx: ExtensionContext) => {
      await openUndoTree(ctx);
    },
  });
}
