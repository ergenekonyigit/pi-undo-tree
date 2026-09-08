import type {
  SessionEntry,
  SessionTreeNode,
  SessionMessageEntry,
  CompactionEntry,
  BranchSummaryEntry,
  LabelEntry,
  RawNode,
  RawEntryKind,
  TurnNode,
  TurnKind,
  TurnStatus,
  ToolExecutionRecord,
  FileDiffRecord,
  SessionTree,
  SessionTreeMetadata,
  ToolCall,
} from "../types/index.js";

/**
 * Classifies a raw SessionEntry into its specialized RawEntryKind discriminator.
 */
export function classifyRawEntryKind(entry: SessionEntry): RawEntryKind {
  switch (entry.type) {
    case "message": {
      const msg = (entry as SessionMessageEntry).message;
      if (!msg) return "user";
      switch (msg.role) {
        case "user":
          return "user";
        case "assistant":
          return "assistant";
        case "toolResult":
          return "tool_result";
        case "bashExecution":
          return "bash_execution";
        case "custom":
          return "custom_message";
        default:
          return "user";
      }
    }
    case "compaction":
      return "compaction";
    case "branch_summary":
      return "branch_summary";
    case "label":
      return "label";
    case "model_change":
      return "model_change";
    case "thinking_level_change":
      return "thinking_change";
    case "session_info":
      return "session_info";
    case "custom":
      return "custom";
    case "custom_message":
      return "custom_message";
    default:
      return "custom";
  }
}

/**
 * Extracts plain text from content string or array of blocks.
 */
export function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          if ("text" in part && typeof part.text === "string") return part.text;
          if ("thinking" in part && typeof part.thinking === "string") return part.thinking;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * Builds the RawNode tree (1:1 with session entries) and computes the active path.
 */
export function buildRawGraph(
  entries: SessionEntry[],
  activeLeafId: string | null
): {
  rawNodes: Map<string, RawNode>;
  rawRoots: string[];
  activeRawPath: string[];
  activePathSet: Set<string>;
} {
  const rawNodes = new Map<string, RawNode>();
  const labelsMap = new Map<string, string | undefined>();

  // Pass 1: Index all entries & capture label mutations
  for (const entry of entries) {
    if (entry.type === "label") {
      const labelEntry = entry as LabelEntry;
      labelsMap.set(labelEntry.targetId, labelEntry.label);
      continue;
    }

    const kind = classifyRawEntryKind(entry);
    const node: RawNode = {
      id: entry.id,
      parentId: entry.parentId,
      childrenIds: [],
      entry,
      kind,
      timestamp: entry.timestamp,
      isOnActivePath: false,
    };
    rawNodes.set(node.id, node);
  }

  // Apply resolved labels
  for (const [targetId, label] of labelsMap.entries()) {
    const target = rawNodes.get(targetId);
    if (target) {
      target.label = label;
    }
  }

  // Pass 2: Connect parent-child links & collect roots
  const rawRoots: string[] = [];
  for (const node of rawNodes.values()) {
    if (!node.parentId) {
      rawRoots.push(node.id);
    } else {
      const parent = rawNodes.get(node.parentId);
      if (parent) {
        parent.childrenIds.push(node.id);
      } else {
        // Disconnected / missing parent: treat as a secondary root
        rawRoots.push(node.id);
      }
    }
  }

  // Pass 3: Compute active path from activeLeafId up to root
  const activeRawPath: string[] = [];
  const activePathSet = new Set<string>();

  if (activeLeafId && rawNodes.has(activeLeafId)) {
    let curr: string | null = activeLeafId;
    while (curr) {
      activeRawPath.unshift(curr);
      activePathSet.add(curr);
      const currNode = rawNodes.get(curr);
      if (!currNode) break;
      currNode.isOnActivePath = true;
      curr = currNode.parentId;
    }
  } else if (rawRoots.length > 0) {
    // If no leaf specified, follow deepest child of first root
    let curr: string | null = rawRoots[0];
    while (curr) {
      activeRawPath.push(curr);
      activePathSet.add(curr);
      const currNode = rawNodes.get(curr);
      if (!currNode) break;
      currNode.isOnActivePath = true;
      curr = currNode.childrenIds.length > 0 ? currNode.childrenIds[currNode.childrenIds.length - 1] : null;
    }
  }

  return { rawNodes, rawRoots, activeRawPath, activePathSet };
}

/**
 * Checks whether a raw node triggers the creation of a new TurnNode.
 */
function isTurnStarter(rawNode: RawNode): boolean {
  if (rawNode.kind === "user") return true;
  if (rawNode.kind === "compaction") return true;
  if (rawNode.kind === "branch_summary") return true;
  if (rawNode.kind === "bash_execution") return true;
  return false;
}

/**
 * Extracts affected file paths from tool invocations.
 */
function extractFilesFromArgs(toolName: string, args: Record<string, unknown>, readFiles: Set<string>, modifiedFiles: Set<string>): void {
  const filePath =
    (args.filePath as string) ||
    (args.path as string) ||
    (args.TargetFile as string) ||
    (args.file as string);

  if (filePath && typeof filePath === "string") {
    if (toolName === "edit" || toolName === "write" || toolName === "replace_file_content" || toolName === "write_to_file") {
      modifiedFiles.add(filePath);
    } else if (toolName === "read" || toolName === "view_file") {
      readFiles.add(filePath);
    }
  }
}

