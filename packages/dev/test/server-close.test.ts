import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";

vi.mock("@componentonce/compiler-esbuild", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@componentonce/compiler-esbuild")>();
  return {
    ...actual,
    async watchTrustedModuleFile(
      ...args: Parameters<typeof actual.watchTrustedModuleFile>
    ) {
      const watcher = await actual.watchTrustedModuleFile(...args);
      return {
        ...watcher,
        async dispose() {
          await watcher.dispose();
          throw new Error("synthetic watcher dispose failure");
        },
      };
    },
  };
});

const { createComponentOnceDevServer } = await import("../dist/index.js");

it("releases the HTTP listener before propagating compiler cleanup failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "componentonce-server-close-"));
  const entry = join(dir, "entry.tsx");
  await writeFile(
    entry,
    'export const definition={manifest:{id:"test/close",version:"1"},implementation:()=>null};',
  );
  const server = await createComponentOnceDevServer({ entry, cwd: resolve("."), port: 0 });
  const probe = createServer();
  try {
    await expect(server.close()).rejects.toThrow("synthetic watcher dispose failure");
    await new Promise<void>((done, reject) => {
      probe.once("error", reject);
      probe.listen(server.port, "127.0.0.1", done);
    });
  } finally {
    await new Promise<void>((done) => probe.close(() => done()));
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
