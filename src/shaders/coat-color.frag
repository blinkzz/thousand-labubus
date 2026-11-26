vec3 toySurface = texture2D(roughnessMap, vRoughnessMapUv).rgb;
float toyChest = toyChestStamp(vToyPosition);
float bakedDetail = sqrt(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)));
float coatDetail = min(0.34 + 1.18 * bakedDetail, 1.0);
float chestDetail = clamp(0.59 - 1.9 * (vToyPosition.y - 0.32), 0.49, 0.64);
coatDetail = mix(coatDetail, chestDetail, 0.83 * toyChest);

// Wrap a twelve-cell domain around the toy. The fields repeat at its rear seam.
vec2 coatPosition = vec2(atan(vToyPosition.x, vToyPosition.z) * (6.0 / PI),
                         vToyPosition.y * 11.0 + 0.24);
float field = toyCoatField(coatPosition);
float edge = clamp(0.5 * fwidth(field), 0.018, 0.16);
float marking = 1.0 - smoothstep(-edge, edge, field);
float furLuma = dot(vToyFur, TOY_LUMA);
float inkLuma = dot(vToyInk, TOY_LUMA);
float closeShade = 1.0 - smoothstep(0.035, 0.16, abs(furLuma - inkLuma));
vec3 ink = inkLuma < furLuma
  ? vToyInk * (1.0 - 0.42 * closeShade)
  : mix(vToyInk, vec3(1.0), 0.20 * closeShade);
vec3 coat = mix(vToyFur, ink, marking) * coatDetail;
float furMask = smoothstep(0.18, 0.79, mix(toySurface.r, 1.0, toyChest));
diffuseColor.rgb = mix(diffuseColor.rgb, coat, furMask);

vec3 lining = mix(toyEarColors[vToyEars], toyEarInks[vToyEars], toyEarMark(vToyPosition.xy));
float earMask = smoothstep(0.12, 0.85, toySurface.b);
diffuseColor.rgb = mix(diffuseColor.rgb, lining * min(0.42 + bakedDetail, 1.0), earMask);
