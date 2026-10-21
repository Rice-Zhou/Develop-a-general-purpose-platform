import {z} from "zod";
import {AppError} from "../../../../packages/contracts/src/error";
import {publicIssueConnection} from "../../../../packages/contracts/src/issues";
import type {IssueConnection,IssueConnectionDraft,PublicIssueConnection,TrinityLoginStatus} from "../../../../packages/contracts/src/issues";
import {loginTrinity,readTrinityIdentity} from "../../../../packages/adapters/src/issues/login";
import type {FileCredentialStore} from "../../../../packages/storage/src/credential-store";
type TrinityDraft=Extract<IssueConnectionDraft,{kind:"trinity"}>;
interface Connections {connections():Promise<IssueConnection[]>;commit(connection:IssueConnection):Promise<unknown>}
const remembered=z.object({baseUrl:z.string(),username:z.string().min(1),accountId:z.string().min(1),password:z.string().min(1).max(16000)}).strict();
export class TrinityLogin {
 private current:TrinityLoginStatus={state:"running",message:"正在检查 Trinity 自动登录…"};
 private once:Promise<void>|undefined;
 constructor(private readonly vault:Pick<FileCredentialStore,"save"|"resolve"|"remove">,private readonly connections:Connections,private readonly login=loginTrinity,private readonly identity=readTrinityIdentity){}
 status():TrinityLoginStatus{return {...this.current};}
 forget():void{this.current={state:"disabled",message:"Trinity 自动登录已关闭"};}
 startup():Promise<void>{return this.once??=this.restore();}
 private async restore():Promise<void>{
  try{
   const connection=(await this.connections.connections()).find(c=>c.kind==="trinity");
   if(!connection||connection.kind!=="trinity"||!connection.autoLogin){this.current={state:"disabled",message:"Trinity 自动登录未开启"};return;}
   if(!connection.passwordRef||!connection.username||!connection.accountId)throw new AppError("TRINITY_PASSWORD_REQUIRED","自动登录凭据缺失");
   const saved=remembered.parse(JSON.parse(await this.vault.resolve(connection.passwordRef,connection.id)));
   if(saved.baseUrl!==connection.baseUrl||saved.username!==connection.username||saved.accountId!==connection.accountId)throw new AppError("TRINITY_ACCOUNT_CHANGED","自动登录账号配置不匹配");
   const token=await this.login(connection.baseUrl,saved.username,saved.password);
   const identity=await this.identity(connection.baseUrl,token);
   if(identity.accountId!==connection.accountId)throw new AppError("TRINITY_ACCOUNT_CHANGED","自动登录返回了不同账号");
   await this.persist({...connection},token,connection.passwordRef,connection);
   this.current={state:"succeeded",message:"Trinity 已自动登录"};
  }catch(error){
   this.current={state:"failed",code:error instanceof AppError?error.code:"TRINITY_AUTO_LOGIN_FAILED",message:"Trinity 自动登录失败，请到设置编辑 Trinity 连接并重新登录；本次启动不再自动重试。"};
  }
 }
 async save(draft:TrinityDraft,password:string|undefined,existing:IssueConnection|undefined,id=existing?.id):Promise<PublicIssueConnection>{
  if(!id)throw new AppError("ISSUE_CONNECTION_INVALID","缺少 Trinity 连接标识");
  const same=existing?.kind==="trinity"&&existing.baseUrl===draft.baseUrl&&existing.username===draft.username;
  if(!password){
   if(draft.autoLogin||!same||!existing.credentialRef||!existing.accountId)throw new AppError("ISSUE_LOGIN_REQUIRED","请填写账号密码后登录 Trinity");
   const value={...draft,id,accountId:existing.accountId,autoLogin:false,passwordRef:null,credentialRef:existing.credentialRef};
   if(existing.passwordRef)await this.vault.remove(existing.passwordRef);
   await this.connections.commit(value);
   this.current={state:"disabled",message:"Trinity 自动登录已关闭，保存的密码已清除"};
   return publicIssueConnection(value);
  }
  if(!draft.username)throw new AppError("ISSUE_LOGIN_REQUIRED","请填写 Trinity 账号");
  const token=await this.login(draft.baseUrl,draft.username,password);
  const identity=await this.identity(draft.baseUrl,token);
  let passwordRef:string|null=null;
  if(draft.autoLogin)passwordRef=await this.vault.save(id,JSON.stringify({baseUrl:draft.baseUrl,username:draft.username,accountId:identity.accountId,password}));
  const value={...draft,...identity,id,autoLogin:draft.autoLogin??false};
  const saved=await this.persist(value,token,passwordRef,existing);
  this.current={state:draft.autoLogin?"succeeded":"disabled",message:draft.autoLogin?"Trinity 已登录，后续启动将自动登录":"Trinity 已登录，未保存账号密码"};
  return publicIssueConnection(saved);
 }

 private async persist(value:TrinityDraft & {id:string},token:string,passwordRef:string|null,existing:IssueConnection|undefined):Promise<IssueConnection>{
  let credentialRef:string|undefined;
  try{
   credentialRef=await this.vault.save(value.id,token);
   // Keep the old reference recoverable if removing a remembered password fails.
   if(existing?.passwordRef&&existing.passwordRef!==passwordRef)await this.vault.remove(existing.passwordRef);
   await this.connections.commit({...value,credentialRef,passwordRef});
  }catch(error){
   if(credentialRef)await this.vault.remove(credentialRef);
   if(passwordRef&&passwordRef!==existing?.passwordRef)await this.vault.remove(passwordRef);
   throw error;
  }
  if(existing?.credentialRef&&existing.credentialRef!==credentialRef)await this.vault.remove(existing.credentialRef);
  return {...value,credentialRef:credentialRef!,passwordRef};
 }
}
