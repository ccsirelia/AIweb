export type WorkflowTarget = "chat" | "image";

export type WorkflowFieldType = "text" | "textarea" | "select";

export type WorkflowIconKey =
  | "research"
  | "writing"
  | "strategy"
  | "meeting"
  | "product"
  | "cinema"
  | "brand"
  | "character"
  | "custom";

export interface WorkflowField {
  key: string;
  label: string;
  type: WorkflowFieldType;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  options?: string[];
}

export interface WorkflowStep {
  id: string;
  title: string;
  description: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  iconKey: WorkflowIconKey;
  accent: string;
  target: WorkflowTarget;
  fields: WorkflowField[];
  steps: WorkflowStep[];
  promptTemplate: string;
  custom?: boolean;
  createdAt?: string;
}

export interface WorkflowRecentUse {
  workflowId: string;
  usedAt: string;
}

export interface WorkflowUsageState {
  favorites: string[];
  recent: WorkflowRecentUse[];
  useCounts: Record<string, number>;
}

export interface WorkflowStats {
  workflowId: string;
  favorite: boolean;
  useCount: number;
  lastUsedAt: string | null;
  recentRank: number | null;
}

export interface WorkflowUsageChangedDetail {
  action: "favorite" | "use";
  workflowId: string;
  state: WorkflowUsageState;
}

export type WorkflowValues = Record<string, string>;

export const WORKFLOW_STORAGE_KEY = "aiweb-custom-workflows-v1";
export const WORKFLOW_LIBRARY_CHANGED_EVENT = "aiweb-workflow-library-changed";
export const WORKFLOW_USAGE_STORAGE_KEY = "aiweb-workflow-usage-v1";
export const WORKFLOW_USAGE_CHANGED_EVENT = "aiweb-workflow-usage-changed";
export const WORKFLOW_PENDING_PROMPT_STORAGE_KEY = "aiweb:pending-prompt";
export const WORKFLOW_PROMPT_LIMITS: Record<WorkflowTarget, number> = {
  chat: 4000,
  image: 1200
};

const AIWEB_USER_STORAGE_KEY = "aiweb_user";

function getWorkflowStorageOwner(): string {
  if (typeof window === "undefined") return "guest";
  try {
    const rawUser = window.localStorage.getItem(AIWEB_USER_STORAGE_KEY);
    if (!rawUser) return "guest";
    const parsed = JSON.parse(rawUser) as { id?: unknown };
    if (typeof parsed.id === "number" && Number.isFinite(parsed.id)) return `user:${parsed.id}`;
    if (typeof parsed.id === "string" && parsed.id.trim()) {
      return `user:${encodeURIComponent(parsed.id.trim().slice(0, 128))}`;
    }
  } catch {
    // Corrupt or unavailable auth state is isolated in the guest namespace.
  }
  return "guest";
}

function getScopedWorkflowStorageKey(baseKey: string): string {
  const scopedKey = `${baseKey}:${getWorkflowStorageOwner()}`;
  if (typeof window === "undefined") return scopedKey;

  try {
    const legacyValue = window.localStorage.getItem(baseKey);
    if (legacyValue !== null) {
      if (window.localStorage.getItem(scopedKey) === null) {
        window.localStorage.setItem(scopedKey, legacyValue);
      }
      window.localStorage.removeItem(baseKey);
    }
  } catch {
    // Storage callers retain their existing empty-state/error behavior.
  }
  return scopedKey;
}