/**
 * Extracts a unified diff record from a tool execution record.
 */
export function extractDiffFromTool(tool: ToolExecutionRecord): FileDiffRecord | null {
  const isFileMod =
    tool.toolName === "edit" ||
    tool.toolName === "write" ||
    tool.toolName === "replace_file_content" ||
    tool.toolName === "write_to_file" ||
    tool.toolName === "patch";

  if (!isFileMod) return null;

  const filePath =
    (tool.args as any)?.path ||
    (tool.args as any)?.filePath ||
    (tool.args as any)?.TargetFile ||
    (tool.args as any)?.file ||
    tool.toolName;

  const diffText =
    (tool.result?.details as any)?.diff ||
    (typeof tool.result?.content === "string" && tool.result.content.includes("@@") ? tool.result.content : undefined) ||
    (tool.args as any)?.patch;

  const edits = (tool.args as any)?.edits && Array.isArray((tool.args as any).edits)
    ? (tool.args as any).edits
    : undefined;

  return {
    filePath,
    diffText,
    edits,
  };
}

/**
 * Clusters RawNodes into higher-level TurnNodes.
 */
export function buildTurnGraph(
  rawNodes: Map<string, RawNode>,
  rawRoots: string[],
  activePathSet: Set<string>
): {
  turnNodes: Map<string, TurnNode>;
  turnRoots: string[];
  activeTurnId: string | null;
  activeTurnPath: string[];
  rawToTurnMap: Map<string, string>;
} {
  const turnNodes = new Map<string, TurnNode>();
  const turnRoots: string[] = [];
  const rawToTurnMap = new Map<string, string>();
  const pendingToolCalls = new Map<string, ToolExecutionRecord>();

  function createTurnNode(rawNode: RawNode, parentTurnId: string | null): TurnNode {
    let kind: TurnKind = "user_turn";
    let title = "User Turn";
    let promptText: string | undefined;

    if (rawNode.kind === "compaction") {
      kind = "compaction";
      title = "Context Compaction";
      promptText = (rawNode.entry as CompactionEntry).summary;
    } else if (rawNode.kind === "branch_summary") {
      kind = "branch_summary";
      title = "Branch Summary";
      promptText = (rawNode.entry as BranchSummaryEntry).summary;
    } else if (rawNode.kind === "bash_execution") {
      kind = "user_turn";
      title = "Direct Bash Command";
    } else if (rawNode.kind === "user") {
      const msg = (rawNode.entry as SessionMessageEntry).message;
      if (msg && "content" in msg) {
        promptText = extractTextContent(msg.content);
      }
      title = promptText && promptText.length > 50 ? promptText.slice(0, 47) + "..." : promptText || "User Turn";
    }

    const turn: TurnNode = {
      id: rawNode.id,
      parentTurnId,
      childrenTurnIds: [],
      rawEntryIds: [rawNode.id],
      kind,
      status: "completed",
      title,
      promptText,
      tools: [],
      diffs: [],
      fileOps: {
        readFiles: new Set<string>(),
        modifiedFiles: new Set<string>(),
      },
      metrics: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        toolCallsCount: 0,
      },
      label: rawNode.label,
      isOnActivePath: activePathSet.has(rawNode.id),
      timestamp: rawNode.timestamp,
    };

    turnNodes.set(turn.id, turn);
    rawToTurnMap.set(rawNode.id, turn.id);

    if (parentTurnId) {
      const parent = turnNodes.get(parentTurnId);
      if (parent && !parent.childrenTurnIds.includes(turn.id)) {
        parent.childrenTurnIds.push(turn.id);
      }
    } else {
      turnRoots.push(turn.id);
    }

    return turn;
  }

  function absorbIntoTurn(turn: TurnNode, rawNode: RawNode): void {
    turn.rawEntryIds.push(rawNode.id);
    rawToTurnMap.set(rawNode.id, turn.id);

    if (rawNode.label && !turn.label) {
      turn.label = rawNode.label;
    }

    if (activePathSet.has(rawNode.id)) {
      turn.isOnActivePath = true;
    }

    // Accumulate content based on entry type
    if (rawNode.entry.type === "message") {
      const msg = (rawNode.entry as SessionMessageEntry).message;
      if (msg.role === "assistant") {
        if (msg.model) {
          turn.model = { provider: msg.provider || "unknown", modelId: msg.model };
        }
        if (msg.usage) {
          turn.metrics.inputTokens += msg.usage.input || 0;
          turn.metrics.outputTokens += msg.usage.output || 0;
          turn.metrics.totalTokens += msg.usage.totalTokens || 0;
          if (msg.usage.cost) {
            turn.metrics.totalCost += msg.usage.cost.total || 0;
          }
        }
        if (msg.stopReason === "error") {
          turn.status = "error";
        }

        // Process message blocks
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === "text") {
              turn.assistantText = (turn.assistantText ? turn.assistantText + "\n" : "") + block.text;
            } else if (block.type === "thinking") {
              turn.thinkingText = (turn.thinkingText ? turn.thinkingText + "\n" : "") + block.thinking;
            } else if (block.type === "toolCall") {
              const tc = block as ToolCall;
              turn.metrics.toolCallsCount++;
              const record: ToolExecutionRecord = {
                callId: tc.id,
                toolName: tc.name,
                args: tc.arguments || {},
              };
              turn.tools.push(record);
              pendingToolCalls.set(tc.id, record);
              extractFilesFromArgs(tc.name, tc.arguments || {}, turn.fileOps.readFiles, turn.fileOps.modifiedFiles);
            }
          }
        }
      } else if (msg.role === "toolResult") {
        const tr = msg;
        const call = pendingToolCalls.get(tr.toolCallId);
        if (call) {
          call.result = {
            content: extractTextContent(tr.content),
            isError: tr.isError,
            details: tr.details,
          };
          pendingToolCalls.delete(tr.toolCallId);
        }
      }
    } else if (rawNode.entry.type === "model_change") {
      turn.model = {
        provider: rawNode.entry.provider,
        modelId: rawNode.entry.modelId,
      };
    } else if (rawNode.entry.type === "thinking_level_change") {
      turn.thinkingLevel = rawNode.entry.thinkingLevel;
    }

    // Encapsulated Turn Inspection: synthesize file diffs for the turn
    if (turn.tools.length > 0) {
      turn.diffs = turn.tools
        .map(extractDiffFromTool)
        .filter((d): d is FileDiffRecord => d !== null);
    }
  }

  // Traverse tree recursively
  function traverse(rawId: string, currentTurn: TurnNode | null, forceNewTurn: boolean): void {
    const rawNode = rawNodes.get(rawId);
    if (!rawNode) return;

    let activeTurn: TurnNode;

    if (!currentTurn || forceNewTurn || isTurnStarter(rawNode)) {
      activeTurn = createTurnNode(rawNode, currentTurn ? currentTurn.id : null);
    } else {
      activeTurn = currentTurn;
      absorbIntoTurn(activeTurn, rawNode);
    }

    const isFork = rawNode.childrenIds.length > 1;
    for (const childId of rawNode.childrenIds) {
      traverse(childId, activeTurn, isFork);
    }
  }

  for (const rootId of rawRoots) {
    traverse(rootId, null, false);
  }

  // Compute activeTurnPath
  const activeTurnPath: string[] = [];
  let activeTurnId: string | null = null;

  for (const turn of turnNodes.values()) {
    if (turn.isOnActivePath) {
      // If none of its children are on active path, this turn is the active turn leaf
      const hasActiveChild = turn.childrenTurnIds.some((cid) => turnNodes.get(cid)?.isOnActivePath);
      if (!hasActiveChild) {
        activeTurnId = turn.id;
      }
    }
  }

  if (activeTurnId) {
    let curr: string | null = activeTurnId;
    while (curr) {
      activeTurnPath.unshift(curr);
      const currTurn = turnNodes.get(curr);
      if (!currTurn) break;
      curr = currTurn.parentTurnId;
    }
  } else if (turnRoots.length > 0) {
    activeTurnId = turnRoots[0];
    activeTurnPath.push(activeTurnId);
  }

  return { turnNodes, turnRoots, activeTurnId, activeTurnPath, rawToTurnMap };
}

