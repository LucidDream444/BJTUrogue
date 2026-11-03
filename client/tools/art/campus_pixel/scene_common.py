"""Shared orthographic scene composition and pixel material placement."""
from __future__ import annotations

from PIL import Image, ImageDraw
from .drawing import P, paste_at

WIDTH, HEIGHT = 768, 432


def fill_texture(image, tile, rect, floor=False):
    x0,y0,x1,y1=rect
    if floor:
        tile=tile.resize((64,32),Image.Resampling.NEAREST)
    layer=Image.new('RGBA',(x1-x0,y1-y0))
    for y in range(0,layer.height,tile.height):
        for x in range(0,layer.width,tile.width):
            layer.paste(tile,(x,y))
    image.alpha_composite(layer,(x0,y0))


def room(floor_tile, wall_tile, wall_bottom=136):
    image=Image.new('RGBA',(WIDTH,HEIGHT),'#B7B7AC')
    d=ImageDraw.Draw(image)
    # Straight parallel architecture: a cut-away south wall, no isometric grid.
    d.rectangle((24,14,743,420),fill=P['steel_shadow'] if 'steel_shadow' in P else '#626A63')
    fill_texture(image,wall_tile,(32,20,736,wall_bottom))
    fill_texture(image,floor_tile,(32,wall_bottom,736,411),floor=True)
    d.line((32,20,735,20),fill=P['wall_light'],width=3)
    d.rectangle((28,19,31,412),fill=P['wall_shadow'])
    d.rectangle((736,19,739,412),fill='#969D93')
    d.line((32,wall_bottom-5,735,wall_bottom-5),fill=P['steel_light'])
    d.rectangle((32,wall_bottom-4,735,wall_bottom-1),fill=P['steel'])
    d.rectangle((32,wall_bottom,735,wall_bottom+3),fill='#8C9488')
    d.rectangle((32,411,735,416),fill=P['tile_shadow'])
    d.line((32,411,735,411),fill=P['wall_light'])
    d.line((25,420,742,420),fill='#93998D')
    return image


def stamp(image,sprites,key,x,y,scale=1,anchor=(64,108),shadow=False,shadow_width=30):
    if shadow:
        overlay=Image.new('RGBA',image.size,(0,0,0,0))
        d=ImageDraw.Draw(overlay)
        w=shadow_width*scale
        d.ellipse((x-w//2,y-2,x+w//2,y+3),fill=(37,44,38,32))
        image.alpha_composite(overlay)
    paste_at(image,sprites[key],(x,y),anchor=anchor,scale=scale)


def doorway(image,x,y,width=36,height=76):
    d=ImageDraw.Draw(image)
    d.rectangle((x-width//2,y-height,x+width//2,y-2),fill='#434C47')
    d.rectangle((x-width//2+4,y-height+8,x+width//2-5,y-27),fill='#8F9688')
    d.rectangle((x-width//2+4,y-26,x+width//2-5,y-1),fill='#B2B2A3')


def floor_glint(image,x,y,width=12):
    d=ImageDraw.Draw(image)
    d.rectangle((x-width//2,y,x+width//2,y+1),fill='#D8D9C9')
    d.rectangle((x-width//4,y-1,x+width//4,y+2),fill='#E2E3D3')


def warm_window_light(image):
    """A separate, square-pixel lighting layer; never recolor base assets."""
    light=Image.new('RGBA',image.size,(0,0,0,0))
    d=ImageDraw.Draw(light)
    for x in (105,278,451,624):
        d.polygon([(x-12,170),(x+4,170),(x+72,398),(x+30,398)],fill=(255,207,115,34))
        d.polygon([(x-9,171),(x-5,171),(x+50,398),(x+35,398)],fill=(255,223,160,22))
    image.alpha_composite(light)
    return light
