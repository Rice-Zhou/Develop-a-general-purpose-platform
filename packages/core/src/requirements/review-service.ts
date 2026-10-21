import {createHash} from "node:crypto";
import type {RequirementItem} from "../../../contracts/src/requirements";
import type {ReviewState} from "../../../contracts/src/requirement-review";
import type {AnalysisReport} from "../../../contracts/src/analysis";
export interface ReviewSource{resourceId:string;quoteHash:string}
export type ReviewSourceIndex=Record<string,ReviewSource>;
const normalized=(v:string)=>v.normalize("NFC").trim().replace(/\s+/gu," ");
export function reviewFingerprint(projectId:string,item:RequirementItem,sources:ReviewSource[]):string{
 const unique=(v:string[])=>[...new Set(v)].sort();
 return createHash("sha256").update(JSON.stringify([1,projectId,normalized(item.text),unique(item.acceptanceCriteria.map(normalized)),unique(sources.map(s=>JSON.stringify([s.resourceId,s.quoteHash])))])).digest("hex");
}
export function nextReviewState(current:ReviewState,status:AnalysisReport["findings"][number]["status"],humanChanged:boolean):ReviewState{
 if(humanChanged||current==="FALSE_POSITIVE")return current;
 if(current==="DONE"&&(status==="MISSING"||status==="PARTIAL"))return "PENDING";
 return current;
}
