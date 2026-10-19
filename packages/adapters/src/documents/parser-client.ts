import { z } from 'zod';
import { DocumentBlockSchema,WarningSchema,type ParsedDocument } from '../../../contracts/src/documents';
import type { DocumentBinding,DocumentParser } from '../../../core/src/documents/ports';
import { runProcess } from '../process/run-process';
import { AppError } from '../../../contracts/src/error';
const response=z.object({blocks:z.array(DocumentBlockSchema),warnings:z.array(WarningSchema),parserVersion:z.string()}).strict();
export class ParserClient implements DocumentParser {
 constructor(private readonly worker:string,private readonly cwd:string){}
 async parse(kind:DocumentBinding['kind'],bytes:Buffer,signal:AbortSignal):Promise<ParsedDocument>{
  const env:NodeJS.ProcessEnv={ELECTRON_RUN_AS_NODE:'1'};
  for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH'])if(process.env[key])env[key]=process.env[key];
  const raw=await runProcess(process.execPath,['--max-old-space-size=256',this.worker],{cwd:this.cwd,env,signal,timeoutMs:60000,maxOutput:16*1024*1024,input:JSON.stringify({kind,bytes:bytes.toString('base64')})});
  let value:unknown;try{value=JSON.parse(raw);}catch{throw new AppError('PARSER_OUTPUT_INVALID','解析进程返回了无效 JSON');}
  const parsed=response.safeParse(value);if(!parsed.success)throw new AppError('PARSER_OUTPUT_INVALID','解析结果不符合文档块协议');return parsed.data;
 }
}
