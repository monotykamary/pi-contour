#!/usr/bin/env node
import { createRequire as __contourCreateRequire } from "node:module"; import { fileURLToPath as __contourFileURLToPath } from "node:url"; import { dirname as __contourDirname } from "node:path"; const require = __contourCreateRequire(import.meta.url); const __filename = __contourFileURLToPath(import.meta.url); const __dirname = __contourDirname(__filename);
import{a as b}from"./chunk-P55ITQAZ.mjs";import{a as f,b as $,c as R,d as F}from"./chunk-QOGMOQQK.mjs";import"./chunk-HXQEELCN.mjs";import{readFile as C,mkdir as O,writeFile as q,realpath as J}from"node:fs/promises";import{resolve as N,dirname as L,join as W}from"node:path";import{tmpdir as K}from"node:os";import{fileURLToPath as T}from"node:url";import{mkdir as A,readFile as H,writeFile as B,unlink as G,lstat as U}from"node:fs/promises";import{dirname as D,resolve as M}from"node:path";var k="# pi-contour managed pre-commit v1",y=i=>`'${i.replaceAll("'","'\\''")}'`;async function I(i){let{stdout:r}=await $("git",["rev-parse","--git-path","hooks/pre-commit"],i);return M(i,r.toString().trim())}async function P(i,r,e){if(!r.endsWith(".mjs"))throw new Error("Build first, then install using node dist/cli.mjs hook install");let n=await I(i),a=`#!/bin/sh
${k}
${y(process.execPath)} ${y(r)} review --staged --checkpoint${e?` --policy ${y(e)}`:""}
code=$?
`+(e?`exit "$code"
`:`if [ "$code" -eq 2 ]; then exit 2; fi
if [ "$code" -ne 0 ]; then printf "%s\\n" "Contour analysis unavailable; advisory hook did not block this commit." >&2; fi
exit 0
`);await A(D(n),{recursive:!0});let s=`#!/bin/sh
${k}
`,l=s+`# sha256:${f(a)}
`+a.slice(s.length);try{await B(n,l,{flag:"wx",mode:493})}catch(c){throw c.code==="EEXIST"?new Error(`Hook already exists at ${n}; integrate Contour manually or explicitly uninstall its managed hook first`):c}return`Installed ${n}${e?" (explicit policy enforcement; analysis failures block)":" (advisory)"}`}async function S(i){let r=await I(i);if(!(await U(r)).isFile())throw new Error("Refusing to remove a hook not managed by Contour");let e=await H(r,"utf8"),n=`#!/bin/sh
${k}
`,a=e.slice(n.length),s=a.indexOf(`
`);if(!e.startsWith(n)||a.slice(0,s)!==`# sha256:${f(n+a.slice(s+1))}`)throw new Error("Refusing to remove a modified or unmanaged Contour hook");return await G(r),`Removed ${r}`}var X=`contour review [--staged|--working-tree] [--json] [--root DIR]
               [--max-tokens N] [--max-findings N] [--policy FILE] [--checkpoint]
contour hook install [--root DIR] [--policy FILE]
contour hook uninstall [--root DIR]

Reviews compare HEAD with an immutable target snapshot. No source or index writes.
Exit 0: advisory; 2: explicit boundary policy violations; 1: analysis/usage failure.
Hooks are opt-in, never overwrite existing hooks, and do not intercept shell commands.
`;async function z(i,r={out:e=>process.stdout.write(e),error:e=>process.stderr.write(e)}){if(!i.length||i.includes("--help")||i[0]==="help")return r.out(X),0;try{let e=[...i],n=e.shift(),a=n==="hook"?e.shift():void 0,s=process.cwd(),l="staged",c=!1,u=!1,m=!1,g,p=2500,x=8;for(;e.length;){let o=e.shift();if(o==="--json")u=!0;else if(o==="--checkpoint")m=!0;else if(o==="--staged"||o==="--working-tree"){if(c)throw new Error("Choose exactly one target");c=!0,l=o==="--staged"?"staged":"working-tree"}else if(["--root","--policy","--max-tokens","--max-findings"].includes(o??"")){let t=e.shift();if(!t||t.startsWith("--"))throw new Error(`Missing value for ${o}`);o==="--root"?s=N(t):o==="--policy"?g=t:o==="--max-tokens"?p=Number(t):x=Number(t)}else throw new Error(`Unknown argument: ${o}`)}let w=g?N(s,g):void 0,v=[];if(w){let o=await C(w,"utf8");if(o.length>65536)throw new Error("Policy file exceeds 64KiB");let t=JSON.parse(o);if(!t||!Array.isArray(t.boundaries)||Object.keys(t).some(d=>d!=="boundaries"))throw new Error("Policy must contain only a boundaries array");v=t.boundaries}let j=R({maxTokens:p,maxFindings:x,boundaries:v});if(n==="hook"){if(u||m||c)throw new Error("Review flags do not apply to hook management");if(a==="install")r.out(await P(s,T(import.meta.url),w)+`
`);else if(a==="uninstall")r.out(await S(s)+`
`);else throw new Error("Use hook install or hook uninstall");return 0}if(n!=="review")throw new Error(`Unknown command: ${n}`);if(m&&l!=="staged")throw new Error("Commit checkpoints require the staged target");let E=new AbortController,h=()=>E.abort(new Error("Review cancelled"));process.once("SIGINT",h),process.once("SIGTERM",h);try{let o=await new F().review(s,l,j,E.signal),t=!0;if(m&&!u){t=o.totalFindings>0||o.coverage.before.length>0||o.coverage.after.length>0;let d=W(K(),`pi-contour-${process.getuid?.()??"user"}`,`checkpoint-${f(o.root)}.txt`);try{!o.blockingFindings&&await C(d,"utf8")===o.id&&(t=!1)}catch{}if(t)try{await O(L(d),{recursive:!0,mode:448}),await q(d,o.id,{mode:384})}catch{}}return t&&r.out(u?JSON.stringify(o,null,2)+`
`:b(o,p).text+`
`),o.blockingFindings?2:0}finally{process.off("SIGINT",h),process.off("SIGTERM",h)}}catch(e){return r.error(`Contour: ${e instanceof Error?e.message:String(e)}
`),1}}process.argv[1]&&await J(process.argv[1]).catch(()=>"")===T(import.meta.url)&&(process.exitCode=await z(process.argv.slice(2)));export{z as main};
