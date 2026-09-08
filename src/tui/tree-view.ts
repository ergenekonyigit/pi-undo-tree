import type { PositionedNode } from "../layout/layout.js";
import { buildTreeLayout } from "../layout/layout.js";
import { VirtualCanvas, type ThemeColors } from "../layout/canvas.js";
import type { SessionTree } from "../types/index.js";

export interface TreeNavigatorOptions {
  filterMode?: "turn" | "raw";
  initialSelectedId?: string | null;
  activeBranchMap?: Map<string, string>;
  spacing?: number;
  useUnicode?: boolean;
  showLabels?: boolean;
  showTimestamps?: boolean;
}

export interface TreeBounds {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
  width: number;
  height: number;
}

/**
 * Deep module managing 2D tree topology, cursor position, active branch choices,
 * and viewport rasterization behind a minimal navigation interface.
 */
export class TreeNavigator {
  protected tree: SessionTree;
  protected options: TreeNavigatorOptions;
  public selectedId: string | null = null;
  public activeBranchMap = new Map<string, string>();
  protected layout: Map<string, PositionedNode> = new Map();
  protected canvas: VirtualCanvas = new VirtualCanvas();
  public scrollCol = 0;
  public scrollRow = 0;

  constructor(tree: SessionTree, options: TreeNavigatorOptions = {}) {
    this.tree = tree;
    this.options = {
      filterMode: "turn",
      spacing: 3,
      useUnicode: false,
      ...options,
    };
    if (options.activeBranchMap) {
      this.activeBranchMap = new Map(options.activeBranchMap);
    }
    this.selectedId =
      options.initialSelectedId ??
      (this.options.filterMode === "raw" ? tree.activeLeafId : tree.activeTurnId) ??
      (this.options.filterMode === "raw" ? tree.rawRoots[0] : tree.turnRoots[0]) ??
      null;

    this.rebuildLayout();
  }

  public getFilterMode(): "turn" | "raw" {
    return this.options.filterMode ?? "turn";
  }

  public setFilterMode(mode: "turn" | "raw"): void {
    if (this.options.filterMode !== mode) {
      this.options.filterMode = mode;
      const roots = mode === "raw" ? this.tree.rawRoots : this.tree.turnRoots;
      const activeLeaf = mode === "raw" ? this.tree.activeLeafId : this.tree.activeTurnId;
      this.selectedId = activeLeaf || roots[0] || null;
      this.rebuildLayout();
    }
  }

  public rebuildLayout(): void {
    const { layout, canvas } = buildTreeLayout(this.tree, {
      filterMode: this.options.filterMode,
      selectedId: this.selectedId || undefined,
      activeBranchMap: this.activeBranchMap,
      spacing: this.options.spacing,
      useUnicode: this.options.useUnicode,
      showLabels: this.options.showLabels,
      showTimestamps: this.options.showTimestamps,
    });
    this.layout = layout;
    this.canvas = canvas;
    if (this.selectedId && !this.layout.has(this.selectedId)) {
      this.selectedId = this.layout.keys().next().value || null;
    }
  }

  public getSelectedNode(): PositionedNode | undefined {
    return this.selectedId ? this.layout.get(this.selectedId) : undefined;
  }

  /**
   * Move up to parent node (Undo direction)
   */
  public moveUp(): boolean {
    if (!this.selectedId) return false;
    const current = this.layout.get(this.selectedId);
    if (current && current.parentId && this.layout.has(current.parentId)) {
      this.selectedId = current.parentId;
      this.rebuildLayout();
      return true;
    }
    return false;
  }

  /**
   * Move down to child node (Redo direction)
   */
  public moveDown(): boolean {
    if (!this.selectedId) return false;
    const current = this.layout.get(this.selectedId);
    if (!current || current.childrenIds.length === 0) return false;

    // Prefer active branch choice if available, else active path child, else first child
    const chosenChildId =
      this.activeBranchMap.get(current.id) ||
      current.childrenIds.find((cid) => this.layout.get(cid)?.isOnActivePath) ||
      current.childrenIds[0];

    this.selectedId = chosenChildId;
    this.rebuildLayout();
    return true;
  }

