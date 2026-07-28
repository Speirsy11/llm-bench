import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@llm-bench/control-plane", "@llm-bench/crypto"],
};

export default config;
