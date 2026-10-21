import {it,expect} from "vitest";
import {isIssueStatusIndexed} from "./issues";
it("excludes only Closed Trinity issues irrespective of case or whitespace",()=>{for(const s of ["Closed"," closed ","CLOSED"])expect(isIssueStatusIndexed("trinity",s)).toBe(false);for(const s of ["Open","Review","Resolved"])expect(isIssueStatusIndexed("trinity",s)).toBe(true);});
