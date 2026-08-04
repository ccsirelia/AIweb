import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AIWeb Studio",
    short_name: "AIWeb",
    description: "AI 对话、图像创作与智能工作流工作台。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#090a0f",
    theme_color: "#090a0f",
    lang: "zh-CN",
    categories: ["productivity", "utilities", "graphics"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      }
    ],
    shortcuts: [
      {
        name: "新建 AI 对话",
        short_name: "AI 对话",
        description: "直接进入 AI 对话工作台",
        url: "/chat",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }]
      },
      {
        name: "创作 AI 图像",
        short_name: "AI 生图",
        description: "直接进入 AI 图像工作台",
        url: "/image",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }]
      }
    ]
  };
}
