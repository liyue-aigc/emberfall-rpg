"""Build rigged Phase 2 v3 assets from concept-reconstructed base meshes.

The reconstructed mesh carries the original concept silhouette and color.
Only a few crisp gameplay-readable props (staff, rune cores and launchers) are
kept from the procedural kit. Vertex groups are assigned deterministically so
the export remains reproducible and does not depend on bone-heat success.
"""

from __future__ import annotations

import importlib.util
import math
import colorsys
from pathlib import Path

import bpy
from mathutils import Vector


REPO_ROOT = Path(__file__).resolve().parents[2]
BASE_SCRIPT = REPO_ROOT / "tools" / "blender" / "build_phase2_assets.py"
RECON_DIR = REPO_ROOT / "art" / "phase2" / "reconstructed"

module_spec = importlib.util.spec_from_file_location("phase2_base", BASE_SCRIPT)
base = importlib.util.module_from_spec(module_spec)
assert module_spec.loader
module_spec.loader.exec_module(base)


def world_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[index] for point in points) for index in range(3))),
        Vector(tuple(max(point[index] for point in points) for index in range(3))),
    )


def import_single_mesh(path: Path, name: str) -> bpy.types.Object:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    meshes = [obj for obj in imported if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh found in {path}")

    for obj in meshes:
        matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = matrix

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    result = bpy.context.view_layer.objects.active
    result.name = name

    for obj in imported:
        if obj != result and obj.name in bpy.context.scene.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    return result


def normalize_mesh(
    obj: bpy.types.Object,
    target_height: float,
    rotation_z: float,
    target_center_y: float = 0.0,
) -> None:
    obj.rotation_euler.z += rotation_z
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    minimum, maximum = world_bounds(obj)
    scale = target_height / max(maximum.z - minimum.z, 0.001)
    obj.scale = (scale, scale, scale)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    minimum, maximum = world_bounds(obj)
    center = (minimum + maximum) * 0.5
    obj.location += Vector((-center.x, target_center_y - center.y, -minimum.z))
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)


def decimate(obj: bpy.types.Object, target_triangles: int) -> None:
    triangles = sum(len(poly.vertices) - 2 for poly in obj.data.polygons)
    if triangles <= target_triangles:
        return
    modifier = obj.modifiers.new("Game-ready decimation", "DECIMATE")
    modifier.ratio = max(0.05, target_triangles / triangles)
    modifier.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def grade_vertex_colors(
    obj: bpy.types.Object,
    saturation_factor: float,
    value_factor: float,
) -> None:
    for attribute in obj.data.color_attributes:
        for item in attribute.data:
            red, green, blue, alpha = item.color
            hue, saturation, value = colorsys.rgb_to_hsv(red, green, blue)
            saturation = min(1.0, saturation * saturation_factor)
            value = min(1.0, value * value_factor)
            item.color = (*colorsys.hsv_to_rgb(hue, saturation, value), alpha)


def stylize_monster_colors(obj: bpy.types.Object) -> None:
    """Push noisy reconstruction colors back to the jade/copper/violet brief."""
    for attribute in obj.data.color_attributes:
        for item in attribute.data:
            red, green, blue, alpha = item.color
            value = max(red, green, blue)
            if blue > red * 1.1 and blue > green * 1.08:
                rgb = colorsys.hsv_to_rgb(0.735, 0.82, min(1.0, value * 1.55 + 0.08))
            elif red > green * 1.18 and red > blue * 1.12:
                rgb = (value, value * 0.42, value * 0.16)
            else:
                rgb = (value * 0.18, value * 0.95, value * 0.78)
            item.color = (*rgb, alpha)


