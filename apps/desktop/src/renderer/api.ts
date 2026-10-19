import type {
  DesktopAPI,
  Result,
} from "../../../../packages/contracts/src/models";
declare global {
  interface Window {
    platform: DesktopAPI;
  }
}
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok)
    throw new Error(
      `[${result.error.code}] ${result.error.message}${result.error.requiredAction ? `；${result.error.requiredAction}` : ""}`,
    );
  return result.value;
}
export const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