export const builtInWorkflows: WorkflowTemplate[] = [
  {
    id: "deep-research-sprint",
    name: "深度研究冲刺",
    category: "研究分析",
    description: "从问题拆解、证据核验到决策摘要，快速形成可引用的研究结果。",
    iconKey: "research",
    accent: "#2DD4BF",
    target: "chat",
    fields: [
      { key: "topic", label: "研究主题", type: "textarea", placeholder: "例如：生成式 AI 对独立设计团队的影响", required: true },
      { key: "goal", label: "最终目的", type: "text", placeholder: "例如：为季度战略会提供判断依据", required: true },
      { key: "audience", label: "阅读对象", type: "text", placeholder: "例如：产品负责人和管理层", defaultValue: "需要快速决策的业务负责人" },
      {
        key: "depth",
        label: "分析深度",
        type: "select",
        options: ["快速扫描", "标准研究", "专家级深挖"],
        defaultValue: "标准研究"
      },
      { key: "constraints", label: "边界与偏好", type: "textarea", placeholder: "时间范围、地区、必须覆盖或排除的内容" }
    ],
    steps: [
      { id: "frame", title: "定义问题", description: "识别关键术语、假设与研究边界" },
      { id: "evidence", title: "构建证据", description: "区分事实、推断、争议与未知项" },
      { id: "challenge", title: "交叉质询", description: "用反例、替代解释和利益相关方视角挑战结论" },
      { id: "synthesis", title: "形成判断", description: "输出带置信度的结论、风险与下一步行动" }
    ],
    promptTemplate: `你是一名严谨的研究分析师。请围绕「{{topic}}」完成一次{{depth}}。

研究目的：{{goal}}
目标读者：{{audience}}
边界与偏好：{{constraints}}

请按以下结构输出：
1. 执行摘要：先给出 3-5 条最关键判断。
2. 问题地图：拆解核心问题、关键变量和隐含假设。
3. 证据与分析：区分已知事实、合理推断、争议点和信息缺口；不要虚构来源。
4. 反方视角：给出至少两个可能推翻当前结论的情境。
5. 方案比较：至少列出 3 种可行路径，用“价值 / 成本 / 风险 / 可逆性”矩阵比较。
6. 行动建议：按影响力和实施难度排序，明确负责人类型、第一步与观察指标。
7. 待验证清单：列出下一步应补充的数据或材料，并说明它会改变哪项判断。

表达要清晰、具体。每条重要判断标记置信度（高 / 中 / 低）和依据类型；若缺少实时资料，明确说明知识边界，不编造链接、数字或引用。`
  },
  {
    id: "content-production-line",
    name: "内容生产线",
    category: "写作创意",
    description: "将一个主题变成兼顾传播目标、叙事节奏与可读性的完整内容。",
    iconKey: "writing",
    accent: "#FBBF24",
    target: "chat",
    fields: [
      { key: "subject", label: "内容主题", type: "textarea", placeholder: "你想表达的核心主题或原始材料", required: true },
      { key: "channel", label: "发布渠道", type: "select", options: ["微信公众号", "小红书", "知乎", "博客 / 官网", "视频口播"], defaultValue: "微信公众号" },
      { key: "audience", label: "目标读者", type: "text", placeholder: "例如：希望提高效率的知识工作者", required: true },
      { key: "tone", label: "表达气质", type: "select", options: ["专业克制", "轻松有趣", "犀利直接", "温暖叙事", "未来科技"], defaultValue: "专业克制" },
      { key: "length", label: "篇幅", type: "select", options: ["精简（500 字内）", "标准（1000-1500 字）", "长文（2500 字以上）"], defaultValue: "标准（1000-1500 字）" }
    ],
    steps: [
      { id: "angle", title: "锁定切角", description: "从读者痛点中选择最强叙事入口" },
      { id: "outline", title: "搭建结构", description: "组织开场、论点、案例与收束" },
      { id: "draft", title: "完成初稿", description: "用事实、场景和转折支撑核心观点" },
      { id: "polish", title: "渠道润色", description: "按平台语境优化节奏、标题与互动设计" }
    ],
    promptTemplate: `请将以下主题制作成适合「{{channel}}」发布的内容。

主题 / 素材：{{subject}}
目标读者：{{audience}}
表达气质：{{tone}}
期望篇幅：{{length}}

请严格按以下交付结构完成：
1. 内容策略卡：一句话核心价值、读者当前状态、希望读者完成的认知或行动变化。
2. 标题方案：提供 5 个差异明显的标题，并标注各自使用的切角。
3. 内容大纲：列出每一段的功能、关键信息和节奏安排。
4. 可直接发布的正文：开场在前 3 句建立冲突或收益；每个关键观点至少由一个案例、细节或机制解释支撑。
5. 发布组件：摘要、自然互动问题、3 条二次传播短句，以及适合渠道的标签建议。
6. 自检：指出正文中最可能显得空泛或需要事实核验的 2 处，并给出改写建议。

不要使用“赋能、破局、在这个时代”等套话，不虚构数据与亲历故事；{{tone}}应体现在句式和选材中，而不是直接宣称。`
  },
  {
    id: "decision-red-team",
    name: "决策红队推演",
    category: "策略决策",
    description: "让 AI 同时扮演支持者、反对者与风险官，找出决策中的脆弱假设。",
    iconKey: "strategy",
    accent: "#A78BFA",
    target: "chat",
    fields: [
      { key: "decision", label: "待评估决策", type: "textarea", placeholder: "描述方案、背景和你当前倾向", required: true },
      { key: "success", label: "成功标准", type: "textarea", placeholder: "怎样才算这项决策成功？", required: true },
      { key: "horizon", label: "时间尺度", type: "select", options: ["30 天", "一个季度", "一年", "三年以上"], defaultValue: "一个季度" },
      { key: "risk", label: "风险偏好", type: "select", options: ["保守", "平衡", "进取"], defaultValue: "平衡" }
    ],
    steps: [
      { id: "steelman", title: "强化正方", description: "寻找方案成立的最强逻辑" },
      { id: "redteam", title: "红队攻击", description: "暴露依赖、盲点与二阶影响" },
      { id: "scenario", title: "情景推演", description: "模拟乐观、基准和压力情景下的结果" },
      { id: "gate", title: "设置闸门", description: "给出可观测、可量化的继续或终止条件" }
    ],
    promptTemplate: `请对以下决策进行一次严格的红队推演：

待评估决策：{{decision}}
成功标准：{{success}}
评估周期：{{horizon}}
风险偏好：{{risk}}

请严格完成以下推演：
1. 决策定义：复述选择、不可选项、约束和真正的机会成本。
2. 四方陈述：分别以“最强支持者”“最强反对者”“财务风险官”“一线执行者”的视角独立分析，不互相折中。
3. 假设台账：列出关键假设、当前证据、脆弱程度、最低成本验证方式。
4. 失败预演：假设 {{horizon}} 后失败，倒推最可能的 5 条因果链及预警信号。
5. 情景矩阵：乐观 / 基准 / 压力情景下的收益、代价、可逆性和次生影响。
6. 最终建议：结论、置信度、仍需验证的 3 个假设，以及带数值或可观察阈值的继续 / 暂停 / 退出条件。

不要为了显得全面而平均分配观点；优先揭示真正可能改变决策的证据。`
  },
  {
    id: "meeting-to-action",
    name: "会议转行动",
    category: "效率协作",
    description: "把杂乱会议记录提炼成共识、分歧、责任人和可追踪行动项。",
    iconKey: "meeting",
    accent: "#5B7CFF",
    target: "chat",
    fields: [
      { key: "notes", label: "会议记录", type: "textarea", placeholder: "粘贴逐字稿、速记或讨论摘要", required: true },
      { key: "context", label: "会议背景", type: "text", placeholder: "例如：新版本上线前风险同步" },
      { key: "deadline", label: "默认截止时间", type: "text", placeholder: "例如：本周五；不确定可留空" },
      { key: "format", label: "输出风格", type: "select", options: ["精简行动版", "标准纪要版", "高管摘要版"], defaultValue: "标准纪要版" }
    ],
    steps: [
      { id: "extract", title: "提取信号", description: "过滤重复表达并识别明确结论" },
      { id: "resolve", title: "标记分歧", description: "分离已达成共识和待决问题" },
      { id: "assign", title: "生成行动", description: "整理责任人、时间、依赖与验收标准" },
      { id: "followup", title: "建立跟踪", description: "生成风险提醒、复盘节点和下次会议输入" }
    ],
    promptTemplate: `请将下面的会议内容整理为{{format}}。

会议背景：{{context}}
默认截止时间：{{deadline}}
原始记录：
{{notes}}

请按以下结构输出：
1. 一句话结论与会议状态（已决策 / 部分决策 / 仅讨论）。
2. 关键共识：每条注明支持它的原始信息。
3. 分歧与未决问题：写清各方立场、缺失证据和决策人。
4. 决策日志表：决策 / 理由 / 影响范围 / 生效时间 / 可否回滚。
5. 行动项表：事项 / 责任人 / 截止时间 / 前置依赖 / 验收标准 / 当前风险。
6. 跟进节奏：建议的检查节点、下次会议必须带回的数据，以及可直接发送的 100 字会后通知。

原文没有提供的信息统一标记为“待确认”；不要猜测发言人、责任人、日期或数字。合并重复行动，但保留重要异议。`
  },
  {
    id: "product-hero-shot",
    name: "产品英雄镜头",
    category: "商业视觉",
    description: "为真实产品生成可控的商业主视觉，兼顾材质、灯光与品牌气质。",
    iconKey: "product",
    accent: "#FB7185",
    target: "image",
    fields: [
      { key: "product", label: "产品主体", type: "textarea", placeholder: "例如：磨砂钛金属智能手表，黑色织物表带", required: true },
      { key: "scene", label: "场景", type: "text", placeholder: "例如：极简黑色反射台面", defaultValue: "精密的现代摄影棚场景" },
      { key: "mood", label: "视觉气质", type: "select", options: ["高端克制", "明快活力", "硬核科技", "自然疗愈", "奢华戏剧"], defaultValue: "高端克制" },
      { key: "palette", label: "色彩偏好", type: "text", placeholder: "例如：石墨黑、银灰、少量青绿" },
      { key: "ratio", label: "构图比例意图", type: "select", options: ["横版广告", "方形电商", "竖版海报", "超宽横幅"], defaultValue: "横版广告" }
    ],
    steps: [
      { id: "subject", title: "锁定主体", description: "明确产品外观、材质与不可改变特征" },
      { id: "light", title: "设计光线", description: "用轮廓光和反射塑造质感" },
      { id: "composition", title: "规划构图", description: "根据投放画幅设计视觉动线与文案安全区" },
      { id: "finish", title: "商业精修", description: "控制瑕疵、反射、边缘和背景视觉噪声" }
    ],
    promptTemplate: `商业产品英雄镜头。主体：{{product}}。场景：{{scene}}。整体气质：{{mood}}。色彩：{{palette}}。构图用途：{{ratio}}。

画面结构：产品占据第一视觉层，{{scene}}形成第二层空间线索，背景保持克制。外观比例、接口、边缘和材质必须准确一致；主光塑造体积，轮廓光完成背景分离，受控高光解释表面工艺，自然接触阴影锚定重量。根据{{ratio}}在不削弱主体的前提下预留干净文案安全区。

成片标准：高端商业摄影、真实光学透视、细腻动态范围、可用于正式广告。避免漂浮、重复产品、错误反射、熔化边缘、假塑料质感、无意义装饰、文字、Logo 变形和水印。`
  },
  {
    id: "cinematic-story-frame",
    name: "电影叙事帧",
    category: "叙事影像",
    description: "把一句故事设想转化为具有镜头语言、光线逻辑和情绪张力的画面。",
    iconKey: "cinema",
    accent: "#F97316",
    target: "image",
    fields: [
      { key: "moment", label: "故事瞬间", type: "textarea", placeholder: "人物正在做什么？此刻发生了什么？", required: true },
      { key: "world", label: "时间与地点", type: "text", placeholder: "例如：雨后的 2049 年香港旧城区", required: true },
      { key: "shot", label: "镜头", type: "select", options: ["广角建立镜头", "中景人物镜头", "特写", "俯拍", "低机位跟拍"], defaultValue: "广角建立镜头" },
      { key: "light", label: "光线", type: "select", options: ["清晨自然光", "阴天柔光", "霓虹夜景", "黄金时刻逆光", "戏剧性侧光"], defaultValue: "霓虹夜景" },
      { key: "emotion", label: "核心情绪", type: "text", placeholder: "例如：克制的孤独与微弱希望", required: true }
    ],
    steps: [
      { id: "blocking", title: "场面调度", description: "确定人物、空间关系与动作瞬间" },
      { id: "camera", title: "镜头语法", description: "定义景别、机位、焦段与景深" },
      { id: "light", title: "建立光线", description: "让主光、环境光和实景光源遵循同一逻辑" },
      { id: "grade", title: "情绪定调", description: "用色彩、天气和环境细节完成叙事收束" }
    ],
    promptTemplate: `电影叙事画面：{{moment}}。时空背景：{{world}}。核心情绪：{{emotion}}。

采用{{shot}}，{{light}}。镜头必须明确回答“人物刚刚做了什么、下一秒可能发生什么”：动作停在最有叙事张力的瞬间，视线与空间阻力清晰。前景用于引导或遮挡，中景承载主要事件，远景交代世界状态；真实焦段透视、受控景深、符合场景的运动模糊。

光源方向、反射和天气一致，环境细节只保留能揭示时代、身份或冲突的信息。色彩分级克制统一，保留高光与暗部层次，呈现精细胶片颗粒和电影宽容度。无字幕、无水印、无边框，避免摆拍、舞台式打光、过度锐化、肢体错误和背景人群复制。`
  },
  {
    id: "brand-visual-system",
    name: "品牌视觉母版",
    category: "品牌设计",
    description: "将品牌关键词转译成统一、可延展且具辨识度的主视觉系统。",
    iconKey: "brand",
    accent: "#38BDF8",
    target: "image",
    fields: [
      { key: "brand", label: "品牌 / 项目", type: "text", placeholder: "品牌名称或项目类型", required: true },
      { key: "promise", label: "核心承诺", type: "textarea", placeholder: "它为谁解决什么问题？", required: true },
      { key: "keywords", label: "品牌关键词", type: "text", placeholder: "3-5 个词，用逗号分隔", required: true },
      { key: "palette", label: "色彩系统", type: "text", placeholder: "例如：深灰、冷白、电光青，少量珊瑚红" },
      { key: "medium", label: "视觉媒介", type: "select", options: ["编辑摄影", "3D 材质艺术", "平面拼贴", "极简静物", "抽象数据景观"], defaultValue: "3D 材质艺术" }
    ],
    steps: [
      { id: "codes", title: "提取符号", description: "将品牌承诺转译为视觉母题" },
      { id: "system", title: "建立系统", description: "统一色彩、材质、构图和节奏" },
      { id: "adapt", title: "验证延展", description: "确保核心母题可适配横、竖与方形画幅" },
      { id: "distinct", title: "强化识别", description: "移除通用视觉并保留独特记忆点" }
    ],
    promptTemplate: `为「{{brand}}」设计一幅品牌主视觉。品牌核心承诺：{{promise}}。关键词：{{keywords}}。使用{{medium}}语言，色彩系统为{{palette}}。

核心系统：只使用一个鲜明、可复用的视觉母题，并通过尺度、重复、裁切和留白建立节奏；{{medium}}的材质、光线、空间透视必须遵循统一规则。画面设置清晰的主视觉锚点、次级信息区和可裁切缓冲区，让母题能延展到横版、竖版与方形画幅。

成片应像成熟品牌系统的母版：有专属识别性、克制层级和真实制作细节，而不是单张概念图。画面不出现文字、字母、Logo 或水印；避免通用霓虹线条、发光球体、模板化科技隧道、无意义粒子和颜色失控。`
  },
  {
    id: "character-concept-sheet",
    name: "角色概念定帧",
    category: "角色概念",
    description: "从身份、世界观与性格矛盾出发，生成有故事感的角色设计画面。",
    iconKey: "character",
    accent: "#A3E635",
    target: "image",
    fields: [
      { key: "identity", label: "角色身份", type: "text", placeholder: "例如：修复废弃卫星的年轻工程师", required: true },
      { key: "world", label: "世界观", type: "textarea", placeholder: "时代、地点、社会与技术背景", required: true },
      { key: "conflict", label: "性格矛盾", type: "text", placeholder: "例如：极度理性但害怕独处", required: true },
      { key: "details", label: "外观线索", type: "textarea", placeholder: "服装、装备、年龄、材质或必须保留的细节" },
      { key: "style", label: "表现方式", type: "select", options: ["写实概念艺术", "电影角色定妆照", "精致动画设定", "时尚编辑摄影"], defaultValue: "电影角色定妆照" }
    ],
    steps: [
      { id: "story", title: "写入经历", description: "让服装、状态和物件体现角色过去" },
      { id: "silhouette", title: "塑造轮廓", description: "建立清晰独特的形体辨识度" },
      { id: "function", title: "验证功能", description: "确保服装、装备和磨损符合职业与世界规则" },
      { id: "portrait", title: "凝固瞬间", description: "通过目光、姿态和环境暗示内在冲突" }
    ],
    promptTemplate: `{{style}}。角色身份：{{identity}}。所处世界：{{world}}。内在矛盾：{{conflict}}。外观与装备线索：{{details}}。

设计逻辑：先以体型、姿态和主要装备建立远距离可辨的轮廓；再用 2-3 个重复的形状或材质语言形成统一性。服装分层、闭合方式、负重位置和防护范围符合职业功能，磨损、维修与个人物件只用于暗示真实经历。

画面采用全身或四分之三身，手部清晰，重心自然，眼神和微表情体现{{conflict}}；背景克制但包含一个与世界冲突相关的线索。人体结构、衣料张力和材质响应准确，电影级光线。无文字、无水印，避免廉价盔甲、过量口袋、无功能绑带、配件堆砌、僵硬站姿和左右肢体错误。`
  },
  {
    id: "code-review-hardening",
    name: "代码审查与加固",
    category: "工程研发",
    description: "从正确性、安全性、性能与可维护性四条线审查代码，输出可直接实施的修复顺序。",
    iconKey: "strategy",
    accent: "#22D3EE",
    target: "chat",
    fields: [
      { key: "code", label: "代码或变更", type: "textarea", placeholder: "粘贴代码、diff、报错或关键文件内容", required: true },
      { key: "stack", label: "语言与技术栈", type: "text", placeholder: "例如：TypeScript / Next.js 15 / PostgreSQL", required: true },
      { key: "context", label: "业务与运行上下文", type: "textarea", placeholder: "代码负责什么、入口、数据规模、部署环境", required: true },
      { key: "objective", label: "本次审查目标", type: "select", options: ["发布前综合审查", "安全专项", "性能专项", "重构可维护性", "故障根因定位"], defaultValue: "发布前综合审查" },
      { key: "risk", label: "风险等级", type: "select", options: ["内部工具", "普通线上服务", "核心业务", "资金 / 隐私敏感"], defaultValue: "普通线上服务" },
      { key: "constraints", label: "修改约束", type: "textarea", placeholder: "例如：不能更换依赖、必须兼容旧 API、两天内上线" }
    ],
    steps: [
      { id: "model", title: "建立运行模型", description: "梳理入口、状态、数据流和外部信任边界" },
      { id: "inspect", title: "逐层审查", description: "检查正确性、安全性、并发、性能与可维护性" },
      { id: "reproduce", title: "验证缺陷", description: "为高风险问题构造最小复现或失败路径" },
      { id: "patch", title: "设计修复", description: "给出最小改动、代码示例和兼容性影响" },
      { id: "verify", title: "建立回归", description: "补齐测试矩阵、观测指标与发布检查" }
    ],
    promptTemplate: `你是一名负责线上可靠性与应用安全的资深工程师，请完成一次{{objective}}。

技术栈：{{stack}}
业务与运行上下文：{{context}}
风险等级：{{risk}}
修改约束：{{constraints}}
待审查内容：
{{code}}

请按以下结构输出：
1. 运行模型：用简洁步骤说明入口、数据流、状态变化、外部依赖与信任边界；指出上下文缺口。
2. 审查结论：先给“可发布 / 有条件发布 / 阻止发布”，再给出判断依据。
3. 问题清单表：编号 / 严重度（阻断、严重、一般、建议）/ 位置 / 触发条件 / 用户或系统影响 / 证据。不要把纯风格偏好包装成缺陷。
4. 深入分析：对每个阻断或严重问题说明因果链、最小复现、为什么现有保护无效，以及是否可能被利用。
5. 修复方案：按优先级给出最小补丁或伪代码；明确行为变化、兼容性、迁移风险和不建议采用的替代方案。
6. 验证计划：单元、集成、边界、并发与失败注入测试；列出发布前检查和上线后应观察的指标。
7. 优点保留：指出 2-3 个应保留的设计选择，避免修复时破坏已有优势。

只基于提供的代码和上下文下结论。无法确认的问题标记为“需验证”并说明验证方法，不虚构文件、调用链、基准数据或漏洞编号。`
  },
  {
    id: "adaptive-learning-coach",
    name: "自适应学习教练",
    category: "学习成长",
    description: "先诊断已有认知，再生成带练习、反馈与复习节奏的个性化学习路径。",
    iconKey: "research",
    accent: "#34D399",
    target: "chat",
    fields: [
      { key: "topic", label: "学习主题", type: "textarea", placeholder: "例如：理解 Transformer，并能独立实现注意力模块", required: true },
      { key: "level", label: "当前基础", type: "textarea", placeholder: "已掌握什么、在哪些地方卡住", required: true },
      { key: "outcome", label: "目标成果", type: "text", placeholder: "例如：两周后完成一次内部技术分享", required: true },
      { key: "time", label: "时间预算", type: "text", placeholder: "例如：14 天，每天 45 分钟", required: true },
      { key: "style", label: "偏好方式", type: "select", options: ["概念推导优先", "项目实践优先", "例题训练优先", "类比与可视化优先"], defaultValue: "项目实践优先" },
      { key: "resources", label: "可用材料与限制", type: "textarea", placeholder: "教材、课程、设备、语言或不希望使用的资源" }
    ],
    steps: [
      { id: "diagnose", title: "诊断起点", description: "用可回答的问题识别先修知识与误区" },
      { id: "map", title: "绘制路径", description: "把目标拆为递进能力、里程碑和依赖" },
      { id: "teach", title: "生成首课", description: "用讲解、示例和练习完成一次闭环" },
      { id: "test", title: "检索练习", description: "设置由浅入深且可自检的迁移任务" },
      { id: "adapt", title: "动态调整", description: "依据错误类型规划复习与下一阶段分支" }
    ],
    promptTemplate: `你是一名重视主动回忆、间隔复习和刻意练习的学习教练。

学习主题：{{topic}}
当前基础：{{level}}
目标成果：{{outcome}}
时间预算：{{time}}
偏好方式：{{style}}
可用材料与限制：{{resources}}

请交付一套真正可执行的学习系统：
1. 起点诊断：提出 5 个覆盖先修知识、概念理解和迁移能力的诊断题；随后说明不同答案对应的路径分支。不要假设用户已经回答。
2. 能力地图：按“必须掌握 / 有帮助 / 暂时跳过”组织知识点，解释依赖关系和常见误区。
3. 阶段计划表：日期或阶段 / 学习目标 / 具体任务 / 可见产物 / 通过标准 / 预计用时。总用时不得超过{{time}}。
4. 第一节微课程：用{{style}}讲解最关键的起点概念，包含一个直观模型、一个反例和一个逐步示例。
5. 练习阶梯：设计“复述、应用、纠错、迁移”四级练习，先不给完整答案；另设提示思路和评分量规。
6. 复习机制：安排 1 天、3 天、7 天后的主动回忆任务，并给出“答对 / 模糊 / 答错”三种情况下的调整动作。
7. 成果验收：定义最终项目或演示的评分表，使{{outcome}}可以被客观检查。

控制信息密度，不用励志口号。若时间目标不现实，指出冲突并给最小可行版本。`
  },
  {
    id: "data-storytelling-brief",
    name: "数据叙事导演",
    category: "数据洞察",
    description: "把表格、指标或分析摘要转化成有证据链、图表规划和决策落点的数据故事。",
    iconKey: "strategy",
    accent: "#60A5FA",
    target: "chat",
    fields: [
      { key: "data", label: "数据与发现", type: "textarea", placeholder: "粘贴指标、表格摘要、统计结果或已有分析", required: true },
      { key: "decision", label: "要支持的决策", type: "text", placeholder: "听众看完后需要判断或采取什么行动", required: true },
      { key: "audience", label: "目标听众", type: "text", placeholder: "例如：不熟悉分析细节的业务管理层", required: true },
      { key: "medium", label: "交付载体", type: "select", options: ["高管汇报", "分析报告", "数据看板讲解", "产品复盘", "公开演讲"], defaultValue: "高管汇报" },
      { key: "caveats", label: "口径与限制", type: "textarea", placeholder: "样本范围、时间窗口、缺失值、不可比较项" }
    ],
    steps: [
      { id: "audit", title: "审计证据", description: "核对指标口径、比较基准与可推导范围" },
      { id: "signal", title: "提取信号", description: "区分趋势、异常、分群差异和噪声" },
      { id: "arc", title: "建立叙事", description: "按背景、变化、原因、影响和选择组织证据" },
      { id: "visual", title: "规划图表", description: "为每个主张选择合适图形与注释方式" },
      { id: "decision", title: "落到决策", description: "明确行动、观察指标和反证条件" }
    ],
    promptTemplate: `你是一名数据分析负责人和信息设计师，请将原始信息转成面向{{audience}}的{{medium}}。

数据与发现：
{{data}}

要支持的决策：{{decision}}
已知口径与限制：{{caveats}}

请严格按以下结构输出：
1. 数据审计：列出可确认的事实、计算或口径缺口、不可从数据推出的结论；检查基数、时间窗口、选择偏差和“相关不等于因果”。
2. 一句话主张：必须包含“发生了什么、为什么重要、建议做什么”，并给置信度。
3. 证据树：每个主张对应哪些数据，哪些是解释性假设，哪些反例会推翻它。
4. 叙事脚本：按 6-8 个章节组织，每章给标题、核心句、证据、过渡和听众应记住的一点。
5. 图表分镜表：图表类型 / 横纵轴与单位 / 筛选范围 / 高亮对象 / 注释文案 / 该图避免的误导。没有原始数据时不要杜撰数值。
6. 决策页面：给出推荐行动、预期影响、成本或风险、领先指标、滞后指标和复盘时间。
7. 质询准备：列出听众最可能提出的 5 个尖锐问题及基于现有证据的回答边界。

标题陈述洞察而非只写主题；不要用装饰性饼图、双轴误导或无基准的大数字。`
  },
  {
    id: "contract-risk-scanner",
    name: "合同风险扫描",
    category: "法律与风控",
    description: "从自身立场扫描权利义务、责任失衡和执行陷阱，并形成可谈判的修改清单。",
    iconKey: "research",
    accent: "#F59E0B",
    target: "chat",
    fields: [
      { key: "contract", label: "合同文本", type: "textarea", placeholder: "粘贴合同、条款或对方修改稿；请先移除不必要的敏感信息", required: true },
      { key: "role", label: "你的角色", type: "text", placeholder: "例如：采购方、服务商、员工、房屋承租人", required: true },
      { key: "jurisdiction", label: "适用地区 / 法律", type: "text", placeholder: "例如：中国大陆；不确定可写待确认", required: true },
      { key: "scenario", label: "交易背景", type: "textarea", placeholder: "金额、期限、交付方式、合作强弱关系", required: true },
      { key: "priority", label: "最关心的事项", type: "textarea", placeholder: "例如：知识产权、付款、数据、退出机制" },
      { key: "appetite", label: "风险偏好", type: "select", options: ["保守防御", "平衡成交", "优先快速签署"], defaultValue: "平衡成交" }
    ],
    steps: [
      { id: "map", title: "建立义务地图", description: "提取主体、期限、付款、交付与终止关系" },
      { id: "scan", title: "扫描风险", description: "识别缺失、含糊、单边权利和责任上限问题" },
      { id: "scenario", title: "违约推演", description: "模拟延期、争议、泄露与退出时的实际后果" },
      { id: "negotiate", title: "生成谈判稿", description: "按优先级提出条款修改和可接受退让" },
      { id: "escalate", title: "标记升级", description: "指出必须由当地专业律师确认的问题" }
    ],
    promptTemplate: `请站在“{{role}}”立场，对以下合同做商业风险预审。适用地区 / 法律：{{jurisdiction}}；交易背景：{{scenario}}；风险偏好：{{appetite}}；重点关注：{{priority}}。

合同文本：
{{contract}}

请按以下结构输出：
1. 非法律意见声明与审查边界：说明文本缺失、地区不确定性及必须咨询持证律师的情形。
2. 交易结构摘要：主体、标的、金额与付款、交付与验收、期限、续约、终止、争议解决；未写明项标“缺失”。
3. 风险矩阵：原条款定位或原文短引 / 风险等级 / 对{{role}}的实际后果 / 触发场景 / 建议立场。引用必须来自输入。
4. 情景压力测试：至少覆盖未按期交付、付款争议、数据或保密事件、知识产权争议、提前退出五类情景，说明谁承担什么成本。
5. 谈判清单：按“必须修改 / 建议修改 / 可接受”分级；每项给出友好解释、建议条款方向和可退让底线，不伪造法条。
6. 缺失条款：列出应补充的定义、通知、验收、责任上限、不可抗力、数据处理或退出协助等内容，并说明原因。
7. 签署前清单：需要业务确认的事实、需要对方提供的附件、需要专业律师判断的问题。

不要仅复述合同，不要把常见条款一律判为高风险；风险等级必须结合{{scenario}}解释。`
  },
  {
    id: "user-research-synthesis",
    name: "用户研究合成器",
    category: "产品研究",
    description: "把访谈、问卷和观察记录压缩为可追溯主题、机会地图与下一轮验证方案。",
    iconKey: "product",
    accent: "#C084FC",
    target: "chat",
    fields: [
      { key: "evidence", label: "研究材料", type: "textarea", placeholder: "粘贴访谈记录、问卷开放题、客服反馈或观察笔记", required: true },
      { key: "product", label: "产品与阶段", type: "text", placeholder: "例如：个人财务 App，原型验证阶段", required: true },
      { key: "question", label: "核心研究问题", type: "textarea", placeholder: "这次研究最需要回答什么？", required: true },
      { key: "segments", label: "用户分群信息", type: "textarea", placeholder: "样本编号、角色、经验或可用于比较的标签" },
      { key: "decision", label: "待支持的决策", type: "text", placeholder: "例如：是否调整首次使用流程", required: true },
      { key: "method", label: "材料类型", type: "select", options: ["深度访谈", "可用性测试", "问卷与反馈", "混合研究"], defaultValue: "混合研究" }
    ],
    steps: [
      { id: "prepare", title: "整理证据", description: "按参与者和来源切分事实、行为与解释" },
      { id: "code", title: "开放编码", description: "提取重复模式、关键事件、动机和阻力" },
      { id: "contrast", title: "对比反例", description: "比较分群差异、矛盾证据与少数重要声音" },
      { id: "opportunity", title: "形成机会", description: "将主题转译为需求、机会与优先级" },
      { id: "validate", title: "规划验证", description: "提出可证伪假设和下一轮研究设计" }
    ],
    promptTemplate: `你是一名严谨的用户研究负责人。请基于{{method}}材料，为「{{product}}」完成研究合成。

核心研究问题：{{question}}
待支持的决策：{{decision}}
分群信息：{{segments}}
原始证据：
{{evidence}}

请按以下结构输出：
1. 样本与证据边界：列出可识别的样本、来源、缺失信息和不能代表总体的限制。
2. 决策摘要：给出 3-5 条最可能影响{{decision}}的发现，每条标注证据强度和涉及样本。
3. 主题矩阵：主题 / 用户行为或原话证据 / 涉及分群 / 频次描述 / 反例 / 产品含义。只有原文中的句子才能加引号，不得合成“用户原话”。
4. 体验旅程：按触发、尝试、关键任务、失败恢复、完成后感受排列痛点、需求和现有替代行为。
5. 张力与矛盾：专门保留无法被主流主题解释的案例，区分“用户说的”和“用户做的”。
6. 机会地图：用“当……时，用户需要……，以便……”描述机会，并按用户价值、覆盖证据、实现不确定性排序。
7. 验证计划：把前三项机会转为可证伪假设，给出方法、招募条件、关键任务、成功信号和停止条件。
8. 面向团队的分享稿：100 字摘要、三张建议幻灯片标题，以及不应从本研究得出的结论。

不要把出现次数等同于重要性，不要虚构百分比、人格画像或样本身份。`
  },
  {
    id: "constraint-aware-travel-plan",
    name: "约束型旅行规划",
    category: "生活规划",
    description: "在预算、体力、交通和真实偏好之间排出可执行行程，并准备天气与突发情况备选。",
    iconKey: "meeting",
    accent: "#2DD4BF",
    target: "chat",
    fields: [
      { key: "destination", label: "目的地与日期", type: "text", placeholder: "例如：京都，10 月 3 日至 7 日", required: true },
      { key: "travelers", label: "同行人与体力", type: "textarea", placeholder: "人数、年龄、步行能力、无障碍或儿童需求", required: true },
      { key: "interests", label: "兴趣与必去项", type: "textarea", placeholder: "喜欢什么、明确不喜欢什么、必须去的地点", required: true },
      { key: "budget", label: "预算范围", type: "text", placeholder: "请注明币种，是否包含住宿与交通", required: true },
      { key: "pace", label: "行程节奏", type: "select", options: ["松弛留白", "每日 2-3 个重点", "高密度探索"], defaultValue: "每日 2-3 个重点" },
      { key: "constraints", label: "交通、饮食与其他限制", type: "textarea", placeholder: "住宿区域、航班时间、饮食禁忌、行李、签证等" }
    ],
    steps: [
      { id: "constraints", title: "建立约束", description: "核对日期、预算、体力与不可移动事项" },
      { id: "cluster", title: "空间聚类", description: "按区域和开放时段组合每天活动" },
      { id: "schedule", title: "安排节奏", description: "平衡移动、排队、用餐、休息与探索" },
      { id: "budget", title: "核算预算", description: "按类别估算费用并保留弹性缓冲" },
      { id: "fallback", title: "准备备选", description: "针对天气、闭馆、疲劳和延误设置替代方案" }
    ],
    promptTemplate: `你是一名重视可执行性和在地节奏的旅行规划师。

目的地与日期：{{destination}}
同行人与体力：{{travelers}}
兴趣与必去项：{{interests}}
预算：{{budget}}
节奏：{{pace}}
交通、饮食与其他限制：{{constraints}}

请按以下结构输出：
1. 规划假设与待确认项：指出日期、交通、开放时间、价格或预订规则中需要实时核验的信息；不要把旧知识写成确定事实。
2. 行程策略：说明住宿或活动中心选择、区域分组、每天移动强度及为什么适合同伴。
3. 逐日时间轴：时间段 / 地点与活动 / 建议停留 / 点到点交通方式与估计耗时 / 用餐与休息 / 是否需预约。每日保留至少一段缓冲时间。
4. 每日 Plan B：针对下雨、闭馆、排队过长或体力不足给同区域替代，不跨城折返。
5. 预算表：住宿、城际交通、市内交通、餐饮、门票、购物与 10%-15% 缓冲；无法获知实时价格时给计算框架而非伪精确数字。
6. 预订与准备清单：按“现在 / 出发前一周 / 当天”排序，包含证件、网络、支付、天气与健康事项。
7. 地图清单：按天列出可直接录入地图的地点顺序，并标注必须核验的官方名称。
8. 轻量版本：若疲劳或延误，给一个删减 30% 活动但保留核心体验的方案。

避免早晚跨区往返和分钟级虚假精确；不推荐涉及安全、签证、医疗风险却未经核验的做法。`
  },
  {
    id: "editorial-infographic",
    name: "编辑级信息图",
    category: "信息设计",
    description: "把复杂主题压缩成层级明确、数据可读且适合后期排版的信息图视觉底稿。",
    iconKey: "brand",
    accent: "#06B6D4",
    target: "image",
    fields: [
      { key: "topic", label: "主题与核心结论", type: "textarea", placeholder: "例如：城市热岛如何形成，核心结论是绿地与反照率共同影响", required: true },
      { key: "facts", label: "必须呈现的信息", type: "textarea", placeholder: "列出流程、数据、类别或比较关系；文字可后期添加", required: true },
      { key: "audience", label: "目标读者", type: "text", placeholder: "例如：高中生、政策制定者、普通消费者", required: true },
      { key: "structure", label: "信息结构", type: "select", options: ["流程解释", "多维对比", "时间演进", "系统剖面", "数据仪表盘"], defaultValue: "流程解释" },
      { key: "style", label: "视觉语言", type: "select", options: ["科学编辑插画", "精密 3D 剖面", "现代扁平信息设计", "博物馆展陈图解"], defaultValue: "科学编辑插画" },
      { key: "palette", label: "色彩与画幅", type: "text", placeholder: "例如：冷白底、青绿与珊瑚红，竖版海报", required: true }
    ],
    steps: [
      { id: "hierarchy", title: "建立层级", description: "将一个核心结论拆为 3-5 个视觉模块" },
      { id: "encode", title: "编码信息", description: "用位置、尺度、颜色和连线表达真实关系" },
      { id: "compose", title: "组织版面", description: "建立清晰阅读顺序、网格和安全区" },
      { id: "illustrate", title: "统一图形", description: "保持图标、插画、透视和线宽一致" },
      { id: "audit", title: "可读性审计", description: "消除装饰噪声并为后期文字保留空间" }
    ],
    promptTemplate: `为{{audience}}创作一张{{structure}}信息图的高完成度视觉底稿。主题与核心结论：{{topic}}。必须表达的信息：{{facts}}。视觉语言：{{style}}。色彩与画幅：{{palette}}。

版面结构：顶部保留标题安全区；主体按照清晰单向阅读路径组织 3-5 个独立但相连的模块；底部保留来源与注释区。用空间位置表示顺序，用尺度表示重要性，用有限色彩区分类别，用箭头或连线表示真实因果与流向。所有模块对齐统一网格，边距充足。

视觉标准：图形语言一致、轮廓清楚、对比符合信息层级；复杂对象使用剖面、局部放大或小倍图解释，装饰不能伪装成数据。只允许极少量清晰的占位短标签，优先生成无文字的图示与留白供后期排版。避免不可读小字、乱码、伪造数字、3D 饼图、无意义仪表盘、交叉连线、霓虹科技背景、水印和 Logo。`
  },
  {
    id: "spatial-design-concept",
    name: "空间设计概念",
    category: "空间与建筑",
    description: "从使用者、动线、采光和材质维护出发，生成可信且可落地的室内空间概念图。",
    iconKey: "product",
    accent: "#84CC16",
    target: "image",
    fields: [
      { key: "space", label: "空间与尺度", type: "textarea", placeholder: "例如：35 平方米狭长咖啡店，层高 3.2 米", required: true },
      { key: "users", label: "使用者与活动", type: "textarea", placeholder: "人数、核心动作、无障碍或隐私需求", required: true },
      { key: "style", label: "设计方向", type: "text", placeholder: "例如：精密工业感与温暖木材的平衡", required: true },
      { key: "materials", label: "材质与色彩", type: "textarea", placeholder: "必须使用、避免使用、维护或预算要求", required: true },
      { key: "light", label: "采光条件", type: "text", placeholder: "朝向、窗户、自然光时段与人工照明偏好" },
      { key: "view", label: "表现视角", type: "select", options: ["入口广角实景", "人眼高度核心区", "轴测剖切视图", "夜间氛围实景"], defaultValue: "人眼高度核心区" }
    ],
    steps: [
      { id: "program", title: "空间编程", description: "把活动、人数与设备转成明确功能分区" },
      { id: "circulation", title: "组织动线", description: "处理入口、主路径、停留点和无障碍净宽" },
      { id: "light", title: "设计光环境", description: "协调自然光、任务照明和氛围照明" },
      { id: "material", title: "落地材质", description: "让接缝、尺度、耐久与清洁逻辑可信" },
      { id: "render", title: "真实呈现", description: "以准确透视和生活痕迹表达使用状态" }
    ],
    promptTemplate: `专业建筑室内实景概念图。空间与尺度：{{space}}。使用者与活动：{{users}}。设计方向：{{style}}。材质与色彩：{{materials}}。采光条件：{{light}}。采用{{view}}。

空间必须能被真实使用：入口、主通道、停留区、储物、设备与视线关系清晰；家具尺度符合人体工学，通行净宽可信，不用不可能的超大开间。自然光方向与窗户一致，任务照明落在实际工作面，环境光只用于补充层次。材质表现包含正确厚度、收口、接缝、反射与磨损逻辑。

成片像经过摄影师记录的已落成项目：垂直线受控，广角不过度，亮部不过曝，暗部有细节；加入少量与{{users}}一致的使用痕迹体现尺度，但不遮挡空间。避免漂浮家具、阻断动线、无支撑结构、重复物件、过度装饰、全屋同色、假 HDR、文字、Logo 和水印。`
  },
  {
    id: "ecommerce-campaign-grid",
    name: "电商组图导演",
    category: "电商视觉",
    description: "在一张四宫格中生成主体一致、卖点各异的电商组图分镜，适合建立整套商品视觉方向。",
    iconKey: "product",
    accent: "#FB7185",
    target: "image",
    fields: [
      { key: "product", label: "产品与固定特征", type: "textarea", placeholder: "产品结构、颜色、材质、包装及不可改变部分", required: true },
      { key: "benefits", label: "核心卖点", type: "textarea", placeholder: "列出 3-4 个需要分别表现的功能或体验", required: true },
      { key: "audience", label: "目标人群", type: "text", placeholder: "例如：重视轻量装备的城市骑行者", required: true },
      { key: "brand", label: "品牌气质", type: "text", placeholder: "例如：理性、精密、可靠，但不冰冷", required: true },
      { key: "palette", label: "统一色彩系统", type: "text", placeholder: "例如：冷白、石墨灰与信号黄" },
      { key: "format", label: "组图用途", type: "select", options: ["详情页四宫格", "社媒广告组图", "新品发布组图", "生活方式组图"], defaultValue: "详情页四宫格" }
    ],
    steps: [
      { id: "lock", title: "锁定产品", description: "建立跨画面一致的比例、材质、颜色和包装规则" },
      { id: "storyboard", title: "分配镜头", description: "分别设计英雄、功能、细节和使用场景镜头" },
      { id: "system", title: "统一系统", description: "让灯光、背景、色彩与留白形成系列感" },
      { id: "proof", title: "证明卖点", description: "用真实动作、尺度或材质反应展示功能" },
      { id: "quality", title: "一致性校验", description: "抑制跨格变形、重复与视觉层级漂移" }
    ],
    promptTemplate: `创建一张无缝对齐的 2x2 {{format}}视觉分镜板，四格中必须是同一个产品版本。产品与固定特征：{{product}}。核心卖点：{{benefits}}。目标人群：{{audience}}。品牌气质：{{brand}}。统一色彩：{{palette}}。

四格镜头分工：
左上：英雄镜头，完整展示产品和主要轮廓，预留文案区。
右上：功能证明，用可信动作或环境响应展示第一核心卖点，不使用虚假特效。
左下：微距细节，解释材质、工艺、接口或关键结构。
右下：真实使用场景，人物与环境符合{{audience}}，产品仍清晰可辨。

一致性规则：四格产品的几何比例、颜色、按钮、接口、Logo 位置和包装完全一致；光线方向可以因场景变化，但曝光、色彩分级和品牌质感统一。分隔线细且克制，每格构图可单独裁切。商业摄影级真实材质和接触阴影。不要生成宣传文字、错误 Logo、额外产品版本、变形结构、重复手指、悬浮物体、廉价粒子特效或水印。`
  },
  {
    id: "game-world-keyframe",
    name: "游戏世界关键帧",
    category: "游戏概念",
    description: "将玩法目标、空间路线和世界叙事融合为可供关卡与美术团队讨论的关键概念帧。",
    iconKey: "cinema",
    accent: "#8B5CF6",
    target: "image",
    fields: [
      { key: "world", label: "世界设定", type: "textarea", placeholder: "时代、文明、自然规则、冲突与独特母题", required: true },
      { key: "location", label: "关卡地点", type: "text", placeholder: "例如：悬挂在气态巨行星云层中的采矿修道院", required: true },
      { key: "gameplay", label: "核心玩法与玩家目标", type: "textarea", placeholder: "玩家要去哪里、做什么、主要风险是什么", required: true },
      { key: "landmarks", label: "关键地标与路线", type: "textarea", placeholder: "入口、中程目标、终点、可选路径或危险区", required: true },
      { key: "mood", label: "氛围与时间", type: "text", placeholder: "例如：暴风前的清晨，庄严但不安全", required: true },
      { key: "camera", label: "游戏镜头", type: "select", options: ["第三人称探索视角", "第一人称沉浸视角", "等距策略视角", "广角关卡建立镜头"], defaultValue: "第三人称探索视角" }
    ],
    steps: [
      { id: "route", title: "建立路线", description: "用地标、光线和高度差表达可读的玩家路径" },
      { id: "gameplay", title: "嵌入玩法", description: "让掩体、平台、危险与奖励服务核心机制" },
      { id: "world", title: "环境叙事", description: "通过建筑、遗迹和使用痕迹解释世界规则" },
      { id: "scale", title: "校准尺度", description: "用角色和熟悉物体建立可信空间比例" },
      { id: "keyframe", title: "凝固关键帧", description: "选择既展示目标又制造悬念的游戏瞬间" }
    ],
    promptTemplate: `AAA 游戏环境概念关键帧。世界设定：{{world}}。关卡地点：{{location}}。核心玩法与玩家目标：{{gameplay}}。关键地标与路线：{{landmarks}}。氛围与时间：{{mood}}。采用{{camera}}。

画面首先是一张可读的关卡：玩家当前位置清楚，近期交互点、中程地标和最终目标形成连续视线；利用光线、色彩、移动实体和建筑朝向引导，而不是依赖 UI 箭头。空间包含符合{{gameplay}}的掩体、垂直层次、风险区和可选探索线，路线不能被装饰阻断。

世界叙事通过结构功能、材料老化、维修痕迹和生态响应体现，所有设计服从{{world}}的规则。用玩家角色或可识别对象校准尺度，前中后景分明，大气透视准确，电影级但保留实时游戏可实现感。无 HUD、文字、水印；避免无意义巨构、复制建筑、不可达平台、纯概念雾、视觉噪声和缺少玩法信息的风景照。`
  },
  {
    id: "social-cover-system",
    name: "社媒封面系统",
    category: "传播视觉",
    description: "为指定平台生成高识别、可读性强且可延展成系列的封面视觉母版。",
    iconKey: "brand",
    accent: "#F43F5E",
    target: "image",
    fields: [
      { key: "topic", label: "内容主题", type: "textarea", placeholder: "这一期具体讲什么，最值得点击的信息是什么", required: true },
      { key: "series", label: "账号 / 系列定位", type: "text", placeholder: "例如：面向独立开发者的产品拆解栏目", required: true },
      { key: "platform", label: "发布平台", type: "select", options: ["小红书竖版", "视频号竖版", "B 站横版", "播客方形", "公众号头图"], defaultValue: "小红书竖版" },
      { key: "hook", label: "标题与视觉钩子", type: "textarea", placeholder: "提供标题文字，并说明希望强化的关键词；文字建议后期添加", required: true },
      { key: "assets", label: "主体素材", type: "textarea", placeholder: "人物、产品、界面、地点或象征物；没有可写纯图形", required: true },
      { key: "style", label: "视觉气质与配色", type: "text", placeholder: "例如：编辑感、锐利克制，黑白加信号绿", required: true }
    ],
    steps: [
      { id: "hook", title: "提炼钩子", description: "把主题压缩为一个强视觉冲突或具体收益" },
      { id: "hierarchy", title: "设计层级", description: "规划主体、标题安全区和系列识别位" },
      { id: "compose", title: "适配平台", description: "根据缩略图尺寸与界面遮挡调整构图" },
      { id: "system", title: "建立系列", description: "固定网格、颜色、裁切与标识位置规则" },
      { id: "thumbnail", title: "缩略图校验", description: "确保缩小后仍能辨认主题与主体" }
    ],
    promptTemplate: `为「{{series}}」生成一张适配{{platform}}的系列封面视觉母版。本期主题：{{topic}}。标题与视觉钩子：{{hook}}。主体素材：{{assets}}。视觉气质与配色：{{style}}。

构图层级：一个明确主体占据第一视觉层；围绕{{hook}}设计一个可在缩略图中识别的视觉冲突；为标题保留高对比、低细节的安全区，同时预留固定系列标识位和平台界面遮挡缓冲区。主体、标题区、系列位形成稳定三段层级，画面缩小到手机列表尺寸后仍清楚。

采用真实编辑设计手法：精确裁切、克制配色、有意留白、统一网格与少量结构化图形；让这张母版可通过替换主体和强调色延展成系列。不要直接生成长段文字，标题区域保持干净供后期排版；避免乱码、伪 Logo、廉价描边字、箭头堆叠、表情包拼贴、过量发光、无关装饰、水印和平台商标。`
  }
];

