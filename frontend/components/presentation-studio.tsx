"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  BookOpen,
  BriefcaseBusiness,
  Cpu,
  Download,
  FileArchive,
  FileText,
  Layers3,
  Loader2,
  Megaphone,
  Presentation,
  RefreshCcw,
  Sparkles,
  Target,
  Trash2,
  Upload,
  UsersRound,
  X
} from "lucide-react";
import { toast } from "sonner";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  createPresentationJob,
  deletePresentationJob,
  downloadPresentation,
  getAuthToken,
  getChatModels,
  getPresentationCatalog,
  getPresentationJobs,
  retryPresentationJob,
  type ChatModel,
  type PresentationCatalog,
  type PresentationJob,
  type Provider
} from "@/lib/api";
import { cn } from "@/lib/utils";

const PRESENTATION_PROVIDER_KEY = "aiweb_presentation_provider";
const PRESENTATION_MODEL_KEY_PREFIX = "aiweb_presentation_model_";
const MAX_REFERENCE_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_TEMPLATE_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_UPLOAD_BYTES = 125 * 1024 * 1024;
const MAX_PRESENTATION_ASSETS = 8;
const providers: { label: string; value: Provider }[] = [
  { label: "OpenAI", value: "openai" },
  { label: "Grok", value: "grok" }
];

const fallbackCatalog: PresentationCatalog = {
  skill: { id: "ppt-master", version: "4.8.0", installed: true, source: "project-local" },
  modes: [
    { id: "pyramid", label: "结论金字塔", description: "先给判断，再用证据支持决策。" },
    { id: "narrative", label: "叙事推进", description: "情境、张力、转折与解决方案。" },
    { id: "instructional", label: "教学拆解", description: "按步骤建立理解，适合培训与方法论。" },
    { id: "showcase", label: "视觉发布", description: "大标题、大数字与强节奏展示。" },
    { id: "briefing", label: "信息简报", description: "中性、完整、适合会议资料查阅。" }
  ],
  styles: [
    { id: "random", label: "智能随机", description: "根据提示词、资料和模板自动选择最合适的视觉方向。" },
    { id: "state-briefing", label: "国企蓝白", description: "白底、机场蓝、顶部章节条与克制的信息层级，适合正式汇报。" },
    { id: "aviation-blue", label: "机场专项蓝", description: "白底与机场蓝、编号章、图纸或现场照片证据，适合项目与外包专项汇报。" },
    { id: "aqua-planning", label: "浅青年度规划", description: "浅青底、轻量章节号与阶段控件，适合年度计划、部署和成果展望。" },
    { id: "security-report", label: "安护年度深蓝", description: "深蓝章节、浅色数据页与硬朗标签，适合安全、安保和年度总结。" },
    { id: "dark-tech", label: "暗夜科技", description: "深色底、光感线条、几何节点。" },
    { id: "swiss-minimal", label: "瑞士极简", description: "网格、留白与极少装饰。" },
    { id: "glassmorphism", label: "玻璃拟态", description: "半透明面板、光晕与悬浮层次。" },
    { id: "data-journalism", label: "数据新闻", description: "数据密度、侧栏与出版物规则线。" },
    { id: "editorial", label: "杂志社论", description: "杂志栏目、眉题、引文与层级。" },
    { id: "blueprint", label: "工程蓝图", description: "工程图、标注线与技术图纸语言。" },
    { id: "ink-notes", label: "墨迹笔记", description: "手绘线条、概念圈与克制批注。" },
    { id: "photo-editorial", label: "摄影社论", description: "图片主导、标题与图注辅助。" },
    { id: "soft-rounded", label: "柔和圆角", description: "柔和卡片、轻量层次与亲和节奏。" },
    { id: "vivid-launch", label: "鲜明发布", description: "高对比色块、发布会气氛与动势。" }
  ],
  features: [
    { id: "assertion_titles", label: "结论式标题", description: "把页标题写成可直接汇报的判断。" },
    { id: "kicker_summary", label: "小标题 + 页面总结", description: "每页增加眉题、结论带和一句话总结。" },
    { id: "layout_variety", label: "多版式轮换", description: "在观点、对比、指标、流程、引文之间切换构图。" },
    { id: "visual_decor", label: "视觉装饰与控件", description: "按页面角色生成规则线、编号章、章节条、证据标签与克制装饰。" },
    { id: "metrics", label: "关键指标页", description: "把事实提炼成适合管理层快速扫描的数字。" },
    { id: "roadmap", label: "路线图页", description: "自动生成阶段、负责人和下一步动作的时间轴。" },
    { id: "comparison", label: "对比决策页", description: "把方案、现状或竞品放到同一判断框架。" },
    { id: "source_notes", label: "来源备注", description: "为资料页保留来源和可追溯说明。" },
    { id: "data_story", label: "数据叙事与图表", description: "从可核验数据选择柱状、折线、环形或原生图表。" },
    { id: "template_fidelity", label: "原生模板保真", description: "沿用上传 PPT 的母版、页眉、图片和表格槽位。" }
  ]
};

