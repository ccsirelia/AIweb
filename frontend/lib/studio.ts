import { getStoredUser } from "@/lib/api";
import {
  compileWorkflow,
  type WorkflowTemplate,
  type WorkflowValues
} from "@/lib/workflows";

export type ProjectStatus = "idea" | "active" | "blocked" | "done";
export type ArtifactType = "document" | "code" | "table" | "brief";

export interface StudioProject {
  id: string;
  name: string;
  objective: string;
  status: ProjectStatus;
  pinnedContext: string;
  workflowIds: string[];
  artifactIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactVersion {
  id: string;
  content: string;
  reason: "created" | "autosave" | "rollback" | "manual";
  createdAt: string;
}

export interface StudioArtifact {
  id: string;
  projectId: string | null;
  title: string;
  type: ArtifactType;
  content: string;
  language?: string;
  source?: string;
  versions: ArtifactVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface BrandKit {
  id: string;
  name: string;
  colors: string[];
  tone: string;
  audience: string;
  productFacts: string;
  forbiddenWords: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowSnapshot {
  id: string;
  workflowId: string;
  label: string;
  workflow: WorkflowTemplate;
  createdAt: string;
}

export interface WorkflowTestCase {
  id: string;
  workflowId: string;
  name: string;
  values: WorkflowValues;
  expectedKeywords: string[];
  createdAt: string;
}

export interface WorkflowEvaluation {
  id: string;
  workflowId: string;
  testCaseId: string;
  testCaseName: string;
  score: number;
  checks: Array<{ label: string; passed: boolean; detail: string }>;
  createdAt: string;
}

export interface StudioState {
  version: 1;
  projects: StudioProject[];
  artifacts: StudioArtifact[];
  brandKits: BrandKit[];
  workflowSnapshots: WorkflowSnapshot[];
  workflowTests: WorkflowTestCase[];
  evaluations: WorkflowEvaluation[];
  activeProjectId: string | null;
  activeBrandKitId: string | null;
}

export interface ArtifactCreateDetail {
  title?: string;
  content: string;
  type?: ArtifactType;
  projectId?: string | null;
  language?: string;
  source?: string;
  ownerId?: number | null;
}

export interface PromptFinding {
  id: string;
  severity: "critical" | "warning" | "info";
  category: "missing" | "ambiguity" | "conflict" | "privacy" | "structure";
  title: string;
  detail: string;
}

export interface PromptSegment {
  id: string;
  text: string;
  source: "workflow" | "variable" | "brand" | "user" | "instruction";
  label: string;
}

export interface PromptAudit {
  findings: PromptFinding[];
  segments: PromptSegment[];
  characters: number;
  estimatedTokens: number;
  estimatedInputCostUsd: number;
  score: number;
}

export interface MemorySignal {
  id: string;
  kind: "project" | "artifact" | "inspiration";
  title: string;
  detail: string;
  timestamp: string;
  unfinished: boolean;
}

export const STUDIO_STORAGE_KEY = "aiweb:creator-studio:v1";
export const STUDIO_CHANGED_EVENT = "aiweb:creator-studio-changed";
export const ARTIFACT_CREATE_EVENT = "aiweb:artifact-create";
export const PENDING_ARTIFACT_KEY = "aiweb:pending-artifact";

const MAX_PROJECTS = 80;
const MAX_ARTIFACTS = 160;
const MAX_ARTIFACT_VERSIONS = 30;
const MAX_BRAND_KITS = 24;
const MAX_WORKFLOW_SNAPSHOTS = 120;
const MAX_WORKFLOW_TESTS = 120;
const MAX_EVALUATIONS = 240;

export function createStudioId(prefix: string): string {
  if (typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function") {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function emptyStudioState(): StudioState {
  return {
    version: 1,
    projects: [],
    artifacts: [],
    brandKits: [],
    workflowSnapshots: [],
    workflowTests: [],
    evaluations: [],
    activeProjectId: null,
    activeBrandKitId: null
  };
}

export function getStudioStorageOwner(): string {
  const user = getStoredUser();
  return user && Number.isFinite(user.id) ? `user:${user.id}` : "guest";
}

export function getStudioStorageKey(): string {
  return `${STUDIO_STORAGE_KEY}:${getStudioStorageOwner()}`;
}

function text(value: unknown, max = 10000): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function date(value: unknown, fallback: string): string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

function stringList(value: unknown, maxItems: number, maxLength = 120): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, maxLength)).filter(Boolean))
  ).slice(0, maxItems);
}

