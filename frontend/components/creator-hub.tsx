"use client";

import {
  Activity,
  ArchiveRestore,
  Beaker,
  BookOpenCheck,
  Box,
  BrainCircuit,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  Code2,
  Copy,
  Download,
  FileJson,
  FileText,
  Film,
  FolderKanban,
  GitCompareArrows,
  Layers3,
  Link2,
  ListChecks,
  Loader2,
  MessageSquareText,
  Network,
  Palette,
  Pencil,
  Pin,
  Plus,
  Radar,
  RefreshCw,
  Rocket,
  Save,
  Search,
  Send,
  Sparkles,
  Star,
  Table2,
  TestTube2,
  Trash2,
  type LucideIcon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PageShell } from "@/components/page-shell";
import { AUTH_CHANGED_EVENT, AUTH_WILL_CHANGE_EVENT, getStoredUser, type User } from "@/lib/api";
import {
  commentOnTeamTemplate,
  deleteTeamTemplate,
  installTeamTemplate,
  listTeamTemplates,
  publishTeamTemplate,
  rateTeamTemplate,
  type TeamTemplate
} from "@/lib/studio-api";
import {
  ARTIFACT_CREATE_EVENT,
  PENDING_ARTIFACT_KEY,
  auditPrompt,
  buildBrandContext,
  createArtifact,
  createBrandKit,
  createProject,
  createStudioId,
  downloadTextFile,
  evaluateWorkflow,
  loadStudioState,
  readPendingArtifact,
  saveStudioState,
  workflowDiff,
  type ArtifactCreateDetail,
  type ArtifactType,
  type BrandKit,
  type MemorySignal,
  type ProjectStatus,
  type StudioArtifact,
  type StudioProject,
  type StudioState,
  type WorkflowSnapshot,
  type WorkflowTestCase
} from "@/lib/studio";
import { cn } from "@/lib/utils";
import {
  builtInWorkflows,
  createCustomWorkflowId,
  getInitialWorkflowValues,
  loadCustomWorkflows,
  saveCustomWorkflow,
  type WorkflowTemplate
} from "@/lib/workflows";

type StudioTab = "overview" | "projects" | "artifacts" | "brand" | "prompt" | "evaluation" | "team" | "memory";

const tabs: Array<{ id: StudioTab; label: string; signal: string; icon: LucideIcon }> = [
  { id: "overview", label: "总览", signal: "00", icon: Radar },
  { id: "projects", label: "项目", signal: "01", icon: FolderKanban },
  { id: "artifacts", label: "Artifact", signal: "02", icon: Layers3 },
  { id: "brand", label: "品牌套件", signal: "03", icon: Palette },
  { id: "prompt", label: "Prompt X-Ray", signal: "04", icon: BrainCircuit },
  { id: "evaluation", label: "版本评测", signal: "05", icon: Beaker },
  { id: "team", label: "团队模板", signal: "06", icon: Network },
  { id: "memory", label: "记忆胶片", signal: "07", icon: Film }
];

const statusMeta: Record<ProjectStatus, { label: string; color: string }> = {
  idea: { label: "构想", color: "#A78BFA" },
  active: { label: "推进中", color: "#2DD4BF" },
  blocked: { label: "受阻", color: "#FB7185" },
  done: { label: "已完成", color: "#5B7CFF" }
};

const artifactMeta: Record<ArtifactType, { label: string; icon: LucideIcon }> = {
  document: { label: "文档", icon: FileText },
  code: { label: "代码", icon: Code2 },
  table: { label: "表格", icon: Table2 },
  brief: { label: "Brief", icon: BriefcaseBusiness }
};

const inputClass = "h-10 w-full rounded-md border border-border bg-background/60 px-3 text-sm text-foreground outline-none transition focus:border-[#5B7CFF]/70 focus:ring-2 focus:ring-[#5B7CFF]/15";
const textareaClass = "w-full resize-y rounded-md border border-border bg-background/60 px-3 py-2.5 text-sm leading-6 text-foreground outline-none transition focus:border-[#5B7CFF]/70 focus:ring-2 focus:ring-[#5B7CFF]/15";
const miniButton = "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card/40 px-3 text-xs font-medium text-foreground transition hover:border-[#2DD4BF]/45 hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B7CFF]/50 disabled:pointer-events-none disabled:opacity-45";

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "--" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(parsed);
}

function cloneWorkflow(workflow: WorkflowTemplate): WorkflowTemplate {
  return JSON.parse(JSON.stringify(workflow)) as WorkflowTemplate;
}

function copyText(value: string, success: string): void {
  navigator.clipboard.writeText(value).then(() => toast.success(success)).catch(() => toast.error("无法访问剪贴板"));
}

function projectProgress(project: StudioProject, artifacts: StudioArtifact[]): number {
  if (project.status === "done") return 100;
  const linked = artifacts.filter((artifact) => artifact.projectId === project.id).length;
  const contextScore = project.pinnedContext.trim() ? 20 : 0;
  const objectiveScore = project.objective.trim() ? 20 : 0;
  return Math.min(90, 10 + contextScore + objectiveScore + linked * 12 + project.workflowIds.length * 8);
}

function artifactDiff(current: string, previous: string): { changed: number; currentLines: string[]; previousLines: string[] } {
  const currentLines = current.split("\n");
  const previousLines = previous.split("\n");
  const length = Math.max(currentLines.length, previousLines.length);
  let changed = 0;
  for (let index = 0; index < length; index += 1) {
    if (currentLines[index] !== previousLines[index]) changed += 1;
  }
  return { changed, currentLines, previousLines };
}

function makeMemorySignals(state: StudioState): MemorySignal[] {
  const signals: MemorySignal[] = [];
  for (const project of state.projects) {
    signals.push({
      id: `memory-${project.id}`,
      kind: "project",
      title: project.name,
      detail: project.status === "done" ? "项目已归档，可提炼为模板" : project.objective || "目标尚未定义",
      timestamp: project.updatedAt,
      unfinished: project.status !== "done"
    });
  }
  for (const artifact of state.artifacts) {
    const unfinishedMatch = artifact.content.match(/(?:TODO|FIXME|待办|待补充|未完成|\[ \])[^\n]*/i);
    signals.push({
      id: `memory-${artifact.id}`,
      kind: "artifact",
      title: artifact.title,
      detail: unfinishedMatch?.[0]?.slice(0, 160) || `${artifactMeta[artifact.type].label} · ${artifact.content.length} 字符 · ${artifact.versions.length} 个版本`,
      timestamp: artifact.updatedAt,
      unfinished: Boolean(unfinishedMatch) || !artifact.content.trim()
    });
  }
  if (typeof window !== "undefined") {
    try {
      const userId = getStoredUser()?.id;
      const key = `aiweb:inspiration-capsule:v1:${Number.isFinite(userId) ? `user:${userId}` : "guest"}`;
      const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as { items?: unknown[] } | null;
      for (const value of parsed?.items ?? []) {
        if (!value || typeof value !== "object") continue;
        const item = value as { id?: unknown; title?: unknown; target?: unknown; tags?: unknown; updatedAt?: unknown; createdAt?: unknown };
        if (typeof item.id !== "string" || typeof item.title !== "string") continue;
        const tags = Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 4) : [];
        signals.push({
          id: `memory-idea-${item.id}`,
          kind: "inspiration",
          title: item.title,
          detail: `${item.target === "image" ? "视觉灵感" : "语言灵感"}${tags.length ? ` · ${tags.join(" / ")}` : ""}`,
          timestamp: typeof item.updatedAt === "string" ? item.updatedAt : typeof item.createdAt === "string" ? item.createdAt : new Date(0).toISOString(),
          unfinished: true
        });
      }
    } catch {
      // Memory film remains useful when the optional inspiration store is unavailable.
    }
  }
  return signals.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

