import { PAGE_BASE } from '@appdyno/core';

const PAGE = `main{max-width:1240px;margin:auto;padding:0 2rem 5rem}
h2{font-size:1.2rem;margin-bottom:.5rem}h3{font-size:.78rem;letter-spacing:.05em;text-transform:uppercase;color:var(--ink2);margin:2.25rem 0 .75rem;font-weight:600}
h4{font-size:1rem;margin:2rem 0 .75rem}
h1,h2,h3,h4,.m,.which,.cap,figcaption{overflow-wrap:anywhere}
.note,.cap{color:var(--ink2)}.cap{font-size:.8rem;font-weight:400}.note{font-size:.88rem;margin:.6rem 0 0}.none{color:var(--muted);font-size:.85rem}
.nophone{margin:.75rem 0}.nophone .chip{font-size:.9rem;font-weight:600;margin-top:0}.nophone pre{margin-bottom:0}.note+.tw{margin-top:.75rem}.nophone+.tw{margin-top:.75rem}
.app{margin-top:3.5rem}.app>h2{font-size:1.75rem;font-weight:700;letter-spacing:-.022em;margin:0}.unread{margin-top:.85rem}`;

const MARKS = `.defs{position:absolute;width:0;height:0}
.i{width:14px;height:14px;flex:none}.good{color:var(--good)}.warning{color:var(--warning)}.critical{color:var(--critical)}.model,.no{color:var(--ink2)}
.chip{display:flex;gap:.3rem;align-items:flex-start;margin-top:.2rem;font-size:.8rem}.chip .i{margin-top:.15rem}.chip>span{min-width:0;overflow-wrap:anywhere}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));gap:.75rem;margin:.75rem 0 1rem}.tile{padding:.75rem .9rem;border-radius:10px;background:var(--plane)}.count{font:700 2.5rem/1.05 ui-rounded,-apple-system,BlinkMacSystemFont,system-ui,sans-serif;letter-spacing:-.02em}.tile.quiet{color:var(--ink2)}.tl-quiet{font-size:.8rem}
.tile .chip{margin-top:0;font-size:.85rem}
.which{margin:.25rem 0;padding-left:1.1rem}.which li{margin:.15rem 0}.clear{margin:.25rem 0}.clear .chip{display:inline-flex;font-weight:600;font-size:inherit;margin-right:.25rem}
.attention h3{font-size:.9rem;margin:.75rem 0 .1rem}.attention details{margin-top:.75rem}.attention summary{font-weight:600;font-size:.9rem}
summary{cursor:pointer}
.why+.why{margin-top:.6rem}.why h4{margin:0 0 .35rem;padding:0;border:0;overflow-wrap:anywhere}.why dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:.15rem .75rem;margin:0}.why dt{font-weight:600}.why dd{margin:0;overflow-wrap:anywhere}`;

const TABLES = `.tw{overflow-x:auto;background:var(--surface);border:1px solid var(--edge);border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 12px 28px -22px rgba(0,0,0,.28)}
.matrix tbody tr:hover{background:color-mix(in srgb,var(--series) 5%,transparent)}
.matrix{border-collapse:collapse;table-layout:fixed;width:100%;min-width:calc(10.5rem + var(--cols)*10.5rem);background:var(--surface);font-variant-numeric:tabular-nums}
.matrix th,.matrix td{padding:.8rem 1rem;text-align:left;vertical-align:top;border-top:1px solid var(--grid);overflow-wrap:break-word}
.matrix thead th{border-top:0;border-bottom:1px solid var(--axis);font-weight:600}.matrix thead th:first-child{width:10.5rem}
.matrix tbody th{font-weight:600}.v{font:650 1.3rem/1.2 ui-rounded,-apple-system,BlinkMacSystemFont,system-ui,sans-serif;white-space:nowrap}
.data{border-collapse:collapse;width:100%;font-size:.8rem;font-variant-numeric:tabular-nums;margin-top:.25rem}.data th,.data td{padding:.15rem .4rem .15rem 0;text-align:left;border-top:1px solid var(--grid)}.data th{font-weight:600;border-top:0}
.view{margin-top:.4rem;font-size:.8rem;color:var(--ink2)}`;

