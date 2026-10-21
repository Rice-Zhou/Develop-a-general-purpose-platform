import {test,expect,_electron as electron} from "@playwright/test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
test("organizes references without a code project",async()=>{
 const data=await mkdtemp(join(tmpdir(),"library-e2e-"));const app=await electron.launch({executablePath:process.env.PLATFORM_EXECUTABLE!,args:[],env:{...process.env,PLATFORM_E2E:"1",PLATFORM_DATA_DIR:data,APPDATA:data}});
 try{const page=await app.firstWindow();await page.getByRole("button",{name:"需求资料库",exact:true}).click();
 await page.getByRole("button",{name:"新增分类",exact:true}).click();await page.getByLabel("分类名称",{exact:true}).fill("前期设计");await page.getByRole("button",{name:"保存分类",exact:true}).click();
 await page.getByRole("button",{name:"前期设计",exact:true}).click();await page.getByRole("button",{name:"添加需求文档资源",exact:true}).click();const dialog=page.getByRole("dialog",{name:"添加需求文档资源",exact:true});await dialog.getByLabel("需求文档名称",{exact:true}).fill("UI链接");await dialog.getByLabel("文档类型",{exact:true}).selectOption("url");await dialog.getByLabel("文档路径或链接",{exact:true}).fill("https://example.com/ui");await dialog.getByRole("button",{name:"保存需求文档资源",exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByText("UI链接",{exact:true})).toBeVisible();
 await page.reload();await page.getByRole("button",{name:"需求资料库",exact:true}).click();await expect(page.getByRole("button",{name:"前期设计",exact:true})).toBeVisible();await expect(page.getByText("UI链接",{exact:true})).toBeVisible();
 }finally{await app.close();await rm(data,{recursive:true,force:true});}
});