/**
 * Main entrance: parses raw entries or canonical SessionTreeNode hierarchy and builds the full SessionTree structure.
 */
export function buildSessionTree(
  entries: (SessionEntry | SessionTreeNode)[],
  metadata: SessionTreeMetadata,
  activeLeafId: string | null
): SessionTree {
  const flatEntries: SessionEntry[] = [];

  if (
    entries.length > 0 &&
    typeof (entries[0] as any).entry === "object" &&
    Array.isArray((entries[0] as any).children)
  ) {
    // Ingesting canonical SessionTreeNode[] directly across the seam
    const walk = (node: SessionTreeNode) => {
      flatEntries.push(node.entry);
      if (node.label) {
        flatEntries.push({
          type: "label",
          id: `label-${node.entry.id}`,
          parentId: node.entry.id,
          timestamp: node.labelTimestamp || node.entry.timestamp,
          targetId: node.entry.id,
          label: node.label,
        } as LabelEntry);
      }
      for (const child of node.children) {
        walk(child);
      }
    };
    for (const root of entries as SessionTreeNode[]) {
      walk(root);
    }
  } else {
    flatEntries.push(...(entries as SessionEntry[]));
  }

  const { rawNodes, rawRoots, activeRawPath, activePathSet } = buildRawGraph(flatEntries, activeLeafId);
  const { turnNodes, turnRoots, activeTurnId, activeTurnPath } = buildTurnGraph(rawNodes, rawRoots, activePathSet);

  return {
    metadata,
    rawNodes,
    rawRoots,
    activeLeafId,
    activeRawPath,
    turnNodes,
    turnRoots,
    activeTurnId,
    activeTurnPath,
  };
}
