#!/usr/bin/env python3
"""Fix all RadialGradient elements in scene.rml — remove invalid
startRadius/endRadius attributes and set proper endX/endY to define
the gradient radius via the start→end distance."""

import re

RML = '/home/z/my-project/shikubot/scene.rml'

with open(RML, 'r') as f:
    content = f.read()

# Pattern: match RadialGradient opening tag with startRadius/endRadius
pattern = r'<RadialGradient([^>]*)>'

def fix_radial(match):
    attrs = match.group(1)
    # Remove startRadius and endRadius
    attrs = re.sub(r'\s*startRadius="[^"]*"', '', attrs)
    attrs = re.sub(r'\s*endRadius="[^"]*"', '', attrs)
    # Parse startX, startY, endX, endY
    sx = float(re.search(r'startX="(-?[\d.]+)"', attrs).group(1))
    sy = float(re.search(r'startY="(-?[\d.]+)"', attrs).group(1))
    # The endX/endY currently might be (0,0) — we need to set them
    # so the distance from start to end = desired radius.
    # We'll use the name to determine the desired radius.
    name_match = re.search(r'name="(\w+)"', attrs)
    name = name_match.group(1) if name_match else ''
    
    # Map shape names to desired radii
    radii = {
        'headGrad': 120, 'bodyGrad': 120,
        'mouthGrad': 22,
        'lidRGrad': 30, 'lidLGrad': 30,
        'pupilRGrad': 10, 'pupilLGrad': 10,
        'scleraRGrad': 25, 'scleraLGrad': 25,
        'tail5Grad': 9, 'tail4Grad': 11, 'tail3Grad': 13,
        'tail2Grad': 15, 'tail1Grad': 17,
    }
    radius = radii.get(name, 50)
    
    # Set endX/endY so that distance from (sx,sy) to (ex,ey) = radius
    # Direction: along the X axis from start
    ex = sx + radius
    ey = sy
    
    # Replace endX/endY in attrs
    attrs = re.sub(r'endX="[^"]*"', f'endX="{ex}"', attrs)
    attrs = re.sub(r'endY="[^"]*"', f'endY="{ey}"', attrs)
    
    return f'<RadialGradient{attrs}>'

content_fixed = re.sub(pattern, fix_radial, content)

with open(RML, 'w') as f:
    f.write(content_fixed)

print(f'Fixed RadialGradient elements in {RML}')
