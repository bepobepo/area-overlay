import { defineMcp } from "@lovable.dev/mcp-js";
import generateAreaShapeTool from "./tools/generate-area-shape";
import searchPlaceTool from "./tools/search-place";

export default defineMcp({
  name: "area-overlay",
  title: "Area Overlay",
  version: "0.1.0",
  instructions:
    "Tools for Area Overlay, an app for comparing the real-world size of places. Use `search_place` to resolve a place name or address to coordinates, and `generate_area_shape` to estimate the footprint of a described thing as a polygon in meters.",
  tools: [searchPlaceTool, generateAreaShapeTool],
});
