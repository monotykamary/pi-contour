import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const levels = Array.from({ length: 10 }, (_, i) => {
  const radius = 25 + i * 22;
  const points = Array.from({ length: 120 }, (_, j) => {
    const a = 2 * Math.PI * j / 120;
    const r = radius * (1 + 0.1 * Math.cos(3 * a + 0.4) + 0.045 * Math.sin(5 * a));
    return `${(778 + r * Math.cos(a)).toFixed(1)} ${(200 + 0.62 * r * Math.sin(a)).toFixed(1)}`;
  });
  const path = `M${points.join(" L")} Z`;
  return `    <path d="${path}" fill="none" stroke="${i < 4 ? "#6debc8" : "#5fabc3"}" stroke-width="${i < 3 ? 1.6 : 1}" opacity="${(0.9 - i * 0.063).toFixed(2)}"/>
    ${i === 4 || i === 8 ? `<path class="current" d="${path}" fill="none" stroke="#b5ffe7" stroke-width="2" stroke-dasharray="35 1600" style="animation-delay:-${i}s"/>` : ""}`;
}).join("\n");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="400" viewBox="0 0 1100 400" role="img" aria-labelledby="title desc">
  <title id="title">pi-contour — see the shape of a change</title>
  <desc id="desc">A topographic heat field is progressively revealed across a module boundary. A staged patch is the source; contour lines carry review exposure outward. This is an illustrative identity animation, not a repository measurement. Reduced-motion viewers see the complete static composition.</desc>
  <defs>
    <linearGradient id="paper" x2="1" y2="1"><stop stop-color="#080e1a"/><stop offset="1" stop-color="#102331"/></linearGradient>
    <radialGradient id="heat"><stop stop-color="#68f2c4" stop-opacity=".28"/><stop offset=".4" stop-color="#55cdb9" stop-opacity=".07"/><stop offset="1" stop-color="#55cdb9" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#28404b" stroke-opacity=".24" stroke-width=".6"/></pattern>
    <mask id="survey" maskUnits="userSpaceOnUse" x="500" y="40" width="570" height="310"><rect class="sweep" x="500" y="40" width="570" height="310" fill="white"/></mask>
    <clipPath id="canvas"><rect x="1" y="1" width="1098" height="398" rx="20"/></clipPath>
  </defs>
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .sweep { animation: survey 2.8s cubic-bezier(.2,.7,.2,1) both; }
    .intro { animation: appear 1.1s ease-out both; }
    .card { animation: appear 1.3s .25s ease-out both; }
    .current { animation: travel 18s linear infinite; }
    .pulse { transform-box: fill-box; transform-origin: center; animation: pulse 4.8s ease-out infinite; }
    .checkpoint { animation: checkpoint 5s ease-in-out infinite; }
    @keyframes survey { from { transform: translateX(-570px); } to { transform: translateX(0); } }
    @keyframes appear { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes travel { to { stroke-dashoffset: -1635; } }
    @keyframes pulse { 0% { transform: scale(.5); opacity: .65; } 90%,100% { transform: scale(3.8); opacity: 0; } }
    @keyframes checkpoint { 0%,100% { opacity: .6; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .sweep,.intro,.card,.current,.pulse,.checkpoint { animation: none; } .pulse,.current { display: none; } }
  </style>
  <g clip-path="url(#canvas)">
    <rect width="1100" height="400" fill="url(#paper)"/>
    <rect x="490" width="610" height="400" fill="url(#grid)"/>
    <path d="M490 32V368" stroke="#2a414f" stroke-dasharray="2 7"/>
    <g class="intro">
      <text x="44" y="54" fill="#78b5ba" font-size="11" letter-spacing="3">STRUCTURAL REVIEW / PI EXTENSION</text>
      <text x="42" y="115" fill="#e8fff5" font-size="44" font-weight="650" letter-spacing="-2">pi-contour</text>
      <text x="44" y="146" fill="#9fb7c3" font-size="16">See the shape of a change.</text>
    </g>
    <g class="card">
      <rect x="44" y="178" width="394" height="126" rx="9" fill="#0b1622" stroke="#29404a"/>
      <path d="M44 211H438" stroke="#29404a"/>
      <circle class="checkpoint" cx="63" cy="195" r="3.5" fill="#75edc5"/>
      <text x="78" y="199" fill="#c2d9df" font-size="11" letter-spacing="1">HEAD → INDEX</text>
      <text x="283" y="199" fill="#75edc5" font-size="10">SNAPSHOT PINNED</text>
      <text x="62" y="237" fill="#738b9a" font-size="12">src/core/options.ts:84</text>
      <text x="62" y="262" fill="#f1bc7c" font-size="13">+ one dependency across a boundary</text>
      <text x="62" y="285" fill="#7cd8c4" font-size="12">Evidence first. A question, not a score.</text>
    </g>
    <g mask="url(#survey)">
      <ellipse cx="778" cy="200" rx="255" ry="173" fill="url(#heat)"/>
${levels}
      <path d="M873 73V327" stroke="#f1bc7c" stroke-opacity=".65" stroke-dasharray="4 6"/>
      <text x="885" y="91" fill="#c19b72" font-size="9" letter-spacing="1.5">BOUNDARY</text>
      <circle class="pulse" cx="778" cy="200" r="24" fill="none" stroke="#85ffdc" stroke-width=".8"/>
      <circle cx="778" cy="200" r="6" fill="#b9ffe9"/>
      <circle cx="873" cy="227" r="4" fill="#f1bc7c"/>
      <path d="M778 206V251H711" fill="none" stroke="#7acbb9" stroke-opacity=".65"/>
      <text x="638" y="256" fill="#a5d9cf" font-size="10">PATCH SOURCE</text>
      <path d="M877 227H959V252" fill="none" stroke="#d8b480" stroke-opacity=".65"/>
      <text x="915" y="269" fill="#d8b480" font-size="10">EXPOSURE</text>
      <text x="548" y="77" fill="#70b6b1" font-size="10" letter-spacing="2">A FIELD, NOT A VERDICT</text>
      <text x="951" y="331" fill="#77a5b0" font-size="10">t = 0.5 · 2 · 8</text>
    </g>
    <path d="M44 337H1056" stroke="#29404a"/>
    <text x="44" y="367" fill="#75edc5" font-size="10" letter-spacing="2">OBSERVE</text>
    <path d="M120 363H160M156 360L160 363L156 366" fill="none" stroke="#477979"/>
    <text x="178" y="367" fill="#75edc5" font-size="10" letter-spacing="2">DIFFUSE</text>
    <path d="M251 363H291M287 360L291 363L287 366" fill="none" stroke="#477979"/>
    <text x="309" y="367" fill="#f1bc7c" font-size="10" letter-spacing="2">DISCLOSE</text>
    <text x="682" y="367" fill="#819ba9" font-size="11">Quiet while you work. Clear at the checkpoint.</text>
  </g>
  <rect x=".5" y=".5" width="1099" height="399" rx="20" fill="none" stroke="#36545e" stroke-opacity=".7"/>
</svg>\n`;
const directory = new URL("../media/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("cover.svg", directory), svg.split("\n").map(line => line.trimEnd()).join("\n"));
console.log(`Wrote ${fileURLToPath(new URL("cover.svg", directory))}`);
