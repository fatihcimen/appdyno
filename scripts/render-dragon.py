# The dragon's pictures outside the site, drawn from the site's own model, site/public/models/dyno.glb, by Blender:
#   blender -b --factory-startup --python scripts/render-dragon.py -- still <mac/App/dragon.png>
#   blender -b --factory-startup --python scripts/render-dragon.py -- welcome <welcome-prores.mov>
#   avconvert -p PresetHEVCHighestQualityWithAlpha -s welcome-prores.mov -o mac/Viewer/welcome.mov
# `still` is the dragon of the disk image's window. `welcome` is the first launch's moment: it flies in, lands and
# breathes fire, on no ground, for mac/Viewer/Welcome.m to lay over its own, from frames it leaves beside the movie. It
# prints where the fire leaves the mouth, in the stage's points, which Welcome.m holds as kMouth.
import math
import os
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Quaternion, Vector

MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site", "public", "models", "dyno.glb")
# the clips run at the model's own rate; the movie at the screen's
CLIP_FPS, FPS = 24, 30
# Welcome.m's stage, in points, and where the dragon's feet come to rest on it
STAGE = (560, 240)
REST = (150, 214)
# its height on the stage, in points, as the model is one unit tall
TALL = 150
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


CURVES = {name: list(channels(name)) for name in ("idle", "look", "fly", "land", "puff")}
LENGTH = {name: bpy.data.actions[name].frame_range[1] / CLIP_FPS for name in CURVES}


def sample(name, seconds):
    """A clip's pose at a time: each bone's location, rotation and scale."""
    pose = {}
    for bone, prop, index, curve in CURVES[name]:
        rest = {"location": [0, 0, 0], "rotation_quaternion": [1, 0, 0, 0], "scale": [1, 1, 1]}
        pose.setdefault(bone, rest)[prop][index] = curve.evaluate(seconds * CLIP_FPS)
    return pose


def blend(a, b, share):
    """Two poses, a share of the way from the first to the second, as the site's mixer fades one clip into the next."""
    pose = {}
    for bone in set(a) | set(b):
        rest = {"location": [0, 0, 0], "rotation_quaternion": [1, 0, 0, 0], "scale": [1, 1, 1]}
        p, q = a.get(bone, rest), b.get(bone, rest)
        pose[bone] = {
            "location": [x + (y - x) * share for x, y in zip(p["location"], q["location"])],
            "rotation_quaternion": list(
                Quaternion(p["rotation_quaternion"]).slerp(Quaternion(q["rotation_quaternion"]), share)
            ),
            "scale": [x + (y - x) * share for x, y in zip(p["scale"], q["scale"])],
        }
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


def welcome():
    """3.6 s: it flies in from the left, lands, breathes fire to its right, and stands."""
    unit = 1 / TALL
    eye, back = camera(STAGE[0] * unit)
    right = eye.rotation_euler.to_matrix() @ Vector((1, 0, 0))
    up = eye.rotation_euler.to_matrix() @ Vector((0, 1, 0))
    # the hips over the origin, as the site's rig stands it
    put(sample("idle", 0))
    hip = rig.matrix_world @ rig.pose.bones["Hip"].head
    feet = Vector((hip.x, hip.y, 0))
    centre = feet + right * (STAGE[0] / 2 - REST[0]) * unit - up * (STAGE[1] / 2 - REST[1]) * unit
    eye.location = centre + back * 10
    home = rig.location.copy()

    def on_stage(x, y):
        return home + right * (x - REST[0]) * unit - up * (y - REST[1]) * unit

    def flight(t):
        """Along a curve from off the stage, high on the left, to just over where it lands."""
        s = 1 - (1 - min(t / 1.1, 1)) ** 3
        a, c, b = (-110, 30), (60, -20), (REST[0], REST[1] - 20)
        x = (1 - s) ** 2 * a[0] + 2 * (1 - s) * s * c[0] + s * s * b[0]
        y = (1 - s) ** 2 * a[1] + 2 * (1 - s) * s * c[1] + s * s * b[1]
        if t > 1.05:
            y += 20 * min((t - 1.05) / 0.35, 1)
        return x, y

    def fade(t, at, length=0.15):
        return min(max((t - at) / length, 0), 1)

    def pose_at(t):
        fly = sample("fly", t % LENGTH["fly"])
        land = sample("land", min(max(t - 1.0, 0), LENGTH["land"]))
        puff = sample("puff", min(max(t - 1.45, 0), LENGTH["puff"]))
        idle = sample("idle", max(t - 3.0, 0))
        return blend(blend(blend(fly, land, fade(t, 1.0)), puff, fade(t, 1.45)), idle, fade(t, 3.0, 0.2))

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = STAGE[0] * 2, STAGE[1] * 2
    scene.render.fps = FPS
    frames = round(3.6 * FPS)
    folder = out + ".frames"
    os.makedirs(folder, exist_ok=True)
    fire = []
    for frame in range(frames):
        t = frame / FPS
        rig.location = on_stage(*flight(t))
        put(pose_at(t))
        # while the puff's fire burns, by the clip's own times
        if 1.45 + 0.6 <= t <= 1.45 + 0.933:
            at = world_to_camera_view(scene, eye, rig.matrix_world @ rig.pose.bones["FireSocket"].head)
            fire.append((at.x * STAGE[0], (1 - at.y) * STAGE[1]))
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.filepath = os.path.join(folder, f"{frame:04d}.png")
        bpy.ops.render.render(write_still=True)
    print("MOUTH %.0f %.0f" % tuple(sum(f[i] for f in fire) / len(fire) for i in range(2)))
    # the frames, one movie with their alpha, from Blender's own sequencer
    edit = scene.sequence_editor_create()
    strips = edit.strips if hasattr(edit, "strips") else edit.sequences
    strip = strips.new_image("frames", os.path.join(folder, "0000.png"), 1, 1)
    for frame in range(1, frames):
        strip.elements.append(f"{frame:04d}.png")
    scene.frame_start, scene.frame_end = 1, frames
    settings = scene.render.image_settings
    settings.media_type = "VIDEO"
    settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "QUICKTIME"
    scene.render.ffmpeg.codec = "PRORES"
    scene.render.ffmpeg.ffmpeg_prores_profile = "4444"
    settings.color_mode = "RGBA"
    scene.render.use_sequencer = True
    scene.render.filepath = out
    bpy.ops.render.render(animation=True)


light()
{"still": still, "welcome": welcome}[mode]()
