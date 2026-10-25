import { defineConfig } from "vitest/config";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Isolate unit tests from the developer's real .data directory: the audit
// JSONL and the persisted-state deltas both get their own temp location.
const auditDir = mkdtempSync(path.join(tmpdir(), "hcm-audit-test-"));
const stateDir = mkdtempSync(path.join(tmpdir(), "hcm-state-test-"));
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
    },
  },
  test: {
    env: {
      AUDIT_FILE: path.join(auditDir, "audit.jsonl"),
      HCM_STATE_DIR: stateDir,
    },
  },
});
