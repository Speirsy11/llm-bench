import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeControl } from "@/components/theme-control";

import "./globals.css";

import { themeInitializationScript } from "./theme-initialization";

export const metadata: Metadata = {
  title: "LLMBench",
  description:
    "Reproducible comparisons of models, harnesses, and toolsets on paired runners.",
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeInitializationScript }}
        />
      </head>
      <body>
        {children}
        <ThemeControl />
      </body>
    </html>
  );
}
