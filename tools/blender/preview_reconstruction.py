"""Render four diagnostic views of a reconstructed GLB in Blender."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def script_args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def mesh_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[i] for point in points) for i in range(3))),
        Vector(tuple(max(point[i] for point in points) for i in range(3))),
    )


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def main() -> None:
    args = script_args()
    if len(args) != 2:
        raise SystemExit("Usage: blender --background --python preview_reconstruction.py -- input.glb output-prefix")

    input_glb = Path(args[0]).resolve()
    output_prefix = Path(args[1]).resolve()
    output_prefix.parent.mkdir(parents=True, exist_ok=True)

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(input_glb))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh objects imported from {input_glb}")

    minimum, maximum = mesh_bounds(meshes)
    center = (minimum + maximum) * 0.5
    height = max(maximum.z - minimum.z, 0.001)
    scale = 2.4 / height
    root = bpy.data.objects.new("PreviewRoot", None)
    bpy.context.collection.objects.link(root)
    for obj in [item for item in bpy.context.scene.objects if item not in {root}]:
        if obj.parent is None:
            obj.parent = root
    root.scale = (scale, scale, scale)
    root.location = (-center.x * scale, -center.y * scale, -minimum.z * scale)
    bpy.context.view_layer.update()

    minimum, maximum = mesh_bounds(meshes)
    center = (minimum + maximum) * 0.5
    span = maximum - minimum
    target = Vector((center.x, center.y, minimum.z + span.z * 0.53))

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.035, 0.045, 0.07)

    bpy.ops.mesh.primitive_plane_add(size=18, location=(0, 0, 0))
    ground = bpy.context.object
    ground_mat = bpy.data.materials.new("Ground")
    ground_mat.diffuse_color = (0.055, 0.075, 0.09, 1)
    ground.data.materials.append(ground_mat)

    bpy.ops.object.light_add(type="AREA", location=(4.5, -5.5, 7.0))
    key = bpy.context.object
    key.data.energy = 1200
    key.data.shape = "DISK"
    key.data.size = 5.0
    key.data.color = (1.0, 0.83, 0.69)
    look_at(key, target)

    bpy.ops.object.light_add(type="AREA", location=(-4.5, 1.5, 4.0))
    fill = bpy.context.object
    fill.data.energy = 900
    fill.data.size = 4.0
    fill.data.color = (0.29, 0.68, 1.0)
    look_at(fill, target)

    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = max(span.z * 1.22, span.x * 1.12, span.y * 1.12, 3.0)
    scene.camera = camera

    radius = max(span.x, span.y, span.z) * 2.1 + 2.0
    for index, angle_degrees in enumerate((0, 90, 180, 270)):
        angle = math.radians(angle_degrees)
        camera.location = (
            target.x + math.sin(angle) * radius,
            target.y - math.cos(angle) * radius,
            target.z + span.z * 0.06,
        )
        look_at(camera, target)
        scene.render.filepath = str(output_prefix.with_name(f"{output_prefix.name}-{index + 1}.png"))
        bpy.ops.render.render(write_still=True)

    triangles = sum(len(poly.vertices) - 2 for obj in meshes for poly in obj.data.polygons)
    print(f"Imported {len(meshes)} meshes, {triangles} triangles, bounds={tuple(span)}")


if __name__ == "__main__":
    main()
