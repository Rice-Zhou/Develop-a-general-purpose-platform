import { spawn } from 'node:child_process';
import { AppError } from '../../../contracts/src/error';
import { terminateProcessTree } from '../git/process-tree';
export interface ProcessOptions { cwd:string;input?:string;signal?:AbortSignal;timeoutMs?:number;maxOutput?:number;env?:NodeJS.ProcessEnv; }
export function runProcess(executable:string,args:string[],options:ProcessOptions):Promise<string>{
 if(options.signal?.aborted)return Promise.reject(new AppError('CANCELLED','进程调用已取消'));
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{cwd:options.cwd,windowsHide:true,shell:false,detached:process.platform!=='win32',env:options.env??process.env,stdio:['pipe','pipe','pipe']});
  const chunks:Buffer[]=[];let count=0;let reason:AppError|null=null;let stopping:Promise<void>|null=null;
  const clean=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);};
  const stop=(error:AppError)=>{if(stopping||!child.pid)return;reason=error;stopping=terminateProcessTree(child.pid).catch((failure:unknown)=>{reason=failure instanceof AppError?failure:new AppError('PROCESS_STOP_UNCONFIRMED','无法确认进程退出');clean();reject(reason);});};
  const abort=()=>stop(new AppError('CANCELLED','本次进程调用已取消'));
  const timer=setTimeout(()=>stop(new AppError('PROCESS_TIMEOUT','进程调用超时，已终止进程树')),options.timeoutMs??30000);
  options.signal?.addEventListener('abort',abort,{once:true});
  child.stdin.on('error',(error:NodeJS.ErrnoException)=>{if(error.code!=='EPIPE')stop(new AppError('PROCESS_INPUT_FAILED','无法传入任务材料'));});
  child.stdin.end(options.input);
  child.stdout.on('data',(buffer:Buffer)=>{count+=buffer.length;if(count>(options.maxOutput??8*1024*1024))stop(new AppError('PROCESS_OUTPUT_LIMIT','进程输出超过限制'));else chunks.push(buffer);});
  child.stderr.on('data',()=>{/* Raw CLI diagnostics may contain account data; exit status remains visible. */});
  child.once('error',()=>{clean();reject(new AppError('PROCESS_UNAVAILABLE','无法启动配置的可执行文件，请检查路径和执行权限'));});
  child.once('close',(code)=>{void(async()=>{clean();await stopping;if(reason){reject(reason);return;}if(code!==0){reject(new AppError('PROCESS_FAILED',`工具退出码 ${code}，请检查工具登录、权限及版本`));return;}resolve(Buffer.concat(chunks).toString('utf8'));})();});
 });
}
