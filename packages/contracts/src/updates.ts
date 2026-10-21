import {z} from "zod";
import {valid,prerelease} from "semver";
import type {ErrorData} from "./models";
export const MAX_UPDATE_BYTES=1024**3;
export const UpdateManifestSchema=z.object({schemaVersion:z.literal(1),version:z.string().refine(v=>valid(v)===v&&!prerelease(v),"版本必须为正式 SemVer"),platform:z.literal("win32"),arch:z.literal("x64"),assetName:z.literal("LocalDevPlatformSetup.exe"),size:z.number().int().positive().max(MAX_UPDATE_BYTES),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type UpdateManifest=z.infer<typeof UpdateManifestSchema>;
export interface UpdateOffer{id:string;version:string;releaseUrl:string;notes:string;manifest:UpdateManifest;assetUrl:string}
export type ReleaseCheck={kind:"current";version:string}|{kind:"no-release"}|{kind:"available";offer:UpdateOffer};
export interface ReleaseProvider{check(currentVersion:string,signal:AbortSignal):Promise<ReleaseCheck>}
export type UpdatePhase="idle"|"checking"|"up-to-date"|"unavailable"|"available"|"downloading"|"ready"|"installing"|"error";
export interface UpdateStatus{currentVersion:string;phase:UpdatePhase;offer:UpdateOffer|null;receivedBytes:number;error:ErrorData|null;startupPromptPending:boolean;installationMode:"installed"|"portable"|"development";lastCheckedAt:string|null;restartRequired?:boolean}
