import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Tests live in test/ (not src/) so they are neither shipped in the npm
    // tarball (files = src + .medusa/server) nor compiled by `medusa plugin:build`.
  },
})
