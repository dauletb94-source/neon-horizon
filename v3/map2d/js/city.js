// City map data: loads the real-photo mosaic metadata + building hotspot
// coordinates from buildings.json. No procedural layout generation —
// every slot is a hand-placed point on the actual photo.
(function (global) {
  let cache = null;

  async function loadMap() {
    if (cache) return cache;
    const res = await fetch("buildings.json");
    cache = await res.json();
    return cache;
  }

  function districtUnlocked(district, residents) {
    return residents >= district.unlockFollowers;
  }

  // Slots are visited in file order (already grouped by district) so early
  // districts fill up before later ones, same spirit as the old grid walk.
  function findFreePlot(map, claimedSet, residents) {
    const byId = new Map(map.districts.map((d) => [d.id, d]));
    for (const slot of map.slots) {
      const d = byId.get(slot.districtId);
      if (!d || !districtUnlocked(d, residents)) continue;
      if (claimedSet.has(slot.id)) continue;
      return { districtId: slot.districtId, plotId: slot.id, slot };
    }
    return null;
  }

  function randomFreePlot(map, claimedSet, residents, excludeId) {
    const byId = new Map(map.districts.map((d) => [d.id, d]));
    const candidates = map.slots.filter((s) => {
      const d = byId.get(s.districtId);
      if (!d || !districtUnlocked(d, residents)) return false;
      if (s.id === excludeId) return false;
      return !claimedSet.has(s.id);
    });
    if (!candidates.length) return null;
    const slot = candidates[Math.floor(Math.random() * candidates.length)];
    return { districtId: slot.districtId, plotId: slot.id, slot };
  }

  global.NH_City = { loadMap, districtUnlocked, findFreePlot, randomFreePlot };
})(window);
