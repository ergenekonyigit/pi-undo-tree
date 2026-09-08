import type { Component } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { SessionTree } from "../types/index.js";
import type { ThemeColors } from "../layout/canvas.js";
import { TreeNavigator } from "./tree-view.js";
import { PreviewPane } from "./preview-pane.js";
import { extractTextContent } from "../model/graph.js";

export interface NavigationAction {
  targetId: string;
  rawTargetId: string;
  summarize: boolean;
  forkPrompt?: boolean;
  editorText?: string;
}

export interface VisualizerComponentOptions {
  tree: SessionTree;
  theme?: ThemeColors;
  onSelect: (action: NavigationAction) => void;
  onCancel: () => void;
  onRequestRender?: () => void;
  targetHeight?: number;
}

export class VisualizerComponent implements Component {
  private navigator: TreeNavigator;
  private previewPane: PreviewPane;
  private tree: SessionTree;
  private theme?: ThemeColors;
  private onSelect: (action: NavigationAction) => void;
  private onCancel: () => void;
  private onRequestRender?: () => void;
  private customTargetHeight?: number;
  private isFullScreen: boolean = false;

  constructor(options: VisualizerComponentOptions) {
    this.tree = options.tree;
    this.theme = options.theme;
    this.onSelect = options.onSelect;
    this.onCancel = options.onCancel;
    this.onRequestRender = options.onRequestRender;
    this.customTargetHeight = options.targetHeight;

    this.navigator = new TreeNavigator(this.tree, {
      filterMode: "turn",
    });
    this.previewPane = new PreviewPane();
  }

  public invalidate(): void {
    this.navigator.rebuildLayout();
  }

  public handleInput(data: string): void {
    // Navigation Up (Undo)
    if (
      matchesKey(data, "up") ||
      matchesKey(data, "k") ||
      matchesKey(data, "p")
    ) {
      if (this.navigator.moveUp()) {
        this.previewPane.resetScroll();
        this.onRequestRender?.();
      }
      return;
    }

    // Navigation Down (Redo)
    if (
      matchesKey(data, "down") ||
      matchesKey(data, "j") ||
      matchesKey(data, "n")
    ) {
      if (this.navigator.moveDown()) {
        this.previewPane.resetScroll();
        this.onRequestRender?.();
      }
      return;
    }

    // Navigation Left (Sibling branch)
    if (
      matchesKey(data, "left") ||
      matchesKey(data, "h") ||
      matchesKey(data, "b")
    ) {
      if (this.navigator.moveLeft()) {
        this.previewPane.resetScroll();
        this.onRequestRender?.();
      }
      return;
    }

    // Navigation Right (Sibling branch)
    if (
      matchesKey(data, "right") ||
      matchesKey(data, "l")
    ) {
      if (this.navigator.moveRight()) {
        this.previewPane.resetScroll();
        this.onRequestRender?.();
      }
      return;
    }

    // Toggle Diff View (Emacs 'd' key)
    if (matchesKey(data, "d")) {
      this.previewPane.toggleDiff();
      this.onRequestRender?.();
      return;
    }

    // Toggle Timestamps (Emacs 't' key)
    if (matchesKey(data, "t")) {
      this.previewPane.toggleTimestamps();
      this.onRequestRender?.();
      return;
    }

    // Scroll Preview Pane Up
    if (matchesKey(data, "pageUp") || matchesKey(data, "[")) {
      this.previewPane.pageUp(5);
      this.onRequestRender?.();
      return;
    }

    // Scroll Preview Pane Down
    if (matchesKey(data, "pageDown") || matchesKey(data, "]")) {
      this.previewPane.pageDown(5);
      this.onRequestRender?.();
      return;
    }

    // Toggle Filter Mode (turn vs raw)
    if (matchesKey(data, "ctrl+o")) {
      const nextMode = this.navigator.getFilterMode() === "turn" ? "raw" : "turn";
      this.navigator.setFilterMode(nextMode);
      this.onRequestRender?.();
      return;
    }

    // Edit / Fork Prompt (Emacs 'e' key)
    if (matchesKey(data, "e")) {
      const selected = this.navigator.getSelectedNode();
      if (selected) {
        if (selected.turn) {
          this.onSelect({
            targetId: selected.id,
            rawTargetId: selected.turn.rawEntryIds[0],
            summarize: false,
            forkPrompt: true,
            editorText: selected.turn.promptText,
          });
        } else if (selected.raw) {
          const isUser = selected.raw.kind === "user";
          const editorText = isUser
            ? extractTextContent((selected.raw.entry as any).message?.content)
            : undefined;
          this.onSelect({
            targetId: selected.id,
            rawTargetId: selected.id,
            summarize: false,
            forkPrompt: isUser,
            editorText,
          });
        }
      }
      return;
    }

    // Select & Navigate with Summary
    if (
      matchesKey(data, "shift+enter") ||
      matchesKey(data, "shift+return") ||
      matchesKey(data, "s") ||
      data === "S"
    ) {
      const selected = this.navigator.getSelectedNode();
      if (selected) {
        const rawTargetId = selected.turn
          ? selected.turn.rawEntryIds[selected.turn.rawEntryIds.length - 1]
          : selected.id;
        this.onSelect({
          targetId: selected.id,
          rawTargetId,
          summarize: true,
          forkPrompt: false,
        });
      }
      return;
    }

    // Select & Navigate directly
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      const selected = this.navigator.getSelectedNode();
      if (selected) {
        const rawTargetId = selected.turn
          ? selected.turn.rawEntryIds[selected.turn.rawEntryIds.length - 1]
          : selected.id;
        this.onSelect({
          targetId: selected.id,
          rawTargetId,
          summarize: false,
          forkPrompt: false,
        });
      }
      return;
    }

