import {z} from "zod";
import type {RequirementItem} from "./requirements";
import type {AnalysisReport} from "./analysis";
export const RequirementDecisionSchema=z.enum(["false-positive","confirm-missing","complete","restore"]);
export type RequirementDecision=z.infer<typeof RequirementDecisionSchema>;
export type ReviewState="PENDING"|"CONFIRMED_MISSING"|"FALSE_POSITIVE"|"DONE";
export interface ReviewRunToken{decisionSequence:number}
export interface RequirementReviewItem{id:string;projectId:string;fingerprint:string;state:ReviewState;revision:number;reportId:string;requirementSetId:string;requirementId:string;historicalSource:boolean;updatedAt:string}
export interface RequirementReviewView extends RequirementReviewItem{requirement:RequirementItem;finding:AnalysisReport["findings"][number];report:AnalysisReport}