function normalizeArtifactType(value: unknown): ArtifactType {
  return value === "code" || value === "table" || value === "brief" ? value : "document";
}

function normalizeProjectStatus(value: unknown): ProjectStatus {
  return value === "idea" || value === "blocked" || value === "done" ? value : "active";
}

function isStoredWorkflowSnapshot(value: unknown): value is WorkflowSnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WorkflowSnapshot>;
  const workflow = item.workflow as Partial<WorkflowTemplate> | undefined;
  return Boolean(
    typeof item.id === "string" &&
    typeof item.workflowId === "string" &&
    typeof item.label === "string" &&
    typeof item.createdAt === "string" &&
    workflow &&
    typeof workflow.id === "string" &&
    typeof workflow.name === "string" &&
    typeof workflow.category === "string" &&
    typeof workflow.description === "string" &&
    (workflow.target === "chat" || workflow.target === "image") &&
    Array.isArray(workflow.fields) &&
    Array.isArray(workflow.steps) &&
    typeof workflow.promptTemplate === "string"
  );
}

function isStoredWorkflowTest(value: unknown): value is WorkflowTestCase {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WorkflowTestCase>;
  return Boolean(
    typeof item.id === "string" &&
    typeof item.workflowId === "string" &&
    typeof item.name === "string" &&
    item.values &&
    typeof item.values === "object" &&
    !Array.isArray(item.values) &&
    Array.isArray(item.expectedKeywords) &&
    typeof item.createdAt === "string"
  );
}

function isStoredEvaluation(value: unknown): value is WorkflowEvaluation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WorkflowEvaluation>;
  return Boolean(
    typeof item.id === "string" &&
    typeof item.workflowId === "string" &&
    typeof item.testCaseId === "string" &&
    typeof item.testCaseName === "string" &&
    typeof item.score === "number" &&
    Number.isFinite(item.score) &&
    Array.isArray(item.checks) &&
    item.checks.every((check) => check && typeof check.label === "string" && typeof check.passed === "boolean" && typeof check.detail === "string") &&
    typeof item.createdAt === "string"
  );
}

function normalizeStudioState(value: unknown): StudioState {
  if (!value || typeof value !== "object") return emptyStudioState();
  const raw = value as Partial<StudioState>;
  const now = new Date().toISOString();

  const projects = Array.isArray(raw.projects)
    ? raw.projects.slice(0, MAX_PROJECTS).flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const item = value as Partial<StudioProject>;
        const id = text(item.id, 120);
        const name = text(item.name, 100).trim();
        if (!id || !name) return [];
        const createdAt = date(item.createdAt, now);
        return [{
          id,
          name,
          objective: text(item.objective, 4000),
          status: normalizeProjectStatus(item.status),
          pinnedContext: text(item.pinnedContext, 12000),
          workflowIds: stringList(item.workflowIds, 40),
          artifactIds: stringList(item.artifactIds, 160),
          createdAt,
          updatedAt: date(item.updatedAt, createdAt)
        } satisfies StudioProject];
      })
    : [];

  const projectIds = new Set(projects.map((item) => item.id));
  const artifacts = Array.isArray(raw.artifacts)
    ? raw.artifacts.slice(0, MAX_ARTIFACTS).flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const item = value as Partial<StudioArtifact>;
        const id = text(item.id, 120);
        const title = text(item.title, 140).trim();
        if (!id || !title) return [];
        const createdAt = date(item.createdAt, now);
        const versions = Array.isArray(item.versions)
          ? item.versions.slice(-MAX_ARTIFACT_VERSIONS).flatMap((versionValue) => {
              if (!versionValue || typeof versionValue !== "object") return [];
              const version = versionValue as Partial<ArtifactVersion>;
              const versionId = text(version.id, 120);
              if (!versionId) return [];
              return [{
                id: versionId,
                content: text(version.content, 120000),
                reason: version.reason === "created" || version.reason === "rollback" || version.reason === "manual" ? version.reason : "autosave",
                createdAt: date(version.createdAt, createdAt)
              } satisfies ArtifactVersion];
            })
          : [];
        return [{
          id,
          projectId: typeof item.projectId === "string" && projectIds.has(item.projectId) ? item.projectId : null,
          title,
          type: normalizeArtifactType(item.type),
          content: text(item.content, 120000),
          language: text(item.language, 40) || undefined,
          source: text(item.source, 120) || undefined,
          versions,
          createdAt,
          updatedAt: date(item.updatedAt, createdAt)
        } satisfies StudioArtifact];
      })
    : [];

  const brandKits = Array.isArray(raw.brandKits)
    ? raw.brandKits.slice(0, MAX_BRAND_KITS).flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const item = value as Partial<BrandKit>;
        const id = text(item.id, 120);
        const name = text(item.name, 100).trim();
        if (!id || !name) return [];
        const createdAt = date(item.createdAt, now);
        return [{
          id,
          name,
          colors: stringList(item.colors, 8, 20).filter((color) => /^#[0-9a-f]{6}$/i.test(color)),
          tone: text(item.tone, 1000),
          audience: text(item.audience, 2000),
          productFacts: text(item.productFacts, 8000),
          forbiddenWords: text(item.forbiddenWords, 2000),
          createdAt,
          updatedAt: date(item.updatedAt, createdAt)
        } satisfies BrandKit];
      })
    : [];

  const workflowSnapshots = Array.isArray(raw.workflowSnapshots)
    ? raw.workflowSnapshots.slice(0, MAX_WORKFLOW_SNAPSHOTS).filter(isStoredWorkflowSnapshot)
    : [];
  const workflowTests = Array.isArray(raw.workflowTests)
    ? raw.workflowTests.slice(0, MAX_WORKFLOW_TESTS).filter(isStoredWorkflowTest)
    : [];
  const evaluations = Array.isArray(raw.evaluations)
    ? raw.evaluations.slice(0, MAX_EVALUATIONS).filter(isStoredEvaluation)
    : [];

  return {
    version: 1,
    projects,
    artifacts,
    brandKits,
    workflowSnapshots,
    workflowTests,
    evaluations,
    activeProjectId: typeof raw.activeProjectId === "string" && projectIds.has(raw.activeProjectId) ? raw.activeProjectId : null,
    activeBrandKitId: typeof raw.activeBrandKitId === "string" && brandKits.some((item) => item.id === raw.activeBrandKitId) ? raw.activeBrandKitId : null
  };
}

