import {test,expect,_electron as electron} from "@playwright/test";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
test("keeps task history hidden until expanded and selected",async()=>{
 const root=await mkdtemp(join(tmpdir(),"task-navigation-"));const app=await electron.launch({executablePath:process.env.PLATFORM_EXECUTABLE!,args:[],env:{...process.env,PLATFORM_E2E:"1",PLATFORM_DATA_DIR:root,APPDATA:root,HOME:root,USERPROFILE:root}});
 try{const page=await app.firstWindow();await expect(page.getByRole("button",{name:"任务历史",exact:true})).toHaveCount(0);await page.getByRole("button",{name:"任务列表",exact:true}).click();await expect(page.getByRole("heading",{name:/当前任务/})).toBeVisible();await page.getByRole("button",{name:"展开任务历史",exact:true}).click();await expect(page.getByRole("button",{name:"任务历史",exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:/历史任务/})).toHaveCount(0);await page.getByRole("button",{name:"任务历史",exact:true}).click();await expect(page.getByRole("heading",{name:/历史任务/})).toBeVisible();await page.getByRole("button",{name:"收起任务历史",exact:true}).click();await expect(page.getByRole("heading",{name:/当前任务/})).toBeVisible();await expect(page.getByRole("button",{name:"任务历史",exact:true})).toHaveCount(0);}finally{await app.close();await rm(root,{recursive:true,force:true});}
});