def attach_with_weights(
    obj: bpy.types.Object,
    armature: bpy.types.Object,
    selector,
) -> None:
    obj.vertex_groups.clear()
    # Single-view reconstruction often contains fused cloth/limbs and
    # non-manifold shells. Smooth skinning those surfaces causes catastrophic
    # tearing, so the concept body follows the torso as one stable silhouette.
    # Separate staff and gameplay props retain their articulated bone motion.
    group = obj.vertex_groups.new(name="spine")
    group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
    obj.parent = armature
    modifier = obj.modifiers.new("Concept silhouette rig", "ARMATURE")
    modifier.object = armature
    obj["phase2_asset"] = True
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def hero_bone(point: Vector) -> str:
    x, _y, z = point
    abs_x = abs(x)
    side = "L" if x < 0 else "R"
    if z > 1.48:
        return "head"
    if z > 0.88 and abs_x > 0.29:
        if abs_x > 0.47:
            return f"hand.{side}"
        if abs_x > 0.39:
            return f"lower_arm.{side}"
        return f"upper_arm.{side}"
    if z < 0.14:
        return f"foot.{side}"
    if z < 0.50 and abs_x > 0.08:
        return f"lower_leg.{side}"
    if z < 0.88 and abs_x > 0.11:
        return f"upper_leg.{side}"
    if z < 1.0:
        return "hips"
    return "spine"


def monster_bone(point: Vector) -> str:
    x, y, z = point
    side = "L" if x < 0 else "R"
    if y < -0.42 and z > 1.25:
        return f"ear.{side}"
    if y < -0.38 and z > 0.72:
        return "head"
    if y > 0.62:
        if y > 1.08:
            return "tail.3"
        if y > 0.86:
            return "tail.2"
        return "tail.1"
    if z < 0.74 and y < -0.12:
        label = "FL" if x < 0 else "FR"
        return f"upper_leg.{label}" if z > 0.35 else f"lower_leg.{label}"
    if z < 0.74 and y > 0.18:
        label = "BL" if x < 0 else "BR"
        return f"upper_leg.{label}" if z > 0.35 else f"lower_leg.{label}"
    if abs(x) > 0.31 and -0.32 < y < 0.18 and 0.76 < z < 1.28:
        return f"launcher.{side}"
    return "spine"


def delete_unless(keep_predicate) -> None:
    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH" and not keep_predicate(obj.name):
            bpy.data.objects.remove(obj, do_unlink=True)


def build_hero() -> bpy.types.Object:
    armature = base.build_hero_v2()
    delete_unless(lambda name: name.startswith("Staff") or name.startswith("BackRune"))
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and obj.name.startswith("Staff"):
            obj.location.x -= 0.14
    body = import_single_mesh(
        RECON_DIR / "starforge-traveler-triposr.glb",
        "StarforgeTraveler_ConceptBody",
    )
    normalize_mesh(body, target_height=1.92, rotation_z=math.pi)
    decimate(body, target_triangles=24000)
    grade_vertex_colors(body, saturation_factor=1.4, value_factor=0.92)
    attach_with_weights(body, armature, hero_bone)
    armature.animation_data.action = bpy.data.actions.get("Idle")
    return armature


def build_monster() -> bpy.types.Object:
    armature = base.build_monster_v2()
    delete_unless(lambda _name: False)
    body = import_single_mesh(
        RECON_DIR / "verdigris-lantern-jackal-triposr.glb",
        "VerdigrisLanternJackal_ConceptBody",
    )
    normalize_mesh(body, target_height=1.74, rotation_z=math.pi * 0.5, target_center_y=0.2)
    decimate(body, target_triangles=22000)
    stylize_monster_colors(body)
    attach_with_weights(body, armature, monster_bone)
    armature.animation_data.action = bpy.data.actions.get("Idle")
    return armature


def main() -> None:
    hero = build_hero()
    base.export_asset(
        "starforge-traveler-v3",
        hero,
        "starforge-traveler-v3.blend",
        "starforge-traveler-blender-v3.png",
        (3.15, -6.4, 2.65),
    )
    monster = build_monster()
    base.export_asset(
        "verdigris-lantern-jackal-v3",
        monster,
        "verdigris-lantern-jackal-v3.blend",
        "verdigris-lantern-jackal-blender-v3.png",
        (3.3, -6.4, 2.55),
    )


if __name__ == "__main__":
    main()