export function getInitialWorkflowValues(workflow: WorkflowTemplate): WorkflowValues {
  return Object.fromEntries(workflow.fields.map((field) => [field.key, field.defaultValue ?? ""]));
}

export function getMissingRequiredFields(workflow: WorkflowTemplate, values: WorkflowValues): WorkflowField[] {
  return workflow.fields.filter((field) => field.required && !values[field.key]?.trim());
}

export function compileWorkflow(workflow: WorkflowTemplate, values: WorkflowValues): string {
  const fieldMap = new Map(workflow.fields.map((field) => [field.key, field]));
  const compiledBody = workflow.promptTemplate.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, rawKey: string) => {
    const key = rawKey.trim();
    const value = values[key]?.trim();
    if (value) return value;
    const field = fieldMap.get(key);
    return field?.required ? `[待补充：${field.label}]` : "未指定";
  });

  const executionPlan = workflow.steps
    .map((step, index) => `${index + 1}. ${step.title}：${step.description}`)
    .join("\n");

  return `[AIWeb Workflow · ${workflow.name}]
任务通道：${workflow.target === "chat" ? "语言创作" : "视觉生成"}
执行计划：
${executionPlan || "1. 理解目标并完成任务"}

--- 编译后的任务指令 ---
${compiledBody.trim()}`;
}

