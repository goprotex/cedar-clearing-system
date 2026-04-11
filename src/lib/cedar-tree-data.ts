// Tree positions derived from cedar analysis — shared by hologram map layers and operator view.

export interface TreePosition {
  lng: number;
  lat: number;
  species: 'cedar' | 'oak' | 'mixed';
  height: number;
  canopyDiameter: number;
}

export interface PastureWall {
  id: string;
  coordinates: [number, number][];
  color: string;
}

type Species = 'cedar' | 'oak' | 'mixed';

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function extractTreesFromAnalysis(
  pastures: Array<{
    cedarAnalysis: { gridCells: GeoJSON.FeatureCollection; summary: { gridSpacingM: number } } | null;
    density: string;
  }>
): TreePosition[] {
  const trees: TreePosition[] = [];
  const rand = seededRandom(42);

  for (const pasture of pastures) {
    if (!pasture.cedarAnalysis?.gridCells?.features) continue;

    for (const feature of pasture.cedarAnalysis.gridCells.features) {
      const props = feature.properties ?? {};
      const cls = props.classification as string;
      if (cls !== 'cedar' && cls !== 'oak' && cls !== 'mixed_brush') continue;

      const species: Species = cls === 'mixed_brush' ? 'mixed' : (cls as Species);

      const ndvi = (props.ndvi as number) ?? 0.2;
      const bandVotes = (props.bandVotes as number) ?? 2;

      let treeCount = 5;
      if (ndvi > 0.6) treeCount += 10;
      else if (ndvi > 0.5) treeCount += 8;
      else if (ndvi > 0.4) treeCount += 6;
      else if (ndvi > 0.3) treeCount += 4;
      else if (ndvi > 0.2) treeCount += 2;
      else if (ndvi > 0.1) treeCount += 1;

      if (bandVotes >= 5) treeCount += 4;
      else if (bandVotes >= 4) treeCount += 3;
      else if (bandVotes >= 3) treeCount += 2;
      else if (bandVotes >= 2) treeCount += 1;

      const coords = (feature.geometry as GeoJSON.Polygon).coordinates[0];
      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);

      for (let t = 0; t < treeCount; t++) {
        const lng = minLng + rand() * (maxLng - minLng);
        const lat = minLat + rand() * (maxLat - minLat);
        const ndviScale = 0.7 + Math.min(ndvi, 0.7) * 1.0;

        let height: number;
        let canopy: number;
        if (species === 'cedar') {
          height = (4 + rand() * 8) * ndviScale;
          canopy = (3 + rand() * 5) * ndviScale;
        } else if (species === 'oak') {
          height = (5 + rand() * 7) * ndviScale;
          canopy = (5 + rand() * 7) * ndviScale;
        } else {
          height = (3 + rand() * 5) * ndviScale;
          canopy = (3 + rand() * 4) * ndviScale;
        }

        trees.push({
          lng,
          lat,
          species,
          height: Math.round(height * 10) / 10,
          canopyDiameter: Math.round(canopy * 10) / 10,
        });
      }
    }
  }

  return trees;
}
