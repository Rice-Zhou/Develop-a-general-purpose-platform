import { z } from 'zod';
import { load } from 'cheerio';
import type { DocumentBlock,DocumentWarning,ParsedDocument } from '../../../contracts/src/documents';
import { AppError } from '../../../contracts/src/error';
export const FeishuResponseSchema=z.object({ok:z.literal(true),data:z.object({document:z.object({document_id:z.string().min(1),revision_id:z.union([z.number(),z.string()]).optional(),content:z.string().max(2000000),reference_map:z.unknown().optional(),tips:z.unknown().optional(),has_more:z.boolean().optional()}).passthrough(),has_more:z.boolean().optional()}).passthrough(),has_more:z.boolean().optional()}).passthrough();
export function parseFeishu(value:unknown):ParsedDocument {
 const result=FeishuResponseSchema.safeParse(value);if(!result.success)throw new AppError('FEISHU_PROTOCOL_INVALID','飞书 CLI 返回不符合已支持的文档协议，请检查版本和登录');
 const response=result.data;const document=response.data.document;
 if(response.has_more||response.data.has_more||document.has_more||/<(?:fragment|excerpt)\b/i.test(document.content))throw new AppError('FEISHU_PARTIAL','飞书 CLI 返回了局部内容，不能作为完整文档');
 const $=load(document.content,{xml:true});const blocks:DocumentBlock[]=[];const warnings:DocumentWarning[]=[];const headings:string[]=[];
 const nodes=$('document').length?$('document').first().children():$.root().children();
 nodes.each((_i,node)=>{
  const el=$(node);const tag=node.tagName;const blockId=el.attr('block-id')??el.attr('block_id')??el.attr('id');const id=blockId??`feishu-${blocks.length+1}`;
  if(blocks.some(b=>b.id===id))throw new AppError('FEISHU_DUPLICATE_BLOCK','飞书返回重复块 ID');
  const own:DocumentWarning[]=[];const isHeading=tag==='title'||/^h[1-9]$/.test(tag);const text=el.text().trim();if(isHeading)headings.splice(0,headings.length,text);
  const image=['img','image','whiteboard','source'].includes(tag)||el.find('img,image,whiteboard').length>0;
  const known=isHeading||['p','paragraph','table','ul','ol','list','code','quote','blockquote','divider'].includes(tag);
  if(image)own.push({code:'IMAGE_NOT_PARSED',message:'飞书图片或画板未解析',blockId:id});
  if(!known&&!image)own.push({code:'FEISHU_UNKNOWN_BLOCK',message:`未支持的飞书块类型：${tag}`,blockId:id});
  if(!blockId)own.push({code:'SOURCE_ANCHOR_MISSING',message:'CLI 未返回该块的原始 blockId，只有快照内锚点',blockId:id});
  const table=tag==='table'?el.find('tr,row').map((_j,row)=>[$(row).children('td,th,cell').map((_k,cell)=>$(cell).text().trim()).get()]).get():undefined;
  if(table&&el.find('[colspan],[rowspan]').length)own.push({code:'TABLE_STRUCTURE_LOSS',message:'合并表格需人工复核',blockId:id});
  blocks.push({id,kind:isHeading?'heading':image?'image':tag==='table'?'table':known?'paragraph':'unknown',text,headingPath:[...headings],anchor:{label:`飞书块 ${blockId??id}`,...(blockId?{blockId}:{})},...(table?{table}:{}),warnings:own});warnings.push(...own);
 });
 if(document.tips)warnings.push({code:'FEISHU_EXPORT_NOTICE',message:typeof document.tips==='string'?document.tips.slice(0,2000):'CLI 返回了导出限制，请人工复核'});
 if(!blocks.length)warnings.push({code:'DOCUMENT_NO_TEXT',message:'飞书文档没有可读取块'});
 return{blocks,warnings,parserVersion:'lark-cli-docs-v2/blocks-1'};
}