export function getWorkflowPromptLengthError(target: WorkflowTarget, prompt: string): string | null {
  const limit = WORKFLOW_PROMPT_LIMITS[target];
  if (prompt.length <= limit) return null;
  const channel = target === "chat" ? "对话" : "生图";
  return `${channel}工作流编译结果为 ${prompt.length.toLocaleString("zh-CN")} 个字符，超过 ${limit.toLocaleString("zh-CN")} 字符上限。请精简变量内容或模板后再装载。`;
}

export function buildWorkflowUrl(workflow: WorkflowTemplate, prompt: string): string {
  const lengthError = getWorkflowPromptLengthError(workflow.target, prompt);
  if (lengthError) throw new Error(lengthError);
  if (typeof window === "undefined") throw new Error("工作流只能在浏览器中装载");

  try {
    window.sessionStorage.setItem(
      WORKFLOW_PENDING_PROMPT_STORAGE_KEY,
      JSON.stringify({ prompt, target: workflow.target, workflowId: workflow.id })
    );
  } catch {
    throw new Error("无法暂存工作流内容，请检查浏览器存储权限后重试。");
  }

  const pathname = workflow.target === "chat" ? "/chat" : "/image";
  const params = new URLSearchParams({ workflow: workflow.id });
  return `${pathname}?${params.toString()}`;
}

