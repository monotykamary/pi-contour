import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, realpath, rm, readFile, symlink, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import contour from "../src/index.js";
import { ContourEngine } from "../src/core/engine.js";
import { run } from "../src/core/util.js";
import { WORKSPACE_ACCESS_EVENT } from "pi-fovea/workspace";
import { repo, put, git, complex } from "./helpers.js";
const extra:string[]=[];
const parent=async()=>{const root=await realpath(await mkdtemp(join(tmpdir(),"contour-coordinator-")));extra.push(root);return root;};
afterEach(async()=>{vi.unstubAllEnvs();for(const path of extra.splice(0))await rm(path,{recursive:true,force:true});});
function host(cwd:string) {
  const tools=new Map<string,any>(),commands=new Map<string,any>(),handlers=new Map<string,any[]>(),entries:any[]=[],messages:any[]=[],bus=new Map<string,Set<(data:unknown)=>void>>();
  const ctx={cwd,hasUI:false,sessionManager:{getSessionId:()=>"workspace-test",getBranch:()=>entries}};
  const api={on:(name:string,fn:any)=>handlers.set(name,[...(handlers.get(name)??[]),fn]),registerTool:(tool:any)=>tools.set(tool.name,tool),registerCommand:(name:string,cmd:any)=>commands.set(name,cmd),appendEntry:(customType:string,data:unknown)=>entries.push({type:"custom",customType,data}),sendMessage:(...args:unknown[])=>messages.push(args),events:{on:(name:string,fn:(data:unknown)=>void)=>{const set=bus.get(name)??new Set();set.add(fn);bus.set(name,set);return()=>{set.delete(fn);};},emit:(name:string,data:unknown)=>{for(const fn of bus.get(name)??[])fn(data);}}};
  contour(api as never);
  const emit=async(name:string,event:Record<string,unknown>={})=>{for(const fn of handlers.get(name)??[])await fn(event,ctx);};
  const review=(params:Record<string,unknown>={})=>tools.get("contour_review").execute("review",params,undefined,undefined,ctx);
  const read=(root:string,error=false)=>emit("tool_result",{toolName:"read",input:{path:join(root,"a.ts")},isError:error});
  return{tools,commands,ctx,entries,messages,api,emit,review,read};
}

