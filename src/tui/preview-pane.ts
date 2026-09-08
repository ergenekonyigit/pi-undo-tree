import type { PositionedNode } from "../layout/layout.js";
import type { ThemeColors } from "../layout/canvas.js";
import type { FileDiffRecord } from "../types/index.js";
import { extractDiffFromTool } from "../model/graph.js";
import { truncateToWidth } from "@earendil-works/pi-tui";

export interface PreviewPaneOptions {
  showDiff?: boolean;
  showTimestamps?: boolean;
}

/**
 * Renders the right pane showing details of the currently selected node.
 * Supports scrolling, diff inspection, and timestamp toggling.
 */
export class PreviewPane {
  public scrollRow = 0;
  private options: PreviewPaneOptions;

  constructor(options: PreviewPaneOptions = {}) {
    this.options = {
      showDiff: false,
      showTimestamps: true,
      ...options,
    };
  }

  public toggleDiff(): boolean {
    this.options.showDiff = !this.options.showDiff;
    this.scrollRow = 0; // reset scroll on mode toggle
    return this.options.showDiff;
  }

  public isDiffMode(): boolean {
    return !!this.options.showDiff;
  }

  public toggleTimestamps(): boolean {
    this.options.showTimestamps = !this.options.showTimestamps;
    return this.options.showTimestamps;
  }

  public scrollUp(lines = 1): void {
    this.scrollRow = Math.max(0, this.scrollRow - lines);
  }

  public scrollDown(lines = 1): void {
    this.scrollRow += lines;
  }

  public pageUp(lines = 10): void {
    this.scrollRow = Math.max(0, this.scrollRow - lines);
  }

  public pageDown(lines = 10): void {
    this.scrollRow += lines;
  }

  public resetScroll(): void {
    this.scrollRow = 0;
  }

  /**
   * Generates all content lines for the current node without viewport slicing.
   */
  public generateLines(node: PositionedNode | undefined, width: number, theme?: ThemeColors): string[] {
    const rawLines: string[] = [];

    const formatFg = (color: string, text: string) => {
      if (!theme) return text;
      try {
        return theme.fg(color, text);
      } catch {
        return text;
      }
    };

    const addLine = (text: string) => {
      rawLines.push(truncateToWidth(text, width));
    };

    if (!node) {
      addLine(formatFg("dim", "  No node selected"));
      return rawLines;
    }

    const isLeaf = node.marker === "active_leaf";
    const statusTag = isLeaf ? " [active leaf]" : node.isOnActivePath ? " [active path]" : " [historical]";

    if (this.options.showDiff) {
      // Diff View (native style)
      addLine(formatFg("accent", `  Diff · #${node.id.slice(0, 8)}${statusTag}`));
      addLine("");

      let diffFound = false;

      // Primary source: encapsulated diff records on TurnNode
      const diffRecords =
        node.turn?.diffs && node.turn.diffs.length > 0
          ? node.turn.diffs
          : node.turn?.tools
            ? node.turn.tools.map(extractDiffFromTool).filter((d): d is FileDiffRecord => d !== null)
            : [];

      if (diffRecords.length > 0) {
        for (const record of diffRecords) {
          diffFound = true;
          addLine(formatFg("accent", `  • ${record.filePath}`));

          if (record.diffText) {
            const diffLines = record.diffText.split("\n");
            for (const dl of diffLines) {
              if (dl.startsWith("+++") || dl.startsWith("---")) {
                addLine(formatFg("dim", `    ${dl}`));
              } else if (dl.startsWith("+")) {
                addLine(formatFg("success", `    ${dl}`));
              } else if (dl.startsWith("-")) {
                addLine(formatFg("error", `    ${dl}`));
              } else if (dl.startsWith("@@")) {
                addLine(formatFg("dim", `    ${dl}`));
              } else {
                addLine(`    ${dl}`);
              }
            }
          } else if (record.edits && Array.isArray(record.edits)) {
            for (const edit of record.edits) {
              if (edit.oldText) {
                for (const l of edit.oldText.split("\n")) {
                  addLine(formatFg("error", `    - ${l}`));
                }
              }
              if (edit.newText) {
                for (const l of edit.newText.split("\n")) {
                  addLine(formatFg("success", `    + ${l}`));
                }
              }
            }
          }
        }
      }

      if (!diffFound) {
        if (node.turn?.fileOps.modifiedFiles.size) {
          diffFound = true;
          addLine(formatFg("dim", "  modified:"));
          for (const file of node.turn.fileOps.modifiedFiles) {
            addLine(`    ${file}`);
          }
        }
      }

      if (!diffFound) {
        addLine(formatFg("dim", "  (no file modifications in this turn)"));
      }
    } else {
      // Standard Overview (native Pi conversation format)
      if (node.turn?.promptText) {
        const pLines = node.turn.promptText.split("\n");
        addLine(`  • user: ${pLines[0]}`);
        for (let i = 1; i < Math.min(3, pLines.length); i++) {
          addLine(`    ${pLines[i]}`);
        }
        if (pLines.length > 3) {
          addLine(formatFg("dim", `    ... (${pLines.length - 3} more lines)`));
        }
      }

      if (node.turn?.assistantText) {
        const aLines = node.turn.assistantText.split("\n").filter((l) => l.trim().length > 0);
        if (aLines.length > 0) {
          addLine(`  • assistant: ${aLines[0]}`);
          for (let i = 1; i < Math.min(3, aLines.length); i++) {
            addLine(`    ${aLines[i]}`);
          }
          if (aLines.length > 3) {
            addLine(formatFg("dim", `    ... (${aLines.length - 3} more lines)`));
          }
        }
      } else if (node.raw) {
        addLine(`  • ${node.raw.kind}: ${node.raw.entry.type}`);
      }

      addLine("");

      // Metadata line: model · tokens · cost · time · status
      const metaParts: string[] = [];
      if (node.turn?.model) {
        metaParts.push(node.turn.model.modelId || `${node.turn.model.provider}/${node.turn.model.modelId}`);
      }
      if (node.turn?.metrics) {
        const total = node.turn.metrics.totalTokens;
        const tokStr = total >= 1000 ? `${(total / 1000).toFixed(1)}k tokens` : `${total} tokens`;
        metaParts.push(tokStr);
        if (node.turn.metrics.totalCost > 0) {
          metaParts.push(`$${node.turn.metrics.totalCost.toFixed(4)}`);
        }
      }
      if (this.options.showTimestamps && node.timestamp) {
        const time = new Date(node.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        metaParts.push(time);
      }
      if (statusTag) {
        metaParts.push(statusTag.trim());
      }

      if (metaParts.length > 0) {
        addLine(formatFg("dim", `  · ${metaParts.join(" · ")}`));
      }

      if (node.label) {
        addLine(formatFg("warning", `  label: ${node.label}`));
      }

      if (node.turn?.tools.length) {
        const toolNames = node.turn.tools.map((t) => t.toolName).join(", ");
        addLine(formatFg("dim", `  · tools: ${toolNames}`));
      }
    }

    return rawLines;
  }

  public render(
    node: PositionedNode | undefined,
    width: number,
    height: number,
    theme?: ThemeColors
  ): string[] {
    const allLines = this.generateLines(node, width, theme);

    // Bound scroll
    const maxScroll = Math.max(0, allLines.length - height);
    this.scrollRow = Math.min(this.scrollRow, maxScroll);

    const visibleLines = allLines.slice(this.scrollRow, this.scrollRow + height);

    // Pad remaining height
    while (visibleLines.length < height) {
      visibleLines.push(" ".repeat(width));
    }

    return visibleLines.slice(0, height);
  }
}