    // Toggle Full Screen ('f' key)
    if (matchesKey(data, "f")) {
      this.isFullScreen = !this.isFullScreen;
      this.onRequestRender?.();
      return;
    }

    // Exit visualizer
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.onCancel();
      return;
    }
  }

  public render(width: number, customHeight?: number): string[] {
    const termHeight =
      typeof process !== "undefined" && process.stdout?.rows && process.stdout.rows > 0
        ? process.stdout.rows
        : 24;

    let targetHeight: number;
    if (this.isFullScreen) {
      targetHeight = Math.max(20, termHeight - 2);
    } else {
      // Fixed 20-line limit (matching Pi's native modal style)
      targetHeight =
        customHeight ??
        this.customTargetHeight ??
        Math.min(20, Math.max(11, termHeight - 2));
    }

    const lines: string[] = [];

    const formatFg = (color: string, text: string) => {
      if (!this.theme) return text;
      try {
        return this.theme.fg(color, text);
      } catch {
        return text;
      }
    };

    const hr = formatFg("dim", "─".repeat(width));

    // 1. Top border
    lines.push(hr);

    // 2. Title (Native Pi style: bold, uncolored, no leading space)
    const mode = this.navigator.getFilterMode();
    const modeBadge = mode === "turn" ? "" : " [raw]";
    lines.push(`\x1b[1mUndo Tree${modeBadge}\x1b[22m`);

    // 3. Header separator
    lines.push(hr);

    // 4. Split Screen Body
    const bodyHeight = Math.max(5, targetHeight - 5);
    const bounds = this.navigator.getTreeBounds();

    // Dynamic split: give tree what it comfortably needs, up to 45% of width
    const maxLeftWidth = Math.max(26, Math.floor(width * 0.45));
    const minLeftWidth = Math.min(
      maxLeftWidth,
      Math.max(24, Math.floor(width * 0.25)),
    );
    const desiredLeftWidth = Math.max(minLeftWidth, bounds.width + 12);
    const leftWidth = Math.min(maxLeftWidth, desiredLeftWidth);

    const separator = formatFg("dim", "│");
    const rightWidth = Math.max(20, width - leftWidth - 1);

    const leftLines = this.navigator.render(leftWidth, bodyHeight, this.theme);
    const selectedNode = this.navigator.getSelectedNode();
    const rightLines = this.previewPane.render(
      selectedNode,
      rightWidth,
      bodyHeight,
      this.theme,
    );

    for (let r = 0; r < bodyHeight; r++) {
      const l = leftLines[r] || " ".repeat(leftWidth);
      const right = rightLines[r] || " ".repeat(rightWidth);
      lines.push(`${l}${separator}${right}`);
    }

    // 5. Navigation Controls / Hints (at bottom, matching /scoped-models)
    const fullHelp =
      "  ↑/↓ move · ←/→ branch · Enter jump · e edit · d diff · f full · Esc cancel";
    const compactHelp = "  ↑/↓ move · ←/→ branch · Enter jump · f full · Esc cancel";
    const helpText = width >= 75 ? fullHelp : compactHelp;
    lines.push(formatFg("dim", truncateToWidth(helpText, width)));

    // 6. Bottom border
    lines.push(hr);

    return lines;
  }
}
