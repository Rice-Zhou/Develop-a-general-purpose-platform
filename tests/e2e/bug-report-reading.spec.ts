import {test,expect} from "@playwright/test";
import {reportFixture} from "./report-fixture";
test("prioritizes causes and steps and expands each evidence inside its row",async()=>{
 const f=await reportFixture();try{const page=f.page;await page.locator("article.finding-card").filter({has:page.getByRole("link",{name:"A-1",exact:true})}).getByRole("button",{name:"打开分析报告",exact:true}).click();
 await expect(page.getByText("Cause 1",{exact:true})).toBeVisible();await expect(page.getByText("Debug next step",{exact:true})).toBeVisible();
 for(const summary of ["复现条件","代码事实","缺失信息","固定版本证据","检查范围与未解析材料","代码上下文与模型用量"]){await expect(page.locator("details").filter({has:page.locator("summary").getByText(summary,{exact:true})})).not.toHaveAttribute("open","");}
 await page.locator("summary").getByText("固定版本证据",{exact:true}).click();const rows=page.locator(".bug-evidence-item");await rows.nth(0).getByRole("button",{name:"阅读 BUG 证据",exact:true}).click();await rows.nth(1).getByRole("button",{name:"阅读 BUG 证据",exact:true}).click();await expect(rows.nth(0).locator("pre")).toHaveText("Content ev-1");await expect(rows.nth(1).locator("pre")).toHaveText("Content ev-2");
 const first=await rows.nth(0).boundingBox(),second=await rows.nth(1).boundingBox();expect(second!.y).toBeGreaterThanOrEqual(first!.y+first!.height);await page.screenshot({path:test.info().outputPath("inline-evidence.png")});
 }finally{await f.dispose();}
});
