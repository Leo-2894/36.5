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
  // Draw the four rare impacts on a small pixel grid, then scale it with the HUD.
  function signature(id, panel) {
    const swap = id === "swap";
    const preview = panel.querySelector(".mini-card");
    const anchor = swap && preview.getBoundingClientRect().top < innerHeight ? preview : panel.querySelector(".pilot");
    const [cx, cy] = center(anchor);
    const side = Math.min(240, innerWidth * .68, Math.max(152, panel.clientWidth * 1.12));
    const canvas = document.createElement("canvas");
    canvas.className = "signature";
    canvas.dataset.card = id;
    canvas.width = canvas.height = 96;
    Object.assign(canvas.style, {width:side+"px", height:side+"px", left:Math.max(0,Math.min(innerWidth-side,cx-side/2))+"px",
      top:Math.max(0,Math.min(innerHeight-side,cy-side/2))+"px", opacity:"1"});
    layer.append(canvas);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const [,,color, accent=color] = styles[id];
    const icon = (name, tint, x, y, size) => ctx.drawImage(sprite(name,tint), Math.round(x-size/2),Math.round(y-size/2),size,size);
    function card(x,y,ink) {
      ctx.fillStyle="#192a3b"; ctx.fillRect(x-7,y-10,15,21);
      ctx.strokeStyle=ink; ctx.strokeRect(x-7.5,y-10.5,16,22);
      icon("arrow",ink,x,y,9);
    }
    const begin = performance.now();
    function frame(now) {
      if (!canvas.isConnected) return;
      const t = Math.min(1,(now-begin)/1480);
      if (t >= 1 || reduced.matches) { canvas.remove(); return; }
      const close = Math.min(1,t/.46);
      const pulse = Math.sin(Math.PI*t);
      ctx.clearRect(0,0,96,96);
      ctx.globalAlpha = Math.min(1,t*8,(1-t)*5);
      const halo = ctx.createRadialGradient(48,48,4,48,48,45);
      halo.addColorStop(0,color+"65"); halo.addColorStop(.68,color+"28"); halo.addColorStop(1,color+"00");
      ctx.fillStyle=halo; ctx.fillRect(0,0,96,96);
      if (swap) {
        const a=t*Math.PI*1.4;
        for (let k=0;k<2;k++) {
          const phase=a+k*Math.PI, ink=k?accent:color;
          ctx.strokeStyle=ink; ctx.lineWidth=2;
          ctx.beginPath(); ctx.ellipse(48,48,31,17,0,phase-1.8,phase); ctx.stroke();
          card(Math.round(48+31*Math.cos(phase)),Math.round(48+17*Math.sin(phase)),ink);
        }
      } else if (id === "turn-control") {
        for (const slope of [-1,1]) {
          for (let j=-4;j<=4;j++) {
            icon("link",color,48+j*8,48+slope*j*5+slope*(1-close)*32,12);
          }
        }
        if (close===1) icon("lock","#ffc451",48,48,23);
      } else if (id === "recovery-lock") {
        icon("cross","#a1edbe",48,48,32);
        for (const sign of [-1,1]) {
          const y=Math.round(48+sign*(5+22*(1-close)));
          ctx.fillStyle="#51273c"; ctx.fillRect(19,y-3,58,7);
          ctx.fillStyle="#ffc181"; ctx.fillRect(19,y-3,58,2);
          for(let x=22;x<74;x+=8) {ctx.fillStyle="#d86962";ctx.fillRect(x,y,4,2);}
        }
        if(close===1) icon("lock","#ffe1a0",48,48,20);
      } else {
        const reach=Math.round(close*18);
        ctx.save(); ctx.translate(24+reach,17+reach); ctx.rotate(-Math.PI/4);
        ctx.fillStyle="#ddd2f6";ctx.fillRect(-5,-12,10,18);ctx.fillRect(-8,-16,16,3);ctx.fillRect(-1,6,2,14);
        ctx.fillStyle="#9863ca";ctx.fillRect(-3,-4,6,8);ctx.restore();
        for(let j=0;j<7;j++) {
          const a=j*2.4+t*2, r=8+t*27;
          icon("drop",accent,49+r*Math.cos(a),52+r*Math.sin(a),7);
        }
        if(t>.24) icon("skull",color,51,54-Math.round(t*6),Math.round(12+18*pulse));
      }
      for(let j=0;j<8;j++) {
        const a=j*Math.PI/4+.18, r=25+t*20;
        icon("crystal",j%2?color:accent,48+r*Math.cos(a),48+r*Math.sin(a),Math.round(2+pulse*3));
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function cast(id, caster, targets) {
    if (reduced.matches) return;
    const [first, second, primary, accent = primary] = styles[id];
    const start = center(document.getElementById(caster.toLowerCase() + "Slot").closest(".slot"));
    for (const target of targets) {
      const panel = document.getElementById(target.toLowerCase() + "Temp").closest(".player");
      if (["swap","turn-control","recovery-lock","fever"].includes(id)) signature(id, panel);
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
        const airborne = first === "steam" || first === "ember" || first === "heart";
        const gust = first === "wind" || id === "cooling-spray";
        const liquid = first === "drop" || first === "ring";
        const middleY = (start[1]+end[1])/2 + (gust ? (i-3)*4 : liquid ? -70 : -45+i*6);
        const radius = Math.min(65,panel.clientWidth*.36);
        let dx = Math.cos(angle)*radius, dy = Math.sin(angle)*radius;
        if (airborne) { dx = (i-8.5)*9; dy = -radius*(.65+(i%3)*.18); }
        else if (gust) { dx = (end[0]>=start[0]?1:-1)*radius*.8; dy=(i-8.5)*10; }
        else if (liquid) { dy = 14+Math.abs(dy)*.8; }
        else if (first === "snow" || first === "crystal") { dy = radius*.65; dx=(i-8.5)*13; }
        const frames = impact ? [
          {transform:pose(...end,.5),opacity:0}, {offset:.23,transform:pose(end[0]+Math.cos(angle)*20,end[1]+Math.sin(angle)*20,1.2),opacity:1},
          {transform:pose(end[0]+dx,end[1]+dy,.75),opacity:0}
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
