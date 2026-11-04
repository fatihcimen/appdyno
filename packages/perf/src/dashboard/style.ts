/** Colors by role; dark is on screen only, so that a page prints as ink on paper. */
const COLORS = `:root{color-scheme:light dark;--surface:#fcfcfb;--plane:#f9f9f7;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--edge:rgba(11,11,11,.1);--series:#2a78d6;
--good:#0ca30c;--warning:#fab219;--critical:#d03b3b;--fold:#898781;--tip:#0b0b0b;--tip-ink:#f0efec;--tip-ink2:#c3c2b7;
--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4;--s6:#008300;--s7:#6250d6;--s8:#e34948;--on4:#0b0b0b}
@media screen and (prefers-color-scheme:dark){:root{--surface:#1a1a19;--plane:#0d0d0d;--ink:#f0efec;--ink2:#c3c2b7;--grid:#2c2c2a;--axis:#383835;--edge:rgba(255,255,255,.1);--series:#3987e5;--tip:#f0efec;--tip-ink:#0b0b0b;--tip-ink2:#52514e;
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--s6:#008300;--s7:#9085e9;--s8:#e66767;--on4:#fff}}`;

const PAGE = `*{box-sizing:border-box}
body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;background:var(--plane);color:var(--ink)}
main{max-width:1320px;margin:auto;padding:1.25rem 1rem 3rem}
h1{font-size:1.4rem;margin:0}h2{font-size:1.15rem;margin:0 0 .5rem}
h3{font-size:1rem;margin:1.5rem 0 .5rem}h4{font-size:.95rem;margin:1.5rem 0 .6rem;padding-top:.75rem;border-top:1px solid var(--grid)}
h1,h2,h3,h4,.m,.which,.cap,figcaption{overflow-wrap:anywhere}
a{color:inherit}pre{background:var(--surface);border:1px solid var(--edge);border-radius:6px;padding:.6rem .8rem;overflow-x:auto;margin:.5rem 0}
.card{background:var(--surface);border:1px solid var(--edge);border-radius:8px;padding:.85rem}
.note,.m,.cap{color:var(--ink2)}.m,.cap{font-size:.8rem;font-weight:400}.note{font-size:.85rem;margin:.6rem 0 0}.none{color:var(--ink2)}
.head{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:baseline;margin-bottom:1rem}.head nav{display:flex;flex-wrap:wrap;gap:.25rem .75rem}
.nophone{margin:.6rem 0}.nophone .chip{font-size:.9rem;font-weight:600;margin-top:0}.nophone pre{margin-bottom:0}.note+.tw{margin-top:.6rem}.nophone+.tw{margin-top:.6rem}.app{margin-top:2rem}.app>h2{font-size:1.25rem;margin:0}
.m{font-variant-numeric:tabular-nums}`;

const MARKS = `.defs{position:absolute;width:0;height:0}
.i{width:14px;height:14px;flex:none}.good{color:var(--good)}.warning{color:var(--warning)}.critical{color:var(--critical)}.model,.no{color:var(--ink2)}
.chip{display:flex;gap:.3rem;align-items:flex-start;margin-top:.2rem;font-size:.8rem}.chip .i{margin-top:.15rem}.chip>span{min-width:0;overflow-wrap:anywhere}
.tiles{display:flex;flex-wrap:wrap;gap:.5rem 2rem;margin:.25rem 0 .5rem}.count{font-size:1.9rem;font-weight:600;line-height:1.1}.tile.quiet{color:var(--ink2)}.tl-quiet{font-size:.8rem}
.tile .chip{margin-top:0;font-size:.85rem}
.which{margin:.25rem 0;padding-left:1.1rem}.which li{margin:.15rem 0}.clear{margin:.25rem 0}.clear .chip{display:inline-flex;font-weight:600;font-size:inherit;margin-right:.25rem}
.attention h3{font-size:.9rem;margin:.75rem 0 .1rem}.attention details{margin-top:.75rem}.attention summary{font-weight:600;font-size:.9rem}
summary{cursor:pointer}
.why+.why{margin-top:.6rem}.why h4{margin:0 0 .35rem;padding:0;border:0;overflow-wrap:anywhere}.why dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:.15rem .75rem;margin:0}.why dt{font-weight:600}.why dd{margin:0;overflow-wrap:anywhere}`;

const TABLES = `.tw{overflow-x:auto}
.matrix{border-collapse:collapse;table-layout:fixed;width:100%;min-width:calc(10.5rem + var(--cols)*10.5rem);background:var(--surface);font-variant-numeric:tabular-nums}
.matrix th,.matrix td{padding:.55rem .65rem;text-align:left;vertical-align:top;border-top:1px solid var(--grid);overflow-wrap:break-word}
.matrix thead th{border-top:0;border-bottom:1px solid var(--axis);font-weight:600}.matrix thead th:first-child{width:10.5rem}
.matrix tbody th{font-weight:600}.v{font-size:1.05rem;font-weight:600;white-space:nowrap}
.data{border-collapse:collapse;width:100%;font-size:.8rem;font-variant-numeric:tabular-nums;margin-top:.25rem}.data th,.data td{padding:.15rem .4rem .15rem 0;text-align:left;border-top:1px solid var(--grid)}.data th{font-weight:600;border-top:0}
.view{margin-top:.4rem;font-size:.8rem;color:var(--ink2)}`;

const CHARTS = `.multiples{display:grid;grid-template-columns:repeat(auto-fill,minmax(285px,1fr));gap:.75rem;align-items:start}
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
const LAYOUTS = `@media screen and (max-width:720px){main{padding:.75rem .6rem 2rem}.matrix,.matrix tbody,.matrix tr,.matrix th,.matrix td{display:block;min-width:0;width:auto}.matrix thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.matrix tr{border-top:1px solid var(--axis)}.matrix tbody th{border-top:0;padding-bottom:0}.matrix td{border-top:0;padding-top:.3rem;padding-bottom:.3rem}.matrix td::before{content:attr(data-device);display:block;font-size:.75rem;color:var(--ink2)}.matrix td:has(>.none){display:flex;justify-content:space-between;gap:.5rem}}
@media print{:root{color-scheme:light}body{background:#fff;font-size:10pt}main{max-width:none;padding:0}.tw{overflow:visible}.matrix{min-width:0}.view,.head nav{display:none}.card,.tile,tr,figure{break-inside:avoid}h3,h4{break-after:avoid}.card{border-color:var(--grid)}a{text-decoration:none}}`;

export const STYLE = [COLORS, PAGE, MARKS, TABLES, CHARTS, LAYOUTS].join('\n');
