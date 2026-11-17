# The dragon's pictures outside the site, drawn from the site's own model, site/public/models/dyno.glb, by Blender:
#   blender -b --factory-startup --python scripts/render-dragon.py -- still <mac/App/dragon.png>
# `still` is the dragon of the disk image's window.
import math
import os
import sys

import bpy
from mathutils import Vector

MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site", "public", "models", "dyno.glb")
# the clips run at the model's own rate
CLIP_FPS = 24
# a camera a little above it and turned to its face, as the site's poster shows it
AZIMUTH, ELEVATION = 35, 12

mode, out = sys.argv[sys.argv.index("--") + 1 :][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=MODEL)
scene = bpy.context.scene
# the model carries a sphere of its own for the site's picking: no part of the picture
bpy.data.objects["Icosphere"].hide_render = True
rig, mesh = bpy.data.objects["rig"], bpy.data.objects["dyno"]
rig.animation_data_create()
rig.animation_data.action = None
# the importer stacks every clip on the rig: each pose here is set by hand, bone by bone
for track in rig.animation_data.nla_tracks:
    track.mute = True


def channels(name):
    """Each bone's channels of a clip, as (bone, property, index, curve)."""
    action = bpy.data.actions[name]
    for curve in action.layers[0].strips[0].channelbags[0].fcurves:
        if not curve.data_path.startswith("pose.bones"):
            continue
        bone = curve.data_path.split('"')[1]
        yield bone, curve.data_path.rsplit(".", 1)[1], curve.array_index, curve


CURVES = {name: list(channels(name)) for name in ("look",)}


def sample(name, seconds):
    """A clip's pose at a time: each bone's location, rotation and scale."""
    pose = {}
    for bone, prop, index, curve in CURVES[name]:
        rest = {"location": [0, 0, 0], "rotation_quaternion": [1, 0, 0, 0], "scale": [1, 1, 1]}
        pose.setdefault(bone, rest)[prop][index] = curve.evaluate(seconds * CLIP_FPS)
    return pose


def put(pose):
    for bone in rig.pose.bones:
        held = pose.get(bone.name)
        bone.rotation_mode = "QUATERNION"
        bone.location = held["location"] if held else (0, 0, 0)
        bone.rotation_quaternion = held["rotation_quaternion"] if held else (1, 0, 0, 0)
        bone.scale = held["scale"] if held else (1, 1, 1)
    bpy.context.view_layer.update()


def camera(ortho):
    data = bpy.data.cameras.new("eye")
    data.type = "ORTHO"
    data.ortho_scale = ortho
    eye = bpy.data.objects.new("eye", data)
    scene.collection.objects.link(eye)
    scene.camera = eye
    a, e = math.radians(AZIMUTH), math.radians(ELEVATION)
    back = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    eye.rotation_euler = (-back).to_track_quat("-Z", "Y").to_euler()
    return eye, back


def light():
    """A soft key from the upper left, a cool fill and a warm rim, under a lilac sky: the house's light."""
    for name, power, at, color, size in (
        ("key", 260, (-1.6, -2.2, 2.6), (1, 0.97, 0.95), 2.2),
        ("fill", 80, (2.4, -1.4, 0.8), (0.86, 0.84, 1.0), 2.5),
        ("rim", 200, (0.6, 2.6, 1.8), (1.0, 0.72, 0.95), 1.4),
    ):
        lamp = bpy.data.lights.new(name, "AREA")
        lamp.energy, lamp.color, lamp.size = power, color, size
        holder = bpy.data.objects.new(name, lamp)
        holder.location = Vector(at) + Vector((0, 0, 0.5))
        holder.rotation_euler = (Vector((0, 0, 0.5)) - holder.location).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(holder)
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.86, 0.85, 1.0, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.55
    scene.world = world
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"


def still():
    """Looking about, cut to its outline, 440 pixels tall: the window turns it to face the app."""
    put(sample("look", 40 / CLIP_FPS))
    eye, back = camera(3.0)
    eye.location = Vector((0, 0, 0.5)) + back * 10
    scene.render.engine = "CYCLES"
    scene.cycles.use_denoising = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = out
    # its outline, from a small quick picture of it: what has any alpha there, and a little room around that
    side = 256
    scene.cycles.samples = 4
    scene.render.resolution_x = scene.render.resolution_y = side
    bpy.ops.render.render(write_still=True)
    picture = bpy.data.images.load(out)
    alpha = picture.pixels[3::4]
    shown = [i for i, a in enumerate(alpha) if a > 0.01]
    xs, ys = [i % side for i in shown], [i // side for i in shown]
    pad = 3
    left, right = (min(xs) - pad) / side, (max(xs) + 1 + pad) / side
    low, high = (min(ys) - pad) / side, (max(ys) + 1 + pad) / side
    bpy.data.images.remove(picture)
    # the camera framed to that outline alone, its taller side across the view
    wide, tall = right - left, high - low
    eye.data.ortho_scale = 3.0 * max(wide, tall)
    eye.data.shift_x = ((left + right) / 2 - 0.5) / max(wide, tall)
    eye.data.shift_y = ((low + high) / 2 - 0.5) / max(wide, tall)
    scene.render.resolution_x, scene.render.resolution_y = round(440 * wide / tall), 440
    scene.cycles.samples = 128
    bpy.ops.render.render(write_still=True)


light()
{"still": still}[mode]()