const workflows = [
  { id: "airport-outsourcing-report", title: "航站楼岗位外包", description: "范围、岗位、成本、市场与可行性", icon: BriefcaseBusiness, accent: "#005BAC", slides: 16, purpose: "向公司领导班子说明航站楼岗位外包边界、测算依据、市场证据与审议建议", mode: "pyramid" },
  { id: "annual-work-plan", title: "年度工作规划", description: "主线、举措、里程碑与预期成果", icon: Presentation, accent: "#32B8C7", slides: 14, purpose: "对齐年度工作主线、重点任务、时间安排和可衡量成果", mode: "briefing" },
  { id: "security-annual-review", title: "安护年度总结", description: "数据、举措、成效、问题与计划", icon: Target, accent: "#07569F", slides: 18, purpose: "向管理层复盘安检护卫年度成效、重点举措、存在问题和下一年度安排", mode: "briefing" },
  { id: "state-special-report", title: "专项工作汇报", description: "背景、进展、问题与请示事项", icon: BriefcaseBusiness, accent: "#00479D", slides: 12, purpose: "向公司领导班子汇报专项工作并推动关键事项决策", mode: "pyramid" },
  { id: "feasibility-study", title: "可研与立项", description: "必要性、方案、测算与风险", icon: FileArchive, accent: "#2B6F9F", slides: 16, purpose: "形成可供立项审议的必要性判断、方案比较和投资测算", mode: "briefing" },
  { id: "procurement-review", title: "采购评审", description: "需求、市场、控制价与建议", icon: Layers3, accent: "#397D75", slides: 14, purpose: "为采购或招标评审提供可追溯的需求依据、市场证据和决策建议", mode: "pyramid" },
  { id: "safety-briefing", title: "安全生产通报", description: "态势、事件、隐患与整改闭环", icon: Target, accent: "#B45309", slides: 12, purpose: "帮助管理层掌握安全态势、重大隐患和整改责任闭环", mode: "briefing" },
  { id: "operations-analysis", title: "经营分析会", description: "指标、偏差、归因与行动", icon: FileArchive, accent: "#147D87", slides: 15, purpose: "用可核验数据解释经营偏差并明确下一阶段经营动作", mode: "pyramid" },
  { id: "rectification-report", title: "检查整改报告", description: "发现、原因、措施与销号", icon: Presentation, accent: "#7C5C26", slides: 10, purpose: "汇报检查发现、根因分析、整改措施和销号证据", mode: "briefing" },
  { id: "project-review", title: "项目汇报", description: "进展、风险、资源与下一步", icon: BriefcaseBusiness, accent: "#5B7CFF", slides: 8, purpose: "帮助决策者快速判断项目状态并给出资源支持", mode: "pyramid" },
  { id: "executive-briefing", title: "经营简报", description: "指标、变化、判断与动作", icon: Target, accent: "#2DD4BF", slides: 9, purpose: "让管理层在有限时间内完成判断", mode: "briefing" },
  { id: "product-launch", title: "产品发布会", description: "问题、产品、证据与发布节奏", icon: Megaphone, accent: "#FB7185", slides: 10, purpose: "让团队和客户快速理解产品价值并产生行动", mode: "showcase" },
  { id: "training-course", title: "培训课件", description: "概念、步骤、练习与记忆点", icon: BookOpen, accent: "#A78BFA", slides: 12, purpose: "让学习者掌握核心方法并能迁移到真实工作", mode: "instructional" },
  { id: "market-strategy", title: "市场方案", description: "洞察、竞品、策略和增长指标", icon: Layers3, accent: "#FBBF24", slides: 11, purpose: "对齐市场判断、策略优先级和衡量方式", mode: "pyramid" },
  { id: "data-report", title: "数据报告", description: "趋势、原因、指标与建议", icon: FileArchive, accent: "#34D399", slides: 9, purpose: "让读者看懂趋势、原因和建议动作", mode: "briefing" },
  { id: "fundraising", title: "融资路演", description: "机会、产品、增长与商业模式", icon: UsersRound, accent: "#F97316", slides: 12, purpose: "在有限时间内建立可信度并推动下一次沟通", mode: "narrative" },
  { id: "case-study", title: "案例复盘", description: "背景、转折、解法与结果", icon: Presentation, accent: "#38BDF8", slides: 10, purpose: "让听众理解变化发生的原因和可复用方法", mode: "narrative" }
] as const;

