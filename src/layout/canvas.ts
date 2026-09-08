export interface GridCell {
  char: string;
  color?: "accent" | "text" | "dim" | "warning" | "muted" | "success" | string;
  bold?: boolean;
  inverse?: boolean;
  dim?: boolean;
  nodeId?: string;
}

export interface ThemeColors {
  fg(color: string, text: string): string;
  bg(color: string, text: string): string;
}

/**
 * Detect whether the provided theme represents a dark terminal theme.
 * Defaults to true (standard for developer terminals).
 */
export function isDarkTheme(theme?: ThemeColors): boolean {
  if (!theme) return true;
  if ("name" in theme && typeof (theme as any).name === "string") {
    const name = (theme as any).name.toLowerCase();
    if (name.includes("light")) return false;
    if (name.includes("dark")) return true;
  }
  try {
    const textAnsi =
      typeof (theme as any).getFgAnsi === "function"
        ? (theme as any).getFgAnsi("text")
        : theme.fg("text", "");
    const match = textAnsi.match(/38;2;(\d+);(\d+);(\d+)/);
    if (match) {
      const r = parseInt(match[1], 10);
      const g = parseInt(match[2], 10);
      const b = parseInt(match[3], 10);
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      return luminance >= 128;
    }
  } catch {
    // fallback
  }
  return true;
}

/**
 * 2D Sparse Grid Canvas for plotting nodes, connectors, and text.
 */
export class VirtualCanvas {
  private grid = new Map<number, Map<number, GridCell>>();
  public minCol = Infinity;
  public maxCol = -Infinity;
  public minRow = Infinity;
  public maxRow = -Infinity;

  public clear(): void {
    this.grid.clear();
    this.minCol = Infinity;
    this.maxCol = -Infinity;
    this.minRow = Infinity;
    this.maxRow = -Infinity;
  }

  public setCell(col: number, row: number, cell: GridCell): void {
    let rowMap = this.grid.get(row);
    if (!rowMap) {
      rowMap = new Map();
      this.grid.set(row, rowMap);
    }
    rowMap.set(col, cell);

    this.minCol = Math.min(this.minCol, col);
    this.maxCol = Math.max(this.maxCol, col);
    this.minRow = Math.min(this.minRow, row);
    this.maxRow = Math.max(this.maxRow, row);
  }

  public getCell(col: number, row: number): GridCell | undefined {
    return this.grid.get(row)?.get(col);
  }

  public writeText(col: number, row: number, text: string, cellProps: Omit<GridCell, "char"> = {}): void {
    for (let i = 0; i < text.length; i++) {
      this.setCell(col + i, row, { char: text[i], ...cellProps });
    }
  }

  /**
   * Slices a rectangular viewport from the canvas into formatted terminal lines.
   */
  public renderViewport(
    scrollCol: number,
    scrollRow: number,
    viewWidth: number,
    viewHeight: number,
    theme?: ThemeColors
  ): string[] {
    const lines: string[] = [];
    const isDark = isDarkTheme(theme);

    for (let r = 0; r < viewHeight; r++) {
      const rowIdx = scrollRow + r;
      let line = "";

      for (let c = 0; c < viewWidth; c++) {
        const colIdx = scrollCol + c;
        const cell = this.getCell(colIdx, rowIdx);

        if (!cell) {
          line += " ";
        } else {
          let charStr = cell.char;

          if (cell.color === "text") {
            // Use the theme's text color so active branches match Pi's palette:
            // dark.json: #d4d4d4, light.json: #1f2328.
            if (theme) {
              try {
                charStr = theme.fg("text", charStr);
              } catch {
                charStr = isDark
                  ? `\x1b[38;2;212;212;212m${charStr}\x1b[39m`
                  : `\x1b[38;2;31;35;40m${charStr}\x1b[39m`;
              }
            } else {
              charStr = `\x1b[38;2;212;212;212m${charStr}\x1b[39m`;
            }
          } else if (cell.color === "dim") {
            if (theme) {
              try {
                charStr = theme.fg("dim", charStr);
              } catch {
                charStr = `\x1b[38;2;102;102;102m${charStr}\x1b[39m`;
              }
            } else {
              charStr = `\x1b[38;2;102;102;102m${charStr}\x1b[39m`;
            }
            charStr = `\x1b[2m${charStr}\x1b[22m`;
          } else if (theme && cell.color) {
            try {
              charStr = theme.fg(cell.color, charStr);
            } catch {
              // Fallback to ANSI styles if theme lookup fails
            }
          }

          if (cell.bold) {
            charStr = `\x1b[1m${charStr}\x1b[22m`;
          }
          if (cell.dim && cell.color !== "dim") {
            charStr = `\x1b[2m${charStr}\x1b[22m`;
          }
          if (cell.inverse) {
            charStr = `\x1b[7m${charStr}\x1b[27m`;
          }
          line += charStr;
        }
      }

      lines.push(line);
    }

    return lines;
  }
}