export function getWorkflowCategories(workflows: WorkflowTemplate[], target?: WorkflowTarget): string[] {
  return Array.from(
    new Set(workflows.filter((workflow) => !target || workflow.target === target).map((workflow) => workflow.category))
  );
}

function isWorkflowTarget(value: unknown): value is WorkflowTarget {
  return value === "chat" || value === "image";
}

function normalizeWorkflowField(value: unknown): WorkflowField | null {
  if (!value || typeof value !== "object") return null;
  const field = value as Partial<WorkflowField>;
  const key = typeof field.key === "string" ? field.key.trim().slice(0, 80) : "";
  const label = typeof field.label === "string" ? field.label.trim().slice(0, 120) : "";
  if (!key || !label || (field.type !== "text" && field.type !== "textarea" && field.type !== "select")) return null;

  let options: string[] | undefined;
  if (field.type === "select") {
    if (!Array.isArray(field.options)) return null;
    options = Array.from(
      new Set(field.options.filter((option): option is string => typeof option === "string").map((option) => option.trim().slice(0, 120)).filter(Boolean))
    ).slice(0, 50);
    if (!options.length) return null;
  }

  const rawDefault = typeof field.defaultValue === "string" ? field.defaultValue.trim().slice(0, 2000) : undefined;
  return {
    key,
    label,
    type: field.type,
    placeholder: typeof field.placeholder === "string" ? field.placeholder.trim().slice(0, 500) : undefined,
    required: field.required === true,
    options,
    defaultValue: field.type === "select" ? (rawDefault && options?.includes(rawDefault) ? rawDefault : options?.[0]) : rawDefault
  };
}

