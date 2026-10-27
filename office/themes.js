// Themes for the Agent Office. Each theme sets:
// - the page look, through CSS variables in office.css ([data-theme="<id>"]);
// - the pixel world: `map` recolours the classic palette (classic hex → new hex),
//   and optional `floor`/`wall` hooks redraw tiles and `decor` adds wall decorations;
// - character outfits (`looks`), the room names, and how speech is drawn;
// - the side game's names (`game`).
// To add a theme: add an entry here and a [data-theme="<id>"] block in office.css.
window.OfficeThemes = (() => {
  "use strict";

  const CLASSIC_GAME = {
    title: "Commit Clicker",
    currency: "commits",
    clickLabel: "Write code",
    clickVerb: "Write code",
    sprite: "coffee",
    levelName: "Dev level",
    bonusName: "Overtime bonus",
    clickUpgrade: "Faster typing",
    upgrades: ["Rubber duck", "Intern", "Mechanical keyboard", "CI server", "Pair programmer", "AI dev team"]
  };

  const classic = {
    id: "classic",
    label: "Pixel office (night)",
    map: {},
    zones: ["YOUR OFFICE", "MANAGER", "EDIT SUITE", "DEV POD", "GITHUB", "QA LAB", "DESIGN"],
    zoneColor: "rgba(23,21,31,0.45)",
    boardText: "#3a354f",
    speech: "bubble",
    effects: false,
    game: CLASSIC_GAME
  };

  const daylight = {
    ...classic,
    id: "daylight",
    label: "Pixel office (day)",
    map: { "#0f0e15": "#e2dccd" }
  };

  // ---------- Old School RuneScape (fan theme, original pixel art) ----------
  const OSRS_FLOORS = {
    wood: ["#6b4a2e", "#563a22"],
    wood2: ["#5e4129", "#4a3220"]
  };

  function osrsFloor(x, y, zone, r, T) {
    const px = x * T, py = y * T;
    const seed = (x * 73 + y * 151) % 97;
    if (zone === "wood" || zone === "wood2") {
      const [base, line] = OSRS_FLOORS[zone];
      r(px, py, T, T, base);
      for (let j = 0; j < 4; j++) { r(px, py + j * 4 + 3, T, 1, line); r(px + ((x * 7 + j * 5 + y * 3) % 16), py + j * 4, 1, 3, line); }
    } else if (zone === "tile") {
      // Flagstones (the tavern).
      r(px, py, T, T, (x + y) % 3 ? "#8b8577" : "#7f7a6c");
      r(px, py, T, 1, "#5d594f"); r(px, py, 1, T, "#5d594f");
      if (seed % 4 === 0) r(px + 5, py + 6, 3, 2, "#9a9486");
    } else if (zone === "blue") {
      // Cobbles (the dev guild).
      r(px, py, T, T, "#5e5a51");
      r(px + 1, py + 1, 6, 6, "#77726a"); r(px + 9, py + 1, 6, 5, "#6f6a60");
      r(px + 1, py + 9, 5, 6, "#6f6a60"); r(px + 8, py + 8, 7, 7, "#77726a");
      r(px + 2, py + 2, 2, 1, "#8a857b"); r(px + 9, py + 9, 2, 1, "#8a857b");
    } else if (zone === "sage") {
      // Grass (the QA range).
      r(px, py, T, T, "#4c7a2a");
      for (let i = 0; i < 5; i++) {
        const gx = (seed * (i + 3) * 7) % 15, gy = (seed * (i + 5) * 3) % 14;
        r(px + gx, py + gy, 1, 2, i % 2 ? "#5f9133" : "#3f6823");
      }
    } else {
      // Dirt path.
      r(px, py, T, T, "#8a6c45");
      r(px + (seed % 13), py + (seed % 11), 2, 1, "#7a5d3a");
      r(px + ((seed * 3) % 14), py + ((seed * 7) % 13), 1, 1, "#9a7b52");
    }
  }

  function osrsWall(x, y, r, T, H, wall) {
    const px = x * T, py = y * T;
    r(px, py, T, T, "#3b3833"); r(px, py, T, 1, "#4a4640");
    if (y + 1 < H && !wall[y + 1][x]) {
      r(px, py + 7, T, 9, "#6e6a62"); r(px, py + 7, T, 1, "#85817a");
      r(px, py + 11, T, 1, "#4f4b45"); r(px, py + 14, T, 2, "#4f4b45");
      r(px + (x % 2 ? 4 : 11), py + 7, 1, 4, "#4f4b45");
      r(px + (x % 2 ? 11 : 4), py + 12, 1, 2, "#4f4b45");
    }
  }

  // Wall torches with a flickering flame.
  function torch(r, T, t, x, y) {
    const px = x * T, py = y * T, f = Math.floor(t * 8 + x) % 3, lift = f === 1 ? 1 : 0;
    r(px + 7, py + 9, 2, 5, "#4a3220");
    r(px + 6, py + 6 - lift, 4, 3, f === 2 ? "#ffb33c" : "#ff981f");
    r(px + 7, py + 5 - lift, 2, 2, "#fff2a8");
  }
  const TORCHES = [[3, 0], [13, 0], [27, 0], [2, 7], [8, 7], [22, 7], [28, 7]];

  const osrs = {
    id: "osrs",
    label: "Old School RuneScape",
    map: {
      "#0f0e15": "#000000",
      // Red carpet under the bank.
      "#3d3a52": "#5c1a1a", "#48445f": "#7a2323",
      // Dark oak desks.
      "#8a5a36": "#5a3a1e", "#a8714a": "#71492a", "#5f3c22": "#3f2914",
      // Scrying screens instead of monitors.
      "#163b52": "#2a1a4a", "#2f3a4c": "#3a3446", "#7fd1ff": "#c9a7ff",
      // The GitHub rack becomes a bank booth full of coins.
      "#1c1b26": "#3f2914", "#2a2938": "#5a3a1e", "#15141d": "#2b1c0e", "#7ccf8a": "#ffd54a", "#355e3e": "#6b5a2a",
      // Quest board.
      "#e9e4d8": "#d8c8a1", "#9a95a8": "#5a3a1e", "#b9b3c4": "#a8916a",
      // Coffee machine → cooking range.
      "#3a3546": "#4a4640", "#57516a": "#5f5a52",
      // Red velvet sofa, stone anvil bench, stone plant pots.
      "#7a4f6e": "#7a1f1f", "#946385": "#963030", "#69425e": "#5c1414",
      "#4b4a5c": "#5a5a5a", "#5f5e73": "#7a7a7a",
      "#a8603c": "#6e6a62", "#c27449": "#85817a",
      // Water barrel.
      "#9fd3f0": "#3a6ea5", "#c4e6f8": "#5b8fc4",
      "#6b4a30": "#4f3420"
    },
    floor: osrsFloor,
    wall: osrsWall,
    decor: TORCHES.map(([x, y]) => ({ x, y, draw: torch })),
    looks: {
      you:     { shirt: "#7a5230", pants: "#4a3f35", hat: "party", hatColor: "#3b6cd4" },
      manager: { shirt: "#5b2d8c", pants: "#4a2475", tie: false, hat: "wizard", hatColor: "#5b2d8c" },
      senior:  { shirt: "#3d6b7c", pants: "#2f5562", phones: false, hat: "full", hatColor: "#3d6b7c" },
      junior:  { shirt: "#8a6430", pants: "#6b4f25", hat: "med", hatColor: "#9a7238" },
      designer: { shirt: "#9c3f73", pants: "#4a2e3a", hat: "beret", hatColor: "#c8a24a" },
      editor:   { shirt: "#3b4f7a", pants: "#2b2b3a", phones: false, hat: "cap", hatColor: "#7a1f1f" },
      qa:      { shirt: "#2f6b2f", pants: "#28572a", hat: "coif", hatColor: "#5a4630" }
    },
    zones: ["YOUR KEEP", "MANAGER", "THEATRE", "DEV GUILD", "BANK", "QA RANGE", "CRAFTING"],
    zoneColor: "rgba(0,0,0,0.5)",
    boardText: "#3f2914",
    speech: "overhead",
    effects: true,
    game: {
      title: "Gold Ore Miner",
      currency: "coins",
      clickLabel: "Mine the gold rock",
      clickVerb: "Mine",
      sprite: "rock",
      levelName: "Mining level",
      bonusName: "Double XP",
      clickUpgrade: "Mining gloves",
      upgrades: ["Bronze pickaxe", "Iron pickaxe", "Mithril pickaxe", "Adamant pickaxe", "Rune pickaxe", "Dragon pickaxe"],
      stackColours: true
    }
  };

  const list = [classic, daylight, osrs];
  const byId = Object.fromEntries(list.map(t => [t.id, t]));

  return {
    list,
    DEFAULT: "classic",
    isValid: id => Object.prototype.hasOwnProperty.call(byId, id),
    get: id => byId[id] || classic
  };
})();
