import { createHash } from "node:crypto";
import type {
  AIProfile,
  ExecutorIdentity,
} from "../../../contracts/src/analysis";
export function executorIdentity(profile: AIProfile): ExecutorIdentity {
  const identity = {
    profileId: profile.id,
    kind: profile.kind,
    name: profile.name,
    configuredModel: profile.model || null,
    location: profile.kind === "api" ? profile.baseUrl : profile.executable,
  };
  return Object.freeze({
    ...identity,
    configurationHash: createHash("sha256")
      .update(JSON.stringify(identity))
      .digest("hex"),
  });
}