  /**
   * Move left to previous sibling branch or switch branch left
   */
  public moveLeft(): boolean {
    if (!this.selectedId) return false;
    const current = this.layout.get(this.selectedId);
    if (!current) return false;

    // Case 1: Cursor is on a child node with siblings
    if (current.parentId) {
      const parent = this.layout.get(current.parentId);
      if (parent && parent.childrenIds.length > 1) {
        const siblings = parent.childrenIds
          .map((id) => this.layout.get(id)!)
          .filter(Boolean)
          .sort((a, b) => a.col - b.col);

        const currentIndex = siblings.findIndex((s) => s.id === this.selectedId);
        if (currentIndex > 0) {
          this.selectedId = siblings[currentIndex - 1].id;
          this.activeBranchMap.set(parent.id, this.selectedId);
          this.rebuildLayout();
          return true;
        }
      }
    }

    // Case 2: Cursor is at a branching node itself, switch which child branch is active below it!
    if (current.childrenIds.length > 1) {
      const siblings = current.childrenIds
        .map((id) => this.layout.get(id)!)
        .filter(Boolean)
        .sort((a, b) => a.col - b.col);

      const activeChildId =
        this.activeBranchMap.get(current.id) ||
        current.childrenIds.find((cid) => this.layout.get(cid)?.isOnActivePath) ||
        siblings[0].id;

      const currentIndex = siblings.findIndex((s) => s.id === activeChildId);
      if (currentIndex > 0) {
        const newActiveChild = siblings[currentIndex - 1].id;
        this.activeBranchMap.set(current.id, newActiveChild);
        this.rebuildLayout();
        return true;
      }
    }

    return false;
  }

  /**
   * Move right to next sibling branch or switch branch right
   */
  public moveRight(): boolean {
    if (!this.selectedId) return false;
    const current = this.layout.get(this.selectedId);
    if (!current) return false;

    // Case 1: Cursor is on a child node with siblings
    if (current.parentId) {
      const parent = this.layout.get(current.parentId);
      if (parent && parent.childrenIds.length > 1) {
        const siblings = parent.childrenIds
          .map((id) => this.layout.get(id)!)
          .filter(Boolean)
          .sort((a, b) => a.col - b.col);

        const currentIndex = siblings.findIndex((s) => s.id === this.selectedId);
        if (currentIndex >= 0 && currentIndex < siblings.length - 1) {
          this.selectedId = siblings[currentIndex + 1].id;
          this.activeBranchMap.set(parent.id, this.selectedId);
          this.rebuildLayout();
          return true;
        }
      }
    }

    // Case 2: Cursor is at a branching node itself, switch which child branch is active below it!
    if (current.childrenIds.length > 1) {
      const siblings = current.childrenIds
        .map((id) => this.layout.get(id)!)
        .filter(Boolean)
        .sort((a, b) => a.col - b.col);

      const activeChildId =
        this.activeBranchMap.get(current.id) ||
        current.childrenIds.find((cid) => this.layout.get(cid)?.isOnActivePath) ||
        siblings[0].id;

      const currentIndex = siblings.findIndex((s) => s.id === activeChildId);
      if (currentIndex >= 0 && currentIndex < siblings.length - 1) {
        const newActiveChild = siblings[currentIndex + 1].id;
        this.activeBranchMap.set(current.id, newActiveChild);
        this.rebuildLayout();
        return true;
      }
    }

    return false;
  }

