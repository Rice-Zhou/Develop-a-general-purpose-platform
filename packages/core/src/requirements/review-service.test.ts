import {it,expect} from "vitest";
import {reviewFingerprint,nextReviewState} from "./review-service";
const item={id:"new-uuid",text:"  车门  状态 ",acceptanceCriteria:["B","A"],sourceRefs:[{documentSnapshotId:"s1",blockId:"b1",quoteHash:"h1"}],clarification:"",reviewed:true};
it("uses semantic source identity rather than extraction IDs or formatting",()=>{
 const sources=[{resourceId:"r1",quoteHash:"h1"}];const a=reviewFingerprint("p",item,sources);
 expect(reviewFingerprint("p",{...item,id:"other",text:"车门 状态",acceptanceCriteria:["A","B"]},sources)).toBe(a);
 expect(reviewFingerprint("p2",item,sources)).not.toBe(a);
 expect(reviewFingerprint("p",{...item,text:"变更"},sources)).not.toBe(a);
 expect(reviewFingerprint("p",item,[{resourceId:"r1",quoteHash:"h2"}])).not.toBe(a);
});
it("never infers human completion and preserves false positives",()=>{
 expect(nextReviewState("FALSE_POSITIVE","MISSING",false)).toBe("FALSE_POSITIVE");
 expect(nextReviewState("DONE","PARTIAL",false)).toBe("PENDING");
 expect(nextReviewState("DONE","UNKNOWN",false)).toBe("DONE");
 expect(nextReviewState("CONFIRMED_MISSING","IMPLEMENTED",false)).toBe("CONFIRMED_MISSING");
 expect(nextReviewState("DONE","MISSING",true)).toBe("DONE");
});
