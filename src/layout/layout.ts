import type { TurnNode, RawNode, SessionTree, NodeMarker } from "../types/index.js";
import { VirtualCanvas, type GridCell } from "./canvas.js";

export interface SubtreeMetrics {
  lwidth: number;
  cwidth: number;
  rwidth: number;
  charLwidth: number;
  charRwidth: number;
}

export interface PositionedNode {
  id: string;
  parentId: string | null;
  childrenIds: string[];
  row: number;
  col: number;
  metrics: SubtreeMetrics;
  marker: NodeMarker;
  label?: string;
  isOnActivePath: boolean;
  timestamp: string;
  title: string;
  turn?: TurnNode;
  raw?: RawNode;
}

export interface LayoutOptions {
  spacing?: number;
  useUnicode?: boolean;
  showLabels?: boolean;
  showTimestamps?: boolean;
  selectedId?: string;
  filterMode?: "turn" | "raw";
  activeBranchMap?: Map<string, string>;
}

/**
 * Step 1: Bottom-up subtree width calculation (Toby Cubitt's undo-tree algorithm)
 */
export function computeSubtreeWidths(
  nodeId: string,
  getChildren: (id: string) => string[],
  spacing = 3,
  metricsMap = new Map<string, SubtreeMetrics>()
): Map<string, SubtreeMetrics> {
  function recurse(id: string): SubtreeMetrics {
    const children = getChildren(id);
    const numChildren = children.length;

    if (numChildren === 0) {
      const leafMetrics: SubtreeMetrics = {
        lwidth: 0,
        cwidth: 1,
        rwidth: 0,
        charLwidth: 0,
        charRwidth: 0,
      };
      metricsMap.set(id, leafMetrics);
      return leafMetrics;
    }

    const childMetrics = children.map((cid) => recurse(cid));
    let lwidth = 0;
    let cwidth = 0;
    let rwidth = 0;

    if (numChildren % 2 === 1) {
      // Odd number of children (including single child)
      const half = Math.floor(numChildren / 2);

      for (let i = 0; i < half; i++) {
        const m = childMetrics[i];
        lwidth += m.lwidth + m.cwidth + m.rwidth;
      }

      const mid = childMetrics[half];
      lwidth += mid.lwidth;
      cwidth = mid.cwidth;
      rwidth += mid.rwidth;

      for (let i = half + 1; i < numChildren; i++) {
        const m = childMetrics[i];
        rwidth += m.lwidth + m.cwidth + m.rwidth;
      }
    } else {
      // Even number of children
      const half = numChildren / 2;

      for (let i = 0; i < half; i++) {
        const m = childMetrics[i];
        lwidth += m.lwidth + m.cwidth + m.rwidth;
      }

      cwidth = 0;

      for (let i = half; i < numChildren; i++) {
        const m = childMetrics[i];
        rwidth += m.lwidth + m.cwidth + m.rwidth;
      }
    }

    const pitch = spacing + 1;
    const evenOffset = cwidth === 0 ? 1 + Math.floor(spacing / 2) : 0;
    const charLwidth = pitch * lwidth - evenOffset;
    const charRwidth = pitch * rwidth - evenOffset;

    const metrics: SubtreeMetrics = {
      lwidth,
      cwidth,
      rwidth,
      charLwidth,
      charRwidth,
    };
    metricsMap.set(id, metrics);
    return metrics;
  }

  recurse(nodeId);
  return metricsMap;
}

/**
 * Step 2: Top-down coordinate assignment
 */
export function assignTreeCoordinates(
  rootId: string,
  getParent: (id: string) => string | null,
  getChildren: (id: string) => string[],
  getNodeData: (id: string) => {
    label?: string;
    isOnActivePath: boolean;
    timestamp: string;
    title: string;
    marker: NodeMarker;
    turn?: TurnNode;
    raw?: RawNode;
  },
  metricsMap: Map<string, SubtreeMetrics>,
  spacing = 3,
  startCol = 0,
  startRow = 0,
  layout = new Map<string, PositionedNode>()
): Map<string, PositionedNode> {
  const rootMetrics = metricsMap.get(rootId);
  if (!rootMetrics) return layout;

  const initialCol = Math.max(startCol, rootMetrics.charLwidth);

  function assign(id: string, col: number, row: number) {
    const metrics = metricsMap.get(id) || {
      lwidth: 0,
      cwidth: 1,
      rwidth: 0,
      charLwidth: 0,
      charRwidth: 0,
    };
    const data = getNodeData(id);
    const children = getChildren(id);
    const parentId = getParent(id);

    layout.set(id, {
      id,
      parentId,
      childrenIds: children,
      col,
      row,
      metrics,
      ...data,
    });

    const numChildren = children.length;
    if (numChildren === 0) return;

    if (numChildren === 1) {
      // Single child: straight down
      assign(children[0], col, row + 3);
      return;
    }

    // Multiple children: calculate starting column of leftmost child
    const firstChildId = children[0];
    const firstChildMetrics = metricsMap.get(firstChildId) || { charLwidth: 0, charRwidth: 0 };
    let pos = col - (metrics.charLwidth - firstChildMetrics.charLwidth);

    for (let i = 0; i < numChildren; i++) {
      const childId = children[i];
      const childMetrics = metricsMap.get(childId) || { charLwidth: 0, charRwidth: 0 };

      assign(childId, pos, row + 3);

      if (i < numChildren - 1) {
        const nextChildId = children[i + 1];
        const nextChildMetrics = metricsMap.get(nextChildId) || { charLwidth: 0, charRwidth: 0 };
        pos += childMetrics.charRwidth + nextChildMetrics.charLwidth + spacing + 1;
      }
    }
  }

  assign(rootId, initialCol, startRow);
  return layout;
}