export function loadStudioState(): StudioState {
  if (typeof window === "undefined") return emptyStudioState();
  try {
    return normalizeStudioState(JSON.parse(window.localStorage.getItem(getStudioStorageKey()) ?? "null") as unknown);
  } catch {
    return emptyStudioState();
  }
}

export function saveStudioState(state: StudioState): StudioState {
  const normalized = normalizeStudioState(state);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(getStudioStorageKey(), JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent(STUDIO_CHANGED_EVENT, { detail: normalized }));
  }
  return normalized;
}

export function createProject(name = "未命名项目"): StudioProject {
  const now = new Date().toISOString();
  return {
    id: createStudioId("project"),
    name,
    objective: "",
    status: "active",
    pinnedContext: "",
    workflowIds: [],
    artifactIds: [],
    createdAt: now,
    updatedAt: now
  };
}

export function createArtifact(detail: ArtifactCreateDetail): StudioArtifact {
  const now = new Date().toISOString();
  const content = detail.content.slice(0, 120000);
  return {
    id: createStudioId("artifact"),
    projectId: detail.projectId ?? null,
    title: (detail.title?.trim() || defaultArtifactTitle(detail.type)).slice(0, 140),
    type: normalizeArtifactType(detail.type),
    content,
    language: detail.language?.slice(0, 40),
    source: detail.source?.slice(0, 120),
    versions: [{ id: createStudioId("version"), content, reason: "created", createdAt: now }],
    createdAt: now,
    updatedAt: now
  };
}

function defaultArtifactTitle(type: ArtifactType | undefined): string {
  if (type === "code") return "代码草稿";
  if (type === "table") return "数据表格";
  if (type === "brief") return "创意 Brief";
  return "创作文档";
}

export function createBrandKit(): BrandKit {
  const now = new Date().toISOString();
  return {
    id: createStudioId("brand"),
    name: "新品牌套件",
    colors: ["#5B7CFF", "#2DD4BF", "#F8FAFC"],
    tone: "专业、克制、清晰，避免空泛营销表达",
    audience: "",
    productFacts: "",
    forbiddenWords: "赋能、颠覆、遥遥领先",
    createdAt: now,
    updatedAt: now
  };
}

export function buildBrandContext(brand: BrandKit): string {
  return `[BRAND CONTEXT · ${brand.name}]
品牌色：${brand.colors.join(" / ") || "未指定"}
表达语气：${brand.tone || "未指定"}
核心受众：${brand.audience || "未指定"}
产品事实：${brand.productFacts || "未指定"}
禁用表达：${brand.forbiddenWords || "无"}

请把以上内容作为硬性品牌约束。事实不足时标记待确认，不得自行补造。`;
}