function normalizeWorkflowStep(value: unknown, index: number): WorkflowStep | null {
  if (!value || typeof value !== "object") return null;
  const step = value as Partial<WorkflowStep>;
  const title = typeof step.title === "string" ? step.title.trim().slice(0, 160) : "";
  const description = typeof step.description === "string" ? step.description.trim().slice(0, 500) : "";
  if (!title || !description) return null;
  return {
    id: typeof step.id === "string" && step.id.trim() ? step.id.trim().slice(0, 100) : `step-${index + 1}`,
    title,
    description
  };
}

function normalizeCustomWorkflow(value: unknown): WorkflowTemplate | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<WorkflowTemplate>;
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.category !== "string" ||
    typeof item.description !== "string" ||
    !isWorkflowTarget(item.target) ||
    !Array.isArray(item.fields) ||
    !Array.isArray(item.steps) ||
    typeof item.promptTemplate !== "string"
  ) {
    return null;
  }

  const fields = item.fields.slice(0, 24).map(normalizeWorkflowField);
  const steps = item.steps.slice(0, 20).map(normalizeWorkflowStep);
  if (fields.some((field) => !field) || steps.some((step) => !step)) return null;
  const normalizedFields = fields.filter((field): field is WorkflowField => Boolean(field));
  const normalizedSteps = steps.filter((step): step is WorkflowStep => Boolean(step));
  if (new Set(normalizedFields.map((field) => field.key)).size !== normalizedFields.length) return null;

  const name = item.name.trim().slice(0, 80);
  const category = item.category.trim().slice(0, 40);
  const promptTemplate = item.promptTemplate.trim().slice(0, 30000);
  if (!name || !category || !promptTemplate) return null;

  return {
    id: item.id,
    name,
    category,
    description: item.description.trim().slice(0, 500),
    iconKey: "custom",
    accent: typeof item.accent === "string" && /^#[0-9a-f]{6}$/i.test(item.accent) ? item.accent : "#5B7CFF",
    target: item.target,
    fields: normalizedFields,
    steps: normalizedSteps,
    promptTemplate,
    custom: true,
    createdAt: typeof item.createdAt === "string" && !Number.isNaN(Date.parse(item.createdAt)) ? item.createdAt : undefined
  };
}