function SectionTitle({ icon: Icon, eyebrow, title, description, actions }: { icon: LucideIcon; eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase text-[#2DD4BF]"><Icon className="h-3.5 w-3.5" />{eyebrow}</div>
        <h2 className="mt-1 text-lg font-semibold text-foreground sm:text-xl">{title}</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground sm:text-sm">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function EmptyState({ icon: Icon, title, detail, action }: { icon: LucideIcon; title: string; detail: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center border border-dashed border-border bg-background/25 px-6 py-10 text-center">
      <Icon className="h-8 w-8 text-[#5B7CFF]" />
      <h3 className="mt-4 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{detail}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

function applyArtifactDraft(state: StudioState, draft: { artifactId: string; content: string }): StudioState {
  if (!draft.artifactId) return state;
  const artifact = state.artifacts.find((item) => item.id === draft.artifactId);
  if (!artifact || artifact.content === draft.content) return state;
  const timestamp = new Date().toISOString();
  const version = {
    id: createStudioId("version"),
    content: draft.content,
    reason: "autosave" as const,
    createdAt: timestamp
  };
  return {
    ...state,
    artifacts: state.artifacts.map((item) => item.id === artifact.id
      ? { ...item, content: draft.content, updatedAt: timestamp, versions: [...item.versions, version].slice(-30) }
      : item)
  };
}

export function CreatorHub() {
  const [activeTab, setActiveTab] = useState<StudioTab>("overview");
  const [studio, setStudio] = useState<StudioState>({
    version: 1,
    projects: [],
    artifacts: [],
    brandKits: [],
    workflowSnapshots: [],
    workflowTests: [],
    evaluations: [],
    activeProjectId: null,
    activeBrandKitId: null
  });
  const [user, setUser] = useState<User | null>(null);
  const [customWorkflows, setCustomWorkflows] = useState<WorkflowTemplate[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [artifactDraft, setArtifactDraft] = useState({ artifactId: "", content: "" });
  const [compareVersionId, setCompareVersionId] = useState<string>("");
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(builtInWorkflows[0].id);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>("");
  const [testName, setTestName] = useState("基准样例");
  const [testValues, setTestValues] = useState("{}");
  const [testKeywords, setTestKeywords] = useState("");
  const [teamTemplates, setTeamTemplates] = useState<TeamTemplate[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamQuery, setTeamQuery] = useState("");
  const [teamSort, setTeamSort] = useState<"recent" | "rating" | "popular">("recent");
  const [teamTarget, setTeamTarget] = useState<"all" | "chat" | "image">("all");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [publishWorkflowId, setPublishWorkflowId] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [teamComment, setTeamComment] = useState("");
  const [memorySignals, setMemorySignals] = useState<MemorySignal[]>([]);
  const studioRef = useRef(studio);
  const artifactDraftRef = useRef(artifactDraft);
  const teamRequestIdRef = useRef(0);
  studioRef.current = studio;
  artifactDraftRef.current = artifactDraft;

  const workflows = useMemo(() => [...customWorkflows, ...builtInWorkflows], [customWorkflows]);
  const selectedProject = studio.projects.find((item) => item.id === selectedProjectId) ?? studio.projects.find((item) => item.id === studio.activeProjectId) ?? studio.projects[0] ?? null;
  const selectedArtifact = studio.artifacts.find((item) => item.id === selectedArtifactId) ?? studio.artifacts[0] ?? null;
  const selectedBrand = studio.brandKits.find((item) => item.id === selectedBrandId) ?? studio.brandKits.find((item) => item.id === studio.activeBrandKitId) ?? studio.brandKits[0] ?? null;
  const selectedWorkflow = workflows.find((item) => item.id === selectedWorkflowId) ?? workflows[0];
  const selectedSnapshots = studio.workflowSnapshots.filter((item) => item.workflowId === selectedWorkflow?.id);
  const selectedSnapshot = selectedSnapshots.find((item) => item.id === selectedSnapshotId) ?? selectedSnapshots[0] ?? null;
  const selectedTests = studio.workflowTests.filter((item) => item.workflowId === selectedWorkflow?.id);
  const selectedEvaluations = studio.evaluations.filter((item) => item.workflowId === selectedWorkflow?.id).slice(0, 12);
  const selectedTeam = teamTemplates.find((item) => item.id === selectedTeamId) ?? teamTemplates[0] ?? null;
  const promptAudit = useMemo(() => auditPrompt(promptValue), [promptValue]);
  const comparedArtifactVersion = selectedArtifact?.versions.find((item) => item.id === compareVersionId) ?? selectedArtifact?.versions.at(-1) ?? null;
  const comparedArtifactDiff = selectedArtifact && comparedArtifactVersion ? artifactDiff(artifactDraft.artifactId === selectedArtifact.id ? artifactDraft.content : selectedArtifact.content, comparedArtifactVersion.content) : null;

  const commit = useCallback((update: (current: StudioState) => StudioState) => {
    setStudio((current) => {
      try {
        const saved = saveStudioState(update(current));
        studioRef.current = saved;
        return saved;
      } catch {
        toast.error("本地创作数据保存失败，请检查浏览器存储空间");
        return current;
      }
    });
  }, []);

  const persistArtifactDraftNow = useCallback((reportError = true) => {
    const next = applyArtifactDraft(studioRef.current, artifactDraftRef.current);
    if (next === studioRef.current) return;
    try {
      const saved = saveStudioState(next);
      studioRef.current = saved;
    } catch {
      if (reportError) toast.error("Artifact 保存失败，请检查浏览器存储空间");
    }
  }, []);

  const flushArtifactDraft = useCallback(() => {
    persistArtifactDraftNow();
    setStudio(studioRef.current);
  }, [persistArtifactDraftNow]);

  const ingestArtifact = useCallback((detail: ArtifactCreateDetail) => {
    if (typeof detail.content !== "string") return;
    flushArtifactDraft();
    const baseArtifact = createArtifact(detail);
    setSelectedArtifactId(baseArtifact.id);
    setArtifactDraft({ artifactId: baseArtifact.id, content: baseArtifact.content });
    setActiveTab("artifacts");
    setStudio((current) => {
      const projectId = detail.projectId && current.projects.some((item) => item.id === detail.projectId)
        ? detail.projectId
        : current.activeProjectId;
      const artifact = { ...baseArtifact, projectId };
      const projects = current.projects.map((project) => project.id === projectId
        ? { ...project, artifactIds: Array.from(new Set([...project.artifactIds, artifact.id])), updatedAt: artifact.updatedAt }
        : project);
      try {
        const saved = saveStudioState({ ...current, projects, artifacts: [artifact, ...current.artifacts] });
        studioRef.current = saved;
        return saved;
      } catch {
        toast.error("Artifact 创建失败，浏览器存储空间可能不足");
        return current;
      }
    });
    if (typeof window !== "undefined") window.sessionStorage.removeItem(PENDING_ARTIFACT_KEY);
    toast.success("内容已送入 Artifact 画布");
  }, [flushArtifactDraft]);

  useEffect(() => {
    const persistBeforeAccountChange = () => persistArtifactDraftNow(false);
    const reloadAccountData = () => {
      teamRequestIdRef.current += 1;
      const nextStudio = loadStudioState();
      const nextArtifact = nextStudio.artifacts[0] ?? null;
      const nextArtifactDraft = nextArtifact
        ? { artifactId: nextArtifact.id, content: nextArtifact.content }
        : { artifactId: "", content: "" };
      studioRef.current = nextStudio;
      artifactDraftRef.current = nextArtifactDraft;
      setStudio(nextStudio);
      setArtifactDraft(nextArtifactDraft);
      setUser(getStoredUser());
      setCustomWorkflows(loadCustomWorkflows());
      setSelectedProjectId(nextStudio.activeProjectId ?? nextStudio.projects[0]?.id ?? null);
      setSelectedArtifactId(nextArtifact?.id ?? null);
      setSelectedBrandId(nextStudio.activeBrandKitId ?? nextStudio.brandKits[0]?.id ?? null);
      setTeamTemplates([]);
    };
    reloadAccountData();
    window.addEventListener(AUTH_WILL_CHANGE_EVENT, persistBeforeAccountChange);
    window.addEventListener(AUTH_CHANGED_EVENT, reloadAccountData);
    return () => {
      window.removeEventListener(AUTH_WILL_CHANGE_EVENT, persistBeforeAccountChange);
      window.removeEventListener(AUTH_CHANGED_EVENT, reloadAccountData);
    };
  }, [persistArtifactDraftNow]);

  useEffect(() => {
    const handleArtifact = (event: Event) => {
      const detail = (event as CustomEvent<ArtifactCreateDetail>).detail;
      if (detail) ingestArtifact(detail);
    };
    window.addEventListener(ARTIFACT_CREATE_EVENT, handleArtifact);
    const pending = readPendingArtifact();
    if (pending) ingestArtifact(pending);
    return () => window.removeEventListener(ARTIFACT_CREATE_EVENT, handleArtifact);
  }, [ingestArtifact]);

  useEffect(() => {
    const flushBeforeUnload = () => persistArtifactDraftNow(false);
    window.addEventListener("beforeunload", flushBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", flushBeforeUnload);
      persistArtifactDraftNow(false);
    };
  }, [persistArtifactDraftNow]);

  useEffect(() => {
    if (!selectedArtifact) {
      setArtifactDraft({ artifactId: "", content: "" });
      setCompareVersionId("");
      return;
    }
    setArtifactDraft({ artifactId: selectedArtifact.id, content: selectedArtifact.content });
    setCompareVersionId(selectedArtifact.versions.at(-1)?.id ?? "");
  }, [selectedArtifact?.id]);

  useEffect(() => {
    if (!selectedArtifactId || artifactDraft.artifactId !== selectedArtifactId) return;
    const timer = window.setTimeout(flushArtifactDraft, 850);
    return () => window.clearTimeout(timer);
  }, [artifactDraft, flushArtifactDraft, selectedArtifactId]);

  const loadTeam = useCallback(async () => {
    const requestId = ++teamRequestIdRef.current;
    if (!getStoredUser()) {
      setTeamTemplates([]);
      setTeamLoading(false);
      return;
    }
    setTeamLoading(true);
    try {
      const items = await listTeamTemplates({ query: teamQuery, sort: teamSort, target: teamTarget });
      if (requestId !== teamRequestIdRef.current) return;
      setTeamTemplates(items);
      setSelectedTeamId((current) => items.some((item) => item.id === current) ? current : items[0]?.id ?? "");
    } catch (error) {
      if (requestId !== teamRequestIdRef.current) return;
      toast.error(error instanceof Error ? error.message : "团队模板加载失败");
    } finally {
      if (requestId === teamRequestIdRef.current) setTeamLoading(false);
    }
  }, [teamQuery, teamSort, teamTarget]);

  useEffect(() => {
    if (activeTab !== "team") return;
    const timer = window.setTimeout(() => void loadTeam(), 260);
    return () => window.clearTimeout(timer);
  }, [activeTab, loadTeam]);

  useEffect(() => {
    if (activeTab === "memory") setMemorySignals(makeMemorySignals(studio));
  }, [activeTab, studio]);

  function addProject(): void {
    const project = createProject(`新项目 ${studio.projects.length + 1}`);
    commit((current) => ({ ...current, projects: [project, ...current.projects], activeProjectId: project.id }));
    setSelectedProjectId(project.id);
    setActiveTab("projects");
  }

  function updateProject(projectId: string, patch: Partial<StudioProject>): void {
    commit((current) => ({
      ...current,
      projects: current.projects.map((project) => project.id === projectId ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)
    }));
  }

  function removeProject(project: StudioProject): void {
    if (!window.confirm(`删除项目「${project.name}」？关联 Artifact 会保留并转为未归档。`)) return;
    commit((current) => ({
      ...current,
      projects: current.projects.filter((item) => item.id !== project.id),
      artifacts: current.artifacts.map((artifact) => artifact.projectId === project.id ? { ...artifact, projectId: null } : artifact),
      activeProjectId: current.activeProjectId === project.id ? null : current.activeProjectId
    }));
    setSelectedProjectId(null);
    toast.success("项目已删除，Artifact 已保留");
  }

  function addArtifact(type: ArtifactType = "document", projectId?: string | null): void {
    ingestArtifact({
      content: type === "table" ? "| 字段 | 内容 |\n| --- | --- |\n| 示例 | 待补充 |" : "",
      type,
      projectId: projectId === undefined ? studio.activeProjectId : projectId,
      source: "创作中枢"
    });
  }

  function updateArtifact(artifactId: string, patch: Partial<StudioArtifact>): void {
    commit((current) => {
      const timestamp = new Date().toISOString();
      const nextProjectId = Object.prototype.hasOwnProperty.call(patch, "projectId") ? patch.projectId ?? null : undefined;
      return {
        ...current,
        artifacts: current.artifacts.map((artifact) => artifact.id === artifactId ? { ...artifact, ...patch, updatedAt: timestamp } : artifact),
        projects: nextProjectId === undefined
          ? current.projects
          : current.projects.map((project) => ({
              ...project,
              artifactIds: project.id === nextProjectId
                ? Array.from(new Set([...project.artifactIds, artifactId]))
                : project.artifactIds.filter((id) => id !== artifactId),
              updatedAt: project.id === nextProjectId || project.artifactIds.includes(artifactId) ? timestamp : project.updatedAt
            }))
      };
    });
  }

  function snapshotArtifact(): void {
    if (!selectedArtifact) return;
    const content = artifactDraft.artifactId === selectedArtifact.id ? artifactDraft.content : selectedArtifact.content;
    const version = { id: createStudioId("version"), content, reason: "manual" as const, createdAt: new Date().toISOString() };
    commit((current) => ({
      ...current,
      artifacts: current.artifacts.map((artifact) => artifact.id === selectedArtifact.id ? { ...artifact, content, versions: [...artifact.versions, version].slice(-30), updatedAt: version.createdAt } : artifact)
    }));
    setCompareVersionId(version.id);
    toast.success("已创建手动版本");
  }

  function rollbackArtifact(): void {
    if (!selectedArtifact || !comparedArtifactVersion) return;
    const timestamp = new Date().toISOString();
    const version = { id: createStudioId("version"), content: comparedArtifactVersion.content, reason: "rollback" as const, createdAt: timestamp };
    setArtifactDraft({ artifactId: selectedArtifact.id, content: comparedArtifactVersion.content });
    commit((current) => ({
      ...current,
      artifacts: current.artifacts.map((artifact) => artifact.id === selectedArtifact.id ? { ...artifact, content: comparedArtifactVersion.content, versions: [...artifact.versions, version].slice(-30), updatedAt: timestamp } : artifact)
    }));
    toast.success("已回滚并保留回滚版本");
  }

  function removeArtifact(artifact: StudioArtifact): void {
    if (!window.confirm(`删除 Artifact「${artifact.title}」及其本地版本？`)) return;
    flushArtifactDraft();
    const nextArtifact = studioRef.current.artifacts.find((item) => item.id !== artifact.id) ?? null;
    commit((current) => ({
      ...current,
      artifacts: current.artifacts.filter((item) => item.id !== artifact.id),
      projects: current.projects.map((project) => ({ ...project, artifactIds: project.artifactIds.filter((id) => id !== artifact.id) }))
    }));
    setSelectedArtifactId(nextArtifact?.id ?? null);
    setArtifactDraft(nextArtifact ? { artifactId: nextArtifact.id, content: nextArtifact.content } : { artifactId: "", content: "" });
  }

  function addBrand(): void {
    const brand = createBrandKit();
    commit((current) => ({ ...current, brandKits: [brand, ...current.brandKits], activeBrandKitId: current.activeBrandKitId ?? brand.id }));
    setSelectedBrandId(brand.id);
  }

  function updateBrand(brandId: string, patch: Partial<BrandKit>): void {
    commit((current) => ({
      ...current,
      brandKits: current.brandKits.map((brand) => brand.id === brandId ? { ...brand, ...patch, updatedAt: new Date().toISOString() } : brand)
    }));
  }

  function removeBrand(brand: BrandKit): void {
    if (!window.confirm(`删除品牌套件「${brand.name}」？`)) return;
    commit((current) => ({
      ...current,
      brandKits: current.brandKits.filter((item) => item.id !== brand.id),
      activeBrandKitId: current.activeBrandKitId === brand.id ? null : current.activeBrandKitId
    }));
    setSelectedBrandId(null);
  }

  function createWorkflowSnapshot(): void {
    if (!selectedWorkflow) return;
    const snapshot: WorkflowSnapshot = {
      id: createStudioId("snapshot"),
      workflowId: selectedWorkflow.id,
      label: `快照 ${selectedSnapshots.length + 1}`,
      workflow: cloneWorkflow(selectedWorkflow),
      createdAt: new Date().toISOString()
    };
    commit((current) => ({ ...current, workflowSnapshots: [snapshot, ...current.workflowSnapshots].slice(0, 120) }));
    setSelectedSnapshotId(snapshot.id);
    toast.success("工作流快照已保存");
  }

  function rollbackWorkflowSnapshot(): void {
    if (!selectedWorkflow?.custom || !selectedSnapshot) return;
    try {
      const restored = saveCustomWorkflow({ ...cloneWorkflow(selectedSnapshot.workflow), id: selectedWorkflow.id, custom: true, createdAt: selectedWorkflow.createdAt });
      setCustomWorkflows(restored);
      toast.success("自定义工作流已回滚，可在工作流实验室继续编辑");
    } catch {
      toast.error("快照内容已损坏，无法回滚");
    }
  }

  function addWorkflowTest(): void {
    if (!selectedWorkflow) return;
    try {
      const parsed = JSON.parse(testValues) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("变量必须是 JSON 对象");
      const test: WorkflowTestCase = {
        id: createStudioId("test"),
        workflowId: selectedWorkflow.id,
        name: testName.trim() || `测试 ${selectedTests.length + 1}`,
        values: Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value ?? "")])),
        expectedKeywords: testKeywords.split(/[,，\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, 20),
        createdAt: new Date().toISOString()
      };
      commit((current) => ({ ...current, workflowTests: [test, ...current.workflowTests].slice(0, 120) }));
      toast.success("测试样例已添加");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "变量 JSON 无法解析");
    }
  }

  function runWorkflowEvaluation(): void {
    if (!selectedWorkflow || !selectedTests.length) {
      toast.info("请先添加至少一个测试样例");
      return;
    }
    const results = selectedTests.map((test) => evaluateWorkflow(selectedWorkflow, test));
    commit((current) => ({ ...current, evaluations: [...results, ...current.evaluations].slice(0, 240) }));
    toast.success(`已完成 ${results.length} 条启发式评测`);
  }

  async function publishSelectedWorkflow(): Promise<void> {
    const workflow = customWorkflows.find((item) => item.id === publishWorkflowId);
    if (!workflow) {
      toast.info("请选择要发布的自定义工作流");
      return;
    }
    try {
      const published = await publishTeamTemplate(workflow, releaseNotes);
      setTeamTemplates((current) => [published, ...current.filter((item) => item.id !== published.id)]);
      setSelectedTeamId(published.id);
      setReleaseNotes("");
      toast.success("模板已发布到团队中心");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发布失败");
    }
  }

  async function installSelectedTeamTemplate(): Promise<void> {
    if (!selectedTeam) return;
    try {
      const updated = await installTeamTemplate(selectedTeam.id);
      const workflow: WorkflowTemplate = {
        ...cloneWorkflow(selectedTeam.workflow),
        id: createCustomWorkflowId(),
        name: selectedTeam.workflow.name,
        iconKey: "custom",
        custom: true,
        createdAt: new Date().toISOString()
      };
      const next = saveCustomWorkflow(workflow);
      setCustomWorkflows(next);
      setTeamTemplates((current) => current.map((item) => item.id === updated.id ? updated : item));
      toast.success("已安装为账号内自定义工作流");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "安装失败");
    }
  }

  async function submitTeamComment(): Promise<void> {
    if (!selectedTeam || !teamComment.trim()) return;
    try {
      const updated = await commentOnTeamTemplate(selectedTeam.id, teamComment.trim());
      setTeamTemplates((current) => current.map((item) => item.id === updated.id ? updated : item));
      setTeamComment("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "评论失败");
    }
  }

  async function submitRating(value: number): Promise<void> {
    if (!selectedTeam) return;
    try {
      const rating = await rateTeamTemplate(selectedTeam.id, value);
      setTeamTemplates((current) => current.map((item) => item.id === selectedTeam.id ? { ...item, ...rating } : item));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "评分失败");
    }
  }

  async function removeTeamTemplate(): Promise<void> {
    if (!selectedTeam || !window.confirm(`下架团队模板「${selectedTeam.workflow.name}」？`)) return;
    try {
      await deleteTeamTemplate(selectedTeam.id);
      setTeamTemplates((current) => current.filter((item) => item.id !== selectedTeam.id));
      setSelectedTeamId("");
      toast.success("模板已下架");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下架失败");
    }
  }

  return (
    <PageShell className="pb-5">
      <section className="relative overflow-hidden border-y border-border/70 py-5 sm:py-7">
        <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(91,124,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(45,212,191,.08)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:linear-gradient(to_right,black,transparent_92%)]" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 text-[#2DD4BF]"><Activity className="h-3 w-3" />CREATOR CORE / ONLINE</span>
              <span className="h-3 w-px bg-border" />
              <span>{user ? `NODE USER-${user.id}` : "LOCAL GUEST NODE"}</span>
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-foreground sm:text-3xl">创作中枢</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">把工作流、上下文和产出收束到同一条创作链路。项目负责记住目标，Artifact 负责承接结果，版本与评测负责让迭代可验证。</p>
          </div>
          <div className="grid grid-cols-3 gap-px border border-border bg-border lg:min-w-[420px]">
            {[
              [studio.projects.length, "PROJECTS"],
              [studio.artifacts.length, "ARTIFACTS"],
              [studio.workflowSnapshots.length + studio.evaluations.length, "CHECKPOINTS"]
            ].map(([value, label]) => (
              <div key={String(label)} className="bg-card/80 px-3 py-3 text-center">
                <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
                <div className="mt-1 text-[9px] font-semibold text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-border pb-2" aria-label="创作中枢功能">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={cn("relative flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", active ? "bg-[#5B7CFF] text-white shadow-lg shadow-blue-500/15" : "text-muted-foreground hover:bg-card/70 hover:text-foreground")}
            >
              <span className={cn("text-[9px] tabular-nums", active ? "text-white/60" : "text-[#2DD4BF]")}>{tab.signal}</span>
              <Icon className="h-3.5 w-3.5" />{tab.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-4">
        {activeTab === "overview" ? (
          <OverviewPanel
            studio={studio}
            activeProject={selectedProject}
            onTab={setActiveTab}
            onAddProject={addProject}
            onAddArtifact={() => addArtifact("document")}
          />
        ) : null}

        {activeTab === "projects" ? (
          <section className="glass-panel rounded-lg p-4 sm:p-5">
            <SectionTitle icon={FolderKanban} eyebrow="PROJECT MATRIX" title="项目工作区" description="为长期任务固定目标、状态、上下文和素材关系。切换项目时，创作资产不会再失去背景。" actions={<button type="button" className={miniButton} onClick={addProject}><Plus className="h-3.5 w-3.5" />新建项目</button>} />
            <div className="mt-4 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
              <div className="space-y-2">
                {studio.projects.map((project) => (
                  <button key={project.id} type="button" onClick={() => setSelectedProjectId(project.id)} className={cn("w-full rounded-md border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", selectedProject?.id === project.id ? "border-[#5B7CFF]/55 bg-[#5B7CFF]/8" : "border-border bg-background/35 hover:border-[#2DD4BF]/35")}>
                    <div className="flex items-start justify-between gap-3"><span className="min-w-0 break-words text-sm font-semibold text-foreground">{project.name}</span><span className="mt-1 h-2 w-2 shrink-0" style={{ background: statusMeta[project.status].color }} /></div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{project.objective || "尚未设置项目目标"}</p>
                    <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground"><span>{statusMeta[project.status].label}</span><span>{projectProgress(project, studio.artifacts)}%</span></div>
                    <div className="mt-1 h-1 overflow-hidden bg-border/60"><div className="h-full bg-[#2DD4BF]" style={{ width: `${projectProgress(project, studio.artifacts)}%` }} /></div>
                  </button>
                ))}
                {!studio.projects.length ? <EmptyState icon={FolderKanban} title="还没有项目" detail="创建项目后即可集中管理上下文、工作流和 Artifact。" action={<button type="button" className={miniButton} onClick={addProject}><Plus className="h-3.5 w-3.5" />创建第一个项目</button>} /> : null}
              </div>
              {selectedProject ? (
                <div className="min-w-0 border-l-0 border-border lg:border-l lg:pl-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-xs font-medium text-foreground">项目名称<input className={cn(inputClass, "mt-1.5")} value={selectedProject.name} maxLength={100} onChange={(event) => updateProject(selectedProject.id, { name: event.target.value })} /></label>
                    <label className="text-xs font-medium text-foreground">状态<select className={cn(inputClass, "mt-1.5")} value={selectedProject.status} onChange={(event) => updateProject(selectedProject.id, { status: event.target.value as ProjectStatus })}>{Object.entries(statusMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>
                  </div>
                  <label className="mt-4 block text-xs font-medium text-foreground">目标与验收标准<textarea className={cn(textareaClass, "mt-1.5 min-h-24")} value={selectedProject.objective} maxLength={4000} onChange={(event) => updateProject(selectedProject.id, { objective: event.target.value })} placeholder="这个项目最终要交付什么，怎样判断已经完成？" /></label>
                  <label className="mt-4 block text-xs font-medium text-foreground"><span className="flex items-center gap-1.5"><Pin className="h-3.5 w-3.5 text-[#FBBF24]" />置顶上下文</span><textarea className={cn(textareaClass, "mt-1.5 min-h-32")} value={selectedProject.pinnedContext} maxLength={12000} onChange={(event) => updateProject(selectedProject.id, { pinnedContext: event.target.value })} placeholder="稳定事实、关键约束、术语、已做决策和不要重复踩的坑" /></label>
                  <div className="mt-5">
                    <div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-foreground">关联工作流</h3><span className="text-[10px] text-muted-foreground">{selectedProject.workflowIds.length} 已连接</span></div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {workflows.map((workflow) => {
                        const linked = selectedProject.workflowIds.includes(workflow.id);
                        return <button key={workflow.id} type="button" onClick={() => updateProject(selectedProject.id, { workflowIds: linked ? selectedProject.workflowIds.filter((id) => id !== workflow.id) : [...selectedProject.workflowIds, workflow.id] })} className={cn("flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition", linked ? "border-[#2DD4BF]/50 bg-[#2DD4BF]/8 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}><span className="flex h-4 w-4 shrink-0 items-center justify-center border border-current">{linked ? <Check className="h-3 w-3" /> : null}</span><span className="truncate">{workflow.name}</span></button>;
                      })}
                    </div>
                  </div>
                  <div className="mt-5">
                    <div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-foreground">关联 Artifact</h3><span className="text-[10px] text-muted-foreground">{studio.artifacts.filter((artifact) => artifact.projectId === selectedProject.id).length} 已归档</span></div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {studio.artifacts.filter((artifact) => artifact.projectId === selectedProject.id).map((artifact) => {
                        const Icon = artifactMeta[artifact.type].icon;
                        return <span key={artifact.id} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card/45 py-1 pl-2 pr-1 text-[10px] text-foreground"><Icon className="h-3 w-3 shrink-0 text-[#2DD4BF]" /><button type="button" className="max-w-44 truncate hover:text-[#5B7CFF]" onClick={() => { flushArtifactDraft(); setSelectedArtifactId(artifact.id); setActiveTab("artifacts"); }}>{artifact.title}</button><button type="button" className="p-1 text-muted-foreground hover:text-red-500" title="从项目移除" onClick={() => updateArtifact(artifact.id, { projectId: null })}><Trash2 className="h-3 w-3" /></button></span>;
                      })}
                      {!studio.artifacts.some((artifact) => artifact.projectId === selectedProject.id) ? <span className="text-xs text-muted-foreground">尚无 Artifact，可从下方直接创建并自动关联。</span> : null}
                    </div>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <button type="button" className={cn(miniButton, studio.activeProjectId === selectedProject.id && "border-[#2DD4BF]/55 text-[#2DD4BF]")} onClick={() => commit((current) => ({ ...current, activeProjectId: selectedProject.id }))}><Pin className="h-3.5 w-3.5" />{studio.activeProjectId === selectedProject.id ? "当前项目" : "设为当前项目"}</button>
                    <button type="button" className={miniButton} onClick={() => addArtifact("brief", selectedProject.id)}><FileText className="h-3.5 w-3.5" />新建 Brief</button>
                    <button type="button" className={cn(miniButton, "text-red-500")} onClick={() => removeProject(selectedProject)}><Trash2 className="h-3.5 w-3.5" />删除</button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeTab === "artifacts" ? (
          <section className="glass-panel rounded-lg p-4 sm:p-5">
            <SectionTitle icon={Layers3} eyebrow="ARTIFACT CANVAS" title="Artifact 创作画布" description="承接对话和工作流结果，自动生成本地版本；支持文档、代码、表格与 Brief 的比较、回滚和导出。" actions={<>{(["document", "code", "table", "brief"] as ArtifactType[]).map((type) => { const Icon = artifactMeta[type].icon; return <button key={type} type="button" className={miniButton} title={`新建${artifactMeta[type].label}`} onClick={() => addArtifact(type)}><Icon className="h-3.5 w-3.5" /><span className="hidden sm:inline">{artifactMeta[type].label}</span></button>; })}</>} />
            <div className="mt-4 grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
              <div className="space-y-2">
                {studio.artifacts.map((artifact) => { const Icon = artifactMeta[artifact.type].icon; return (
                  <button key={artifact.id} type="button" onClick={() => { flushArtifactDraft(); setSelectedArtifactId(artifact.id); }} className={cn("w-full rounded-md border p-3 text-left transition", selectedArtifact?.id === artifact.id ? "border-[#5B7CFF]/55 bg-[#5B7CFF]/8" : "border-border bg-background/35 hover:border-[#2DD4BF]/35")}>
                    <div className="flex items-center gap-2"><Icon className="h-3.5 w-3.5 shrink-0 text-[#2DD4BF]" /><span className="truncate text-xs font-semibold text-foreground">{artifact.title}</span></div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground"><span>{artifactMeta[artifact.type].label} · {artifact.versions.length} 版</span><span>{formatDate(artifact.updatedAt)}</span></div>
                  </button>
                ); })}
                {!studio.artifacts.length ? <EmptyState icon={Layers3} title="画布还是空的" detail="从聊天发送内容，或直接创建一个 Artifact。" action={<button type="button" className={miniButton} onClick={() => addArtifact("document")}><Plus className="h-3.5 w-3.5" />新建文档</button>} /> : null}
              </div>
              {selectedArtifact ? (
                <div className="min-w-0 space-y-3">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_180px]">
                    <input aria-label="Artifact 标题" className={inputClass} value={selectedArtifact.title} maxLength={140} onChange={(event) => updateArtifact(selectedArtifact.id, { title: event.target.value })} />
                    <select aria-label="Artifact 类型" className={inputClass} value={selectedArtifact.type} onChange={(event) => updateArtifact(selectedArtifact.id, { type: event.target.value as ArtifactType })}>{Object.entries(artifactMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select>
                    <select aria-label="关联项目" className={inputClass} value={selectedArtifact.projectId ?? ""} onChange={(event) => updateArtifact(selectedArtifact.id, { projectId: event.target.value || null })}><option value="">未归档</option>{studio.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
                  </div>
                  <textarea aria-label="Artifact 内容" className={cn(textareaClass, "min-h-[520px] font-mono text-[13px]")} value={artifactDraft.artifactId === selectedArtifact.id ? artifactDraft.content : selectedArtifact.content} onChange={(event) => setArtifactDraft({ artifactId: selectedArtifact.id, content: event.target.value })} spellCheck={selectedArtifact.type !== "code"} placeholder="在此编辑内容。停止输入约 1 秒后自动生成本地版本。" />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Activity className="h-3 w-3 text-[#2DD4BF]" />自动版本已启用 · {artifactDraft.content.length.toLocaleString("zh-CN")} 字符</span><span>{selectedArtifact.source ? `来源：${selectedArtifact.source}` : "本地创建"}</span></div>
                </div>
              ) : null}
              {selectedArtifact ? (
                <aside className="min-w-0 border-t border-border pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
                  <div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-foreground">版本轨道</h3><button type="button" className={miniButton} onClick={snapshotArtifact}><Save className="h-3.5 w-3.5" />快照</button></div>
                  <select className={cn(inputClass, "mt-3")} aria-label="比较版本" value={comparedArtifactVersion?.id ?? ""} onChange={(event) => setCompareVersionId(event.target.value)}>{[...selectedArtifact.versions].reverse().map((version) => <option key={version.id} value={version.id}>{formatDate(version.createdAt)} · {version.reason}</option>)}</select>
                  {comparedArtifactDiff ? <div className="mt-3 grid grid-cols-3 gap-px bg-border text-center"><div className="bg-background/70 p-2"><strong className="block text-sm text-foreground">{comparedArtifactDiff.changed}</strong><span className="text-[9px] text-muted-foreground">CHANGED</span></div><div className="bg-background/70 p-2"><strong className="block text-sm text-foreground">{comparedArtifactDiff.currentLines.length}</strong><span className="text-[9px] text-muted-foreground">CURRENT</span></div><div className="bg-background/70 p-2"><strong className="block text-sm text-foreground">{comparedArtifactDiff.previousLines.length}</strong><span className="text-[9px] text-muted-foreground">BASE</span></div></div> : null}
                  {comparedArtifactVersion ? <div className="mt-3 max-h-72 overflow-auto border border-border bg-background/55 p-2 font-mono text-[10px] leading-5">{comparedArtifactVersion.content.split("\n").slice(0, 80).map((line, index) => <div key={index} className={cn("flex gap-2 px-1", comparedArtifactDiff?.currentLines[index] !== line && "bg-[#FB7185]/10 text-[#FB7185]")}><span className="w-5 shrink-0 text-right text-muted-foreground">{index + 1}</span><span className="min-w-0 whitespace-pre-wrap break-all">{line || " "}</span></div>)}</div> : null}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" className={miniButton} disabled={!comparedArtifactVersion} onClick={rollbackArtifact}><ArchiveRestore className="h-3.5 w-3.5" />回滚</button>
                    <button type="button" className={miniButton} onClick={() => downloadTextFile(`${selectedArtifact.title.replace(/[\\/:*?\"<>|]/g, "-") || "artifact"}.md`, artifactDraft.content, "text/markdown;charset=utf-8")}><Download className="h-3.5 w-3.5" />Markdown</button>
                    <button type="button" className={miniButton} onClick={() => downloadTextFile(`${selectedArtifact.title.replace(/[\\/:*?\"<>|]/g, "-") || "artifact"}.json`, JSON.stringify({ ...selectedArtifact, content: artifactDraft.artifactId === selectedArtifact.id ? artifactDraft.content : selectedArtifact.content }, null, 2), "application/json;charset=utf-8")}><FileJson className="h-3.5 w-3.5" />JSON</button>
                    <button type="button" className={cn(miniButton, "text-red-500")} onClick={() => removeArtifact(selectedArtifact)}><Trash2 className="h-3.5 w-3.5" />删除</button>
                  </div>
                </aside>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeTab === "brand" ? (
          <section className="glass-panel rounded-lg p-4 sm:p-5">
            <SectionTitle icon={Palette} eyebrow="BRAND CONSTRAINT BUS" title="品牌资产套件" description="把品牌颜色、语气、受众、事实和禁用表达编译成聊天与生图都能复用的上下文。" actions={<button type="button" className={miniButton} onClick={addBrand}><Plus className="h-3.5 w-3.5" />新建套件</button>} />
            <div className="mt-4 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
              <div className="space-y-2">{studio.brandKits.map((brand) => <button key={brand.id} type="button" onClick={() => setSelectedBrandId(brand.id)} className={cn("w-full rounded-md border p-3 text-left transition", selectedBrand?.id === brand.id ? "border-[#5B7CFF]/55 bg-[#5B7CFF]/8" : "border-border bg-background/35 hover:border-[#2DD4BF]/35")}><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold text-foreground">{brand.name}</span>{studio.activeBrandKitId === brand.id ? <span className="text-[9px] font-semibold text-[#2DD4BF]">ACTIVE</span> : null}</div><div className="mt-3 flex gap-1">{brand.colors.map((color) => <span key={color} className="h-4 w-7 border border-white/20" style={{ backgroundColor: color }} title={color} />)}</div></button>)}{!studio.brandKits.length ? <EmptyState icon={Palette} title="尚无品牌套件" detail="创建后可一键注入 Prompt，并在各类工作流之间保持一致。" action={<button type="button" className={miniButton} onClick={addBrand}><Plus className="h-3.5 w-3.5" />创建套件</button>} /> : null}</div>
              {selectedBrand ? <div className="min-w-0 border-l-0 border-border lg:border-l lg:pl-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-xs font-medium text-foreground">套件名称<input className={cn(inputClass, "mt-1.5")} value={selectedBrand.name} maxLength={100} onChange={(event) => updateBrand(selectedBrand.id, { name: event.target.value })} /></label><button type="button" className={cn(miniButton, studio.activeBrandKitId === selectedBrand.id && "border-[#2DD4BF]/55 text-[#2DD4BF]")} onClick={() => commit((current) => ({ ...current, activeBrandKitId: selectedBrand.id }))}><Check className="h-3.5 w-3.5" />{studio.activeBrandKitId === selectedBrand.id ? "已激活" : "激活套件"}</button></div>
                <div className="mt-4"><span className="text-xs font-medium text-foreground">品牌色</span><div className="mt-2 flex flex-wrap gap-2">{selectedBrand.colors.map((color, index) => <label key={`${color}-${index}`} className="group relative h-10 w-14 cursor-pointer border border-border" style={{ backgroundColor: color }} title={`编辑 ${color}`}><input type="color" value={color} className="absolute inset-0 cursor-pointer opacity-0" onChange={(event) => updateBrand(selectedBrand.id, { colors: selectedBrand.colors.map((item, colorIndex) => colorIndex === index ? event.target.value.toUpperCase() : item) })} /><span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[8px] text-white opacity-0 transition group-hover:opacity-100">{color}</span></label>)}{selectedBrand.colors.length < 8 ? <button type="button" className="flex h-10 w-14 items-center justify-center border border-dashed border-border text-muted-foreground hover:text-foreground" title="增加颜色" onClick={() => updateBrand(selectedBrand.id, { colors: [...selectedBrand.colors, "#FBBF24"] })}><Plus className="h-4 w-4" /></button> : null}</div></div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs font-medium text-foreground">表达语气<textarea className={cn(textareaClass, "mt-1.5 min-h-24")} value={selectedBrand.tone} onChange={(event) => updateBrand(selectedBrand.id, { tone: event.target.value })} placeholder="句式、节奏、态度与表达边界" /></label><label className="text-xs font-medium text-foreground">核心受众<textarea className={cn(textareaClass, "mt-1.5 min-h-24")} value={selectedBrand.audience} onChange={(event) => updateBrand(selectedBrand.id, { audience: event.target.value })} placeholder="角色、场景、认知水平和核心诉求" /></label></div>
                <label className="mt-4 block text-xs font-medium text-foreground">产品事实<textarea className={cn(textareaClass, "mt-1.5 min-h-32")} value={selectedBrand.productFacts} onChange={(event) => updateBrand(selectedBrand.id, { productFacts: event.target.value })} placeholder="每行一个可核验事实；模型不得补造未提供的数据" /></label>
                <label className="mt-4 block text-xs font-medium text-foreground">禁用词与禁区<textarea className={cn(textareaClass, "mt-1.5 min-h-20")} value={selectedBrand.forbiddenWords} onChange={(event) => updateBrand(selectedBrand.id, { forbiddenWords: event.target.value })} placeholder="词语、视觉元素、话题或承诺边界" /></label>
                <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={miniButton} onClick={() => copyText(buildBrandContext(selectedBrand), "品牌上下文已复制")}><Copy className="h-3.5 w-3.5" />复制上下文</button><button type="button" className={miniButton} onClick={() => { setPromptValue((current) => `${current}${current ? "\n\n" : ""}${buildBrandContext(selectedBrand)}`); setActiveTab("prompt"); }}><BrainCircuit className="h-3.5 w-3.5" />送入 X-Ray</button><button type="button" className={cn(miniButton, "text-red-500")} onClick={() => removeBrand(selectedBrand)}><Trash2 className="h-3.5 w-3.5" />删除</button></div>
              </div> : null}
            </div>
          </section>
        ) : null}

        {activeTab === "prompt" ? (
          <section className="glass-panel rounded-lg p-4 sm:p-5">
            <SectionTitle icon={BrainCircuit} eyebrow="PROMPT DIAGNOSTICS" title="Prompt 体检与 X-Ray" description="在发送前定位未填变量、模糊约束、冲突指令和敏感信息，并追踪每个片段的可能来源。成本为粗略估算，不代表实际账单。" actions={<>{selectedBrand ? <button type="button" className={miniButton} onClick={() => setPromptValue((current) => `${current}${current ? "\n\n" : ""}${buildBrandContext(selectedBrand)}`)}><Palette className="h-3.5 w-3.5" />注入品牌</button> : null}<button type="button" className={miniButton} onClick={() => selectedWorkflow && setPromptValue(selectedWorkflow.promptTemplate)}><Network className="h-3.5 w-3.5" />读取工作流</button></>} />
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
              <div className="min-w-0"><textarea aria-label="待体检 Prompt" className={cn(textareaClass, "min-h-[420px] font-mono text-[13px]")} value={promptValue} onChange={(event) => setPromptValue(event.target.value)} placeholder="粘贴 Prompt，或从品牌套件 / 工作流载入内容……" /><div className="mt-3 grid grid-cols-4 gap-px bg-border text-center">{[[promptAudit.score, "HEALTH"], [promptAudit.characters, "CHARS"], [promptAudit.estimatedTokens, "TOKENS"], [`$${promptAudit.estimatedInputCostUsd.toFixed(4)}`, "EST. COST"]].map(([value, label]) => <div key={String(label)} className="bg-background/70 px-2 py-3"><strong className="block text-base tabular-nums text-foreground">{value}</strong><span className="text-[9px] text-muted-foreground">{label}</span></div>)}</div>
                <div className="mt-4"><div className="flex flex-wrap gap-3 text-[10px]">{[["workflow", "工作流", "#5B7CFF"], ["variable", "变量", "#FB7185"], ["brand", "品牌", "#2DD4BF"], ["user", "用户上下文", "#FBBF24"], ["instruction", "模板指令", "#A78BFA"]].map(([key, label, color]) => <span key={key} className="inline-flex items-center gap-1.5 text-muted-foreground"><i className="h-2 w-2" style={{ backgroundColor: color }} />{label}</span>)}</div><div className="mt-2 min-h-32 border border-border bg-background/50 p-3 text-xs leading-6 text-foreground">{promptAudit.segments.length ? promptAudit.segments.map((segment) => { const color = { workflow: "#5B7CFF", variable: "#FB7185", brand: "#2DD4BF", user: "#FBBF24", instruction: "#A78BFA" }[segment.source]; return <span key={segment.id} title={segment.label} className="whitespace-pre-wrap border-b" style={{ borderColor: color, backgroundColor: `${color}12` }}>{segment.text}</span>; }) : <span className="text-muted-foreground">X-Ray 会在这里显示片段来源。</span>}</div></div>
              </div>
              <aside className="min-w-0"><h3 className="text-xs font-semibold text-foreground">诊断信号 <span className="ml-1 text-muted-foreground">{promptAudit.findings.length}</span></h3><div className="mt-3 space-y-2">{promptAudit.findings.map((finding) => <div key={finding.id} className={cn("rounded-md border p-3", finding.severity === "critical" ? "border-red-500/35 bg-red-500/5" : finding.severity === "warning" ? "border-amber-400/35 bg-amber-400/5" : "border-[#5B7CFF]/30 bg-[#5B7CFF]/5")}><div className="flex items-center gap-2"><CircleAlert className={cn("h-3.5 w-3.5", finding.severity === "critical" ? "text-red-500" : finding.severity === "warning" ? "text-amber-400" : "text-[#5B7CFF]")} /><strong className="text-xs text-foreground">{finding.title}</strong><span className="ml-auto text-[9px] uppercase text-muted-foreground">{finding.category}</span></div><p className="mt-1.5 text-xs leading-5 text-muted-foreground">{finding.detail}</p></div>)}{promptValue && !promptAudit.findings.length ? <div className="border border-[#2DD4BF]/35 bg-[#2DD4BF]/5 p-5 text-center"><ClipboardCheck className="mx-auto h-7 w-7 text-[#2DD4BF]" /><p className="mt-2 text-sm font-medium text-foreground">未发现明显风险</p><p className="mt-1 text-xs text-muted-foreground">仍建议用真实样例验证输出质量。</p></div> : null}{!promptValue ? <EmptyState icon={BrainCircuit} title="等待 Prompt 信号" detail="输入内容后，诊断和成本估算会实时更新。" /> : null}</div></aside>
            </div>
          </section>
        ) : null}

        {activeTab === "evaluation" ? (
          <section className="glass-panel rounded-lg p-4 sm:p-5">
            <SectionTitle icon={Beaker} eyebrow="VERSION & EVALUATION" title="工作流版本与评测" description="为工作流创建不可变快照，通过测试样例批量检查变量完整性、关键词信号和任务结构，再决定是否回滚。" actions={<><button type="button" className={miniButton} onClick={createWorkflowSnapshot}><Save className="h-3.5 w-3.5" />创建快照</button><button type="button" className={miniButton} onClick={runWorkflowEvaluation}><TestTube2 className="h-3.5 w-3.5" />批量评测</button></>} />
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="min-w-0 space-y-4">
                <label className="block text-xs font-medium text-foreground">工作流<select className={cn(inputClass, "mt-1.5")} value={selectedWorkflow?.id ?? ""} onChange={(event) => { const id = event.target.value; setSelectedWorkflowId(id); setSelectedSnapshotId(""); const workflow = workflows.find((item) => item.id === id); if (workflow) setTestValues(JSON.stringify(getInitialWorkflowValues(workflow), null, 2)); }}><optgroup label="自定义工作流">{customWorkflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</optgroup><optgroup label="内置工作流">{builtInWorkflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</optgroup></select></label>
                <div className="grid gap-4 lg:grid-cols-2"><div className="border border-border bg-background/35 p-3"><div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-foreground">快照轨道</h3><span className="text-[10px] text-muted-foreground">{selectedSnapshots.length} checkpoints</span></div><div className="mt-3 space-y-2">{selectedSnapshots.map((snapshot) => <button key={snapshot.id} type="button" onClick={() => setSelectedSnapshotId(snapshot.id)} className={cn("flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left", selectedSnapshot?.id === snapshot.id ? "border-[#5B7CFF]/55 bg-[#5B7CFF]/8" : "border-border")}><GitCompareArrows className="h-3.5 w-3.5 text-[#2DD4BF]" /><span className="min-w-0 flex-1 truncate text-xs text-foreground">{snapshot.label}</span><span className="text-[9px] text-muted-foreground">{formatDate(snapshot.createdAt)}</span></button>)}{!selectedSnapshots.length ? <p className="py-8 text-center text-xs text-muted-foreground">尚无快照</p> : null}</div></div>
                  <div className="border border-border bg-background/35 p-3"><h3 className="text-xs font-semibold text-foreground">与当前版本比较</h3>{selectedSnapshot && selectedWorkflow ? <><div className="mt-3 space-y-2">{workflowDiff(selectedSnapshot.workflow, selectedWorkflow).map((change) => <div key={change} className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ChevronRight className="mt-1 h-3 w-3 shrink-0 text-[#FB7185]" /><span>{change}</span></div>)}{!workflowDiff(selectedSnapshot.workflow, selectedWorkflow).length ? <div className="flex items-center gap-2 text-xs text-[#2DD4BF]"><Check className="h-3.5 w-3.5" />与快照完全一致</div> : null}</div><button type="button" className={cn(miniButton, "mt-4")} disabled={!selectedWorkflow.custom} title={selectedWorkflow.custom ? "回滚到此快照" : "内置工作流不可覆盖，请先创建自定义副本"} onClick={rollbackWorkflowSnapshot}><ArchiveRestore className="h-3.5 w-3.5" />回滚自定义工作流</button></> : <p className="py-8 text-center text-xs text-muted-foreground">选择或创建快照以比较</p>}</div></div>
                <div className="border border-border bg-background/35 p-3"><div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-foreground">测试样例</h3><span className="text-[10px] text-muted-foreground">启发式评分，不调用模型</span></div><div className="mt-3 grid gap-3 md:grid-cols-2"><label className="text-xs text-muted-foreground">样例名称<input className={cn(inputClass, "mt-1")} value={testName} onChange={(event) => setTestName(event.target.value)} /></label><label className="text-xs text-muted-foreground">期望关键词<input className={cn(inputClass, "mt-1")} value={testKeywords} onChange={(event) => setTestKeywords(event.target.value)} placeholder="报告, 风险, 下一步" /></label></div><label className="mt-3 block text-xs text-muted-foreground">变量 JSON<textarea className={cn(textareaClass, "mt-1 min-h-40 font-mono text-xs")} value={testValues} onChange={(event) => setTestValues(event.target.value)} /></label><button type="button" className={cn(miniButton, "mt-3")} onClick={addWorkflowTest}><Plus className="h-3.5 w-3.5" />加入测试集</button><div className="mt-3 flex flex-wrap gap-2">{selectedTests.map((test) => <span key={test.id} className="inline-flex items-center gap-1.5 border border-border bg-card/50 px-2 py-1 text-[10px] text-foreground"><TestTube2 className="h-3 w-3 text-[#A78BFA]" />{test.name}<button type="button" title="删除测试" onClick={() => commit((current) => ({ ...current, workflowTests: current.workflowTests.filter((item) => item.id !== test.id) }))} className="ml-1 text-muted-foreground hover:text-red-500"><Trash2 className="h-3 w-3" /></button></span>)}</div></div>
              </div>
              <aside className="min-w-0 border-t border-border pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0"><div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-foreground">评测记录</h3><span className="text-[10px] text-muted-foreground">LATEST 12</span></div><div className="mt-3 space-y-3">{selectedEvaluations.map((evaluation) => <div key={evaluation.id} className="rounded-md border border-border bg-background/35 p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-foreground">{evaluation.testCaseName}</span><span className={cn("text-lg font-semibold tabular-nums", evaluation.score >= 80 ? "text-[#2DD4BF]" : evaluation.score >= 50 ? "text-[#FBBF24]" : "text-[#FB7185]")}>{evaluation.score}</span></div><div className="mt-2 grid grid-cols-2 gap-1">{evaluation.checks.map((check) => <div key={check.label} title={check.detail} className={cn("flex items-center gap-1.5 px-2 py-1 text-[10px]", check.passed ? "bg-[#2DD4BF]/8 text-[#2DD4BF]" : "bg-[#FB7185]/8 text-[#FB7185]")}><span className="h-1.5 w-1.5 bg-current" />{check.label}</div>)}</div><div className="mt-2 text-[9px] text-muted-foreground">{formatDate(evaluation.createdAt)}</div></div>)}{!selectedEvaluations.length ? <EmptyState icon={Beaker} title="还没有评测记录" detail="添加测试样例后运行批量评测。" /> : null}</div></aside>
            </div>
          </section>
        ) : null}

        {activeTab === "team" ? (
          <section className="glass-panel rounded-lg p-4 sm:p-5">
            <SectionTitle icon={Network} eyebrow="TEAM TEMPLATE EXCHANGE" title="团队模板中心" description="发布账号内的自定义工作流，安装团队成员的版本，并通过评论与评分沉淀可复用经验。" actions={<button type="button" className={miniButton} onClick={() => void loadTeam()} disabled={teamLoading}>{teamLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}刷新</button>} />
            {!user ? <div className="mt-4"><EmptyState icon={Network} title="登录后连接团队模板" detail="团队目录需要账号身份；个人项目和 Artifact 仍可在访客空间使用。" /></div> : <div className="mt-4 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
              <div className="space-y-3"><div className="relative"><Search className="absolute left-3 top-3 h-3.5 w-3.5 text-muted-foreground" /><input className={cn(inputClass, "pl-9")} value={teamQuery} onChange={(event) => setTeamQuery(event.target.value)} placeholder="搜索模板或作者" /></div><div className="grid grid-cols-2 gap-2"><select className={inputClass} value={teamTarget} onChange={(event) => setTeamTarget(event.target.value as typeof teamTarget)}><option value="all">全部通道</option><option value="chat">对话</option><option value="image">生图</option></select><select className={inputClass} value={teamSort} onChange={(event) => setTeamSort(event.target.value as typeof teamSort)}><option value="recent">最新</option><option value="rating">评分</option><option value="popular">安装</option></select></div><div className="max-h-[620px] space-y-2 overflow-auto pr-1">{teamTemplates.map((template) => <button key={template.id} type="button" onClick={() => setSelectedTeamId(template.id)} className={cn("w-full rounded-md border p-3 text-left transition", selectedTeam?.id === template.id ? "border-[#5B7CFF]/55 bg-[#5B7CFF]/8" : "border-border bg-background/35 hover:border-[#2DD4BF]/35")}><div className="flex items-start justify-between gap-2"><span className="min-w-0 break-words text-xs font-semibold text-foreground">{template.workflow.name}</span><span className="shrink-0 text-[9px] uppercase text-[#2DD4BF]">{template.workflow.target}</span></div><p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{template.workflow.description}</p><div className="mt-2 flex items-center justify-between text-[9px] text-muted-foreground"><span>@{template.owner.username}</span><span>★ {template.ratingAverage || "--"} · ↓ {template.installCount}</span></div></button>)}{teamLoading ? <div className="flex items-center justify-center py-12 text-xs text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />连接团队目录</div> : null}{!teamLoading && !teamTemplates.length ? <EmptyState icon={Network} title="没有匹配的模板" detail="调整筛选，或发布第一条自定义工作流。" /> : null}</div></div>
              <div className="min-w-0">{selectedTeam ? <><div className="border-b border-border pb-4"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#5B7CFF]/35 bg-[#5B7CFF]/8"><Network className="h-5 w-5 text-[#5B7CFF]" /></div><div className="min-w-0"><h3 className="break-words text-lg font-semibold text-foreground">{selectedTeam.workflow.name}</h3><p className="mt-1 text-xs text-muted-foreground">{selectedTeam.workflow.category} · @{selectedTeam.owner.username} · {formatDate(selectedTeam.updatedAt)}</p></div></div><p className="mt-3 text-sm leading-6 text-muted-foreground">{selectedTeam.workflow.description}</p>{selectedTeam.releaseNotes ? <div className="mt-3 border-l-2 border-[#FBBF24] bg-[#FBBF24]/5 px-3 py-2 text-xs leading-5 text-muted-foreground">{selectedTeam.releaseNotes}</div> : null}</div><div className="mt-4 grid grid-cols-3 gap-px bg-border text-center">{[[selectedTeam.workflow.fields.length, "VARIABLES"], [selectedTeam.workflow.steps.length, "NODES"], [selectedTeam.workflow.promptTemplate.length, "CHARS"]].map(([value, label]) => <div key={String(label)} className="bg-background/70 p-3"><strong className="block text-base text-foreground">{value}</strong><span className="text-[9px] text-muted-foreground">{label}</span></div>)}</div><div className="mt-4"><h4 className="text-xs font-semibold text-foreground">执行节点</h4><div className="mt-2 grid gap-2 sm:grid-cols-2">{selectedTeam.workflow.steps.map((step, index) => <div key={step.id} className="border border-border bg-background/35 p-2.5"><div className="text-[10px] text-[#2DD4BF]">NODE {String(index + 1).padStart(2, "0")}</div><div className="mt-1 text-xs font-medium text-foreground">{step.title}</div><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{step.description}</p></div>)}</div></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" className={miniButton} onClick={() => void installSelectedTeamTemplate()}><Download className="h-3.5 w-3.5" />安装到工作流</button><button type="button" className={miniButton} onClick={() => copyText(selectedTeam.workflow.promptTemplate, "Prompt 模板已复制")}><Copy className="h-3.5 w-3.5" />复制 Prompt</button>{selectedTeam.owner.id === user.id || user.role === "admin" ? <button type="button" className={cn(miniButton, "text-red-500")} onClick={() => void removeTeamTemplate()}><Trash2 className="h-3.5 w-3.5" />下架</button> : null}</div><div className="mt-5 border-t border-border pt-4"><div className="flex items-center justify-between"><h4 className="text-xs font-semibold text-foreground">团队反馈</h4><div className="flex items-center gap-0.5" aria-label="模板评分">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" title={`${value} 分`} onClick={() => void submitRating(value)} className="p-1 text-muted-foreground hover:text-[#FBBF24]"><Star className={cn("h-3.5 w-3.5", (selectedTeam.myRating ?? 0) >= value && "fill-[#FBBF24] text-[#FBBF24]")} /></button>)}</div></div><div className="mt-3 flex gap-2"><input className={inputClass} value={teamComment} maxLength={500} onChange={(event) => setTeamComment(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void submitTeamComment(); }} placeholder="留下使用建议或适用场景" /><button type="button" className={miniButton} title="发送评论" onClick={() => void submitTeamComment()}><Send className="h-3.5 w-3.5" /></button></div><div className="mt-3 max-h-44 space-y-2 overflow-auto">{selectedTeam.comments.slice().reverse().map((comment) => <div key={comment.id} className="border-l border-[#5B7CFF]/40 pl-3 text-xs"><div className="text-[10px] text-muted-foreground">@{comment.username} · {formatDate(comment.createdAt)}</div><p className="mt-1 break-words leading-5 text-foreground">{comment.body}</p></div>)}{!selectedTeam.comments.length ? <p className="py-3 text-center text-xs text-muted-foreground">暂无评论</p> : null}</div></div></> : <EmptyState icon={Network} title="选择一条团队模板" detail="查看节点结构、反馈和安装信息。" />}</div>
              <aside className="border-t border-border pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0"><h3 className="text-xs font-semibold text-foreground">发布自定义工作流</h3><p className="mt-1 text-[11px] leading-5 text-muted-foreground">相同账号和源工作流再次发布会更新版本，并保留评分与评论。</p><label className="mt-3 block text-xs text-muted-foreground">本地工作流<select className={cn(inputClass, "mt-1")} value={publishWorkflowId} onChange={(event) => setPublishWorkflowId(event.target.value)}><option value="">请选择</option>{customWorkflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select></label><label className="mt-3 block text-xs text-muted-foreground">版本说明<textarea className={cn(textareaClass, "mt-1 min-h-24")} value={releaseNotes} maxLength={600} onChange={(event) => setReleaseNotes(event.target.value)} placeholder="适用场景、主要改动或使用提示" /></label><button type="button" className={cn(miniButton, "mt-3 w-full border-[#5B7CFF]/45 bg-[#5B7CFF]/10")} onClick={() => void publishSelectedWorkflow()}><Rocket className="h-3.5 w-3.5" />发布或更新</button>{!customWorkflows.length ? <p className="mt-3 text-[10px] leading-4 text-muted-foreground">请先在工作流实验室创建或复制一条自定义工作流。</p> : null}</aside>
            </div>}
          </section>
        ) : null}

        {activeTab === "memory" ? (
          <section className="glass-panel rounded-lg p-4 sm:p-5">
            <SectionTitle icon={Film} eyebrow="MEMORY FILM" title="记忆胶片" description="从本地项目、Artifact 和灵感元数据重组时间线，找回未完成线索。内容仅在当前账号的浏览器空间内分析。" actions={<button type="button" className={miniButton} onClick={() => setMemorySignals(makeMemorySignals(studio))}><RefreshCw className="h-3.5 w-3.5" />重新扫描</button>} />
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]"><div className="relative min-w-0 pl-6 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-border">{memorySignals.map((signal) => <button key={signal.id} type="button" onClick={() => { if (signal.kind === "project") { setSelectedProjectId(signal.id.replace("memory-", "")); setActiveTab("projects"); } else if (signal.kind === "artifact") { flushArtifactDraft(); setSelectedArtifactId(signal.id.replace("memory-", "")); setActiveTab("artifacts"); } }} className="group relative mb-3 w-full rounded-md border border-border bg-background/35 p-3 text-left transition hover:border-[#2DD4BF]/35"><span className={cn("absolute -left-[23px] top-4 h-2.5 w-2.5 border-2 border-background", signal.unfinished ? "bg-[#FBBF24]" : "bg-[#2DD4BF]")} /><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold text-foreground">{signal.title}</span><span className="text-[9px] uppercase text-muted-foreground">{signal.kind} · {formatDate(signal.timestamp)}</span></div><p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{signal.detail}</p></button>)}{!memorySignals.length ? <EmptyState icon={Film} title="没有可回放的片段" detail="开始创建项目、Artifact 或灵感后，时间线会自动出现。" /> : null}</div><aside className="space-y-3"><div className="border border-border bg-background/35 p-4"><div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Radar className="h-3.5 w-3.5 text-[#FBBF24]" />未完成线索</div><div className="mt-3 text-3xl font-semibold tabular-nums text-foreground">{memorySignals.filter((item) => item.unfinished).length}</div><p className="mt-1 text-xs text-muted-foreground">包含推进中的项目、待办标记和保存的灵感。</p></div><div className="border border-border bg-background/35 p-4"><h3 className="text-xs font-semibold text-foreground">下一段建议</h3><div className="mt-3 space-y-2">{memorySignals.filter((item) => item.unfinished).slice(0, 4).map((signal, index) => <div key={signal.id} className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center bg-[#5B7CFF]/12 text-[9px] text-[#5B7CFF]">{index + 1}</span><span>继续推进「{signal.title}」：{signal.detail}</span></div>)}{!memorySignals.some((item) => item.unfinished) ? <p className="text-xs text-muted-foreground">当前没有明显未完成线索，可以从已完成项目提炼团队模板。</p> : null}</div></div><div className="border border-[#2DD4BF]/25 bg-[#2DD4BF]/5 p-4"><div className="text-[10px] font-semibold uppercase text-[#2DD4BF]">LOCAL ONLY</div><p className="mt-2 text-xs leading-5 text-muted-foreground">记忆扫描不会上传 Artifact 正文。账号切换后会重新读取对应空间，不会混用其他账号记录。</p></div></aside></div>
          </section>
        ) : null}
      </div>
    </PageShell>
  );
}

function OverviewPanel({ studio, activeProject, onTab, onAddProject, onAddArtifact }: { studio: StudioState; activeProject: StudioProject | null; onTab: (tab: StudioTab) => void; onAddProject: () => void; onAddArtifact: () => void }) {
  const incomplete = studio.projects.filter((item) => item.status !== "done").length;
  const latestArtifacts = studio.artifacts.slice().sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)).slice(0, 4);
  const quickActions: Array<{ label: string; detail: string; icon: LucideIcon; tab: StudioTab; action?: () => void }> = [
    { label: "建立项目坐标", detail: "固定目标、上下文与工作流关系", icon: FolderKanban, tab: "projects", action: onAddProject },
    { label: "开启 Artifact", detail: "承接回答并启用自动本地版本", icon: Layers3, tab: "artifacts", action: onAddArtifact },
    { label: "运行 Prompt 体检", detail: "定位缺失、冲突与敏感字段", icon: BrainCircuit, tab: "prompt" },
    { label: "评测工作流", detail: "快照、差异与测试样例批测", icon: Beaker, tab: "evaluation" }
  ];
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
      <section className="glass-panel rounded-lg p-4 sm:p-5"><SectionTitle icon={Radar} eyebrow="MISSION CONTROL" title={activeProject ? activeProject.name : "建立第一个创作坐标"} description={activeProject?.objective || "项目会把散落的工作流、上下文与产出组织成可继续推进的任务空间。"} actions={activeProject ? <button type="button" className={miniButton} onClick={() => onTab("projects")}><Pencil className="h-3.5 w-3.5" />编辑项目</button> : undefined} />
        {activeProject ? <div className="mt-5"><div className="grid gap-3 sm:grid-cols-3">{[[statusMeta[activeProject.status].label, "STATUS"], [activeProject.workflowIds.length, "WORKFLOWS"], [studio.artifacts.filter((item) => item.projectId === activeProject.id).length, "ARTIFACTS"]].map(([value, label]) => <div key={String(label)} className="border border-border bg-background/35 p-3"><div className="text-lg font-semibold text-foreground">{value}</div><div className="mt-1 text-[9px] text-muted-foreground">{label}</div></div>)}</div><div className="mt-4 border-l-2 border-[#FBBF24] bg-[#FBBF24]/5 px-3 py-2"><div className="text-[9px] font-semibold text-[#FBBF24]">PINNED CONTEXT</div><p className="mt-1 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{activeProject.pinnedContext || "尚未固定上下文。补充稳定事实和边界，让工作流不用每次从零理解。"}</p></div></div> : <div className="mt-5"><EmptyState icon={FolderKanban} title="当前没有活跃项目" detail="创建一个项目，为后续创作建立可持续的上下文。" action={<button type="button" className={miniButton} onClick={onAddProject}><Plus className="h-3.5 w-3.5" />新建项目</button>} /></div>}
      </section>
      <section className="glass-panel rounded-lg p-4 sm:p-5"><SectionTitle icon={Activity} eyebrow="LIVE SIGNALS" title="创作信号" description="当前账号空间的进度与近期产出。" /><div className="mt-4 grid grid-cols-2 gap-px bg-border"><div className="bg-background/60 p-4"><div className="text-2xl font-semibold text-foreground">{incomplete}</div><div className="mt-1 text-[9px] text-muted-foreground">OPEN PROJECTS</div></div><div className="bg-background/60 p-4"><div className="text-2xl font-semibold text-foreground">{studio.artifacts.reduce((sum, item) => sum + item.versions.length, 0)}</div><div className="mt-1 text-[9px] text-muted-foreground">LOCAL VERSIONS</div></div></div><div className="mt-4 space-y-2">{latestArtifacts.map((artifact) => { const Icon = artifactMeta[artifact.type].icon; return <button key={artifact.id} type="button" onClick={() => onTab("artifacts")} className="flex w-full items-center gap-3 rounded-md border border-border bg-background/35 p-2.5 text-left hover:border-[#2DD4BF]/35"><Icon className="h-4 w-4 shrink-0 text-[#2DD4BF]" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium text-foreground">{artifact.title}</div><div className="mt-0.5 text-[9px] text-muted-foreground">{artifact.versions.length} versions · {formatDate(artifact.updatedAt)}</div></div><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></button>; })}{!latestArtifacts.length ? <p className="py-8 text-center text-xs text-muted-foreground">暂无 Artifact 信号</p> : null}</div></section>
      <section className="glass-panel rounded-lg p-4 sm:p-5 xl:col-span-2"><SectionTitle icon={Sparkles} eyebrow="QUICK ROUTES" title="创作路由" description="选择下一步动作，中枢会把你送到对应工具面板。" /><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{quickActions.map((item, index) => { const Icon = item.icon; return <button key={item.label} type="button" onClick={() => item.action ? item.action() : onTab(item.tab)} className="group min-h-28 rounded-md border border-border bg-background/35 p-3 text-left transition hover:border-[#5B7CFF]/45 hover:bg-[#5B7CFF]/5"><div className="flex items-center justify-between"><span className="text-[9px] tabular-nums text-[#2DD4BF]">ROUTE {String(index + 1).padStart(2, "0")}</span><Icon className="h-4 w-4 text-[#5B7CFF] transition group-hover:text-[#2DD4BF]" /></div><div className="mt-4 text-sm font-semibold text-foreground">{item.label}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p></button>; })}</div></section>
    </div>
  );
}
