import { KeyRound, Server, ShieldCheck } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";

const items = [
  {
    title: "后端环境变量",
    desc: "OPENAI_API_KEY 只放在 FastAPI 的 .env 中，前端不会读取或打包密钥。",
    icon: KeyRound
  },
  {
    title: "接口代理边界",
    desc: "浏览器只访问 /api/chat、/api/image 和 /api/history，由后端统一处理 OpenAI 请求。",
    icon: Server
  },
  {
    title: "安全预留",
    desc: "已加入输入长度校验、异常处理、CORS 和简单内存限流，可替换为 Redis 限流。",
    icon: ShieldCheck
  }
];

export default function SettingsPage() {
  return (
    <PageShell>
      <div className="grid gap-5 lg:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.title} className="p-6">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#5B7CFF]/10 text-[#5B7CFF]">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="mt-5 text-lg font-semibold">{item.title}</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.desc}</p>
            </Card>
          );
        })}
      </div>
    </PageShell>
  );
}