export function loadCustomWorkflows(): WorkflowTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(getScopedWorkflowStorageKey(WORKFLOW_STORAGE_KEY)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeCustomWorkflow).filter((workflow): workflow is WorkflowTemplate => Boolean(workflow));
  } catch {
    return [];
  }
}

function persistCustomWorkflows(workflows: WorkflowTemplate[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getScopedWorkflowStorageKey(WORKFLOW_STORAGE_KEY), JSON.stringify(workflows));
  window.dispatchEvent(new CustomEvent(WORKFLOW_LIBRARY_CHANGED_EVENT));
}

export function saveCustomWorkflow(workflow: WorkflowTemplate): WorkflowTemplate[] {
  const normalized = normalizeCustomWorkflow({ ...workflow, custom: true });
  if (!normalized) throw new Error("工作流数据不完整");
  const current = loadCustomWorkflows();
  const next = [normalized, ...current.filter((item) => item.id !== normalized.id)];
  persistCustomWorkflows(next);
  return next;
}

export function deleteCustomWorkflow(id: string): WorkflowTemplate[] {
  const next = loadCustomWorkflows().filter((workflow) => workflow.id !== id);
  persistCustomWorkflows(next);
  return next;
}

export function createCustomWorkflowId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `custom-${Date.now().toString(36)}-${random}`;
}

