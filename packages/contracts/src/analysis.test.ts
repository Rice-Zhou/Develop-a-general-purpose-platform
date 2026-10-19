import { expect, it } from 'vitest';
import { FindingSchema, AIProfileDraftSchema } from './analysis';
it('requires implementation evidence and explicit checked scope', () => {
  expect(FindingSchema.safeParse({ requirementId:'r',status:'IMPLEMENTED',explanation:'yes',evidenceIds:[],checkedScope:[],verification:'STATIC' }).success).toBe(false);
});
it('represents API and subscription executors without treating subscription accounts as API keys', () => {
  expect(AIProfileDraftSchema.safeParse({ name:'API',kind:'api',baseUrl:'https://example.invalid/v1',model:'chosen-model',outboundEnabled:false }).success).toBe(true);
  expect(AIProfileDraftSchema.safeParse({ name:'ChatGPT',kind:'codex',executable:'D:/tools/codex.exe',model:'',outboundEnabled:false }).success).toBe(true);
  expect(AIProfileDraftSchema.safeParse({ name:'CC',kind:'claude',executable:'D:/tools/claude.exe',model:'',outboundEnabled:false,apiKey:'not-allowed' }).success).toBe(false);
});
