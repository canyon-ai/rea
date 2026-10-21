import {
  requireWindowsNativeAuthority,
  windowsFileIdentitySchema,
  windowsHandleSchema,
} from "./WindowsNativeLoader.js";

const admittedFileSchema = windowsFileIdentitySchema.extend({
  handle: windowsHandleSchema,
});

/** Pin a local NTFS file and its ancestors against write/delete and reparses.
 * The caller owns the lease before metadata validation and must release it after
 * closing any borrowed Node descriptor, including failed reads/admission.
 */
export const guardWindowsFileRead = (
  path: string,
  retain: (lease: { release(): Promise<void> }) => void,
): void => {
  const authority = requireWindowsNativeAuthority();
  const observed = authority.call("open", [path]);
  const handle = windowsHandleSchema.parse(
    typeof observed === "object" && observed !== null
      ? Reflect.get(observed, "handle")
      : undefined,
  );
  let closed = false;
  retain({
    release() {
      if (!closed) {
        authority.call("close", [handle]);
        closed = true;
      }
      return Promise.resolve();
    },
  });
  admittedFileSchema.parse(observed);
};
