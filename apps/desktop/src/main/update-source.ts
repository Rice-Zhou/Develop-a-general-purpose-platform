import {z} from "zod";
import {UpdateManifestSchema,type ReleaseProvider} from "../../../../packages/contracts/src/updates";
import {GitHubReleaseProvider,type UpdateTransport} from "../../../../packages/adapters/src/updates/github-release";
import {AppError} from "../../../../packages/contracts/src/error";
// Only isolated desktop tests may replace the release transport with a loopback server.
export function updateSource(env:NodeJS.ProcessEnv):{provider:ReleaseProvider;transport?:UpdateTransport}{
 if(env.PLATFORM_E2E!=="1"||!env.PLATFORM_UPDATE_E2E_URL)return {provider:new GitHubReleaseProvider()};
 const url=new URL(env.PLATFORM_UPDATE_E2E_URL);if(url.protocol!=="http:"||url.hostname!=="127.0.0.1"||url.pathname!=="/"||url.username||url.password)throw new AppError("UPDATE_TEST_SOURCE_INVALID","更新测试源必须是本机 loopback 服务");
 const schema=z.discriminatedUnion("kind",[z.object({kind:z.literal("current"),version:z.string()}),z.object({kind:z.literal("no-release")}),z.object({kind:z.literal("available"),offer:z.object({id:z.string(),version:z.string(),notes:z.string(),releaseUrl:z.string(),assetUrl:z.string(),manifest:UpdateManifestSchema})})]);
 return {provider:{check:async(_version,signal)=>{const response=await fetch(url,{signal,redirect:"error"});if(!response.ok)throw new AppError("UPDATE_CHECK_FAILED",`更新检查失败（HTTP ${response.status}）`);return schema.parse(await response.json());}},transport:((_input,init)=>fetch(new URL("/asset",url),{...init,redirect:"error"})) as UpdateTransport};
}
