import type {
  SessionEntry,
  SessionTreeNode,
  SessionMessageEntry,
  CompactionEntry,
  BranchSummaryEntry,
  ModelChangeEntry,
  ThinkingLevelChangeEntry,
  SessionInfoEntry,
  CustomEntry,
  CustomMessageEntry,
  SessionHeader,
  SessionEntryBase,
  FileEntry,
} from "@earendil-works/pi-coding-agent";

export type {
  SessionEntry,
  SessionTreeNode,
  SessionMessageEntry,
  CompactionEntry,
  BranchSummaryEntry,
  ModelChangeEntry,
  ThinkingLevelChangeEntry,
  SessionInfoEntry,
  CustomEntry,
  CustomMessageEntry,
  SessionHeader,
  SessionEntryBase,
  FileEntry,
};

export type AgentMessage = SessionMessageEntry["message"];
export type UserMessage = Extract<AgentMessage, { role: "user" }>;
export type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;
export type ToolResultMessage = Extract<AgentMessage, { role: "toolResult" }>;
export type BashExecutionMessage = Extract<AgentMessage, { role: "bashExecution" }>;
export type CustomMessage = Extract<AgentMessage, { role: "custom" }>;

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type Usage = NonNullable<AssistantMessage["usage"]>;

export interface LabelEntry extends SessionEntryBase {
  type: "label";
  targetId: string;
  label: string | undefined;
}

export interface FileDiffRecord {
  filePath: string;
  diffText?: string;
  edits?: Array<{ oldText?: string; newText?: string }>;
}


// ============================================================================
// 2. Dual-Layer Graph Model (RawNode vs TurnNode)
// ============================================================================

export type RawEntryKind =
  | "user"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "bash_execution"
  | "compaction"
  | "branch_summary"
  | "label"
  | "model_change"
  | "thinking_change"
  | "custom"
  | "custom_message"
  | "session_info";

export interface RawNode {
  id: string;
  parentId: string | null;
  childrenIds: string[];
  entry: SessionEntry;
  kind: RawEntryKind;
  timestamp: string;
  label?: string;
  isOnActivePath: boolean;
}

export interface ToolExecutionRecord {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: {
    content: string;
    isError: boolean;
    details?: unknown;
  };
  durationMs?: number;
}

export interface FileOperationsSummary {
  readFiles: Set<string>;
  modifiedFiles: Set<string>;
}

export interface TurnMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCost: number;
  toolCallsCount: number;
  durationMs?: number;
}

export type TurnKind =
  | "user_turn"
  | "compaction"
  | "branch_summary"
  | "system_turn";

export type TurnStatus = "completed" | "in_progress" | "error" | "cancelled";

export interface TurnNode {
  id: string;
  parentTurnId: string | null;
  childrenTurnIds: string[];
  rawEntryIds: string[];
  kind: TurnKind;
  status: TurnStatus;
  title: string;
  promptText?: string;
  assistantText?: string;
  thinkingText?: string;
  tools: ToolExecutionRecord[];
  diffs?: FileDiffRecord[];
  fileOps: FileOperationsSummary;
  metrics: TurnMetrics;
  model?: { provider: string; modelId: string };
  thinkingLevel?: string;
  label?: string;
  isOnActivePath: boolean;
  timestamp: string;
}

export interface SessionTreeMetadata {
  sessionId: string;
  sessionName?: string;
  sessionFile?: string;
  cwd: string;
  version: number;
  parentSession?: string;
  createdAt?: string;
}

export interface SessionTree {
  metadata: SessionTreeMetadata;
  rawNodes: Map<string, RawNode>;
  rawRoots: string[];
  activeLeafId: string | null;
  activeRawPath: string[];
  turnNodes: Map<string, TurnNode>;
  turnRoots: string[];
  activeTurnId: string | null;
  activeTurnPath: string[];
}

// ============================================================================
// 3. Layout & Visualizer Types (Emacs Undo-Tree 2D Layout)
// ============================================================================

export type NodeMarker = "active_leaf" | "active_branch" | "inactive" | "label" | "compaction" | "summary";

export interface LayoutNode {
  id: string;
  parentId: string | null;
  childrenIds: string[];
  row: number;
  col: number;
  lwidth: number;
  cwidth: number;
  rwidth: number;
  charLwidth: number;
  charRwidth: number;
  marker: NodeMarker;
  label?: string;
  isOnActivePath: boolean;
  turn?: TurnNode;
  raw?: RawNode;
}

export interface VisualizerOptions {
  filterMode?: "turn" | "raw";
  showTimestamps?: boolean;
  showDiff?: boolean;
  unicodeConnectors?: boolean;
}
