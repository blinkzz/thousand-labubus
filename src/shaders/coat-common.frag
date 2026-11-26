uniform vec3 toyEarColors[TOY_EAR_COLORS_LENGTH];
uniform vec3 toyEarInks[TOY_EAR_INKS_LENGTH];
const vec3 TOY_LUMA = vec3(0.2126, 0.7152, 0.0722);

float toyEarMark(vec2 p) {
  if (vToyEars == 0) return 0.0;
  p.x += p.x < 0.0 ? 0.105 : -0.066;
  if (vToyEars == 1) {
    float stripe = abs(fract((p.y + p.x * 0.38) * 24.0) - 0.5);
    return 1.0 - smoothstep(0.105, 0.17, stripe);
  }
  float spot = min(length(p - vec2(-0.019, 0.802)), length(p - vec2(0.015, 0.845)));
  spot = min(spot, length(p - vec2(-0.009, 0.892)));
  return 1.0 - smoothstep(0.009, 0.014, spot);
}

float toyCoatField(vec2 p) {
  if (vToyPattern == 0) { // Tapered, swept tiger stripes
    float bend = 0.34 * cos(PI * p.x) + 0.11 * sin(1.5 * PI * p.x + 1.1);
    float taper = 0.5 + 0.5 * sin(PI * p.x + 1.6 * p.y);
    return abs(fract(p.y + bend) - 0.5) - mix(0.016, 0.23, taper);
  }
  if (vToyPattern == 1) { // Angular chevrons
    float zig = abs(fract(p.x * 0.5 + 0.5) - 0.5);
    return abs(fract(p.y - 1.5 * zig) - 0.5) - 0.15;
  }
  if (vToyPattern == 2) { // Staggered, broken leopard rosettes
    vec2 tile = p * vec2(1.0, 0.9);
    tile.x += 0.45 * mod(floor(tile.y), 2.0);
    float shift = mod(floor(tile.x) + 2.0 * floor(tile.y), 3.0) - 1.0;
    vec2 q = fract(tile) - 0.5 - shift * vec2(0.06, -0.05);
    q = vec2(q.x + 0.28 * q.y, 1.27 * q.y);
    float ring = abs(length(q) - 0.225 + 0.039 * sin(13.0 * q.x) * sin(11.0 * q.y)) - 0.080;
    return max(ring, min(q.x - 0.08, 0.060 - abs(q.y)));
  }
  if (vToyPattern == 3) { // Regular round polka dots
    return length(fract(p * vec2(1.0, 0.93)) - 0.5) - 0.265;
  }
  if (vToyPattern == 4) { // Large offset patches
    vec2 tile = p * vec2(2.0 / 3.0, 0.68);
    tile += vec2(0.11 * sin(5.4 * tile.y), 0.13 * cos(0.5 * PI * tile.x));
    float row = floor(tile.y);
    tile.x += 0.34 * mod(row, 2.0);
    vec2 edge = abs(fract(tile) - 0.5) - 0.5;
    return max(edge.x, edge.y) * (1.0 - 2.0 * mod(floor(tile.x) + row, 2.0));
  }
  if (vToyPattern == 5) { // Small, sparse freckle clusters
    vec2 tile = p * vec2(2.0 / 3.0, 0.74);
    tile.x += 0.38 * mod(floor(tile.y), 2.0);
    vec2 q = fract(tile) - 0.5;
    float dots = min(length(q - vec2(-0.18, 0.10)) - 0.13, length(q - vec2(0.17, 0.14)) - 0.10);
    return min(dots, length(q - vec2(0.065, -0.18)) - 0.115);
  }
  if (vToyPattern == 6) { // Offset diamonds
    vec2 tile = p * vec2(1.0, 0.97);
    tile.x += 0.5 * mod(floor(tile.y), 2.0);
    vec2 q = abs(fract(tile) - 0.5);
    return q.x + q.y - 0.355;
  }
  // Smooth waves running vertically, unlike the tiger stripes and chevrons.
  float wave = p.x * 0.5 + 0.25 * sin(PI * p.y);
  return abs(fract(wave) - 0.5) - 0.17;
}

float toyChestStamp(vec3 p) {
  // The source atlas also contains a small pendant and its hanging loop.
  vec2 disk = (p.xy - vec2(0.067, 0.319)) / vec2(0.027, 0.031);
  vec2 loop = (p.xy - vec2(0.059, 0.360)) / vec2(0.015, 0.022);
  float footprint = min(length(disk), length(loop));
  return (1.0 - smoothstep(0.94, 1.26, footprint)) * smoothstep(0.097, 0.128, p.z);
}