const CHARTS = `.trends{display:flex;flex-wrap:wrap;gap:0 1rem}.trend{flex:var(--charts) 1 calc(var(--charts)*300px);min-width:0}.trend h4{margin-top:1rem}
.multiples{display:grid;grid-template-columns:repeat(auto-fill,minmax(285px,1fr));gap:1rem;align-items:start}
figure{margin:0;min-width:0}figcaption{margin-bottom:.25rem}figcaption .chip{display:inline-flex;margin:.15rem .6rem 0 0}
svg.chart,svg.split{display:block;width:100%;height:auto;font-size:11px}
.grid{stroke:var(--grid);vector-effect:non-scaling-stroke}.axis{stroke:var(--axis);vector-effect:non-scaling-stroke}
.tick{fill:var(--muted);font-variant-numeric:tabular-nums}.endv{fill:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}
.band{fill:var(--series);opacity:.1}.limit{stroke:var(--ink2);stroke-dasharray:4 3;vector-effect:non-scaling-stroke}
.line{fill:none;stroke:var(--series);stroke-width:2;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}.line.est{stroke-dasharray:6 4}
.noisy{fill:var(--surface);stroke:var(--series);stroke-width:2;vector-effect:non-scaling-stroke}
.end{fill:var(--series);stroke:var(--surface);stroke-width:2;vector-effect:non-scaling-stroke}.end.alert{fill:var(--critical)}
.hit{fill:transparent;pointer-events:all}.cross,.hot,.tip{visibility:hidden;pointer-events:none}
.cross{stroke:var(--axis);vector-effect:non-scaling-stroke}.hot{fill:var(--series);stroke:var(--surface);stroke-width:2}
.pt:hover .cross,.pt:hover .hot,.pt:hover .tip{visibility:visible}
figure:has(summary:focus-visible) .newest .tip,figure:has(summary:focus-visible) .newest .cross{visibility:visible}
.tip rect{fill:var(--tip)}.tv{fill:var(--tip-ink);font-weight:600}.tl{fill:var(--tip-ink2)}
svg.split{overflow:visible;margin:.5rem 0 .35rem}svg.split:hover{position:relative;z-index:2}
.seg{transition:none}.pt:hover .seg{opacity:.85}.on{fill:#fff;font-size:11px;font-weight:600}.on4{fill:var(--on4)}
.s0{fill:var(--fold);background:var(--fold)}.s1{fill:var(--s1);background:var(--s1)}.s2{fill:var(--s2);background:var(--s2)}.s3{fill:var(--s3);background:var(--s3)}.s4{fill:var(--s4);background:var(--s4)}.s5{fill:var(--s5);background:var(--s5)}.s6{fill:var(--s6);background:var(--s6)}.s7{fill:var(--s7);background:var(--s7)}.s8{fill:var(--s8);background:var(--s8)}
.legend{list-style:none;display:flex;flex-wrap:wrap;gap:.1rem .75rem;margin:.25rem 0 0;padding:0;font-size:.8rem;color:var(--ink2)}.legend li{overflow-wrap:anywhere;min-width:0}
.key{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:.3rem;vertical-align:-1px}
.cap{display:flex;flex-wrap:wrap;gap:.1rem .75rem;margin:.25rem 0 0}.band-key{background:var(--series);opacity:.25}.limit-key{height:0;width:14px;border-radius:0;border-top:1px dashed var(--ink2);vertical-align:3px}.noisy-key{border:2px solid var(--series);border-radius:50%;background:var(--surface)}`;

/** A narrow window reads the table as cards, each cell naming its device; paper keeps the columns and loses what only a pointer can reach. */
const LAYOUTS = `@media screen and (max-width:720px){main{padding:0 .75rem 2rem}.matrix,.matrix tbody,.matrix tr,.matrix th,.matrix td{display:block;min-width:0;width:auto}.matrix thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.matrix tr{border-top:1px solid var(--axis)}.matrix tbody th{border-top:0;padding-bottom:0}.matrix td{border-top:0;padding-top:.3rem;padding-bottom:.3rem}.matrix td::before{content:attr(data-device);display:block;font-size:.75rem;color:var(--ink2)}.matrix td:has(>.none){display:flex;justify-content:space-between;gap:.5rem}}
@media print{:root{color-scheme:light}body{background:#fff;font-size:10pt}main{max-width:none;padding:0}.tw{overflow:visible;box-shadow:none}.matrix{min-width:0}.view,.bar nav{display:none}.card,.tile,tr,figure{break-inside:avoid}h3,h4{break-after:avoid}.card{border-color:var(--grid)}a{text-decoration:none}}`;

export const STYLE = [PAGE_BASE, PAGE, MARKS, TABLES, CHARTS, LAYOUTS].join('\n');
