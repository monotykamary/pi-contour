#!/usr/bin/env node
import { createRequire as __contourCreateRequire } from "node:module"; import { fileURLToPath as __contourFileURLToPath } from "node:url"; import { dirname as __contourDirname } from "node:path"; const require = __contourCreateRequire(import.meta.url); const __filename = __contourFileURLToPath(import.meta.url); const __dirname = __contourDirname(__filename);
import{a as f,b as $,c as R,d as N}from"./chunk-C2HLVW7U.mjs";import"./chunk-WUMNOO5F.mjs";import{a as I}from"./chunk-KGMBD5FP.mjs";import"./chunk-HXQEELCN.mjs";import{readFile as v,mkdir as D,writeFile as J,realpath as L}from"node:fs/promises";import{resolve as C,dirname as M,join as V}from"node:path";import{tmpdir as q}from"node:os";import{fileURLToPath as F}from"node:url";import{mkdir as T,readFile as j,writeFile as U,unlink as A,lstat as H}from"node:fs/promises";import{dirname as B,resolve as G}from"node:path";var y="# pi-contour managed pre-commit v1",k=t=>`'${t.replaceAll("'","'\\''")}'`;async function S(t){let{stdout:r}=await $("git",["rev-parse","--git-path","hooks/pre-commit"],t);return G(t,r.toString().trim())}async function _(t,r,e){if(!r.endsWith(".mjs"))throw new Error("Build first, then install using node dist/cli.mjs hook install");let i=await S(t),a=`#!/bin/sh
${y}
${k(process.execPath)} ${k(r)} review --staged --checkpoint${e?` --policy ${k(e)}`:""}
code=$?
`+(e?`exit "$code"
`:`if [ "$code" -eq 2 ]; then exit 2; fi
if [ "$code" -ne 0 ]; then printf "%s\\n" "Contour analysis unavailable; advisory hook did not block this commit." >&2; fi
exit 0
`);await T(B(i),{recursive:!0});let s=`#!/bin/sh
${y}
`,l=s+`# sha256:${f(a)}
`+a.slice(s.length);try{await U(i,l,{flag:"wx",mode:493})}catch(c){throw c.code==="EEXIST"?new Error(`Hook already exists at ${i}; integrate Contour manually or explicitly uninstall its managed hook first`):c}return`Installed ${i}${e?" (explicit policy enforcement; analysis failures block)":" (advisory)"}`}async function O(t){let r=await S(t);if(!(await H(r)).isFile())throw new Error("Refusing to remove a hook not managed by Contour");let e=await j(r,"utf8"),i=`#!/bin/sh
${y}
`,a=e.slice(i.length),s=a.indexOf(`
`);if(!e.startsWith(i)||a.slice(0,s)!==`# sha256:${f(i+a.slice(s+1))}`)throw new Error("Refusing to remove a modified or unmanaged Contour hook");return await A(r),`Removed ${r}`}async function W(){return"0.4.1"}var K=`contour review [--staged|--working-tree] [--json] [--root DIR]
               [--max-tokens N] [--max-findings N] [--policy FILE] [--checkpoint]
contour hook install [--root DIR] [--policy FILE]
contour hook uninstall [--root DIR]
contour --version

Reviews compare HEAD with an immutable target snapshot. No source or index writes.
Exit 0: advisory; 2: explicit boundary policy violations; 1: analysis/usage failure.
Hooks are opt-in, never overwrite existing hooks, and do not intercept shell commands.
`;async function X(t,r={out:e=>process.stdout.write(e),error:e=>process.stderr.write(e)}){if(!t.length||t.includes("--help")||t[0]==="help")return r.out(K),0;try{if(t.includes("--version"))return r.out(`contour ${await W()}
`),0;let e=[...t],i=e.shift(),a=i==="hook"?e.shift():void 0,s=process.cwd(),l="staged",c=!1,d=!1,m=!1,g,h=2500,x=8;for(;e.length;){let o=e.shift();if(o==="--json")d=!0;else if(o==="--checkpoint")m=!0;else if(o==="--staged"||o==="--working-tree"){if(c)throw new Error("Choose exactly one target");c=!0,l=o==="--staged"?"staged":"working-tree"}else if(["--root","--policy","--max-tokens","--max-findings"].includes(o??"")){let n=e.shift();if(!n||n.startsWith("--"))throw new Error(`Missing value for ${o}`);o==="--root"?s=C(n):o==="--policy"?g=n:o==="--max-tokens"?h=Number(n):x=Number(n)}else throw new Error(`Unknown argument: ${o}`)}let w=g?C(s,g):void 0,E=[];if(w){let o=await v(w,"utf8");if(o.length>65536)throw new Error("Policy file exceeds 64KiB");let n=JSON.parse(o);if(!n||!Array.isArray(n.boundaries)||Object.keys(n).some(u=>u!=="boundaries"))throw new Error("Policy must contain only a boundaries array");E=n.boundaries}let P=R({maxTokens:h,maxFindings:x,boundaries:E});if(i==="hook"){if(d||m||c)throw new Error("Review flags do not apply to hook management");if(a==="install")r.out(await _(s,F(import.meta.url),w)+`
`);else if(a==="uninstall")r.out(await O(s)+`
`);else throw new Error("Use hook install or hook uninstall");return 0}if(i!=="review")throw new Error(`Unknown command: ${i}`);if(m&&l!=="staged")throw new Error("Commit checkpoints require the staged target");let b=new AbortController,p=()=>b.abort(new Error("Review cancelled"));process.once("SIGINT",p),process.once("SIGTERM",p);try{let o=await new N().review(s,l,P,b.signal),n=!0;if(m&&!d){n=o.totalFindings>0||o.coverage.before.length>0||o.coverage.after.length>0;let u=V(q(),`pi-contour-${process.getuid?.()??"user"}`,`checkpoint-${f(o.root)}.txt`);try{!o.blockingFindings&&await v(u,"utf8")===o.id&&(n=!1)}catch{}if(n)try{await D(M(u),{recursive:!0,mode:448}),await J(u,o.id,{mode:384})}catch{}}return n&&r.out(d?JSON.stringify(o,null,2)+`
`:I(o,h).text+`
`),o.blockingFindings?2:0}finally{process.off("SIGINT",p),process.off("SIGTERM",p)}}catch(e){return r.error(`Contour: ${e instanceof Error?e.message:String(e)}
`),1}}process.argv[1]&&await L(process.argv[1]).catch(()=>"")===F(import.meta.url)&&(process.exitCode=await X(process.argv.slice(2)));export{X as main};
