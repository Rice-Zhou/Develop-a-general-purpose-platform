import {beforeEach,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {TrinityLogin} from "./trinity-login";
import type {IssueConnection} from "../../../../packages/contracts/src/issues";
const id=randomUUID();
const draftOf=(c:IssueConnection)=>({kind:"trinity" as const,platform:"trinity" as const,name:c.name,baseUrl:c.baseUrl,username:"alice",accountId:"uid-alice",bypassProxy:true});
let connection:IssueConnection;
const secrets=new Map<string,string>();
const vault={save:vi.fn(async(_id:string,value:string)=>{const ref=randomUUID();secrets.set(ref,value);return ref;}),resolve:vi.fn(async(ref:string)=>{if(!secrets.has(ref))throw new Error("private vault error");return secrets.get(ref)!;}),remove:vi.fn(async(ref:string)=>{secrets.delete(ref);})};
const login=vi.fn(async()=>"new-session");const identity=vi.fn(async()=>({accountId:"uid-alice"}));
const commit=vi.fn(async(value:IssueConnection)=>{connection=value;return value;});
const runtime=()=>new TrinityLogin(vault,{connections:async()=>[connection],commit},login,identity);
beforeEach(()=>{vi.clearAllMocks();secrets.clear();connection={id,kind:"trinity",platform:"trinity",name:"Trinity",baseUrl:"https://example.test/trinity",username:"alice",accountId:"uid-alice",bypassProxy:true,credentialRef:randomUUID()};login.mockResolvedValue("new-session");identity.mockResolvedValue({accountId:"uid-alice"});});
it("stores the opted-in password only in the vault and exposes no secret references",async()=>{
 const auth=runtime();const draft=draftOf(connection);
 const result=await auth.save({...draft,autoLogin:true},"private-password",connection);
 expect(connection.kind==="trinity"&&connection.autoLogin).toBe(true);expect(connection.passwordRef).toBeTruthy();expect(JSON.parse(secrets.get(connection.passwordRef!)!)).toMatchObject({username:"alice",password:"private-password",accountId:"uid-alice"});expect(JSON.stringify(result)).not.toMatch(/passwordRef|credentialRef|private-password|new-session/);
});
it("defaults to no password retention",async()=>{
 const draft=draftOf(connection);await runtime().save(draft,"private-password",connection);expect(connection.kind==="trinity"&&connection.autoLogin).toBe(false);expect(connection.passwordRef).toBeNull();expect([...secrets.values()]).not.toContain("private-password");
});
it("automatically logs in only once per platform launch and preserves connection identity",async()=>{
 let auth=runtime();const draft=draftOf(connection);await auth.save({...draft,autoLogin:true},"private-password",connection);login.mockClear();commit.mockClear();auth=runtime();await Promise.all([auth.startup(),auth.startup()]);expect(login).toHaveBeenCalledTimes(1);expect(commit).toHaveBeenCalledTimes(1);expect(connection.id).toBe(id);expect(await vault.resolve(connection.credentialRef!)).toBe("new-session");expect(auth.status().state).toBe("succeeded");
});
it("never logs in existing connections without opt-in",async()=>{const auth=runtime();await auth.startup();expect(login).not.toHaveBeenCalled();expect(auth.status().state).toBe("disabled");});
it("clears a remembered password when disabled without needing another login",async()=>{
 const auth=runtime();const draft=draftOf(connection);await auth.save({...draft,autoLogin:true},"private-password",connection);const old=connection.passwordRef!;const token=connection.credentialRef;login.mockClear();await auth.save({...draft,autoLogin:false},undefined,connection);expect(login).not.toHaveBeenCalled();expect(connection.credentialRef).toBe(token);expect(connection.passwordRef).toBeNull();expect(secrets.has(old)).toBe(false);
});
it("does not retry or replace the session after startup failure and hides raw exception text",async()=>{
 const draft=draftOf(connection);await runtime().save({...draft,autoLogin:true},"private-password",connection);const prior=connection;login.mockRejectedValue(new Error("private-password"));login.mockClear();const auth=runtime();await auth.startup();await auth.startup();expect(login).toHaveBeenCalledTimes(1);expect(connection).toBe(prior);expect(auth.status()).toMatchObject({state:"failed"});expect(JSON.stringify(auth.status())).not.toContain("private-password");
});
it("rejects a changed server account on automatic login",async()=>{
 const draft=draftOf(connection);await runtime().save({...draft,autoLogin:true},"private-password",connection);commit.mockClear();identity.mockResolvedValue({accountId:"uid-other"});const auth=runtime();await auth.startup();expect(auth.status()).toMatchObject({state:"failed",code:"TRINITY_ACCOUNT_CHANGED"});expect(commit).not.toHaveBeenCalled();
});
it("rolls back new encrypted files if connection persistence fails",async()=>{
 const draft=draftOf(connection);commit.mockRejectedValueOnce(new Error("database unavailable"));await expect(runtime().save({...draft,autoLogin:true},"private-password",connection)).rejects.toThrow("database unavailable");expect(secrets.size).toBe(0);
});
it("keeps the password reference and connection unchanged if clearing it fails, so disabling can be retried",async()=>{
 const auth=runtime();await auth.save({...draftOf(connection),autoLogin:true},"private-password",connection);const prior=connection;commit.mockClear();vault.remove.mockRejectedValueOnce(Object.assign(new Error("access denied"),{code:"EPERM"}));
 await expect(auth.save({...draftOf(connection),autoLogin:false},undefined,connection)).rejects.toThrow("access denied");expect(commit).not.toHaveBeenCalled();expect(connection).toBe(prior);expect(secrets.has(connection.passwordRef!)).toBe(true);
 await auth.save({...draftOf(connection),autoLogin:false},undefined,connection);expect(connection.passwordRef).toBeNull();
});

it("rolls back new files and retains the original password when replacement cleanup fails",async()=>{
 const auth=runtime();await auth.save({...draftOf(connection),autoLogin:true},"private-password",connection);const prior=connection;const refs=[...secrets.keys()].sort();commit.mockClear();vault.remove.mockRejectedValueOnce(Object.assign(new Error("access denied"),{code:"EPERM"}));
 await expect(auth.save({...draftOf(connection),autoLogin:true},"replacement-password",connection)).rejects.toThrow("access denied");expect(commit).not.toHaveBeenCalled();expect(connection).toBe(prior);expect([...secrets.keys()].sort()).toEqual(refs);
});
