import { expect,it } from 'vitest';
import { runProcess } from './run-process';
it('runs a fixed executable without a shell and bounds its output',async()=>{
 expect(await runProcess(process.execPath,['-e',"process.stdin.on('data',d=>process.stdout.write(d))"],{input:'data',cwd:process.cwd()})).toBe('data');
 await expect(runProcess(process.execPath,['-e',"console.log('x'.repeat(1000));setInterval(()=>{},1000)"],{cwd:process.cwd(),maxOutput:20})).rejects.toMatchObject({code:'PROCESS_OUTPUT_LIMIT'});
});
it('terminates a timed-out process before returning',async()=>{
 await expect(runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:process.cwd(),timeoutMs:150})).rejects.toMatchObject({code:'PROCESS_TIMEOUT'});
});
