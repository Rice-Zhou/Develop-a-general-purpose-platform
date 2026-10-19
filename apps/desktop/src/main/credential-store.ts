import { safeStorage } from "electron";
import { join } from "node:path";
import { FileCredentialStore } from "../../../../packages/storage/src/credential-store";
export function createCredentialStore(dataPath: string): FileCredentialStore {
  return new FileCredentialStore(join(dataPath, "credentials"), {
    available: () =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== "linux" ||
        safeStorage.getSelectedStorageBackend() !== "basic_text"),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  });
}
