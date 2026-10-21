import { lstat, mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as regularFile from "../../../src/filesystem/RegularFile.js";
import * as native from "../../../src/windows/WindowsNativeLoader.js";
import { guardWindowsFileRead } from "../../../src/windows/WindowsFileReadGuard.js";
import { readReferenceSource } from "../../support/referenceSourceResourceScope.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { readReferenceSource as readScoped } from "../../../src/reference/ReferenceSourceReader.js";

afterEach(() => vi.restoreAllMocks());

it.runIf(process.platform === "win32")(
  "does not erase a selected root's junction ancestor before native admission",
  async () => {
    const root = await createTestTempDirectory(
      "rea-windows-reference-root-alias-",
    );
    const outside = await createTestTempDirectory(
      "rea-windows-reference-root-target-",
    );
    await mkdir(join(outside, "nested"));
    await writeFile(join(outside, "nested", "source.js"), "OUTSIDE_SENTINEL");
    await symlink(outside, join(root, "alias"), "junction");
    const result = await readReferenceSource(join(root, "alias", "nested"));
    if (!result.ok) throw result.error;
    expect(result.value.bytesRead).toBe(0);
    expect(result.value.entries).toContainEqual(
      expect.objectContaining({
        path: "source.js",
        status: "failed",
        code: "io",
        message: expect.stringContaining("Reparse path component"),
      }),
    );
  },
);

describe.skipIf(process.platform !== "win32")(
  "Windows native reference source admission",
  () => {
    it("holds native write/delete exclusion through the borrowed read and releases both handles", async () => {
      const root = await createTestTempDirectory("rea-windows-reference-lock-");
      const file = join(root, "source.js");
      await writeFile(file, "export const original = true;");
      const open = regularFile.openRegularFile;
      let examined = false;
      vi.spyOn(regularFile, "openRegularFile").mockImplementation(
        async (path, options) => {
          if (path === file) {
            examined = true;
            await expect(writeFile(file, "MUTATED")).rejects.toMatchObject({
              code: expect.any(String),
            });
            await expect(
              rename(file, join(root, "renamed.js")),
            ).rejects.toMatchObject({ code: expect.any(String) });
          }
          return open(path, options);
        },
      );
      const result = await readReferenceSource(root);
      if (!result.ok) throw result.error;
      expect(examined).toBe(true);
      expect(result.value.entries).toContainEqual(
        expect.objectContaining({
          path: "source.js",
          status: "read",
          bytes: Buffer.from("export const original = true;"),
        }),
      );
      await expect(writeFile(file, "released")).resolves.toBeUndefined();
      await expect(
        rename(file, join(root, "released.js")),
      ).resolves.toBeUndefined();
    });

    it("rejects junction ancestors at the native file boundary and does not import their bytes", async () => {
      const root = await createTestTempDirectory(
        "rea-windows-reference-junction-",
      );
      const outside = await createTestTempDirectory(
        "rea-windows-reference-outside-",
      );
      await writeFile(join(outside, "secret.js"), "OUTSIDE_SENTINEL");
      const junction = join(root, "linked");
      await symlink(outside, junction, "junction");
      expect((await lstat(junction)).isSymbolicLink()).toBe(true);
      const guards: { release(): Promise<void> }[] = [];
      try {
        expect(() =>
          guardWindowsFileRead(join(junction, "secret.js"), (guard) =>
            guards.push(guard),
          ),
        ).toThrow(/Reparse path component/u);
      } finally {
        for (const guard of guards) await guard.release();
      }
      const read = await readReferenceSource(root);
      if (!read.ok) throw read.error;
      expect(read.value.bytesRead).toBe(0);
      expect(read.value.entries).toContainEqual(
        expect.objectContaining({
          path: "linked",
          kind: "symlink",
          targetState: "external",
        }),
      );
      const selectedRoot = await readReferenceSource(junction);
      expect(selectedRoot).toMatchObject({
        ok: false,
        error: { code: "invalid-root" },
      });
    });

    it("fails closed when verified native authority is absent rather than using pathname fallback", async () => {
      const root = await createTestTempDirectory(
        "rea-windows-reference-unavailable-",
      );
      await writeFile(join(root, "source.js"), "source");
      vi.spyOn(native, "systemWindowsNativeAuthority").mockReturnValue({
        available: false,
        failureStage: "artifact",
        reason: "fixture native artifact missing",
      });
      const open = vi.spyOn(regularFile, "openRegularFile");
      const result = await readReferenceSource(root);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "unsupported" },
      });
      expect(open).not.toHaveBeenCalled();
    });

    it("releases native guards after a cancelled borrowed admission", async () => {
      const root = await createTestTempDirectory(
        "rea-windows-reference-cancel-",
      );
      const file = join(root, "source.js");
      await writeFile(file, "observed");
      const controller = new AbortController(),
        open = regularFile.openRegularFile;
      vi.spyOn(regularFile, "openRegularFile").mockImplementation(
        async (path, options) => {
          controller.abort();
          return open(path, options);
        },
      );
      const result = await readReferenceSource(root, {
        signal: controller.signal,
      });
      expect(result).toMatchObject({ ok: false, error: { code: "cancelled" } });
      await expect(writeFile(file, "released")).resolves.toBeUndefined();
    });

    it("retains the native guard when Node close fails, until the exact composite owner retries", async () => {
      const root = await createTestTempDirectory(
        "rea-windows-reference-close-",
      );
      const file = join(root, "source.js");
      await writeFile(file, "observed");
      const resources = new ArtifactResourceScope(),
        open = regularFile.openRegularFile;
      vi.spyOn(regularFile, "openRegularFile").mockImplementation(
        async (path, options) => {
          const handle = await open(path, options);
          vi.spyOn(handle, "close").mockRejectedValueOnce(
            Object.assign(new Error("injected close failure"), { code: "EIO" }),
          );
          return handle;
        },
      );
      try {
        const result = await readScoped(root, resources);
        expect(result).toMatchObject({
          ok: false,
          error: { code: "io", cleanup: { resources: [file] } },
        });
        expect(resources.hasPending).toBe(true);
        await expect(writeFile(file, "MUTATED")).rejects.toBeDefined();
        await resources.retryCleanup();
        expect(resources.hasPending).toBe(false);
        await expect(writeFile(file, "released")).resolves.toBeUndefined();
      } finally {
        await resources.close();
      }
    });
  },
);

it.runIf(process.platform === "win32")(
  "retains cancellation arriving during final native close after the physical read",
  async () => {
    const root = await createTestTempDirectory(
      "rea-windows-reference-final-cancel-",
    );
    const file = join(root, "source.js");
    await writeFile(file, "observed");
    const controller = new AbortController();
    const authority = native.requireWindowsNativeAuthority();
    vi.spyOn(native, "requireWindowsNativeAuthority").mockReturnValue({
      ...authority,
      call(operation, args) {
        const value = authority.call(operation, args);
        if (operation === "close") controller.abort();
        return value;
      },
    });
    const result = await readReferenceSource(root, {
      signal: controller.signal,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "cancelled" } });
    await expect(writeFile(file, "released")).resolves.toBeUndefined();
  },
);