const workflowBriefs: Record<string, { audience: string; style?: string; brief: string }> = {
  "airport-outsourcing-report": {
    audience: "公司领导班子、采购评审及业务管理部门",
    style: "aviation-blue",
    brief: "请严格基于上传资料形成航站楼岗位外包专项汇报。先给出外包范围、核心测算结论和需审议事项，再按岗位分布与开放时段、人员配置、现场点位或图纸证据、人工成本对比、外包费用测算、市场调研、风险控制、可行性判断、意向单位和下一步安排展开。岗位数量、班次、金额和时间必须保持资料原始口径；适合的点位图、现场照片、表格和成本数据应分别使用图片证据页、原生表格或可编辑图表。",
  },
  "annual-work-plan": {
    audience: "部门管理层、业务骨干与协同单位",
    style: "aqua-planning",
    brief: "请形成年度工作规划汇报。用一页概括年度主线和关键目标，再按安全防控、队伍建设、管理优化、服务品牌等工作域组织章节；每项举措说明目标、关键动作、责任协同和衡量方式，随后形成季度里程碑、资源与风险、预期安全/服务/运营/队伍成果。内容以计划和可验证交付为主，避免把口号拆成重复卡片；10页以上应包含目录与章节分隔页。",
  },
  "security-annual-review": {
    audience: "公司领导班子、安委会与相关责任部门",
    style: "security-report",
    brief: "请形成安检护卫年度总结。先呈现业务数据和年度判断，再按政治引领、安全治理、双重预防、专项保障、质控体系、应急能力、三基训练、服务品牌等主题复盘工作举措与证据；随后归纳成效、存在问题、原因和下一年度计划。照片应作为活动或现场证据并配简短说明，数字优先使用KPI、柱状图或表格；不得把参考稿中的示例数字直接迁移到新项目。",
  },
  "state-special-report": {
    audience: "公司领导班子与相关职能部门",
    style: "state-briefing",
    brief: "请严格基于上传资料形成正式专项工作汇报。先提炼一页核心结论与需决策事项，再依次说明工作背景、目标与范围、当前进展、关键成果、存在问题及原因、风险影响、下一阶段计划、责任分工和请示事项。标题使用结论句，数据保留原始口径；无法核验的信息不得补造。"
  },
  "feasibility-study": {
    audience: "立项评审会、公司领导班子与财务法务部门",
    style: "state-briefing",
    brief: "请将资料整理为可研与立项汇报。覆盖现状与痛点、政策或业务依据、建设必要性、目标和范围、备选方案对比、资源与投资测算、预期收益、实施路径、关键风险与控制措施、结论及审议事项。涉及金额、人数、周期和比例时优先生成可编辑图表或表格，并注明资料口径。"
  },
  "procurement-review": {
    audience: "采购评审委员会与需求、财务、法务部门",
    style: "state-briefing",
    brief: "请形成采购评审汇报，依次呈现采购背景与必要性、需求范围和服务边界、人员或工作量测算、市场调研、供应商能力比较、成本与控制价测算、合同期限和关键条款、合规风险、评审结论与建议。用户上传模板和资料中的口径优先，不得自行补充供应商或价格数据。"
  },
  "safety-briefing": {
    audience: "安委会、公司领导班子与各责任部门",
    style: "state-briefing",
    brief: "请形成安全生产专题通报。用一页总览呈现安全态势和最重要判断，随后展示事件与指标变化、重点区域或环节、隐患清单、风险分级、问题根因、整改措施、责任部门、完成时限、复查证据和需协调事项。时间序列使用折线图，风险分布使用柱状图或矩阵；只使用资料中可核验的数据。"
  },
  "operations-analysis": {
    audience: "经营分析会与公司管理层",
    style: "state-briefing",
    brief: "请形成经营分析会材料。先给出经营结论和偏差总览，再按核心指标、同比环比趋势、结构变化、预算完成、关键业务单元、偏差归因、风险机会、行动计划和责任人展开。图表必须标注单位与口径；将事实、判断和动作分开表达，避免把数据表简单搬到页面上。"
  },
  "rectification-report": {
    audience: "检查组、公司领导与整改责任部门",
    style: "state-briefing",
    brief: "请形成检查整改闭环汇报。按检查背景、问题总览、问题分类与严重度、典型问题证据、根因分析、整改措施、责任人与期限、阶段成效、未销号事项和后续机制呈现。每项整改尽量保持问题、措施、责任、时限、证据五项对应，避免只写原则性表述。"
  }
};

