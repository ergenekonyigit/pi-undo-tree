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
          if (theme && cell.color) {
            try {
              charStr = theme.fg(cell.color, charStr);
            } catch {
              // Fallback to ANSI styles if theme lookup fails
            }
          }
          if (cell.bold) {
            charStr = `\x1b[1m${charStr}\x1b[22m`;
          }
          if (cell.dim) {
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
