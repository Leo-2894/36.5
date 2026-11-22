"use strict";

// Small two-tone sprites keep the trail legible at the same scale as the card art.
const BattleEffects = (() => {
  const masks = {
    steam: ["..xx.", ".xx..", ".x...", "..xx.", "...x.", "..xx.", ".xx.."],
    ember: ["...x.", "..xx.", ".xxxx", "xxxxx", ".xxx."],
    drop: ["..x..", "..x..", ".xxx.", "xxxxx", ".xxx."],
    wind: ["....xx.", ".....xx", ".xxxxx.", ".......", "xxxxxx.", "....xx."],
    snow: ["x..x..x", ".x.x.x.", "..xxx..", "xxxxxxx", "..xxx..", ".x.x.x.", "x..x..x"],
    crystal: ["..x..", ".xxx.", "xxxxx", ".xxx.", "..x.."],
    ring: [".xxx.", "xx.xx", "x...x", "xx.xx", ".xxx."],
    heart: [".xx.xx.", "xxxxxxx", "xxxxxxx", ".xxxxx.", "..xxx..", "...x..."],
    stitch: ["xx...xx", ".xx.xx.", "..xxx..", ".xx.xx.", "xx...xx"],
    cross: ["..xx..", "..xx..", "xxxxxx", "xxxxxx", "..xx..", "..xx.."],
    shard: ["....xx", "...xxx", "..xxx.", ".xxx..", ".xx...", "x....."],
    arrow: ["...x...", "....x..", "xxxxxx.", "....x..", "...x..."],
    link: ["...xxx.", "..xx..x", ".xx...x", "xx...xx", "x...xx.", ".xxxx.."],
    lock: ["..xxx..", ".x...x.", ".x...x.", "xxxxxxx", "xxx.xxx", "xxx.xxx", ".xxxxx."],
    skull: [".xxxxx.", "xxxxxxx", "x..x..x", "xxxxxxx", ".xx.xx.", "..xxx..", "..x.x.."],
  };
  const styles = {
    "hot-chocolate": ["steam","drop","#e5a576"], "roasted-chestnuts": ["ember","crystal","#ffa449"],
    "sweet-potato": ["steam","ember","#ffae81"], "fish-shaped-bun": ["ember","steam","#ffd16f"],
    "steamed-bun": ["steam","ring","#ffe4bb"], "cup-noodles": ["steam","wind","#ff9169"],
    udon: ["wind","steam","#ffe094"], "fish-cake-soup": ["ring","steam","#ffc875"],
    "mint-candy": ["crystal","snow","#9affdf"], fan: ["wind","shard","#ace1da"],
    "ice-cream": ["drop","snow","#ffd1ec"], "handheld-fan": ["wind","ring","#a7eaff"],
    smoothie: ["drop","crystal","#e8b5ff"], "shaved-ice": ["snow","drop","#d9f4ff"],
    "cooling-spray": ["shard","drop","#92e6fc"], "ice-pack": ["snow","crystal","#83cbff"],
    "half-and-half": ["ember","snow","#ffb774","#8de2ff"], "iced-americano": ["drop","crystal","#e9b58d","#b9edff"],
    "water-gun": ["drop","ring","#77dfff"], "hot-air-blower": ["wind","ember","#ff9856"],
    "ice-bottle": ["shard","crystal","#bbddff"], "ice-bucket": ["drop","snow","#8ed3ff"],
    "heat-pack": ["heart","steam","#ff9c7d"], clothes: ["stitch","heart","#f8cf98"],
    tylenol: ["cross","ring","#9ef2c9"], "electric-fan": ["wind","shard","#98e5da"],
    "frostbite-patch": ["snow","cross","#8ddfff"], "clothing-damage": ["stitch","shard","#ffa994"],
    swap: ["arrow","crystal","#81e5d5","#ffd471"], "turn-control": ["link","lock","#ffd770"],
    "recovery-lock": ["lock","cross","#edab85","#ffdf9e"], fever: ["skull","drop","#ce9aff","#99e49c"],
  };
  const layer = document.getElementById("castTrail");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const stamps = new Map();
  function sprite(name, color) {
    const key = name + color;
    if (!stamps.has(key)) {
      const rows = masks[name];
      const canvas = document.createElement("canvas");
      canvas.width = rows[0].length;
      canvas.height = rows.length;
      const ctx = canvas.getContext("2d");
      rows.forEach((row, y) => [...row].forEach((pixel, x) => {
        if (pixel !== "x") return;
        ctx.fillStyle = y === 0 || row[x-1] !== "x" ? "#fff2dc" : color;
        ctx.fillRect(x, y, 1, 1);
      }));
      stamps.set(key, canvas);
    }
    return stamps.get(key);
  }
  function center(node) {
    const r = node.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }
  function cast(id, caster, targets) {
    if (reduced.matches) return;
    const [first, second, primary, accent = primary] = styles[id];
    const start = center(document.getElementById(caster.toLowerCase() + "Slot").closest(".slot"));
    for (const target of targets) {
      const panel = document.getElementById(target.toLowerCase() + "Temp").closest(".player");
      const end = center(panel.querySelector(".pilot"));
      for (let i = 0; i < 12; i++) {
        const impact = i >= 6;
        const angle = i * Math.PI / 3;
        const stamp = sprite(i % 2 ? second : first, i % 2 ? accent : primary);
        const particle = document.createElement("canvas");
        particle.width = stamp.width;
        particle.height = stamp.height;
        particle.getContext("2d").drawImage(stamp, 0, 0);
        const size = impact ? 18 : 12;
        particle.style.width = particle.style.height = size + "px";
        const pose = (x,y,s) => "translate(" + Math.round(x-size/2) + "px," + Math.round(y-size/2) + "px) scale(" + s + ")";
        const middleX = (start[0]+end[0])/2;
        const middleY = (start[1]+end[1])/2 - 45 + i * 6;
        const radius = Math.min(65,panel.clientWidth*.36);
        const frames = impact ? [
          {transform:pose(...end,.5),opacity:0}, {offset:.23,transform:pose(end[0]+Math.cos(angle)*20,end[1]+Math.sin(angle)*20,1.2),opacity:1},
          {transform:pose(end[0]+Math.cos(angle)*radius,end[1]+Math.sin(angle)*radius,.75),opacity:0}
        ] : [
          {transform:pose(...start,.4),opacity:0}, {offset:.36,transform:pose(middleX,middleY,1),opacity:1},
          {transform:pose(...end,.7),opacity:.2}
        ];
        layer.append(particle);
        const animation = particle.animate(frames,{duration:impact ? 620 : 500,delay:impact ? 450 : i*32,easing:"ease-out"});
        animation.onfinish = () => particle.remove();
      }
    }
  }
  return {cast, clear: () => layer.replaceChildren()};
})();
{
  const snow = document.getElementById("snow");
  const flakes = document.createDocumentFragment();
  for (let i = 0; i < 108; i++) {
    const flake = document.createElement("i");
    const depth = i % 3;
    flake.style.setProperty("--size", (1.5 + depth * 1.4) + "px");
    flake.style.setProperty("--alpha", .36 + depth * .22);
    flake.style.setProperty("--speed", (2.1 - depth * .46) + "s");
    flake.style.setProperty("--delay", -(i * .373 % 2.1) + "s");
    flake.style.setProperty("--x", ((i * 61.803 % 100) * 1.1 - 5) + "%");
    flake.style.setProperty("--y", ((i * 43.117 % 100) * 1.1 - 5) + "%");
    flakes.append(flake);
  }
  snow.append(flakes);
}
