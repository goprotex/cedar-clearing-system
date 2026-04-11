## Operator custom map data

You can add your own **property lines**, **fences**, and **entrances/gates** as GeoJSON files that the Operator map can load as overlays.

### Folder layout

Create a folder per bid id:

- `public/operator-data/<BID_ID>/property-lines.geojson`
- `public/operator-data/<BID_ID>/fences.geojson`
- `public/operator-data/<BID_ID>/entrances.geojson`

These are **optional**. If a file is missing or invalid, the app will just skip it.

### GeoJSON format

- Use `FeatureCollection`
- For **property lines / fences**: `LineString` or `MultiLineString`
- For **entrances**: `Point` or `MultiPoint`
- Coordinates must be **WGS84** longitude/latitude (EPSG:4326)

Example:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "name": "Main gate" },
      "geometry": { "type": "Point", "coordinates": [-97.12345, 31.23456] }
    }
  ]
}
```

### Quick ways to make GeoJSON

- **Google Earth Pro**: draw lines/polygons → export KML → convert to GeoJSON
- **QGIS**: import KML/SHP → reproject to EPSG:4326 → export GeoJSON
- **OnX / Gaia / other mapping apps**: export GPX/KML → convert to GeoJSON

### Tips

- Keep files reasonably small (thousands of vertices is fine; millions will be slow on iPad).
- Add `properties.name` for nicer labels in future popups.
