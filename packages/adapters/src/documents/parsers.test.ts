import { expect,it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseDocx } from './docx-parser';
import { parsePdf } from './pdf-parser';
const fixture=(name:string)=>readFile(resolve('packages/testkit/fixtures/documents',name));
it('preserves Chinese headings, text, tables and paragraph anchors from a real docx',async()=>{
 const parsed=await parseDocx(await fixture('requirements.docx'));
 expect(parsed.blocks.find(b=>b.kind==='heading')?.text).toBe('账户登录');
 expect(parsed.blocks.some(b=>b.text.includes('用户必须输入密码'))).toBe(true);
 expect(parsed.blocks.find(b=>b.kind==='table')?.table?.[1]).toEqual(['密码为空','拒绝登录']);
 expect(parsed.blocks.every(b=>b.anchor.label&&!b.anchor.page)).toBe(true);
});
it('extracts text and page coordinates from a fixed pdf and makes empty-page loss visible',async()=>{
 const parsed=await parsePdf(await fixture('requirements.pdf'));
 expect(parsed.blocks[0].text).toContain('Password is required');expect(parsed.blocks[0].anchor.page).toBe(1);expect(parsed.blocks[0].anchor.coordinates?.length).toBeGreaterThan(0);
 const scanned=await parsePdf(await fixture('scanned.pdf'));expect(scanned.warnings.map(w=>w.code)).toContain('PDF_NO_TEXT');
 await expect(parsePdf(Buffer.from('not pdf'))).rejects.toThrow();
});