const stageLabels: Record<string, string> = {
  queued: "排队等待", reading_references: "读取资料", structuring_story: "组织叙事", composing_slides: "编排页面", quality_check: "质量检查", ready_to_download: "可下载", failed: "生成失败"
};

function statusLabel(job: PresentationJob) {
  if (job.status === "completed") return "已就绪";
  if (job.status === "failed") return "需重试";
  return stageLabels[job.stage] ?? "处理中";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatMb(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

export function PresentationStudio() {
  const [catalog, setCatalog] = useState<PresentationCatalog>(fallbackCatalog);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [audience, setAudience] = useState("");
  const [purpose, setPurpose] = useState("");
  const [slideCountInput, setSlideCountInput] = useState("10");
  const [language, setLanguage] = useState("zh-CN");
  const [style, setStyle] = useState("state-briefing");
  const [mode, setMode] = useState("pyramid");
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(fallbackCatalog.features.map((item) => item.id));
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [provider, setProvider] = useState<Provider>("openai");
  const [chatModels, setChatModels] = useState<ChatModel[]>([]);
  const [model, setModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState("");
  const [includeImages, setIncludeImages] = useState(true);
  const [references, setReferences] = useState<File[]>([]);
  const [template, setTemplate] = useState<File | null>(null);
  const [jobs, setJobs] = useState<PresentationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [activeAction, setActiveAction] = useState<number | null>(null);
  const activeJobs = useMemo(() => jobs.filter((job) => job.status === "pending" || job.status === "running"), [jobs]);
  const availableModels = useMemo(() => chatModels.filter((item) => item.provider === provider), [chatModels, provider]);

  useEffect(() => {
    if (!getAuthToken()) { window.location.href = "/login"; return; }
    const storedProvider = localStorage.getItem(PRESENTATION_PROVIDER_KEY);
    if (storedProvider === "openai" || storedProvider === "grok" || storedProvider === "gork") {
      const normalizedProvider = storedProvider === "gork" ? "grok" : storedProvider;
      setProvider(normalizedProvider);
      localStorage.setItem(PRESENTATION_PROVIDER_KEY, normalizedProvider);
    }
    Promise.allSettled([getPresentationJobs(), getPresentationCatalog(), getChatModels()])
      .then(([jobsResult, catalogResult, modelsResult]) => {
        if (jobsResult.status === "fulfilled") setJobs(jobsResult.value);
        if (catalogResult.status === "fulfilled") {
          setCatalog(catalogResult.value);
          setSelectedFeatures(catalogResult.value.features.map((item) => item.id));
        }
        if (modelsResult.status === "fulfilled") {
          setChatModels(modelsResult.value);
          setModelsError("");
        } else {
          // The backend still resolves an omitted model to its configured
          // default. Keep the form usable while making the degraded state
          // visible instead of turning it into a generic fetch failure.
          setModelsError("模型目录暂时不可用，将使用后台默认模型");
        }
        const firstError = [jobsResult, catalogResult]
          .find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
        if (firstError) toast.error(firstError.reason instanceof Error ? firstError.reason.message : "部分 PPT 工作台数据加载失败");
      })
      .finally(() => { setLoading(false); setModelsLoading(false); });
  }, []);

  useEffect(() => {
    if (modelsLoading) return;
    if (!availableModels.length) {
      setModel("");
      return;
    }
    const storedModel = localStorage.getItem(`${PRESENTATION_MODEL_KEY_PREFIX}${provider}`) ?? "";
    const nextModel =
      availableModels.find((item) => item.model_id === storedModel)?.model_id ??
      availableModels.find((item) => item.is_default)?.model_id ??
      availableModels[0].model_id;
    setModel(nextModel);
    localStorage.setItem(`${PRESENTATION_MODEL_KEY_PREFIX}${provider}`, nextModel);
  }, [availableModels, modelsLoading, provider]);

  useEffect(() => {
    if (!activeJobs.length) return;
    const timer = window.setInterval(() => { getPresentationJobs().then(setJobs).catch(() => undefined); }, 2200);
    return () => window.clearInterval(timer);
  }, [activeJobs.length]);

  function applyWorkflow(workflow: (typeof workflows)[number]) {
    setTitle(workflow.title); setPurpose(workflow.purpose); setSlideCountInput(String(workflow.slides)); setMode(workflow.mode);
    const preset = workflowBriefs[workflow.id];
    setAudience(preset?.audience ?? "团队管理者与相关决策者");
    if (preset?.style) setStyle(preset.style);
    setBrief(preset?.brief ?? `${workflow.title}的核心主题是：\n\n请基于我的资料，梳理现状、关键洞察、方案结构、落地路径和衡量指标。内容需要结论先行，避免堆砌文字，并为每页给出一句可直接放在页面上的核心观点。`);
    toast.success(`已载入「${workflow.title}」工作流`);
  }

  function addReferences(files: FileList | null) {
    if (!files) return;
    const accepted = Array.from(files).filter((file) => file.size <= MAX_REFERENCE_UPLOAD_BYTES);
    if (accepted.length !== files.length) toast.error(`单个参考文件不能超过 ${formatMb(MAX_REFERENCE_UPLOAD_BYTES)}。`);
    setReferences((current) => {
      const limit = template ? MAX_PRESENTATION_ASSETS - 1 : MAX_PRESENTATION_ASSETS;
      const next = [...current, ...accepted].slice(0, limit);
      if (current.length + accepted.length > limit) toast.error(`参考资料和模板合计最多 ${MAX_PRESENTATION_ASSETS} 个文件。`);
      return next;
    });
  }

  function updateTemplate(file: File | null) {
    if (file && file.size > MAX_TEMPLATE_UPLOAD_BYTES) {
      toast.error(`PPT 模板不能超过 ${formatMb(MAX_TEMPLATE_UPLOAD_BYTES)}。`);
      return;
    }
    if (file && references.length >= MAX_PRESENTATION_ASSETS) {
      toast.error(`参考资料和模板合计最多 ${MAX_PRESENTATION_ASSETS} 个文件，请先移除一个参考资料。`);
      return;
    }
    setTemplate(file);
  }

  function changeProvider(value: Provider) {
    setProvider(value);
    localStorage.setItem(PRESENTATION_PROVIDER_KEY, value);
    const providerModels = chatModels.filter((item) => item.provider === value);
    const storedModel = localStorage.getItem(`${PRESENTATION_MODEL_KEY_PREFIX}${value}`) ?? "";
    const nextModel =
      providerModels.find((item) => item.model_id === storedModel)?.model_id ??
      providerModels.find((item) => item.is_default)?.model_id ??
      providerModels[0]?.model_id ??
      "";
    setModel(nextModel);
    if (nextModel) localStorage.setItem(`${PRESENTATION_MODEL_KEY_PREFIX}${value}`, nextModel);
  }

  function changeModel(value: string) {
    setModel(value);
    if (value) localStorage.setItem(`${PRESENTATION_MODEL_KEY_PREFIX}${provider}`, value);
  }

  function toggleFeature(id: string) {
    setSelectedFeatures((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function normaliseSlideCount(value: string) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 10;
    return Math.max(5, Math.min(100, parsed));
  }

  function handleSlideCountChange(value: string) {
    if (!/^\d{0,3}$/.test(value)) return;
    setSlideCountInput(value);
  }

  function handleSlideCountBlur() {
    setSlideCountInput(String(normaliseSlideCount(slideCountInput)));
  }

  async function submit() {
    if (!title.trim() || !brief.trim()) { toast.error("请先填写标题和内容简报。"); return; }
    const parsedSlideCount = Number.parseInt(slideCountInput, 10);
    const nextSlideCount = normaliseSlideCount(slideCountInput);
    if (!/^\d+$/.test(slideCountInput) || !Number.isFinite(parsedSlideCount) || parsedSlideCount < 5 || parsedSlideCount > 100) {
      toast.error("页数请输入 5 到 100 之间的整数。");
      setSlideCountInput(String(nextSlideCount));
      return;
    }
    if (references.length + (template ? 1 : 0) > MAX_PRESENTATION_ASSETS) {
      toast.error(`参考资料和模板合计最多 ${MAX_PRESENTATION_ASSETS} 个文件。`);
      return;
    }
    const uploadBytes = references.reduce((total, file) => total + file.size, template?.size ?? 0);
    if (uploadBytes > MAX_TOTAL_UPLOAD_BYTES) {
      toast.error(`本次上传总大小不能超过 ${formatMb(MAX_TOTAL_UPLOAD_BYTES)}，请减少参考资料后再试。`);
      return;
    }
    setCreating(true);
    try {
      const job = await createPresentationJob({ title, brief, audience, purpose, slide_count: nextSlideCount, language, style, mode, features: selectedFeatures, aspect_ratio: aspectRatio, include_images: includeImages, provider, model: model || undefined, references, template });
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]); toast.success("PPT 任务已进入生成队列"); setReferences([]); setTemplate(null);
    } catch (error) { toast.error(error instanceof Error ? error.message : "PPT 任务创建失败"); }
    finally { setCreating(false); }
  }

  async function download(job: PresentationJob) {
    setActiveAction(job.id);
    try { await downloadPresentation(job); toast.success("PPT 已开始下载，可用 PowerPoint 或 WPS 在本地编辑"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "下载失败"); }
    finally { setActiveAction(null); }
  }

  async function retry(job: PresentationJob) {
    setActiveAction(job.id);
    try { const next = await retryPresentationJob(job.id); setJobs((current) => current.map((item) => item.id === next.id ? next : item)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "重试失败"); }
    finally { setActiveAction(null); }
  }

  async function remove(job: PresentationJob) {
    setActiveAction(job.id);
    try { await deletePresentationJob(job.id); setJobs((current) => current.filter((item) => item.id !== job.id)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "删除失败"); }
    finally { setActiveAction(null); }
  }

  return (
    <PageShell className="space-y-5">
      <section className="command-hero relative overflow-hidden rounded-lg border border-border p-6 sm:p-8">
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div><div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase text-muted-foreground"><span className="inline-flex items-center gap-1.5 rounded-md border border-[#5B7CFF]/30 bg-[#5B7CFF]/10 px-2 py-1 text-[#5B7CFF]"><Presentation className="h-3 w-3" /> PPT WORKSHOP</span><span>LOCAL EDITABLE OUTPUT</span></div><h2 className="mt-5 max-w-3xl text-3xl font-semibold leading-tight sm:text-5xl">把资料变成一份能推动行动的演示文稿。</h2><p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">上传资料和可选模板，系统会完成内容提炼、叙事编排与 PPTX 产出。生成后直接下载到本地继续修改。</p></div>
          <div className="flex shrink-0 items-center gap-2 rounded-md border border-[#2DD4BF]/20 bg-[#2DD4BF]/[0.05] px-3 py-2 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-[#2DD4BF] shadow-[0_0_14px_#2DD4BF]" /> {catalog.skill.id} {catalog.skill.version} · 项目内能力已就绪</div>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-3"><div><div className="text-[10px] font-semibold uppercase text-muted-foreground">WORKFLOW LIBRARY</div><h3 className="mt-1 text-lg font-semibold">快速套用工作流</h3></div><span className="text-xs text-muted-foreground">横向浏览 · 可继续改写</span></div>
        <div className="soft-scrollbar flex gap-2 overflow-x-auto pb-2">
          {workflows.map((workflow) => { const Icon = workflow.icon; return <button key={workflow.id} type="button" onClick={() => applyWorkflow(workflow)} className="group flex min-w-[172px] shrink-0 items-center gap-2 rounded-md border border-border bg-card/55 px-3 py-2 text-left transition hover:border-[#5B7CFF]/45 hover:bg-card/85"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-md" style={{ backgroundColor: `${workflow.accent}1a`, color: workflow.accent }}><Icon className="h-3.5 w-3.5" /></span><span className="min-w-0"><span className="block truncate text-xs font-semibold">{workflow.title}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{workflow.description}</span></span><ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition group-hover:text-foreground" /></button>; })}
        </div>
      </section>

      <Card className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><div className="text-[10px] font-semibold uppercase text-[#5B7CFF]">BRIEF TO DECK</div><h3 className="mt-1 text-xl font-semibold">新建 PPT 任务</h3></div><FileArchive className="h-5 w-5 text-[#2DD4BF]" /></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="sm:col-span-2 lg:col-span-4"><span className="mb-1.5 block text-xs font-medium">演示标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：AI 产品年度发布会" className="h-11 w-full rounded-md border border-border bg-background/60 px-3 text-sm outline-none transition focus:border-[#5B7CFF]" /></label>
          <label><span className="mb-1.5 block text-xs font-medium">目标受众</span><input value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="管理层、客户、团队" className="h-11 w-full rounded-md border border-border bg-background/60 px-3 text-sm outline-none transition focus:border-[#5B7CFF]" /></label>
          <label><span className="mb-1.5 block text-xs font-medium">演示目的</span><input value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="对齐决策并推动行动" className="h-11 w-full rounded-md border border-border bg-background/60 px-3 text-sm outline-none transition focus:border-[#5B7CFF]" /></label>
          <label><span className="mb-1.5 block text-xs font-medium">叙事模式</span><select value={mode} onChange={(event) => setMode(event.target.value)} className="h-11 w-full rounded-md border border-border bg-background/60 px-3 text-sm outline-none focus:border-[#5B7CFF]">{catalog.modes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label><span className="mb-1.5 block text-xs font-medium">视觉风格</span><select value={style} onChange={(event) => setStyle(event.target.value)} className="h-11 w-full rounded-md border border-border bg-background/60 px-3 text-sm outline-none focus:border-[#5B7CFF]">{catalog.styles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="sm:col-span-2 lg:col-span-4"><span className="mb-1.5 block text-xs font-medium">内容简报</span><Textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="说明主题、背景、关键事实、必须包含的观点，以及希望观众最终做什么。" className="min-h-[160px] rounded-md bg-background/60" /></label>
          <label><span className="mb-1.5 block text-xs font-medium">页数</span><input type="number" min={5} max={100} inputMode="numeric" value={slideCountInput} onChange={(event) => handleSlideCountChange(event.target.value)} onBlur={handleSlideCountBlur} placeholder="10" className="h-11 w-full rounded-md border border-border bg-background/60 px-3 text-sm outline-none focus:border-[#5B7CFF]" /></label>
          <label><span className="mb-1.5 block text-xs font-medium">语言</span><select value={language} onChange={(event) => setLanguage(event.target.value)} className="h-11 w-full rounded-md border border-border bg-background/60 px-3 text-sm outline-none focus:border-[#5B7CFF]"><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="en-US">English</option></select></label>
          <label><span className="mb-1.5 block text-xs font-medium">画幅</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)} className="h-11 w-full rounded-md border border-border bg-background/60 px-3 text-sm outline-none focus:border-[#5B7CFF]"><option value="16:9">16:9 宽屏</option><option value="4:3">4:3 经典</option></select></label>
          <div className="sm:col-span-2 lg:col-span-4">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-medium">模型选择</span>
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><Cpu className="h-3 w-3" /> 来源于后台模型配置</span>
            </div>
            <div className="rounded-md border border-border bg-background/45 p-2">
              <div className="flex flex-wrap gap-2">
                {providers.map((item) => (
                  <button key={item.value} type="button" onClick={() => changeProvider(item.value)} className={cn("h-8 rounded-md px-3 text-xs font-semibold transition", provider === item.value ? "bg-[#5B7CFF] text-white shadow-sm" : "bg-background/70 text-muted-foreground hover:text-foreground")}>{item.label}</button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {modelsLoading ? <span className="rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs text-muted-foreground">加载模型中...</span> : availableModels.length ? availableModels.map((item) => (
                  <button key={item.id} type="button" onClick={() => changeModel(item.model_id)} title={item.model_id} className={cn("rounded-md border px-2.5 py-1.5 text-xs transition", model === item.model_id ? "border-[#2DD4BF]/55 bg-[#2DD4BF]/10 text-foreground" : "border-border bg-background/60 text-muted-foreground hover:border-[#5B7CFF]/40 hover:text-foreground")}>{item.display_name}{item.is_default ? " · 默认" : ""}</button>
                )) : <span className="rounded-md border border-[#FB7185]/25 bg-[#FB7185]/[0.06] px-2.5 py-1.5 text-xs text-[#FB7185]">当前通道暂无可用模型</span>}
              </div>
              {modelsError ? <div className="mt-2 text-[10px] text-amber-600 dark:text-amber-300">{modelsError}</div> : null}
            </div>
          </div>
        </div>

        <div className="mt-5 border-t border-border pt-4"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">汇报增强能力</span><span className="text-[10px] text-muted-foreground">{selectedFeatures.length}/{catalog.features.length} 已启用</span></div><div className="mt-2 flex flex-wrap gap-2">{catalog.features.map((feature) => <button key={feature.id} type="button" onClick={() => toggleFeature(feature.id)} className={cn("rounded-md border px-2.5 py-1.5 text-xs transition", selectedFeatures.includes(feature.id) ? "border-[#5B7CFF]/50 bg-[#5B7CFF]/10 text-foreground" : "border-border bg-background/40 text-muted-foreground hover:text-foreground")} title={feature.description}>{feature.label}</button>)}</div></div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="group flex min-h-24 cursor-pointer flex-col justify-center rounded-md border border-dashed border-[#2DD4BF]/40 bg-[#2DD4BF]/[0.04] p-3 transition hover:border-[#2DD4BF]"><input type="file" multiple accept=".pdf,.docx,.pptx,.xlsx,.csv,.txt,.md,.json,.png,.jpg,.jpeg,.webp" onChange={(event) => { addReferences(event.target.files); event.currentTarget.value = ""; }} className="sr-only" /><div className="flex items-center gap-2 text-sm font-medium"><Upload className="h-4 w-4 text-[#2DD4BF]" /> 上传参考资料</div><span className="mt-1 text-xs text-muted-foreground">PDF、Word、Excel、PPT、图片等，单个 25MB 内</span></label>
          <label className="group flex min-h-24 cursor-pointer flex-col justify-center rounded-md border border-dashed border-[#A78BFA]/40 bg-[#A78BFA]/[0.04] p-3 transition hover:border-[#A78BFA]"><input type="file" accept=".pptx" onChange={(event) => { updateTemplate(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} className="sr-only" /><div className="flex items-center gap-2 text-sm font-medium"><Presentation className="h-4 w-4 text-[#A78BFA]" /> 上传 PPT 模板</div><span className="mt-1 text-xs text-muted-foreground">保留模板主题、母版与画幅，最大 100MB</span></label>
        </div>
        {references.length || template ? <div className="mt-3 flex flex-wrap gap-2">{references.map((file) => <span key={`${file.name}-${file.lastModified}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1 text-xs"><FileText className="h-3 w-3 text-[#2DD4BF]" /><span className="max-w-44 truncate">{file.name}</span><button type="button" onClick={() => setReferences((current) => current.filter((item) => item !== file))} aria-label={`移除 ${file.name}`}><X className="h-3 w-3 text-muted-foreground" /></button></span>)}{template ? <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-[#A78BFA]/30 bg-[#A78BFA]/[0.08] px-2 py-1 text-xs"><Presentation className="h-3 w-3 text-[#A78BFA]" /><span className="max-w-44 truncate">{template.name}</span><button type="button" onClick={() => setTemplate(null)} aria-label="移除 PPT 模板"><X className="h-3 w-3 text-muted-foreground" /></button></span> : null}</div> : null}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={includeImages} onChange={(event) => setIncludeImages(event.target.checked)} className="h-4 w-4 accent-[#5B7CFF]" /> 为关键页面预留视觉素材位</label><Button type="button" onClick={submit} disabled={creating || modelsLoading}>{creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}生成 PPTX</Button></div>
      </Card>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3"><div><div className="text-[10px] font-semibold uppercase text-muted-foreground">GENERATION QUEUE</div><h3 className="mt-1 text-lg font-semibold">最近任务</h3></div>{activeJobs.length ? <span className="inline-flex items-center gap-1.5 text-xs text-[#2DD4BF]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {activeJobs.length} 个任务处理中</span> : null}</div>
        {loading ? <Card className="grid min-h-32 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-[#2DD4BF]" /></Card> : jobs.length === 0 ? <Card className="grid min-h-32 place-items-center text-sm text-muted-foreground">还没有 PPT 任务，从上方工作流开始。</Card> : <div className="space-y-2">{jobs.map((job) => <motion.div layout key={job.id} className="rounded-md border border-border bg-card/70 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex items-center gap-2"><span className={cn("h-2 w-2 rounded-full", job.status === "completed" ? "bg-[#2DD4BF]" : job.status === "failed" ? "bg-[#FB7185]" : "animate-pulse bg-[#5B7CFF]")} /><span className="truncate text-sm font-semibold">{job.title}</span><span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{statusLabel(job)}</span></div><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{formatTime(job.created_at)}</span><span>{job.slide_count} 页</span><span>{job.asset_count} 个素材</span><span>{job.provider === "grok" ? "Grok" : "OpenAI"} / {job.model || "默认模型"}</span>{job.output_filename ? <span className="truncate">{job.output_filename}</span> : null}</div></div><div className="flex shrink-0 items-center gap-2">{job.status === "completed" ? <Button type="button" size="sm" onClick={() => download(job)} disabled={activeAction === job.id}><Download className="h-3.5 w-3.5" />下载 PPTX</Button> : null}{job.status === "failed" ? <Button type="button" size="sm" variant="secondary" onClick={() => retry(job)} disabled={activeAction === job.id}><RefreshCcw className="h-3.5 w-3.5" />重试</Button> : null}<Button type="button" size="icon" variant="ghost" onClick={() => remove(job)} disabled={activeAction === job.id} aria-label="删除 PPT 任务" title="删除任务"><Trash2 className="h-4 w-4" /></Button></div></div>{job.status === "pending" || job.status === "running" ? <div className="mt-3"><div className="mb-1.5 flex justify-between text-[10px] text-muted-foreground"><span>{stageLabels[job.stage] ?? "处理中"}</span><span>{job.progress}%</span></div><div className="h-1 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-gradient-to-r from-[#5B7CFF] to-[#2DD4BF] transition-all" style={{ width: `${Math.max(4, job.progress)}%` }} /></div></div> : null}{job.status === "failed" && job.error ? <div className="mt-3 rounded-md border border-[#FB7185]/20 bg-[#FB7185]/[0.06] px-3 py-2 text-xs text-[#FB7185]">{job.error}</div> : null}</motion.div>)}</div>}
      </section>
    </PageShell>
  );
}
