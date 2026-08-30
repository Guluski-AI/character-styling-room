import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto");
  const protocol =
    forwardedProtocol ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);

  return {
    metadataBase,
    title: "角色造型室｜数字人穿搭提示词",
    description:
      "为数字角色选择穿搭方向，并生成可用于生图、视频及其他 AI 创作工具的提示词。",
    icons: {
      icon: "/app-icon.png",
      shortcut: "/app-icon.png",
      apple: "/app-icon.png",
    },
    openGraph: {
      title: "角色造型室",
      description: "为数字角色，找到合适的穿搭方向。",
      type: "website",
      images: [{ url: "/og-v3.png", width: 1731, height: 909 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "角色造型室",
      description: "为数字角色，找到合适的穿搭方向。",
      images: ["/og-v3.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <meta
          httpEquiv="Content-Security-Policy"
          content={[
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: http://127.0.0.1:43127",
            "connect-src 'self' http://127.0.0.1:43127",
            "font-src 'self' data:",
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
          ].join("; ")}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
