import {test,expect,_electron as electron} from "@playwright/test";
import {mkdtemp,rm} from "node:fs/promises";import {tmpdir} from "node:os";import {join} from "node:path";
test("opens connection forms only on explicit add and clears cancelled secrets",async()=>{
 const data=await mkdtemp(join(tmpdir(),"panels-"));const app=await electron.launch({executablePath:process.env.PLATFORM_EXECUTABLE!,args:[],env:{...process.env,PLATFORM_E2E:"1",PLATFORM_DATA_DIR:data,APPDATA:data}});
 try{const page=await app.firstWindow();await page.getByRole("button",{name:"设置",exact:true}).click();await expect(page.getByLabel("连接名称",{exact:true})).toHaveCount(0);await expect(page.getByLabel("模型名称",{exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"新增 Jira 连接",exact:true}).click();await page.getByLabel("Jira 登录方式").selectOption("account");await page.getByLabel("登录密码",{exact:true}).fill("not-saved");await page.getByRole("button",{name:"取消 BUG 连接编辑",exact:true}).click();await page.getByRole("button",{name:"新增 Jira 连接",exact:true}).click();await page.getByLabel("Jira 登录方式").selectOption("account");await expect(page.getByLabel("登录密码",{exact:true})).toHaveValue("");await page.getByRole("button",{name:"取消 BUG 连接编辑",exact:true}).click();
 await page.getByRole("button",{name:"新增 AI 连接",exact:true}).click();await expect(page.getByLabel("模型名称",{exact:true})).toBeVisible();await page.getByRole("button",{name:"取消 AI 连接编辑",exact:true}).click();await expect(page.getByLabel("模型名称",{exact:true})).toHaveCount(0);
 }finally{await app.close();await rm(data,{recursive:true,force:true});}
});
