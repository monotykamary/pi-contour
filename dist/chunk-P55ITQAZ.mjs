import { createRequire as __contourCreateRequire } from "node:module"; import { fileURLToPath as __contourFileURLToPath } from "node:url"; import { dirname as __contourDirname } from "node:path"; const require = __contourCreateRequire(import.meta.url); const __filename = __contourFileURLToPath(import.meta.url); const __dirname = __contourDirname(__filename);
var s=e=>e.replace(/[\u0000-\u001f\u007f-\u009f]/g,o=>`\\u${o.charCodeAt(0).toString(16).padStart(4,"0")}`),d=e=>`${e>=0?"+":""}${e}`,g=e=>{let o=e.evidence.map(i=>`  \u25AA ${s(i.file)}:${i.line}${i.relation?` [${s(i.relation)}]`:""}${i.witness?` \u2014 ${s(i.witness).slice(0,180)}`:""}`).join(`
`),t=e.exposure?.map(i=>`t=${i.time}: ${(100*i.outsideRegion).toFixed(1)}% outside source region`).join("; ");return`\u0394 [${e.category}${e.blocking?"; explicit policy":"; advisory"}] ${s(e.title)}
${o}
  ${e.before} \u2192 ${e.after} ${s(e.unit)}`+(t?`
  \u2197 Exposure (modeled): ${t}`:"")+`
  ? ${s(e.question)}`};function b(e,o=2500){if(!Number.isInteger(o)||o<256||o>16e3)throw new Error("maxTokens must be 256..16000");let t=e.coverage.before.length+e.coverage.after.length,i=`Contour \xB7 ${e.target} \xB7 ${e.baseline.slice(0,12)} \u2192 ${e.snapshot.slice(0,12)}
${e.changed.length} changed source files \xB7 ${e.totalFindings} findings \xB7 ${e.blockingFindings} policy violations \xB7 ${t} file/extraction gaps
\u0394 SLOC ${d(e.after.sloc-e.before.sloc)}; decisions ${d(e.after.decisions-e.before.decisions)}; erosion ${e.before.erosion.toFixed(3)} \u2192 ${e.after.erosion.toFixed(3)}; verbosity ${e.before.verbosity.toFixed(3)} \u2192 ${e.after.verbosity.toFixed(3)}
\u0394 Verbose lines ${e.before.verboseLines} \u2192 ${e.after.verboseLines}; complex mass ${e.before.complexMass.toFixed(1)} \u2192 ${e.after.complexMass.toFixed(1)}
`,c=e.findings.map(g),l=n=>`
${e.totalFindings-n} findings not displayed (CLI --json for details).
`+(t?`\u26A0 Coverage incomplete; absence of findings is not approval.
`:"")+"No quality score or correctness guarantee. Graph resolution is partial. Heat means exposure, not defect probability.",a=i+l(0),r=0;for(let n=1;n<=c.length;n++){let $=i+`
`+c.slice(0,n).join(`

`)+l(n);if(Math.ceil($.length/4)>o)break;a=$,r=n}let f=[...e.coverage.before.slice(0,3).map(n=>`\u26A0 Gap (baseline): ${s(n.file)} \u2014 ${s(n.reason).slice(0,200)}`),...e.coverage.after.slice(0,3).map(n=>`\u26A0 Gap (target): ${s(n.file)} \u2014 ${s(n.reason).slice(0,200)}`),...e.regions.slice(0,5).map(n=>`\u0394 Region ${s(n.region)}: decisions ${n.before.decisions} \u2192 ${n.after.decisions}; functions ${n.before.functions} \u2192 ${n.after.functions}`)];for(let n of f){if(Math.ceil((a.length+n.length+1)/4)>o)break;a+=`
${n}`}return{text:a,tokens:Math.ceil(a.length/4),displayed:r}}export{b as a};
