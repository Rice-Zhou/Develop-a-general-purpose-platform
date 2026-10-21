import {z} from "zod";
import {AppError} from "../../../contracts/src/error";
import type {CodexModel} from "../../../contracts/src/codex";
export type CodexRequest=(method:string,params:unknown)=>Promise<unknown>;
const page=z.object({data:z.array(z.object({model:z.string().min(1).max(200),displayName:z.string().min(1).max(200),hidden:z.boolean().optional(),isDefault:z.boolean()})),nextCursor:z.string().min(1).nullable().optional()});
export async function readCodexCatalogue(request:CodexRequest) {
 const account=z.object({account:z.object({type:z.string(),planType:z.string().nullable().optional()}).nullable()}).safeParse(await request("account/read",{refreshToken:false}));
 if(!account.success)throw new AppError("CODEX_CATALOG_INVALID","Codex 账号响应格式无效");
 if(account.data.account?.type!=="chatgpt")throw new AppError("CODEX_LOGIN_REQUIRED","请先在 Codex CLI 或桌面端使用 ChatGPT 账号登录，再重新检测");
 // exec ignores user config. Do not offer a catalogue injected by config that execution will omit.
 const config=z.object({config:z.object({model_provider:z.string().nullish(),model_catalog_json:z.string().nullish(),chatgpt_base_url:z.string().nullish(),model_providers:z.record(z.string(),z.unknown()).optional()})}).safeParse(await request("config/read",{includeLayers:false}));
 if(!config.success)throw new AppError("CODEX_CATALOG_INVALID","无法确认 Codex 模型配置是否与隔离执行一致，请更新 CLI 后重新检测");
 const settings=config.data.config;const provider=settings.model_providers?.openai;
 if(settings.model_catalog_json||(settings.chatgpt_base_url&&!/^https:\/\/chatgpt\.com\/backend-api\/?$/.test(settings.chatgpt_base_url))||(settings.model_provider&&settings.model_provider!=="openai")||(provider&&typeof provider==="object"&&Object.keys(provider).length))throw new AppError("CODEX_CONFIG_INCOMPATIBLE","Codex 使用自定义模型目录或模型服务，与平台隔离执行不一致；请使用标准 ChatGPT 登录配置后重新检测");
 const models=new Map<string,CodexModel>();const cursors=new Set<string>();let cursor:string|undefined;
 for(let n=0;n<20;n++){
  const value=page.safeParse(await request("model/list",{limit:100,includeHidden:false,...(cursor?{cursor}:{})}));
  if(!value.success)throw new AppError("CODEX_CATALOG_INVALID","Codex 模型目录格式无效，请更新 CLI 后重新检测");
  for(const model of value.data.data){if(model.hidden)continue;if(models.has(model.model))throw new AppError("CODEX_CATALOG_INVALID","Codex 模型目录包含重复条目，请重新检测");models.set(model.model,{id:model.model,name:model.displayName,isDefault:model.isDefault});}
  const next=value.data.nextCursor;
  if(!next){if(!models.size)throw new AppError("CODEX_MODELS_EMPTY","当前 Codex 登录未返回可选模型，请检查账号或工作区权限");return {models:[...models.values()],planType:account.data.account.planType??null};}
  if(cursors.has(next))throw new AppError("CODEX_CATALOG_INVALID","Codex 模型分页重复，未使用不完整列表");cursors.add(next);cursor=next;
 }
 throw new AppError("CODEX_CATALOG_INVALID","Codex 模型分页超过限制，未使用不完整列表");
}