function addFinding(
  findings: PromptFinding[],
  severity: PromptFinding["severity"],
  category: PromptFinding["category"],
  title: string,
  detail: string
): void {
  findings.push({ id: `${category}-${findings.length}`, severity, category, title, detail });
}

export function auditPrompt(prompt: string): PromptAudit {
  const findings: PromptFinding[] = [];
  const unresolved = Array.from(new Set(Array.from(prompt.matchAll(/{{\s*([^{}]+?)\s*}}/g), (match) => match[1].trim())));
  const pending = Array.from(new Set(Array.from(prompt.matchAll(/\[待补充[：:]([^\]]+)]/g), (match) => match[1].trim())));
  if (unresolved.length || pending.length) {
    addFinding(findings, "critical", "missing", "仍有未填变量", [...unresolved, ...pending].slice(0, 8).join("、"));
  }

  const vagueWords = ["适当", "尽量", "高质量", "详细一些", "更好", "高级感", "丰富", "专业一点", "自由发挥"];
  const detectedVague = vagueWords.filter((word) => prompt.includes(word));
  if (detectedVague.length) {
    addFinding(findings, "warning", "ambiguity", "存在不可验证的模糊要求", `建议为 ${detectedVague.join("、")} 补充示例、阈值或验收标准。`);
  }

  const conflictPairs: Array<[RegExp, RegExp, string]> = [
    [/简短|精简|一句话/, /详细|全面|长文|深入/, "篇幅要求同时包含精简与详细"],
    [/不要解释|只给结果/, /说明原因|推理过程|逐步解释/, "输出过程要求相互冲突"],
    [/严格遵循|不得修改/, /自由发挥|大胆创新/, "约束强度与创作自由度冲突"]
  ];
  for (const [left, right, detail] of conflictPairs) {
    if (left.test(prompt) && right.test(prompt)) addFinding(findings, "warning", "conflict", "检测到潜在冲突", detail);
  }

  const privacyPatterns: Array<[RegExp, string]> = [
    [/(api[_ -]?key|secret|token|密码|口令)\s*[:：=]\s*\S{6,}/i, "密钥或密码"],
    [/\b1[3-9]\d{9}\b/, "手机号码"],
    [/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i, "电子邮箱"],
    [/\b\d{17}[\dXx]\b/, "身份证号"]
  ];
  const privacyHits = privacyPatterns.filter(([pattern]) => pattern.test(prompt)).map(([, label]) => label);
  if (privacyHits.length) {
    addFinding(findings, "critical", "privacy", "可能包含敏感字段", `发现${privacyHits.join("、")}，发送前应脱敏或使用占位符。`);
  }

  if (prompt.trim() && !/(输出|交付|格式|结构|返回|请按)/.test(prompt)) {
    addFinding(findings, "info", "structure", "缺少明确交付格式", "补充输出结构、字段或示例可减少结果漂移。" );
  }
  if (prompt.trim() && !/(目标|目的|用于|受众|读者|用户)/.test(prompt)) {
    addFinding(findings, "info", "structure", "任务目标或受众不够明确", "说明结果给谁使用、希望促成什么行动。" );
  }

  const cjkCount = (prompt.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latinWords = (prompt.replace(/[\u3400-\u9fff]/g, " ").match(/[\w'-]+/g) ?? []).length;
  const estimatedTokens = Math.max(0, Math.ceil(cjkCount * 0.72 + latinWords * 1.28 + (prompt.length - cjkCount) * 0.08));
  const estimatedInputCostUsd = estimatedTokens * 5 / 1_000_000;
  if (prompt.length > 4000) addFinding(findings, "warning", "structure", "Prompt 较长", "已超过当前对话通道的 4000 字符参考上限。" );

  const scorePenalty = findings.reduce((sum, item) => sum + (item.severity === "critical" ? 24 : item.severity === "warning" ? 12 : 5), 0);
  return {
    findings,
    segments: segmentPrompt(prompt),
    characters: prompt.length,
    estimatedTokens,
    estimatedInputCostUsd,
    score: prompt.trim() ? Math.max(0, 100 - scorePenalty) : 0
  };
}

export function segmentPrompt(prompt: string): PromptSegment[] {
  if (!prompt) return [];
  return prompt.split(/(\{\{\s*[^{}]+?\s*}}|\[待补充[：:][^\]]+]|\[BRAND CONTEXT[^\]]*])/g).flatMap((part, index) => {
    if (!part) return [];
    let source: PromptSegment["source"] = "instruction";
    let label = "模板指令";
    if (/^\{\{|^\[待补充/.test(part)) {
      source = "variable";
      label = "变量槽位";
    } else if (/^\[BRAND CONTEXT/.test(part) || /品牌色：|表达语气：|核心受众：|产品事实：|禁用表达：/.test(part)) {
      source = "brand";
      label = "品牌套件";
    } else if (/AIWeb Workflow|任务通道：|执行计划：/.test(part)) {
      source = "workflow";
      label = "工作流骨架";
    } else if (/用户输入|原始内容|素材：|主题：/.test(part)) {
      source = "user";
      label = "用户上下文";
    }
    return [{ id: `segment-${index}`, text: part, source, label }];
  });
}

export function workflowDiff(snapshot: WorkflowTemplate, current: WorkflowTemplate): string[] {
  const changes: string[] = [];
  if (snapshot.name !== current.name) changes.push(`名称：${snapshot.name} → ${current.name}`);
  if (snapshot.category !== current.category) changes.push(`分类：${snapshot.category} → ${current.category}`);
  if (snapshot.target !== current.target) changes.push(`通道：${snapshot.target} → ${current.target}`);
  if (snapshot.fields.length !== current.fields.length) changes.push(`变量：${snapshot.fields.length} → ${current.fields.length}`);
  if (snapshot.steps.length !== current.steps.length) changes.push(`节点：${snapshot.steps.length} → ${current.steps.length}`);
  if (snapshot.promptTemplate !== current.promptTemplate) {
    changes.push(`Prompt：${snapshot.promptTemplate.length} → ${current.promptTemplate.length} 字符`);
  }
  if (snapshot.description !== current.description) changes.push("说明已更新");
  return changes;
}

export function evaluateWorkflow(workflow: WorkflowTemplate, testCase: WorkflowTestCase): WorkflowEvaluation {
  const compiled = compileWorkflow(workflow, testCase.values);
  const missing = workflow.fields.filter((field) => field.required && !testCase.values[field.key]?.trim());
  const keywordHits = testCase.expectedKeywords.filter((keyword) => compiled.toLowerCase().includes(keyword.toLowerCase()));
  const unresolved = /\{\{|\[待补充/.test(compiled);
  const hasStructure = workflow.steps.length >= 3 && workflow.promptTemplate.length >= 160;
  const checks = [
    { label: "必填变量", passed: missing.length === 0, detail: missing.length ? `缺少 ${missing.map((item) => item.label).join("、")}` : "已全部提供" },
    { label: "期望信号", passed: !testCase.expectedKeywords.length || keywordHits.length === testCase.expectedKeywords.length, detail: `${keywordHits.length}/${testCase.expectedKeywords.length || 0} 命中` },
    { label: "编译完整性", passed: !unresolved, detail: unresolved ? "仍存在未解析槽位" : "无残留槽位" },
    { label: "任务结构", passed: hasStructure, detail: `${workflow.steps.length} 节点 · ${workflow.promptTemplate.length} 字符` }
  ];
  const weights = [35, 30, 20, 15];
  const score = checks.reduce((sum, check, index) => sum + (check.passed ? weights[index] : 0), 0);
  return {
    id: createStudioId("evaluation"),
    workflowId: workflow.id,
    testCaseId: testCase.id,
    testCaseName: testCase.name,
    score,
    checks,
    createdAt: new Date().toISOString()
  };
}

export function downloadTextFile(filename: string, content: string, type = "text/plain;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function queueArtifactCreation(detail: ArtifactCreateDetail): void {
  if (typeof window === "undefined") return;
  const payload = { ...detail, ownerId: getStoredUser()?.id ?? null };
  window.sessionStorage.setItem(PENDING_ARTIFACT_KEY, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent<ArtifactCreateDetail>(ARTIFACT_CREATE_EVENT, { detail: payload }));
}

export function readPendingArtifact(): ArtifactCreateDetail | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(PENDING_ARTIFACT_KEY);
  if (!raw) return null;
  window.sessionStorage.removeItem(PENDING_ARTIFACT_KEY);
  try {
    const parsed = JSON.parse(raw) as Partial<ArtifactCreateDetail>;
    if ((parsed.ownerId ?? null) !== (getStoredUser()?.id ?? null)) return null;
    if (typeof parsed.content !== "string" || !parsed.content.trim()) return null;
    return {
      title: text(parsed.title, 140) || undefined,
      content: text(parsed.content, 120000),
      type: normalizeArtifactType(parsed.type),
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : null,
      language: text(parsed.language, 40) || undefined,
      source: text(parsed.source, 120) || undefined
    };
  } catch {
    return null;
  }
}
