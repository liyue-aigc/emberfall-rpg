"""Render one action pose from a saved Phase 2 Blender file."""

from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector


def args_after_separator() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def main() -> None:
    args = args_after_separator()
    if len(args) != 3:
        raise SystemExit("Usage: -- ActionName Frame output.png")
    action_name, frame_text, output_path = args
    frame = int(frame_text)

    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    armature.animation_data_create()
    armature.animation_data.action = bpy.data.actions[action_name]
    scene = bpy.context.scene
    scene.frame_set(frame)
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world.color = (0.022, 0.032, 0.045)

    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    minimum = Vector(tuple(min(point[index] for point in points) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in points) for index in range(3)))
    center = (minimum + maximum) * 0.5
    target = Vector((center.x, center.y, minimum.z + (maximum.z - minimum.z) * 0.52))

    bpy.ops.mesh.primitive_plane_add(size=16, location=(0, 0, 0))
    floor = bpy.context.object
    material = bpy.data.materials.new("ActionPreviewFloor")
    material.diffuse_color = (0.035, 0.065, 0.072, 1)
    floor.data.materials.append(material)

    bpy.ops.object.light_add(type="AREA", location=(4.0, -5.0, 6.0))
    key = bpy.context.object
    key.data.energy = 1100
    key.data.size = 5.0
    key.data.color = (1.0, 0.76, 0.58)
    look_at(key, target)

    bpy.ops.object.light_add(type="AREA", location=(-4.0, 1.5, 3.5))
    fill = bpy.context.object
    fill.data.energy = 850
    fill.data.size = 4.0
    fill.data.color = (0.25, 0.72, 1.0)
    look_at(fill, target)

    bpy.ops.object.camera_add(location=(3.1, -6.0, 2.55))
    camera = bpy.context.object
    camera.data.lens = 62
    look_at(camera, target)
    scene.camera = camera
    scene.render.filepath = str(Path(output_path).resolve())
    bpy.ops.render.render(write_still=True)
    print(f"Rendered {action_name} frame {frame} to {scene.render.filepath}")


if __name__ == "__main__":
    main()