describe("roaming review workspaces",()=>{
  it("never invokes configured fsmonitor or lazy-fetch helpers during local review",async()=>{
    const root=await repo({"a.ts":"export const a=1;"}),sentinel=join(root,"invoked"),helper=join(root,".git/observer-helper");
    await writeFile(helper,`#!/bin/sh\ntouch '${sentinel}'\nprintf '\\000'\n`,{mode:0o755});
    await git(root,["config","core.fsmonitor",helper]);
    await new ContourEngine().review(root,"working-tree");await expect(access(sentinel)).rejects.toThrow();
    await git(root,["config","remote.origin.url",`ext::${helper}`]);await git(root,["config","remote.origin.promisor","true"]);await git(root,["config","protocol.ext.allow","always"]);
    expect((await run("git",["cat-file","-p","1234567890123456789012345678901234567890"],root,{allowFailure:true})).code).not.toBe(0);
    await expect(access(sentinel)).rejects.toThrow();
  });

  it("follows disjoint successful access instead of a coordinator cwd, preserving each Git index",async()=>{
    vi.stubEnv("CONTOUR_BACKGROUND","0"); const origin=await parent(),h=host(origin);
    const a=await realpath(await repo({"a.ts":"export const a=1;"})),b=await realpath(await repo({"a.ts":"export const a=1;"}));
    await put(a,"a.ts",complex("alpha",12));await git(a,["add","."]);await put(a,"a.ts",complex("live",20));
    await put(b,"a.ts",complex("beta",16));await git(b,["add","."]);
    const indexA=await readFile(join(a,".git/index")),indexB=await readFile(join(b,".git/index"));
    try {
      await h.emit("session_start"); await expect(h.review()).rejects.toThrow("Git worktree");
      await h.read(a);let r=await h.review();expect(r.details.root).toBe(a);expect(r.details.agentOrigin).toBe(origin);expect(r.details.after.decisions).toBe(12);expect(r.content[0].text).toContain(`Root: ${a}`);
      await h.read(b,true);expect((await h.review()).details.root).toBe(a);
      await h.read(b);r=await h.review();expect(r.details.root).toBe(b);expect(r.details.after.decisions).toBe(16);
      r=await h.review({root:a,target:"working-tree"});expect(r.details.after.decisions).toBe(20);
      await h.commands.get("contour").handler(`review staged --root "${b}"`,h.ctx);
      expect(h.messages[0][0].details.root).toBe(b);expect(h.messages[0][1]).toEqual({triggerTurn:false});
      expect(await readFile(join(a,".git/index"))).toEqual(indexA);expect(await readFile(join(b,".git/index"))).toEqual(indexB);
    } finally {await h.emit("session_shutdown");}
  });
  it("uses a 32-root ring, restores the active project, and rejects cross-session peer hints",async()=>{
    vi.stubEnv("CONTOUR_BACKGROUND","0"); const origin=await parent(),h=host(origin),roots:string[]=[];
    try {
      await h.emit("session_start");
      // Metadata-only fixtures prove admission does not execute Git or import analysis.
      for(let i=0;i<35;i++){const root=join(origin,`group/project-${i}`);await mkdir(join(root,".git"),{recursive:true});await put(root,"a.ts","export const a=1;");roots.push(root);await h.read(root);}
      expect(h.entries.at(-1).data.roots).toEqual(roots.slice(3));
      h.api.events.emit(WORKSPACE_ACCESS_EVENT,{version:1,source:"fovea",sessionId:"wrong",root:origin});
      await h.emit("session_compact");expect(h.entries.at(-1).data.roots).toEqual(roots.slice(3));
      const actual=await realpath(await repo({"a.ts":"export const a=1;"}));
      h.api.events.emit(WORKSPACE_ACCESS_EVENT,{version:1,source:"fovea",sessionId:"workspace-test",root:actual});
      const result=await h.review();expect(result.details.root).toBe(actual);expect(result.details.workspace.observedRoots).toHaveLength(32);
      expect(result.details.workspace.retirements).toBeGreaterThan(0);
      await h.emit("session_compact");await h.emit("session_shutdown");await h.emit("session_start");
      expect((await h.review()).details.root).toBe(actual);
      const unrelated=await parent();await put(unrelated,"a.ts","export const a=1;");await h.read(unrelated);
      await expect(h.review()).rejects.toThrow("Git worktree"); // Never silently review the previous Git project.
    } finally {await h.emit("session_shutdown");}
  });
  it("prefers the session cwd's own project over the recency ring",async()=>{
    vi.stubEnv("CONTOUR_BACKGROUND","0");const cwd=await realpath(await repo({"a.ts":"export const a=1;"})),sibling=await realpath(await repo({"a.ts":"export const a=1;"})),h=host(cwd);
    try {
      await put(sibling,"a.ts",complex("sibling",12));await git(sibling,["add","."]);
      await h.read(sibling); // The ring's most recent root is the sibling, not cwd.
      expect((await h.review()).details.root).toBe(cwd);
      const explicit=await h.review({root:sibling});expect(explicit.details.root).toBe(sibling);
      expect(explicit.details.workspace.observedRoots).toContain(cwd);
    } finally {await h.emit("session_shutdown");}
  });
  it("normalizes aliases and subdirectories without collapsing linked worktrees",async()=>{
    vi.stubEnv("CONTOUR_BACKGROUND","0");const origin=await parent(),h=host(origin),a=await realpath(await repo({"a.ts":"export const a=1;"}));
    const alias=join(origin,"alias"),worktree=join(origin,"worktree");await symlink(a,alias,"dir");await git(a,["worktree","add","-b","workspace-test",worktree]);
    try {
      expect((await h.review({root:alias})).details.root).toBe(a);
      await put(worktree,"a.ts",complex());await git(worktree,["add","."]);
      expect((await h.review({root:worktree})).details.root).toBe(worktree);
      expect((await h.review({root:a})).details.after.decisions).toBe(0);
    } finally {await h.emit("session_shutdown");}
  });
  it("reuses lightweight reports across more roots than the heavy model cache",async()=>{
    const roots=await Promise.all(Array.from({length:4},()=>repo({"a.ts":"export const a=1;"})));
    const engine=new ContourEngine();for(const root of roots)await engine.review(root);
    const models=engine.stats.models,reviews=engine.stats.reviews;
    for(const root of roots)expect((await engine.review(root)).root).toBe(await realpath(root));
    expect(engine.stats.models).toBe(models);expect(engine.stats.reviews).toBe(reviews);expect(engine.stats.reportHits).toBe(4);
  });
});
