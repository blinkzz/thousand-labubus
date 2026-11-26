vToyPosition = position;
vToyFur = toyFurPalette[int(instanceColor.x)];
vToyInk = toyInkPalette[int(instanceColor.y)];
int style = int(instanceColor.z);
vToyEars = style / TOY_PATTERN_COUNT;
vToyPattern = style % TOY_PATTERN_COUNT;
