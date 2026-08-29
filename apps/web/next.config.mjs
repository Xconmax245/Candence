/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @cadence/shared is a workspace TS package consumed directly.
  transpilePackages: ["@cadence/shared"],
  experimental: {
    // Server Actions + RSC data reads hit chain/REST directly (never mock data).
    serverComponentsExternalPackages: ["viem"],
  },
  webpack(config) {
    // @cadence/shared is authored as ESM-correct TypeScript: its internal imports
    // carry explicit ".js" extensions (required by the Node/tsx consumers —
    // watcher, ai-copilot, scripts — and for publishing @cadence/agent-kit).
    // Webpack must resolve those ".js" specifiers to the real ".ts"/".tsx" source.
    // This is the standard extensionAlias fix; it changes nothing for the other
    // consumers, it only teaches webpack what tsc already does under Bundler
    // resolution.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};
export default nextConfig;