/**
 * Builds the complete 2D layout for a SessionTree.
 */
export function buildTreeLayout(
  tree: SessionTree,
  options: LayoutOptions = {}
): {
  layout: Map<string, PositionedNode>;
  canvas: VirtualCanvas;
  activeNodeId: string | null;
} {
  const isRaw = options.filterMode === "raw";
  const spacing = options.spacing ?? 3;
  const unicode = options.useUnicode === true;
  const layout = new Map<string, PositionedNode>();

  const roots = isRaw ? tree.rawRoots : tree.turnRoots;
  const sessionActiveId = isRaw ? tree.activeLeafId : tree.activeTurnId;
  const targetId = options.selectedId || sessionActiveId || roots[0] || null;

  // Determine helper accessors
  const getChildren = (id: string): string[] => {
    if (isRaw) {
      return tree.rawNodes.get(id)?.childrenIds || [];
    }
    return tree.turnNodes.get(id)?.childrenTurnIds || [];
  };

  const getParent = (id: string): string | null => {
    if (isRaw) {
      return tree.rawNodes.get(id)?.parentId || null;
    }
    return tree.turnNodes.get(id)?.parentTurnId || null;
  };

  // Branch map: parentId -> chosen childId (Emacs undo-tree branch tracking)
  const activeBranchMap = new Map<string, string>(options.activeBranchMap || []);

  // Update active branch choices for all ancestors of targetId
  if (targetId) {
    let curr = targetId;
    while (true) {
      const p = getParent(curr);
      if (!p) break;
      activeBranchMap.set(p, curr);
      curr = p;
    }
  }

  // Dynamically compute active path set (from root down to active leaf through targetId)
  const activePathSet = new Set<string>();
  let dynamicActiveLeafId: string | null = null;

  if (targetId) {
    // Upward from targetId to root
    let curr: string | null = targetId;
    while (curr) {
      activePathSet.add(curr);
      curr = getParent(curr);
    }

    // Downward from targetId along active branch choices to leaf
    let currDown = targetId;
    while (true) {
      const children = getChildren(currDown);
      if (children.length === 0) {
        dynamicActiveLeafId = currDown;
        break;
      }

      let chosenChild = activeBranchMap.get(currDown);
      if (!chosenChild || !children.includes(chosenChild)) {
        // Fallback: prefer child that was on session active path, else most recent child
        chosenChild =
          children.find((cid) => {
            const n = isRaw ? tree.rawNodes.get(cid) : tree.turnNodes.get(cid);
            return n?.isOnActivePath;
          }) || children[children.length - 1];
        activeBranchMap.set(currDown, chosenChild);
      }

      activePathSet.add(chosenChild);
      currDown = chosenChild;
    }
  }

  const getNodeData = (id: string) => {
    const isActive = activePathSet.has(id);
    const isLeaf = id === dynamicActiveLeafId;

    if (isRaw) {
      const raw = tree.rawNodes.get(id);

      let marker: NodeMarker = "inactive";
      if (isLeaf) marker = "active_leaf";
      else if (raw?.label) marker = "label";
      else if (raw?.kind === "compaction") marker = "compaction";
      else if (raw?.kind === "branch_summary") marker = "summary";
      else if (isActive) marker = "active_branch";

      return {
        label: raw?.label,
        isOnActivePath: isActive,
        timestamp: raw?.timestamp || "",
        title: raw?.kind || "Entry",
        marker,
        raw,
      };
    } else {
      const turn = tree.turnNodes.get(id);

      let marker: NodeMarker = "inactive";
      if (isLeaf) marker = "active_leaf";
      else if (turn?.label) marker = "label";
      else if (turn?.kind === "compaction") marker = "compaction";
      else if (turn?.kind === "branch_summary") marker = "summary";
      else if (isActive) marker = "active_branch";

      return {
        label: turn?.label,
        isOnActivePath: isActive,
        timestamp: turn?.timestamp || "",
        title: turn?.title || "Turn",
        marker,
        turn,
      };
    }
  };

  // Compute metrics for all roots
  const metricsMap = new Map<string, SubtreeMetrics>();
  for (const rootId of roots) {
    computeSubtreeWidths(rootId, getChildren, spacing, metricsMap);
  }

  // Layout each root (forest layout)
  let currentCol = 2;
  for (const rootId of roots) {
    const rootMetrics = metricsMap.get(rootId);
    if (!rootMetrics) continue;
    currentCol += rootMetrics.charLwidth;

    assignTreeCoordinates(
      rootId,
      getParent,
      getChildren,
      getNodeData,
      metricsMap,
      spacing,
      currentCol,
      1,
      layout
    );

    currentCol += rootMetrics.charRwidth + spacing + 3;
  }

  // Step 3: Rasterize into VirtualCanvas
  const canvas = new VirtualCanvas();
  const vStem = unicode ? "│" : "|";
  const hBar = unicode ? "─" : "_";
  const lDiag = unicode ? "╱" : "/";
  const rDiag = unicode ? "╲" : "\\";

  for (const posNode of layout.values()) {
    const { id, col, row, marker, isOnActivePath, label } = posNode;
    const isSelected = options.selectedId ? id === options.selectedId : id === dynamicActiveLeafId;

    // Emacs undo-tree authentic glyphs:
    // - Selected / cursor node is strictly 'x'
    // - Standard nodes are strictly 'o'
    // - Checkpoints/labels are 'S'
    // - Compactions are 'c'
    // - Summaries are 'b'
    let glyph = "o";
    let color: GridCell["color"] = isOnActivePath ? "text" : "dim";

    if (isSelected) {
      glyph = "x";
      color = "accent";
    } else {
      switch (marker) {
        case "label":
          glyph = "S";
          color = "warning";
          break;
        case "compaction":
          glyph = "c";
          color = "muted";
          break;
        case "summary":
          glyph = "b";
          color = "success";
          break;
        default:
          glyph = "o";
          color = isOnActivePath ? "text" : "dim";
      }
    }

    // Draw node cell
    canvas.setCell(col, row, {
      char: glyph,
      color,
      bold: isOnActivePath || isSelected,
      inverse: isSelected,
      nodeId: id,
    });

    // Optionally draw label tag next to node
    if (options.showLabels !== false && label) {
      canvas.writeText(col + 2, row, `[${label}]`, {
        color: "warning",
        dim: !isSelected,
        nodeId: id,
      });
    }

    // Draw branch lines to children
    const numChildren = posNode.childrenIds.length;
    if (numChildren === 0) continue;

    if (numChildren === 1) {
      const child = layout.get(posNode.childrenIds[0]);
      const isChildActive = isOnActivePath && (child?.isOnActivePath ?? false);
      const stemColor = isChildActive ? "text" : "dim";

      canvas.setCell(col, row + 1, { char: vStem, color: stemColor, bold: isChildActive });
      canvas.setCell(col, row + 2, { char: vStem, color: stemColor, bold: isChildActive });
      continue;
    }

    // Multiple children split (Toby Cubitt's undo-tree layout)
    const middleIdx = numChildren % 2 === 1 ? Math.floor(numChildren / 2) : -1;
    const activeChildId = activeBranchMap.get(id);
    const trunkActive = isOnActivePath && !!activeChildId && activePathSet.has(activeChildId);
    const trunkColor = trunkActive ? "text" : "dim";

    // Parent stem directly beneath the node is always a vertical stem (never standalone ┴)
    canvas.setCell(col, row + 1, { char: vStem, color: trunkColor, bold: trunkActive });

    for (let i = 0; i < numChildren; i++) {
      const child = layout.get(posNode.childrenIds[i]);
      if (!child) continue;

      const isChildActive = isOnActivePath && child.isOnActivePath;
      const branchColor = isChildActive ? "text" : "dim";

      if (i === middleIdx) {
        // Middle child: vertical line straight down
        canvas.setCell(col, row + 2, { char: vStem, color: branchColor, bold: isChildActive });
      } else if (child.col < col) {
        // Left branch: diagonal slash on row + 2, horizontal bars on row + 1
        canvas.setCell(child.col + 1, row + 2, { char: lDiag, color: branchColor, bold: isChildActive });
        for (let c = child.col + 2; c < col; c++) {
          canvas.setCell(c, row + 1, { char: hBar, color: branchColor, bold: isChildActive });
        }
      } else {
        // Right branch: diagonal slash on row + 2, horizontal bars on row + 1
        canvas.setCell(child.col - 1, row + 2, { char: rDiag, color: branchColor, bold: isChildActive });
        for (let c = col + 1; c <= child.col - 2; c++) {
          canvas.setCell(c, row + 1, { char: hBar, color: branchColor, bold: isChildActive });
        }
      }
    }
  }

  return { layout, canvas, activeNodeId: dynamicActiveLeafId };
}