  /**
   * Computes the bounding box of the tree structure.
   */
  public getTreeBounds(): {
    minCol: number;
    maxCol: number;
    minRow: number;
    maxRow: number;
    width: number;
    height: number;
  } {
    const nodeCols = Array.from(this.layout.values()).map((n) => n.col);
    const nodeRows = Array.from(this.layout.values()).map((n) => n.row);

    if (nodeCols.length === 0) {
      return { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0, width: 1, height: 1 };
    }

    let minCol = Math.min(...nodeCols);
    let maxCol = Math.max(...nodeCols);
    if (isFinite(this.canvas.minCol)) {
      minCol = Math.min(minCol, this.canvas.minCol);
    }
    if (isFinite(this.canvas.maxCol)) {
      maxCol = Math.max(maxCol, this.canvas.maxCol);
    }

    let minRow = Math.min(...nodeRows);
    let maxRow = Math.max(...nodeRows);
    if (isFinite(this.canvas.minRow)) {
      minRow = Math.min(minRow, this.canvas.minRow);
    }
    if (isFinite(this.canvas.maxRow)) {
      maxRow = Math.max(maxRow, this.canvas.maxRow);
    }

    return {
      minCol,
      maxCol,
      minRow,
      maxRow,
      width: Math.max(1, maxCol - minCol + 1),
      height: Math.max(1, maxRow - minRow + 1),
    };
  }

  /**
   * Adjusts viewport scroll so the tree is centered and the selected node is visible.
   */
  public adjustViewport(viewWidth: number, viewHeight: number): void {
    const selected = this.getSelectedNode();
    const bounds = this.getTreeBounds();

    // Horizontal centering & auto-scroll
    if (bounds.width <= viewWidth) {
      // Tree fits within viewport: center the entire tree horizontally
      const treeCenterCol = Math.round((bounds.minCol + bounds.maxCol) / 2);
      const viewCenterCol = Math.floor(viewWidth / 2);
      this.scrollCol = treeCenterCol - viewCenterCol;
    } else {
      // Tree is wider than view: center on selected node, clamped to tree bounds
      const targetCol = selected ? selected.col : Math.round((bounds.minCol + bounds.maxCol) / 2);
      const idealScroll = targetCol - Math.floor(viewWidth / 2);
      const minScroll = bounds.minCol - 2;
      const maxScroll = bounds.maxCol - viewWidth + 3;
      if (maxScroll >= minScroll) {
        this.scrollCol = Math.max(minScroll, Math.min(maxScroll, idealScroll));
      } else {
        this.scrollCol = idealScroll;
      }
    }

    // Vertical positioning & auto-scroll
    if (bounds.height <= viewHeight) {
      this.scrollRow = 0;
    } else {
      const targetRow = selected ? selected.row : bounds.minRow;
      const idealRowScroll = targetRow - Math.floor(viewHeight / 2);
      const maxRowScroll = Math.max(0, bounds.maxRow - viewHeight + 2);
      this.scrollRow = Math.max(0, Math.min(maxRowScroll, idealRowScroll));
    }
  }

  public render(width: number, height: number, theme?: ThemeColors): string[] {
    this.adjustViewport(width, height);
    return this.canvas.renderViewport(this.scrollCol, this.scrollRow, width, height, theme);
  }
}

/**
 * Backward-compatible adapter for callers and existing tests.
 */
export class TreeView extends TreeNavigator {
  constructor(
    treeOrLayout: SessionTree | Map<string, PositionedNode>,
    optionsOrCanvas?: TreeNavigatorOptions | VirtualCanvas,
    initialSelectedId?: string | null,
    activeBranchMap?: Map<string, string>
  ) {
    if (treeOrLayout instanceof Map) {
      super(
        {
          metadata: { sessionId: "", cwd: "", version: 3 },
          rawNodes: new Map(),
          rawRoots: [],
          activeLeafId: null,
          activeRawPath: [],
          turnNodes: new Map(),
          turnRoots: [],
          activeTurnId: null,
          activeTurnPath: [],
        },
        { initialSelectedId, activeBranchMap }
      );
      this.updateLayout(treeOrLayout, optionsOrCanvas as VirtualCanvas);
    } else {
      super(treeOrLayout, optionsOrCanvas as TreeNavigatorOptions);
    }
  }

  public updateLayout(layout: Map<string, PositionedNode>, canvas: VirtualCanvas): void {
    this.layout = layout;
    this.canvas = canvas;
    if (this.selectedId && !this.layout.has(this.selectedId)) {
      this.selectedId = this.layout.keys().next().value || null;
    }
  }
}