export function fieldKeyFromLabel(label: string, index: number): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `field-${index + 1}`;
}

const MAX_RECENT_WORKFLOWS = 24;
const MAX_FAVORITE_WORKFLOWS = 200;

function createEmptyWorkflowUsage(): WorkflowUsageState {
  return { favorites: [], recent: [], useCounts: {} };
}

function normalizeWorkflowUsage(value: unknown): WorkflowUsageState {
  if (!value || typeof value !== "object") return createEmptyWorkflowUsage();

  const item = value as Partial<WorkflowUsageState>;
  const favorites = Array.isArray(item.favorites)
    ? Array.from(
        new Set(item.favorites.filter((workflowId): workflowId is string => typeof workflowId === "string" && Boolean(workflowId.trim())))
      ).slice(0, MAX_FAVORITE_WORKFLOWS)
    : [];

  const recentIds = new Set<string>();
  const recent = Array.isArray(item.recent)
    ? item.recent
        .filter((entry): entry is WorkflowRecentUse => {
          if (!entry || typeof entry !== "object") return false;
          if (typeof entry.workflowId !== "string" || !entry.workflowId.trim() || recentIds.has(entry.workflowId)) return false;
          if (typeof entry.usedAt !== "string" || Number.isNaN(Date.parse(entry.usedAt))) return false;
          recentIds.add(entry.workflowId);
          return true;
        })
        .slice(0, MAX_RECENT_WORKFLOWS)
    : [];

  const useCounts: Record<string, number> = {};
  if (item.useCounts && typeof item.useCounts === "object") {
    for (const [workflowId, count] of Object.entries(item.useCounts)) {
      if (!workflowId.trim() || typeof count !== "number" || !Number.isFinite(count) || count <= 0) continue;
      useCounts[workflowId] = Math.min(Math.floor(count), Number.MAX_SAFE_INTEGER);
    }
  }

  return { favorites, recent, useCounts };
}

/** Returns a normalized usage snapshot. On the server or with unavailable storage it returns an empty state. */
export function loadWorkflowUsage(): WorkflowUsageState {
  if (typeof window === "undefined") return createEmptyWorkflowUsage();
  try {
    const stored = window.localStorage.getItem(getScopedWorkflowStorageKey(WORKFLOW_USAGE_STORAGE_KEY));
    return stored ? normalizeWorkflowUsage(JSON.parse(stored) as unknown) : createEmptyWorkflowUsage();
  } catch {
    return createEmptyWorkflowUsage();
  }
}

function persistWorkflowUsage(
  state: WorkflowUsageState,
  action: WorkflowUsageChangedDetail["action"],
  workflowId: string
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getScopedWorkflowStorageKey(WORKFLOW_USAGE_STORAGE_KEY), JSON.stringify(state));
  } catch {
    return;
  }

  const detail: WorkflowUsageChangedDetail = { action, workflowId, state };
  window.dispatchEvent(new CustomEvent<WorkflowUsageChangedDetail>(WORKFLOW_USAGE_CHANGED_EVENT, { detail }));
}

/** Toggles a workflow favorite and returns the complete updated usage snapshot. */
export function toggleWorkflowFavorite(workflowId: string): WorkflowUsageState {
  const normalizedId = workflowId.trim();
  const current = loadWorkflowUsage();
  if (!normalizedId) return current;

  const isFavorite = current.favorites.includes(normalizedId);
  const next: WorkflowUsageState = {
    ...current,
    favorites: isFavorite
      ? current.favorites.filter((id) => id !== normalizedId)
      : [normalizedId, ...current.favorites].slice(0, MAX_FAVORITE_WORKFLOWS)
  };
  persistWorkflowUsage(next, "favorite", normalizedId);
  return next;
}

/** Records one execution, moves the workflow to the front of recent items, and returns the updated snapshot. */
export function recordWorkflowUse(workflowId: string, usedAt: Date = new Date()): WorkflowUsageState {
  const normalizedId = workflowId.trim();
  const current = loadWorkflowUsage();
  if (!normalizedId) return current;

  const nextCount = Math.min((current.useCounts[normalizedId] ?? 0) + 1, Number.MAX_SAFE_INTEGER);
  const next: WorkflowUsageState = {
    favorites: current.favorites,
    recent: [
      { workflowId: normalizedId, usedAt: usedAt.toISOString() },
      ...current.recent.filter((entry) => entry.workflowId !== normalizedId)
    ].slice(0, MAX_RECENT_WORKFLOWS),
    useCounts: { ...current.useCounts, [normalizedId]: nextCount }
  };
  persistWorkflowUsage(next, "use", normalizedId);
  return next;
}

/** Reads derived state for one workflow from a supplied snapshot or current local storage. */
export function getWorkflowStats(workflowId: string, usage: WorkflowUsageState = loadWorkflowUsage()): WorkflowStats {
  const recentRank = usage.recent.findIndex((entry) => entry.workflowId === workflowId);
  return {
    workflowId,
    favorite: usage.favorites.includes(workflowId),
    useCount: usage.useCounts[workflowId] ?? 0,
    lastUsedAt: recentRank >= 0 ? usage.recent[recentRank].usedAt : null,
    recentRank: recentRank >= 0 ? recentRank : null
  };
}

/** Returns a new list ordered by favorite, recency, use count, then original library order. */
export function sortWorkflowsByActivity(
  workflows: WorkflowTemplate[],
  usage: WorkflowUsageState = loadWorkflowUsage()
): WorkflowTemplate[] {
  const originalOrder = new Map(workflows.map((workflow, index) => [workflow.id, index]));
  const recentOrder = new Map(usage.recent.map((entry, index) => [entry.workflowId, index]));

  return [...workflows].sort((left, right) => {
    const favoriteDifference = Number(usage.favorites.includes(right.id)) - Number(usage.favorites.includes(left.id));
    if (favoriteDifference !== 0) return favoriteDifference;

    const leftRecent = recentOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRecent = recentOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftRecent !== rightRecent) return leftRecent - rightRecent;

    const countDifference = (usage.useCounts[right.id] ?? 0) - (usage.useCounts[left.id] ?? 0);
    if (countDifference !== 0) return countDifference;
    return (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0);
  });
}
