import {AppError} from "../../../contracts/src/error";
export class WorkGate{
 private frozen=false;
 assertAccepting(){if(this.frozen)throw new AppError("UPDATE_IN_PROGRESS","客户端正在准备安装更新，请稍后重启客户端");}
 freezeIfIdle(isBusy:()=>boolean){this.assertAccepting();this.frozen=true;try{if(isBusy())throw new AppError("UPDATE_TASKS_ACTIVE","仍有任务执行或排队，请到任务列表等待完成或自行取消后再安装");}catch(e){this.frozen=false;throw e;}}
 release(){this.frozen=false;}
}
