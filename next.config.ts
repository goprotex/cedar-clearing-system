import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Multiple lockfiles (e.g. user home + this repo) confuse Turbopack's root inference;
// pin the app root so dev/build resolve `next` and compile from this directory.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
