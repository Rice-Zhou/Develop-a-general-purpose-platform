import type {ReleaseProvider,UpdateOffer,UpdateStatus} from "../../../../packages/contracts/src/updates";
import {AppError,errorData} from "../../../../packages/contracts/src/error";
import type {UpdateDownloader,VerifiedUpdate} from "../../../../packages/adapters/src/updates/update-download";
export class UpdateService{
 private state:UpdateStatus;private startupChecked=false;private checkFlight:Promise<UpdateStatus>|null=null;private generation=0;private controller:AbortController|null=null;private verified:VerifiedUpdate|null=null;
 constructor(version:string,private readonly provider:ReleaseProvider,private readonly downloader:UpdateDownloader,private readonly cacheRoot:string,mode:UpdateStatus["installationMode"]){this.state={currentVersion:version,phase:"idle",offer:null,receivedBytes:0,error:null,startupPromptPending:false,installationMode:mode,lastCheckedAt:null};}
 getStatus():UpdateStatus{return structuredClone(this.state);}
 takeStartupPrompt():UpdateOffer|null{if(!this.state.startupPromptPending)return null;this.state.startupPromptPending=false;return this.state.offer?structuredClone(this.state.offer):null;}
 check(reason:"startup"|"manual"):Promise<UpdateStatus>{
  if(reason==="startup"){if(this.startupChecked)return this.checkFlight??Promise.resolve(this.getStatus());this.startupChecked=true;}
  if(this.checkFlight)return this.checkFlight;
  if(["downloading","installing"].includes(this.state.phase))return Promise.resolve(this.getStatus());
  this.state.phase="checking";this.state.error=null;const generation=++this.generation;
  this.checkFlight=(async()=>{try{
   const result=await this.provider.check(this.state.currentVersion,AbortSignal.timeout(30000));if(generation!==this.generation)return this.getStatus();
   if(result.kind==="available"){
    if(this.state.offer?.id!==result.offer.id){this.verified=null;this.state.receivedBytes=0;}
    this.state.offer=result.offer;this.state.phase=this.verified?"ready":"available";
    this.state.startupPromptPending=reason==="startup";
   }else{this.verified=null;this.state.offer=null;this.state.phase=result.kind==="current"?"up-to-date":"unavailable";this.state.startupPromptPending=false;}
  }catch(e){if(generation===this.generation){this.state.phase=this.verified?"ready":"error";this.state.error=errorData(e);}}finally{this.state.lastCheckedAt=new Date().toISOString();this.checkFlight=null;}return this.getStatus();})();return this.checkFlight;
 }
 async download(offerId:string):Promise<UpdateStatus>{
  if(this.state.offer?.id!==offerId||!["available","error","ready"].includes(this.state.phase)||this.checkFlight)throw new AppError("UPDATE_OFFER_CHANGED","更新版本已变化或正在操作，请重新检查更新");
  const offer=this.state.offer;if(this.verified)return this.getStatus();const generation=++this.generation;const controller=new AbortController();this.controller=controller;this.state.phase="downloading";this.state.error=null;this.state.receivedBytes=0;
  try{const verified=await this.downloader(offer,this.cacheRoot,controller.signal,bytes=>{if(generation===this.generation)this.state.receivedBytes=bytes;});if(generation===this.generation){this.verified=verified;this.state.phase="ready";}}
  catch(e){if(generation===this.generation){this.verified=null;this.state.phase="error";this.state.error=errorData(e);}}
  finally{if(this.controller===controller)this.controller=null;}return this.getStatus();
 }
 cancelDownload(){if(this.state.phase!=="downloading")return;this.generation++;this.controller?.abort();this.state.phase="available";this.state.receivedBytes=0;this.state.error=null;}
 async install(offerId:string,install:(offer:UpdateOffer,verified:VerifiedUpdate)=>Promise<void>):Promise<void>{
  if(this.state.phase!=="ready"||!this.verified||this.state.offer?.id!==offerId)throw new AppError("UPDATE_NOT_READY","请先下载并校验当前更新包");
  this.state.phase="installing";this.state.error=null;
  try{await install(this.state.offer,this.verified);}catch(e){this.state.phase="ready";this.state.error=errorData(e);throw e;}
 }
 markRestartRequired(){this.state.restartRequired=true;}
}
