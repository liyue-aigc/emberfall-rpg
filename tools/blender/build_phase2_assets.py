from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector


REPO_ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = REPO_ROOT / "public" / "assets" / "models"
BLEND_DIR = REPO_ROOT / "art" / "phase2" / "blender"
PREVIEW_DIR = REPO_ROOT / "art" / "phase2" / "previews"

for directory in (MODEL_DIR, BLEND_DIR, PREVIEW_DIR):
    directory.mkdir(parents=True, exist_ok=True)


def reset_scene():
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.armatures,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.actions,
    ):
        for datablock in list(datablocks):
            datablocks.remove(datablock)


def material(name, color, metallic=0.0, roughness=0.75, emission=None, emission_strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    emission_input = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
    strength_input = bsdf.inputs.get("Emission Strength")
    if emission and emission_input:
        emission_input.default_value = (*emission, 1.0)
    if strength_input:
        strength_input.default_value = emission_strength
    mat["toon_role"] = name.replace("MAT_", "").lower()
    return mat


def finish_mesh(obj, mat, armature=None, bone=None, bevel=0.0, smooth=True):
    obj.name = obj.name.replace(".", "_")
    obj.data.materials.append(mat)
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    if bevel > 0:
        modifier = obj.modifiers.new("Soft bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    if armature and bone:
        obj.parent = armature
        group = obj.vertex_groups.new(name=bone)
        group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
        modifier = obj.modifiers.new("Armature", "ARMATURE")
        modifier.object = armature
    obj["phase2_asset"] = True
    return obj


def cube(name, location, scale, mat, armature=None, bone=None, rotation=(0, 0, 0), bevel=0.03):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_mesh(obj, mat, armature, bone, bevel=bevel, smooth=False)


def ico(name, location, scale, mat, armature=None, bone=None, subdivisions=2, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_mesh(obj, mat, armature, bone, bevel=0, smooth=True)


def uv_sphere(name, location, scale, mat, armature=None, bone=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_mesh(obj, mat, armature, bone, smooth=True)


def cone(name, location, radius1, radius2, depth, mat, armature=None, bone=None, vertices=8, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    return finish_mesh(obj, mat, armature, bone, bevel=0.015, smooth=False)


def cylinder_between(name, start, end, radius, mat, armature=None, bone=None, vertices=10):
    start = Vector(start)
    end = Vector(end)
    direction = end - start
    midpoint = (start + end) * 0.5
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=direction.length, location=midpoint)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_mesh(obj, mat, armature, bone, bevel=0.012, smooth=True)


def torus(name, location, major_radius, minor_radius, mat, armature=None, bone=None, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=32,
        minor_segments=8,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    return finish_mesh(obj, mat, armature, bone, smooth=True)


def panel_xz(
    name,
    points,
    y,
    thickness,
    mat,
    armature=None,
    bone=None,
    bevel=0.012,
):
    """Create an extruded silhouette panel facing the character's front (-Y)."""
    front_y = y - thickness * 0.5
    back_y = y + thickness * 0.5
    vertices = [(x, front_y, z) for x, z in points]
    vertices += [(x, back_y, z) for x, z in points]
    count = len(points)
    faces = [tuple(range(count)), tuple(range(count, count * 2))[::-1]]
    for index in range(count):
        next_index = (index + 1) % count
        faces.append((index, next_index, count + next_index, count + index))
    mesh_data = bpy.data.meshes.new(f"{name}_Mesh")
    mesh_data.from_pydata(vertices, [], faces)
    mesh_data.update()
    obj = bpy.data.objects.new(name, mesh_data)
    bpy.context.collection.objects.link(obj)
    return finish_mesh(
        obj,
        mat,
        armature,
        bone,
        bevel=bevel,
        smooth=False,
    )


def arc_xz(
    name,
    center,
    radius,
    start_angle,
    end_angle,
    segments,
    thickness,
    mat,
    armature=None,
    bone=None,
):
    """Build a broken metal arc from short beveled cylinders."""
    cx, cy, cz = center
    points = []
    for index in range(segments + 1):
        angle = start_angle + (end_angle - start_angle) * index / segments
        points.append(
            (
                cx + math.cos(angle) * radius,
                cy,
                cz + math.sin(angle) * radius,
            )
        )
    objects = []
    for index in range(segments):
        objects.append(
            cylinder_between(
                f"{name}_{index:02d}",
                points[index],
                points[index + 1],
                thickness,
                mat,
                armature,
                bone,
                vertices=8,
            )
        )
    return objects


def armor_spike(
    name,
    base,
    tip,
    width,
    mat,
    armature=None,
    bone=None,
):
    base = Vector(base)
    tip = Vector(tip)
    midpoint = (base + tip) * 0.5
    direction = tip - base
    bpy.ops.mesh.primitive_cone_add(
        vertices=6,
        radius1=width,
        radius2=0,
        depth=direction.length,
        location=midpoint,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_mesh(
        obj,
        mat,
        armature,
        bone,
        bevel=0.008,
        smooth=False,
    )


def build_armature(name, bone_specs):
    armature_data = bpy.data.armatures.new(f"{name}_ArmatureData")
    armature = bpy.data.objects.new(name, armature_data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    created = {}
    for bone_name, head, tail, parent_name in bone_specs:
        bone = armature_data.edit_bones.new(bone_name)
        bone.head = head
        bone.tail = tail
        bone.roll = 0
        if parent_name:
            bone.parent = created[parent_name]
        created[bone_name] = bone
    bpy.ops.object.mode_set(mode="POSE")
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "XYZ"
    bpy.ops.object.mode_set(mode="OBJECT")
    armature["asset_root"] = True
    return armature


def clear_pose(armature):
    for bone in armature.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_euler = (0, 0, 0)
        bone.scale = (1, 1, 1)


def make_action(armature, name, frame_end, poses, loop=False):
    action = bpy.data.actions.new(name=name)
    action.use_fake_user = True
    armature.animation_data_create()
    armature.animation_data.action = action
    clear_pose(armature)
    # Key a complete neutral baseline so switching clips never inherits the
    # final pose of the previously-authored action (notably Death root tilt).
    for bone in armature.pose.bones:
        bone.keyframe_insert(data_path="location", frame=0, group=bone.name)
        bone.keyframe_insert(data_path="rotation_euler", frame=0, group=bone.name)
        bone.keyframe_insert(data_path="scale", frame=0, group=bone.name)
    for frame, changes in poses.items():
        for bone_name, channels in changes.items():
            bone = armature.pose.bones.get(bone_name)
            if not bone:
                continue
            if "rotation" in channels:
                bone.rotation_euler = channels["rotation"]
                bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone_name)
            if "location" in channels:
                bone.location = channels["location"]
                bone.keyframe_insert(data_path="location", frame=frame, group=bone_name)
            if "scale" in channels:
                bone.scale = channels["scale"]
                bone.keyframe_insert(data_path="scale", frame=frame, group=bone_name)
    action.frame_start = 0
    action.frame_end = frame_end
    action["loop"] = loop
    action["fps"] = 30
    armature.animation_data.action = None
    return action


def mirror_cycle(bones, amount, axis=0):
    return {
        bones[0]: {"rotation": tuple(amount if index == axis else 0 for index in range(3))},
        bones[1]: {"rotation": tuple(-amount if index == axis else 0 for index in range(3))},
    }


def hero_actions(armature):
    make_action(
        armature,
        "Idle",
        48,
        {
            0: {"spine": {"rotation": (0, 0, -0.025)}, "staff": {"rotation": (0, 0, 0.02)}},
            24: {
                "spine": {"rotation": (0.025, 0, 0.025)},
                "head": {"rotation": (0, 0, 0.035)},
                "staff": {"rotation": (0, 0, -0.025)},
            },
            48: {"spine": {"rotation": (0, 0, -0.025)}, "staff": {"rotation": (0, 0, 0.02)}},
        },
        loop=True,
    )
    make_action(
        armature,
        "Walk",
        32,
        {
            0: {
                "upper_leg.L": {"rotation": (0.5, 0, 0)},
                "upper_leg.R": {"rotation": (-0.5, 0, 0)},
                "upper_arm.L": {"rotation": (-0.35, 0, 0.08)},
                "upper_arm.R": {"rotation": (0.28, 0, -0.08)},
            },
            8: {"hips": {"location": (0, 0, 0.035)}},
            16: {
                "upper_leg.L": {"rotation": (-0.5, 0, 0)},
                "upper_leg.R": {"rotation": (0.5, 0, 0)},
                "upper_arm.L": {"rotation": (0.35, 0, 0.08)},
                "upper_arm.R": {"rotation": (-0.28, 0, -0.08)},
            },
            24: {"hips": {"location": (0, 0, 0.035)}},
            32: {
                "upper_leg.L": {"rotation": (0.5, 0, 0)},
                "upper_leg.R": {"rotation": (-0.5, 0, 0)},
                "upper_arm.L": {"rotation": (-0.35, 0, 0.08)},
                "upper_arm.R": {"rotation": (0.28, 0, -0.08)},
            },
        },
        loop=True,
    )
    make_action(
        armature,
        "Run",
        24,
        {
            0: {
                "spine": {"rotation": (-0.2, 0, 0)},
                "upper_leg.L": {"rotation": (0.82, 0, 0)},
                "upper_leg.R": {"rotation": (-0.82, 0, 0)},
                "upper_arm.L": {"rotation": (-0.7, 0, 0.08)},
                "upper_arm.R": {"rotation": (0.55, 0, -0.08)},
            },
            6: {"hips": {"location": (0, 0, 0.06)}},
            12: {
                "spine": {"rotation": (-0.2, 0, 0)},
                "upper_leg.L": {"rotation": (-0.82, 0, 0)},
                "upper_leg.R": {"rotation": (0.82, 0, 0)},
                "upper_arm.L": {"rotation": (0.7, 0, 0.08)},
                "upper_arm.R": {"rotation": (-0.55, 0, -0.08)},
            },
            18: {"hips": {"location": (0, 0, 0.06)}},
            24: {
                "spine": {"rotation": (-0.2, 0, 0)},
                "upper_leg.L": {"rotation": (0.82, 0, 0)},
                "upper_leg.R": {"rotation": (-0.82, 0, 0)},
                "upper_arm.L": {"rotation": (-0.7, 0, 0.08)},
                "upper_arm.R": {"rotation": (0.55, 0, -0.08)},
            },
        },
        loop=True,
    )
    make_action(
        armature,
        "Attack_Cast",
        24,
        {
            0: {"spine": {"rotation": (0, 0, 0)}},
            10: {
                "spine": {"rotation": (-0.08, 0.12, -0.1)},
                "upper_arm.R": {"rotation": (-1.05, 0.2, -0.35)},
                "lower_arm.R": {"rotation": (-0.42, 0, 0)},
                "staff": {"rotation": (0.15, -0.15, -0.3)},
                "upper_arm.L": {"rotation": (-0.45, -0.18, 0.35)},
            },
            18: {
                "spine": {"rotation": (0.12, -0.08, 0.12)},
                "upper_arm.R": {"rotation": (-0.32, -0.45, -0.55)},
                "staff": {"rotation": (-0.15, 0.25, 0.52)},
            },
            24: {"spine": {"rotation": (0, 0, 0)}},
        },
    )
    make_action(
        armature,
        "Nova_Cast",
        36,
        {
            0: {},
            14: {
                "spine": {"rotation": (-0.12, 0, 0)},
                "upper_arm.L": {"rotation": (-1.2, 0, 0.52)},
                "upper_arm.R": {"rotation": (-1.2, 0, -0.52)},
                "lower_arm.L": {"rotation": (-0.25, 0, 0)},
                "lower_arm.R": {"rotation": (-0.25, 0, 0)},
            },
            28: {
                "spine": {"rotation": (0.18, 0, 0)},
                "upper_arm.L": {"rotation": (-0.35, 0, 0.9)},
                "upper_arm.R": {"rotation": (-0.35, 0, -0.9)},
            },
            36: {},
        },
    )
    make_action(
        armature,
        "Dash",
        16,
        {
            0: {},
            5: {
                "spine": {"rotation": (-0.48, 0, 0)},
                "upper_leg.L": {"rotation": (0.72, 0, 0)},
                "upper_leg.R": {"rotation": (-0.38, 0, 0)},
                "upper_arm.L": {"rotation": (0.55, 0, 0.25)},
                "upper_arm.R": {"rotation": (0.55, 0, -0.25)},
            },
            11: {"root": {"location": (0, -0.22, 0)}},
            16: {},
        },
    )
    make_action(
        armature,
        "Ward_Cast",
        32,
        {
            0: {},
            12: {
                "spine": {"rotation": (-0.1, 0, 0)},
                "upper_arm.L": {"rotation": (-0.9, 0.15, 0.45)},
                "lower_arm.L": {"rotation": (-0.8, 0, 0)},
                "upper_arm.R": {"rotation": (-0.55, 0, -0.25)},
                "staff": {"rotation": (0.2, 0, -0.25)},
            },
            24: {
                "upper_arm.L": {"rotation": (-0.32, 0.2, 1.05)},
                "spine": {"rotation": (0.12, 0, 0)},
            },
            32: {},
        },
    )
    make_action(
        armature,
        "Hit",
        12,
        {
            0: {},
            4: {"spine": {"rotation": (0.22, 0, 0.2)}, "head": {"rotation": (-0.18, 0, -0.12)}},
            12: {},
        },
    )
    make_action(
        armature,
        "Death",
        42,
        {
            0: {},
            16: {
                "root": {"rotation": (0.65, 0, 0.18), "location": (0, 0, -0.12)},
                "upper_arm.L": {"rotation": (0.7, 0, 0.45)},
                "upper_arm.R": {"rotation": (0.5, 0, -0.55)},
            },
            42: {
                "root": {"rotation": (1.38, 0, 0.12), "location": (0, 0.24, -0.6)},
                "head": {"rotation": (-0.2, 0, 0)},
            },
        },
    )


def build_hero():
    reset_scene()
    mats = {
        "skin": material("MAT_Skin", (0.72, 0.47, 0.34), roughness=0.82),
        "hair": material("MAT_Hair", (0.105, 0.045, 0.035), roughness=0.72),
        "hair_teal": material("MAT_HairTeal", (0.19, 0.7, 0.68), roughness=0.62),
        "dark": material("MAT_Charcoal", (0.035, 0.055, 0.065), roughness=0.88),
        "teal": material("MAT_VerdigrisCloth", (0.055, 0.31, 0.3), roughness=0.84),
        "copper": material("MAT_Copper", (0.48, 0.19, 0.085), metallic=0.72, roughness=0.38),
        "leather": material("MAT_Leather", (0.12, 0.055, 0.03), roughness=0.9),
        "ivory": material("MAT_Ivory", (0.78, 0.68, 0.53), roughness=0.88),
        "ember": material(
            "MAT_Ember",
            (0.9, 0.18, 0.025),
            roughness=0.22,
            emission=(1.0, 0.15, 0.015),
            emission_strength=5.0,
        ),
        "eye": material(
            "MAT_Eye",
            (0.9, 0.45, 0.07),
            roughness=0.2,
            emission=(1.0, 0.25, 0.03),
            emission_strength=1.6,
        ),
    }
    bones = [
        ("root", (0, 0, 0.02), (0, 0, 0.2), None),
        ("hips", (0, 0, 0.78), (0, 0, 0.98), "root"),
        ("spine", (0, 0, 0.98), (0, 0, 1.42), "hips"),
        ("head", (0, 0, 1.42), (0, 0, 1.72), "spine"),
        ("upper_arm.L", (-0.25, 0, 1.35), (-0.51, 0, 1.17), "spine"),
        ("lower_arm.L", (-0.51, 0, 1.17), (-0.63, -0.01, 0.9), "upper_arm.L"),
        ("hand.L", (-0.63, -0.01, 0.9), (-0.64, -0.03, 0.79), "lower_arm.L"),
        ("upper_arm.R", (0.25, 0, 1.35), (0.51, 0, 1.17), "spine"),
        ("lower_arm.R", (0.51, 0, 1.17), (0.63, -0.01, 0.9), "upper_arm.R"),
        ("hand.R", (0.63, -0.01, 0.9), (0.64, -0.03, 0.79), "lower_arm.R"),
        ("staff", (0.64, -0.03, 0.86), (0.64, -0.03, 1.42), "hand.R"),
        ("upper_leg.L", (-0.17, 0, 0.82), (-0.18, 0, 0.48), "hips"),
        ("lower_leg.L", (-0.18, 0, 0.48), (-0.18, -0.02, 0.15), "upper_leg.L"),
        ("foot.L", (-0.18, -0.02, 0.15), (-0.18, -0.16, 0.05), "lower_leg.L"),
        ("upper_leg.R", (0.17, 0, 0.82), (0.18, 0, 0.48), "hips"),
        ("lower_leg.R", (0.18, 0, 0.48), (0.18, -0.02, 0.15), "upper_leg.R"),
        ("foot.R", (0.18, -0.02, 0.15), (0.18, -0.16, 0.05), "lower_leg.R"),
    ]
    arm = build_armature("StarforgeTraveler_Rig", bones)

    cone("Tunic", (0, 0, 1.02), 0.31, 0.25, 0.62, mats["teal"], arm, "hips", vertices=10)
    cone("Torso", (0, 0, 1.27), 0.25, 0.22, 0.56, mats["dark"], arm, "spine", vertices=10)
    cube("ChestCopper", (0, -0.205, 1.29), (0.2, 0.035, 0.23), mats["copper"], arm, "spine", rotation=(0.06, 0, 0))
    torus("Belt", (0, 0, 0.96), 0.27, 0.035, mats["copper"], arm, "hips")
    cube("Scarf", (0, -0.02, 1.46), (0.25, 0.16, 0.07), mats["ivory"], arm, "spine", rotation=(0.05, 0, 0), bevel=0.05)

    uv_sphere("Face", (0, -0.015, 1.63), (0.215, 0.19, 0.24), mats["skin"], arm, "head")
    ico("HairCap", (0, 0.035, 1.74), (0.245, 0.21, 0.2), mats["hair"], arm, "head", subdivisions=2)
    for index, (x, y, z, rz) in enumerate(
        [
            (-0.19, -0.08, 1.75, -0.55),
            (-0.1, -0.19, 1.79, -0.25),
            (0.03, -0.2, 1.8, 0.05),
            (0.15, -0.14, 1.76, 0.45),
            (0.2, 0.02, 1.72, 0.72),
            (-0.22, 0.02, 1.7, -0.85),
        ]
    ):
        cone(f"HairLock_{index}", (x, y, z), 0.075, 0.0, 0.32, mats["hair"], arm, "head", vertices=6, rotation=(0.2, 0, rz))
    cone("TealHairLock", (-0.12, -0.205, 1.78), 0.055, 0, 0.28, mats["hair_teal"], arm, "head", vertices=6, rotation=(0.15, 0, -0.28))
    cube("Eye_L", (-0.075, -0.191, 1.655), (0.04, 0.012, 0.014), mats["eye"], arm, "head", rotation=(0, 0, -0.06), bevel=0.008)
    cube("Eye_R", (0.075, -0.191, 1.655), (0.04, 0.012, 0.014), mats["eye"], arm, "head", rotation=(0, 0, 0.06), bevel=0.008)

    cylinder_between("UpperArm_L", (-0.27, 0, 1.34), (-0.5, 0, 1.17), 0.095, mats["dark"], arm, "upper_arm.L")
    cylinder_between("LowerArm_L", (-0.51, 0, 1.16), (-0.62, -0.01, 0.9), 0.085, mats["leather"], arm, "lower_arm.L")
    ico("Hand_L", (-0.64, -0.02, 0.84), (0.085, 0.075, 0.11), mats["skin"], arm, "hand.L", subdivisions=1)
    cylinder_between("UpperArm_R", (0.27, 0, 1.34), (0.5, 0, 1.17), 0.095, mats["dark"], arm, "upper_arm.R")
    cylinder_between("LowerArm_R", (0.51, 0, 1.16), (0.62, -0.01, 0.9), 0.085, mats["leather"], arm, "lower_arm.R")
    ico("Hand_R", (0.64, -0.02, 0.84), (0.085, 0.075, 0.11), mats["skin"], arm, "hand.R", subdivisions=1)
    ico("Shoulder_L", (-0.29, 0, 1.38), (0.2, 0.15, 0.12), mats["copper"], arm, "upper_arm.L", subdivisions=1)
    torus("ShoulderRing_L", (-0.3, -0.03, 1.39), 0.15, 0.026, mats["copper"], arm, "upper_arm.L", rotation=(math.pi / 2, 0, 0))
    cube("ForearmGuard_L", (-0.57, -0.02, 1.01), (0.11, 0.09, 0.16), mats["copper"], arm, "lower_arm.L", rotation=(0.2, 0, -0.2))
    cube("ForearmGuard_R", (0.57, -0.02, 1.01), (0.11, 0.09, 0.16), mats["copper"], arm, "lower_arm.R", rotation=(0.2, 0, 0.2))

    cylinder_between("UpperLeg_L", (-0.17, 0, 0.82), (-0.18, 0, 0.48), 0.12, mats["dark"], arm, "upper_leg.L")
    cylinder_between("LowerLeg_L", (-0.18, 0, 0.48), (-0.18, -0.02, 0.15), 0.105, mats["leather"], arm, "lower_leg.L")
    cube("Boot_L", (-0.18, -0.09, 0.11), (0.13, 0.22, 0.12), mats["leather"], arm, "foot.L", bevel=0.04)
    cylinder_between("UpperLeg_R", (0.17, 0, 0.82), (0.18, 0, 0.48), 0.12, mats["dark"], arm, "upper_leg.R")
    cylinder_between("LowerLeg_R", (0.18, 0, 0.48), (0.18, -0.02, 0.15), 0.105, mats["leather"], arm, "lower_leg.R")
    cube("Boot_R", (0.18, -0.09, 0.11), (0.13, 0.22, 0.12), mats["leather"], arm, "foot.R", bevel=0.04)

    cone("CloakBack", (0, 0.16, 1.0), 0.42, 0.28, 1.22, mats["dark"], arm, "spine", vertices=7, rotation=(0.08, 0, 0))
    cube("CloakTail_L", (-0.2, 0.235, 0.65), (0.18, 0.035, 0.45), mats["teal"], arm, "hips", rotation=(0.12, -0.12, -0.08), bevel=0.02)
    cube("CloakTail_R", (0.2, 0.235, 0.62), (0.18, 0.035, 0.48), mats["dark"], arm, "hips", rotation=(0.1, 0.1, 0.08), bevel=0.02)
    cube("Satchel", (0.34, 0.16, 0.78), (0.16, 0.08, 0.2), mats["leather"], arm, "hips", rotation=(0, 0.08, -0.08), bevel=0.04)
    torus("BackRuneDevice", (0, 0.205, 1.23), 0.17, 0.035, mats["copper"], arm, "spine", rotation=(math.pi / 2, 0, 0))
    ico("BackRuneCore", (0, 0.245, 1.23), (0.075, 0.035, 0.075), mats["ember"], arm, "spine", subdivisions=1)

    cylinder_between("StaffShaft", (0.64, -0.03, 0.35), (0.64, -0.03, 1.92), 0.035, mats["leather"], arm, "staff", vertices=8)
    torus("StaffOuterRing", (0.64, -0.03, 1.96), 0.27, 0.035, mats["copper"], arm, "staff", rotation=(math.pi / 2, 0, 0))
    torus("StaffInnerRing", (0.64, -0.03, 1.96), 0.18, 0.02, mats["teal"], arm, "staff", rotation=(math.pi / 2, 0, 0))
    ico("StaffGem", (0.64, -0.03, 1.96), (0.12, 0.07, 0.17), mats["ember"], arm, "staff", subdivisions=1, rotation=(0, 0, math.pi / 4))
    cone("StaffTip", (0.64, -0.03, 0.25), 0.07, 0.0, 0.24, mats["copper"], arm, "staff", vertices=6)

    hero_actions(arm)
    arm.animation_data.action = bpy.data.actions.get("Idle")
    return arm


def build_hero_v2():
    """Concept-faithful medium-detail version of the Starforge Traveler."""
    reset_scene()
    mats = {
        "skin": material("MAT_Skin", (0.78, 0.53, 0.39), roughness=0.82),
        "hair": material("MAT_Hair", (0.09, 0.026, 0.022), roughness=0.78),
        "hair_high": material("MAT_HairHighlight", (0.22, 0.075, 0.055), roughness=0.72),
        "hair_teal": material("MAT_HairTeal", (0.18, 0.66, 0.65), roughness=0.62),
        "dark": material("MAT_CharcoalCloth", (0.018, 0.027, 0.035), roughness=0.94),
        "dark_mid": material("MAT_CloakHighlight", (0.045, 0.065, 0.078), roughness=0.9),
        "teal": material("MAT_VerdigrisCloth", (0.025, 0.25, 0.25), roughness=0.86),
        "teal_light": material("MAT_RuneTeal", (0.14, 0.63, 0.62), roughness=0.58),
        "copper": material("MAT_Copper", (0.5, 0.19, 0.075), metallic=0.72, roughness=0.38),
        "copper_high": material("MAT_CopperEdge", (0.78, 0.37, 0.16), metallic=0.62, roughness=0.32),
        "leather": material("MAT_Leather", (0.105, 0.045, 0.024), roughness=0.9),
        "ivory": material("MAT_IvoryScarf", (0.72, 0.64, 0.53), roughness=0.92),
        "ember": material(
            "MAT_Ember",
            (0.95, 0.21, 0.018),
            roughness=0.2,
            emission=(1.0, 0.12, 0.01),
            emission_strength=6.5,
        ),
        "eye": material(
            "MAT_AmberEye",
            (1.0, 0.42, 0.045),
            roughness=0.16,
            emission=(1.0, 0.22, 0.015),
            emission_strength=2.2,
        ),
    }
    bones = [
        ("root", (0, 0, 0.02), (0, 0, 0.2), None),
        ("hips", (0, 0, 0.82), (0, 0, 1.0), "root"),
        ("spine", (0, 0, 1.0), (0, 0, 1.46), "hips"),
        ("head", (0, 0, 1.46), (0, 0, 1.78), "spine"),
        ("upper_arm.L", (-0.24, 0, 1.39), (-0.5, 0, 1.2), "spine"),
        ("lower_arm.L", (-0.5, 0, 1.2), (-0.64, -0.02, 0.92), "upper_arm.L"),
        ("hand.L", (-0.64, -0.02, 0.92), (-0.66, -0.04, 0.8), "lower_arm.L"),
        ("upper_arm.R", (0.24, 0, 1.39), (0.5, 0, 1.2), "spine"),
        ("lower_arm.R", (0.5, 0, 1.2), (0.64, -0.02, 0.92), "upper_arm.R"),
        ("hand.R", (0.64, -0.02, 0.92), (0.66, -0.04, 0.8), "lower_arm.R"),
        ("staff", (0.66, -0.04, 0.88), (0.69, -0.04, 1.5), "hand.R"),
        ("upper_leg.L", (-0.16, 0, 0.84), (-0.18, 0, 0.49), "hips"),
        ("lower_leg.L", (-0.18, 0, 0.49), (-0.18, -0.015, 0.16), "upper_leg.L"),
        ("foot.L", (-0.18, -0.015, 0.16), (-0.18, -0.18, 0.06), "lower_leg.L"),
        ("upper_leg.R", (0.16, 0, 0.84), (0.18, 0, 0.49), "hips"),
        ("lower_leg.R", (0.18, 0, 0.49), (0.18, -0.015, 0.16), "upper_leg.R"),
        ("foot.R", (0.18, -0.015, 0.16), (0.18, -0.18, 0.06), "lower_leg.R"),
    ]
    arm = build_armature("StarforgeTraveler_Rig", bones)

    # Slim anime proportions and layered inner garments.
    cone("Tunic", (0, 0, 1.04), 0.285, 0.235, 0.62, mats["teal"], arm, "hips", vertices=16)
    cone("Torso", (0, 0, 1.31), 0.245, 0.205, 0.58, mats["dark"], arm, "spine", vertices=16)
    panel_xz(
        "FrontTealPanel",
        [(-0.18, 1.36), (0.18, 1.36), (0.15, 0.84), (0, 0.72), (-0.16, 0.84)],
        -0.247,
        0.022,
        mats["teal"],
        arm,
        "spine",
        bevel=0.01,
    )
    panel_xz(
        "FrontRuneStripe",
        [(-0.025, 1.28), (0.025, 1.28), (0.02, 0.86), (0, 0.81), (-0.02, 0.86)],
        -0.263,
        0.012,
        mats["teal_light"],
        arm,
        "spine",
        bevel=0.004,
    )
    torus("Belt", (0, 0, 0.94), 0.275, 0.035, mats["leather"], arm, "hips")
    cube("BeltBuckle", (0, -0.275, 0.94), (0.07, 0.025, 0.055), mats["copper_high"], arm, "hips", bevel=0.014)
    cylinder_between("ChestStrap_A", (-0.22, -0.225, 1.43), (0.17, -0.255, 1.02), 0.025, mats["leather"], arm, "spine", vertices=6)
    cylinder_between("ChestStrap_B", (0.18, -0.23, 1.4), (-0.14, -0.255, 1.12), 0.018, mats["copper"], arm, "spine", vertices=6)
    ico("ChestClasp", (0.01, -0.286, 1.245), (0.06, 0.022, 0.07), mats["copper_high"], arm, "spine", subdivisions=1)

    # Scarf is built as soft overlapping volumes rather than a rectangular block.
    torus("ScarfCollar", (0, -0.005, 1.49), 0.225, 0.075, mats["ivory"], arm, "spine")
    panel_xz(
        "ScarfFront",
        [(-0.25, 1.53), (0.25, 1.53), (0.18, 1.36), (0.02, 1.31), (-0.18, 1.37)],
        -0.18,
        0.045,
        mats["ivory"],
        arm,
        "spine",
        bevel=0.025,
    )

    # Face, amber eyes and layered swept hair.
    uv_sphere("Face", (0, -0.02, 1.68), (0.185, 0.155, 0.225), mats["skin"], arm, "head")
    ico("HairCap", (0, 0.025, 1.79), (0.215, 0.19, 0.18), mats["hair"], arm, "head", subdivisions=3)
    hair_locks = [
        ((-0.17, -0.04, 1.84), (-0.27, -0.04, 1.72), 0.08, "hair"),
        ((-0.12, -0.11, 1.86), (-0.2, -0.2, 1.69), 0.075, "hair"),
        ((-0.045, -0.15, 1.86), (-0.08, -0.205, 1.64), 0.07, "hair_teal"),
        ((0.03, -0.16, 1.86), (0.01, -0.215, 1.68), 0.07, "hair"),
        ((0.12, -0.12, 1.84), (0.19, -0.195, 1.68), 0.075, "hair"),
        ((0.18, -0.02, 1.82), (0.27, -0.04, 1.69), 0.08, "hair"),
        ((0.17, 0.08, 1.8), (0.29, 0.13, 1.7), 0.075, "hair_high"),
        ((0.1, 0.13, 1.83), (0.18, 0.23, 1.69), 0.075, "hair"),
        ((0.0, 0.15, 1.83), (-0.02, 0.27, 1.67), 0.08, "hair"),
        ((-0.11, 0.12, 1.82), (-0.2, 0.22, 1.68), 0.075, "hair_high"),
        ((-0.18, 0.06, 1.8), (-0.29, 0.11, 1.67), 0.075, "hair"),
        ((0.02, 0.11, 1.9), (0.08, 0.19, 2.01), 0.065, "hair_high"),
    ]
    for index, (base, tip, width, material_key) in enumerate(hair_locks):
        armor_spike(
            f"HairLock_{index:02d}",
            base,
            tip,
            width,
            mats[material_key],
            arm,
            "head",
        )
    panel_xz("Eye_L", [(-0.135, 1.705), (-0.025, 1.705), (-0.04, 1.67), (-0.125, 1.668)], -0.174, 0.012, mats["eye"], arm, "head", bevel=0.004)
    panel_xz("Eye_R", [(0.025, 1.705), (0.135, 1.705), (0.125, 1.668), (0.04, 1.67)], -0.174, 0.012, mats["eye"], arm, "head", bevel=0.004)
    cube("Mouth", (0, -0.177, 1.59), (0.035, 0.007, 0.008), mats["hair"], arm, "head", bevel=0.003)
    ico("EarringGem", (-0.2, -0.005, 1.6), (0.025, 0.018, 0.055), mats["teal_light"], arm, "head", subdivisions=1)

    # Limbs, gloves and ornate asymmetrical copper armor.
    for side, sign in (("L", -1), ("R", 1)):
        upper_bone = f"upper_arm.{side}"
        lower_bone = f"lower_arm.{side}"
        hand_bone = f"hand.{side}"
        cylinder_between(f"UpperArm_{side}", (sign * 0.25, 0, 1.39), (sign * 0.5, 0, 1.2), 0.085, mats["dark_mid"], arm, upper_bone, vertices=12)
        cylinder_between(f"LowerArm_{side}", (sign * 0.5, 0, 1.2), (sign * 0.64, -0.02, 0.92), 0.075, mats["dark"], arm, lower_bone, vertices=12)
        ico(f"Glove_{side}", (sign * 0.65, -0.025, 0.86), (0.078, 0.065, 0.115), mats["dark"], arm, hand_bone, subdivisions=2)
        for finger in range(3):
            cylinder_between(
                f"Finger_{side}_{finger}",
                (sign * (0.66 + finger * 0.006), -0.07 - finger * 0.012, 0.84 - finger * 0.012),
                (sign * (0.665 + finger * 0.006), -0.08 - finger * 0.012, 0.78 - finger * 0.01),
                0.012,
                mats["skin"],
                arm,
                hand_bone,
                vertices=6,
            )
        cube(f"Bracer_{side}", (sign * 0.57, -0.015, 1.055), (0.115, 0.085, 0.17), mats["copper"], arm, lower_bone, rotation=(0.16, 0, sign * 0.18), bevel=0.035)
        panel_xz(
            f"BracerRune_{side}",
            [
                (sign * 0.62, 1.14),
                (sign * 0.52, 1.12),
                (sign * 0.545, 1.0),
                (sign * 0.61, 0.98),
            ],
            -0.112,
            0.014,
            mats["teal_light"],
            arm,
            lower_bone,
            bevel=0.004,
        )
    ico("ShoulderCore_L", (-0.3, 0.015, 1.43), (0.22, 0.16, 0.13), mats["copper"], arm, "upper_arm.L", subdivisions=2)
    torus("ShoulderRing_L", (-0.31, -0.035, 1.44), 0.16, 0.028, mats["copper_high"], arm, "upper_arm.L", rotation=(math.pi / 2, 0, 0))
    ico("ShoulderRune_L", (-0.31, -0.178, 1.44), (0.065, 0.025, 0.065), mats["teal_light"], arm, "upper_arm.L", subdivisions=1)
    armor_spike("ShoulderBladeTop", (-0.35, 0.01, 1.52), (-0.5, 0.0, 1.62), 0.07, mats["copper_high"], arm, "upper_arm.L")
    armor_spike("ShoulderBladeSide", (-0.36, 0.0, 1.4), (-0.55, -0.02, 1.34), 0.065, mats["copper"], arm, "upper_arm.L")

    # Baggy trousers and layered travel boots.
    for side, sign in (("L", -1), ("R", 1)):
        upper_bone = f"upper_leg.{side}"
        lower_bone = f"lower_leg.{side}"
        foot_bone = f"foot.{side}"
        cone(f"Trouser_{side}", (sign * 0.17, 0, 0.66), 0.14, 0.115, 0.42, mats["dark_mid"], arm, upper_bone, vertices=14)
        cylinder_between(f"ShinWrap_{side}", (sign * 0.18, 0, 0.49), (sign * 0.18, -0.015, 0.17), 0.09, mats["dark"], arm, lower_bone, vertices=12)
        cube(f"Boot_{side}", (sign * 0.18, -0.105, 0.115), (0.14, 0.225, 0.115), mats["leather"], arm, foot_bone, bevel=0.045)
        cube(f"BootSole_{side}", (sign * 0.18, -0.125, 0.035), (0.15, 0.24, 0.035), mats["dark"], arm, foot_bone, bevel=0.02)
        cube(f"BootCap_{side}", (sign * 0.18, -0.265, 0.13), (0.145, 0.08, 0.075), mats["copper"], arm, foot_bone, bevel=0.025)
        cylinder_between(f"BootStrap_{side}", (sign * 0.07, -0.17, 0.22), (sign * 0.29, -0.17, 0.22), 0.025, mats["copper_high"], arm, foot_bone, vertices=6)

    # The concept's long asymmetric torn cloak, layered back and teal lining.
    panel_xz(
        "CloakInner",
        [(-0.39, 1.49), (0.39, 1.49), (0.48, 1.18), (0.44, 0.32), (0.24, 0.52), (0.06, 0.21), (-0.13, 0.47), (-0.36, 0.26), (-0.48, 1.15)],
        0.185,
        0.035,
        mats["teal"],
        arm,
        "spine",
        bevel=0.018,
    )
    panel_xz(
        "CloakOuter",
        [(-0.4, 1.5), (0.4, 1.5), (0.52, 1.23), (0.5, 0.5), (0.34, 0.65), (0.18, 0.28), (0.02, 0.52), (-0.16, 0.18), (-0.31, 0.55), (-0.5, 0.37), (-0.53, 1.2)],
        0.15,
        0.045,
        mats["dark"],
        arm,
        "spine",
        bevel=0.018,
    )
    for index, (points, material_key, y) in enumerate(
        [
            ([(-0.45, 1.19), (-0.2, 1.25), (-0.25, 0.36), (-0.39, 0.22), (-0.52, 0.48)], "dark_mid", 0.12),
            ([(0.12, 1.2), (0.46, 1.16), (0.49, 0.44), (0.32, 0.23), (0.18, 0.52)], "dark_mid", 0.12),
            ([(-0.25, 1.0), (-0.03, 0.96), (-0.07, 0.36), (-0.2, 0.2), (-0.3, 0.48)], "teal", 0.1),
        ]
    ):
        panel_xz(f"CloakLayer_{index}", points, y, 0.026, mats[material_key], arm, "hips", bevel=0.012)
    # Copper trim and back rune device.
    cylinder_between("CloakTrim_L", (-0.48, 0.105, 1.35), (-0.49, 0.105, 0.43), 0.012, mats["copper_high"], arm, "spine", vertices=6)
    cylinder_between("CloakTrim_R", (0.46, 0.105, 1.33), (0.43, 0.105, 0.48), 0.012, mats["copper_high"], arm, "spine", vertices=6)
    torus("BackRuneDevice", (0, 0.205, 1.25), 0.175, 0.035, mats["copper"], arm, "spine", rotation=(math.pi / 2, 0, 0))
    torus("BackRuneInner", (0, 0.213, 1.25), 0.105, 0.018, mats["copper_high"], arm, "spine", rotation=(math.pi / 2, 0, 0))
    ico("BackRuneCore", (0, 0.232, 1.25), (0.06, 0.025, 0.095), mats["teal_light"], arm, "spine", subdivisions=1)
    cube("Satchel", (0.38, 0.17, 0.83), (0.18, 0.09, 0.21), mats["leather"], arm, "hips", rotation=(0, 0.05, -0.08), bevel=0.05)
    cube("SatchelFlap", (0.38, 0.068, 0.88), (0.17, 0.018, 0.08), mats["copper"], arm, "hips", bevel=0.018)

    # Broken crescent-ring focus staff with floating ember crystal.
    cylinder_between("StaffShaft", (0.69, -0.04, 0.24), (0.69, -0.04, 1.72), 0.032, mats["dark"], arm, "staff", vertices=10)
    cylinder_between("StaffGrip", (0.69, -0.04, 0.78), (0.69, -0.04, 1.18), 0.046, mats["teal"], arm, "staff", vertices=8)
    for wrap_index in range(5):
        torus(
            f"StaffGripWrap_{wrap_index}",
            (0.69, -0.04, 0.84 + wrap_index * 0.075),
            0.047,
            0.006,
            mats["copper_high"],
            arm,
            "staff",
        )
    arc_xz("StaffCrescentOuter", (0.69, -0.04, 1.94), 0.29, -0.25, math.pi * 1.72, 13, 0.034, mats["copper"], arm, "staff")
    arc_xz("StaffCrescentInner", (0.69, -0.04, 1.94), 0.21, 0.28, math.pi * 1.5, 9, 0.02, mats["teal"], arm, "staff")
    ico("StaffGem", (0.69, -0.04, 1.94), (0.105, 0.065, 0.165), mats["ember"], arm, "staff", subdivisions=2, rotation=(0, 0, math.pi / 4))
    armor_spike("StaffCrown", (0.69, -0.04, 1.7), (0.69, -0.04, 1.83), 0.085, mats["copper_high"], arm, "staff")
    armor_spike("StaffTip", (0.69, -0.04, 0.28), (0.69, -0.04, 0.08), 0.075, mats["copper_high"], arm, "staff")

    hero_actions(arm)
    arm.animation_data.action = bpy.data.actions.get("Idle")
    return arm


def monster_actions(armature):
    make_action(
        armature,
        "Idle",
        48,
        {
            0: {"tail.1": {"rotation": (0.08, 0, -0.1)}, "ear.L": {"rotation": (0.02, 0, -0.04)}},
            24: {
                "spine": {"location": (0, 0, 0.035)},
                "tail.1": {"rotation": (-0.05, 0.08, 0.16)},
                "tail.2": {"rotation": (0.08, 0, 0.14)},
                "ear.R": {"rotation": (-0.04, 0, 0.06)},
            },
            48: {"tail.1": {"rotation": (0.08, 0, -0.1)}, "ear.L": {"rotation": (0.02, 0, -0.04)}},
        },
        loop=True,
    )
    make_action(
        armature,
        "Walk",
        32,
        {
            0: {
                "upper_leg.FL": {"rotation": (0.55, 0, 0)},
                "upper_leg.BR": {"rotation": (0.55, 0, 0)},
                "upper_leg.FR": {"rotation": (-0.55, 0, 0)},
                "upper_leg.BL": {"rotation": (-0.55, 0, 0)},
            },
            8: {"spine": {"location": (0, 0, 0.04)}},
            16: {
                "upper_leg.FL": {"rotation": (-0.55, 0, 0)},
                "upper_leg.BR": {"rotation": (-0.55, 0, 0)},
                "upper_leg.FR": {"rotation": (0.55, 0, 0)},
                "upper_leg.BL": {"rotation": (0.55, 0, 0)},
            },
            24: {"spine": {"location": (0, 0, 0.04)}},
            32: {
                "upper_leg.FL": {"rotation": (0.55, 0, 0)},
                "upper_leg.BR": {"rotation": (0.55, 0, 0)},
                "upper_leg.FR": {"rotation": (-0.55, 0, 0)},
                "upper_leg.BL": {"rotation": (-0.55, 0, 0)},
            },
        },
        loop=True,
    )
    make_action(
        armature,
        "Run",
        22,
        {
            0: {
                "spine": {"rotation": (-0.14, 0, 0)},
                "upper_leg.FL": {"rotation": (0.85, 0, 0)},
                "upper_leg.BR": {"rotation": (0.85, 0, 0)},
                "upper_leg.FR": {"rotation": (-0.85, 0, 0)},
                "upper_leg.BL": {"rotation": (-0.85, 0, 0)},
            },
            11: {
                "spine": {"rotation": (-0.14, 0, 0), "location": (0, 0, 0.07)},
                "upper_leg.FL": {"rotation": (-0.85, 0, 0)},
                "upper_leg.BR": {"rotation": (-0.85, 0, 0)},
                "upper_leg.FR": {"rotation": (0.85, 0, 0)},
                "upper_leg.BL": {"rotation": (0.85, 0, 0)},
            },
            22: {
                "spine": {"rotation": (-0.14, 0, 0)},
                "upper_leg.FL": {"rotation": (0.85, 0, 0)},
                "upper_leg.BR": {"rotation": (0.85, 0, 0)},
                "upper_leg.FR": {"rotation": (-0.85, 0, 0)},
                "upper_leg.BL": {"rotation": (-0.85, 0, 0)},
            },
        },
        loop=True,
    )
    make_action(
        armature,
        "Strafe_Left",
        24,
        {
            0: {"root": {"rotation": (0, 0, 0.12)}},
            12: {"root": {"location": (-0.08, 0, 0.035), "rotation": (0, 0, -0.12)}},
            24: {"root": {"rotation": (0, 0, 0.12)}},
        },
        loop=True,
    )
    make_action(
        armature,
        "Strafe_Right",
        24,
        {
            0: {"root": {"rotation": (0, 0, -0.12)}},
            12: {"root": {"location": (0.08, 0, 0.035), "rotation": (0, 0, 0.12)}},
            24: {"root": {"rotation": (0, 0, -0.12)}},
        },
        loop=True,
    )
    make_action(
        armature,
        "Attack_Aim",
        20,
        {
            0: {},
            12: {
                "spine": {"rotation": (-0.12, 0, 0)},
                "head": {"rotation": (0.12, 0, 0)},
                "launcher.L": {"rotation": (0, 0.25, 0)},
                "launcher.R": {"rotation": (0, -0.25, 0)},
                "tail.2": {"rotation": (-0.18, 0, 0)},
            },
            20: {
                "launcher.L": {"rotation": (0, 0.38, 0)},
                "launcher.R": {"rotation": (0, -0.38, 0)},
            },
        },
    )
    make_action(
        armature,
        "Attack_Volley",
        20,
        {
            0: {
                "launcher.L": {"rotation": (0, 0.38, 0)},
                "launcher.R": {"rotation": (0, -0.38, 0)},
            },
            5: {
                "spine": {"location": (0, 0.12, -0.02), "rotation": (0.18, 0, 0)},
                "launcher.L": {"location": (0, 0.09, 0), "scale": (1.22, 1.22, 1.22)},
                "launcher.R": {"location": (0, 0.09, 0), "scale": (1.22, 1.22, 1.22)},
                "tail.3": {"rotation": (0.24, 0, 0)},
            },
            12: {
                "spine": {"location": (0, -0.04, 0)},
                "launcher.L": {"location": (0, 0, 0), "scale": (1, 1, 1)},
                "launcher.R": {"location": (0, 0, 0), "scale": (1, 1, 1)},
            },
            20: {},
        },
    )
    make_action(
        armature,
        "Hit",
        12,
        {0: {}, 4: {"spine": {"rotation": (0.28, 0, 0.18)}, "head": {"rotation": (-0.22, 0, -0.16)}}, 12: {}},
    )
    make_action(
        armature,
        "Armor_Break",
        22,
        {
            0: {},
            8: {
                "launcher.L": {"rotation": (0.5, 0.2, 0.7), "location": (-0.08, 0.02, 0.05)},
                "launcher.R": {"rotation": (0.4, -0.2, -0.7), "location": (0.08, 0.02, 0.05)},
                "head": {"rotation": (-0.22, 0, 0)},
            },
            22: {"launcher.L": {"scale": (0.7, 0.7, 0.7)}, "launcher.R": {"scale": (0.7, 0.7, 0.7)}},
        },
    )
    make_action(
        armature,
        "Death",
        36,
        {
            0: {},
            14: {
                "root": {"rotation": (0, 0.35, 0.65), "location": (0, 0, -0.12)},
                "head": {"rotation": (-0.4, 0, 0)},
                "tail.1": {"rotation": (0.6, 0, 0.3)},
            },
            36: {"root": {"rotation": (0, 0.7, 1.35), "location": (0, 0.15, -0.58)}},
        },
    )


def build_monster():
    reset_scene()
    mats = {
        "stone": material("MAT_Mineral", (0.025, 0.035, 0.045), roughness=0.94),
        "teal": material("MAT_VerdigrisArmor", (0.055, 0.35, 0.31), metallic=0.38, roughness=0.6),
        "copper": material("MAT_Copper", (0.5, 0.21, 0.08), metallic=0.72, roughness=0.4),
        "violet": material(
            "MAT_ArcaneViolet",
            (0.31, 0.08, 0.75),
            roughness=0.18,
            emission=(0.45, 0.08, 1.0),
            emission_strength=5.5,
        ),
        "orange": material(
            "MAT_WarningOrange",
            (0.92, 0.2, 0.025),
            roughness=0.2,
            emission=(1.0, 0.12, 0.01),
            emission_strength=3.0,
        ),
    }
    bones = [
        ("root", (0, 0, 0.1), (0, 0, 0.3), None),
        ("spine", (0, 0.12, 0.78), (0, -0.25, 0.9), "root"),
        ("neck", (0, -0.33, 0.9), (0, -0.58, 1.08), "spine"),
        ("head", (0, -0.58, 1.08), (0, -0.86, 1.18), "neck"),
        ("ear.L", (-0.13, -0.62, 1.22), (-0.18, -0.54, 1.72), "head"),
        ("ear.R", (0.13, -0.62, 1.22), (0.18, -0.54, 1.72), "head"),
        ("upper_leg.FL", (-0.26, -0.34, 0.72), (-0.3, -0.38, 0.38), "spine"),
        ("lower_leg.FL", (-0.3, -0.38, 0.38), (-0.31, -0.48, 0.08), "upper_leg.FL"),
        ("upper_leg.FR", (0.26, -0.34, 0.72), (0.3, -0.38, 0.38), "spine"),
        ("lower_leg.FR", (0.3, -0.38, 0.38), (0.31, -0.48, 0.08), "upper_leg.FR"),
        ("upper_leg.BL", (-0.28, 0.38, 0.73), (-0.32, 0.44, 0.4), "spine"),
        ("lower_leg.BL", (-0.32, 0.44, 0.4), (-0.33, 0.34, 0.08), "upper_leg.BL"),
        ("upper_leg.BR", (0.28, 0.38, 0.73), (0.32, 0.44, 0.4), "spine"),
        ("lower_leg.BR", (0.32, 0.44, 0.4), (0.33, 0.34, 0.08), "upper_leg.BR"),
        ("tail.1", (0, 0.58, 0.78), (0, 0.88, 0.96), "spine"),
        ("tail.2", (0, 0.88, 0.96), (0, 1.13, 1.22), "tail.1"),
        ("tail.3", (0, 1.13, 1.22), (0, 1.25, 1.46), "tail.2"),
        ("launcher.L", (-0.35, -0.08, 0.98), (-0.42, -0.28, 1.04), "spine"),
        ("launcher.R", (0.35, -0.08, 0.98), (0.42, -0.28, 1.04), "spine"),
    ]
    arm = build_armature("VerdigrisLanternJackal_Rig", bones)

    ico("MineralBody", (0, 0.1, 0.82), (0.38, 0.68, 0.34), mats["stone"], arm, "spine", subdivisions=2)
    cube("BackArmor", (0, 0.08, 1.02), (0.34, 0.48, 0.12), mats["teal"], arm, "spine", rotation=(0.05, 0, 0), bevel=0.07)
    cube("ChestArmor", (0, -0.38, 0.87), (0.3, 0.2, 0.24), mats["teal"], arm, "neck", rotation=(-0.18, 0, 0), bevel=0.06)
    ico("NeckMineral", (0, -0.45, 1.02), (0.25, 0.28, 0.32), mats["stone"], arm, "neck", subdivisions=1)
    ico("HeadCore", (0, -0.72, 1.17), (0.23, 0.34, 0.25), mats["stone"], arm, "head", subdivisions=2)
    cube("FaceMask", (0, -0.91, 1.2), (0.19, 0.2, 0.17), mats["teal"], arm, "head", rotation=(0.18, 0, 0), bevel=0.055)
    cone("Snout", (0, -1.08, 1.11), 0.12, 0.045, 0.36, mats["stone"], arm, "head", vertices=6, rotation=(math.pi / 2, 0, 0))
    ico("Eye_L", (-0.095, -0.93, 1.25), (0.045, 0.025, 0.04), mats["violet"], arm, "head", subdivisions=1)
    ico("Eye_R", (0.095, -0.93, 1.25), (0.045, 0.025, 0.04), mats["violet"], arm, "head", subdivisions=1)
    ico("ForeheadCore", (0, -0.91, 1.37), (0.065, 0.035, 0.065), mats["violet"], arm, "head", subdivisions=1)
    cone("Ear_L", (-0.16, -0.58, 1.49), 0.11, 0.025, 0.55, mats["teal"], arm, "ear.L", vertices=5, rotation=(0.08, -0.08, -0.05))
    cone("Ear_R", (0.16, -0.58, 1.49), 0.11, 0.025, 0.55, mats["teal"], arm, "ear.R", vertices=5, rotation=(0.08, 0.08, 0.05))
    cube("EarInset_L", (-0.16, -0.62, 1.49), (0.035, 0.025, 0.19), mats["stone"], arm, "ear.L", bevel=0.015)
    cube("EarInset_R", (0.16, -0.62, 1.49), (0.035, 0.025, 0.19), mats["stone"], arm, "ear.R", bevel=0.015)

    leg_data = [
        ("FL", (-0.27, -0.33, 0.75), (-0.3, -0.4, 0.38), (-0.31, -0.48, 0.08)),
        ("FR", (0.27, -0.33, 0.75), (0.3, -0.4, 0.38), (0.31, -0.48, 0.08)),
        ("BL", (-0.29, 0.36, 0.75), (-0.32, 0.43, 0.4), (-0.33, 0.34, 0.08)),
        ("BR", (0.29, 0.36, 0.75), (0.32, 0.43, 0.4), (0.33, 0.34, 0.08)),
    ]
    for label, upper_start, knee, paw in leg_data:
        cylinder_between(f"UpperLeg_{label}", upper_start, knee, 0.105, mats["stone"], arm, f"upper_leg.{label}", vertices=7)
        cylinder_between(f"LowerLeg_{label}", knee, paw, 0.085, mats["stone"], arm, f"lower_leg.{label}", vertices=7)
        cube(f"LegArmor_{label}", upper_start, (0.13, 0.14, 0.17), mats["teal"], arm, f"upper_leg.{label}", bevel=0.045)
        cube(f"Paw_{label}", (paw[0], paw[1] - 0.07, 0.075), (0.13, 0.19, 0.075), mats["stone"], arm, f"lower_leg.{label}", bevel=0.035)
        for claw_index in (-1, 0, 1):
            cone(
                f"Claw_{label}_{claw_index}",
                (paw[0] + claw_index * 0.065, paw[1] - 0.23, 0.08),
                0.028,
                0,
                0.13,
                mats["copper"],
                arm,
                f"lower_leg.{label}",
                vertices=5,
                rotation=(math.pi / 2, 0, 0),
            )

    for side, x in (("L", -0.39), ("R", 0.39)):
        torus(
            f"LauncherRing_{side}",
            (x, -0.12, 1.02),
            0.16,
            0.045,
            mats["copper"],
            arm,
            f"launcher.{side}",
            rotation=(math.pi / 2, 0, 0),
        )
        ico(
            f"LauncherCore_{side}",
            (x, -0.17, 1.02),
            (0.105, 0.06, 0.105),
            mats["violet"],
            arm,
            f"launcher.{side}",
            subdivisions=1,
        )
        for fin in range(4):
            angle = fin * math.pi * 0.5
            cube(
                f"LauncherFin_{side}_{fin}",
                (x + math.cos(angle) * 0.19, -0.1, 1.02 + math.sin(angle) * 0.19),
                (0.05, 0.05, 0.09),
                mats["teal"],
                arm,
                f"launcher.{side}",
                rotation=(0, angle, 0),
                bevel=0.025,
            )

    cylinder_between("TailBase", (0, 0.55, 0.8), (0, 0.88, 0.97), 0.115, mats["stone"], arm, "tail.1", vertices=7)
    cylinder_between("TailMid", (0, 0.88, 0.97), (0, 1.12, 1.21), 0.1, mats["teal"], arm, "tail.2", vertices=7)
    ico("TailCrystal", (0, 1.2, 1.36), (0.19, 0.16, 0.28), mats["violet"], arm, "tail.3", subdivisions=1)
    for index, angle in enumerate((0, math.pi * 0.5, math.pi, math.pi * 1.5)):
        cone(
            f"TailCage_{index}",
            (math.cos(angle) * 0.16, 1.2 + math.sin(angle) * 0.04, 1.36 + math.sin(angle) * 0.14),
            0.055,
            0.015,
            0.38,
            mats["teal"],
            arm,
            "tail.3",
            vertices=5,
            rotation=(0.2, angle, 0),
        )
    cube("WarningPlate_L", (-0.34, 0.24, 0.93), (0.08, 0.03, 0.11), mats["orange"], arm, "spine", bevel=0.025)
    cube("WarningPlate_R", (0.34, 0.24, 0.93), (0.08, 0.03, 0.11), mats["orange"], arm, "spine", bevel=0.025)

    monster_actions(arm)
    arm.animation_data.action = bpy.data.actions.get("Idle")
    return arm


def build_monster_v2():
    """Concept-faithful medium-detail version of the Verdigris Lantern Jackal."""
    reset_scene()
    mats = {
        "stone": material("MAT_ObsidianMineral", (0.012, 0.018, 0.025), roughness=0.96),
        "stone_high": material("MAT_MineralEdge", (0.05, 0.07, 0.085), roughness=0.9),
        "teal": material("MAT_VerdigrisArmor", (0.035, 0.31, 0.275), metallic=0.46, roughness=0.58),
        "teal_high": material("MAT_VerdigrisEdge", (0.11, 0.48, 0.4), metallic=0.38, roughness=0.48),
        "copper": material("MAT_Copper", (0.48, 0.18, 0.06), metallic=0.76, roughness=0.38),
        "copper_high": material("MAT_CopperEdge", (0.76, 0.38, 0.12), metallic=0.68, roughness=0.3),
        "violet": material(
            "MAT_ArcaneViolet",
            (0.34, 0.075, 0.82),
            roughness=0.16,
            emission=(0.48, 0.045, 1.0),
            emission_strength=7.0,
        ),
        "violet_soft": material(
            "MAT_ArcaneSeam",
            (0.18, 0.035, 0.5),
            roughness=0.26,
            emission=(0.3, 0.03, 0.82),
            emission_strength=3.2,
        ),
        "orange": material(
            "MAT_WarningOrange",
            (0.95, 0.16, 0.015),
            roughness=0.18,
            emission=(1.0, 0.08, 0.005),
            emission_strength=4.2,
        ),
    }
    bones = [
        ("root", (0, 0, 0.1), (0, 0, 0.3), None),
        ("spine", (0, 0.12, 0.78), (0, -0.25, 0.9), "root"),
        ("neck", (0, -0.33, 0.9), (0, -0.58, 1.08), "spine"),
        ("head", (0, -0.58, 1.08), (0, -0.88, 1.19), "neck"),
        ("ear.L", (-0.13, -0.62, 1.23), (-0.2, -0.54, 1.78), "head"),
        ("ear.R", (0.13, -0.62, 1.23), (0.2, -0.54, 1.78), "head"),
        ("upper_leg.FL", (-0.26, -0.34, 0.72), (-0.3, -0.38, 0.38), "spine"),
        ("lower_leg.FL", (-0.3, -0.38, 0.38), (-0.31, -0.48, 0.08), "upper_leg.FL"),
        ("upper_leg.FR", (0.26, -0.34, 0.72), (0.3, -0.38, 0.38), "spine"),
        ("lower_leg.FR", (0.3, -0.38, 0.38), (0.31, -0.48, 0.08), "upper_leg.FR"),
        ("upper_leg.BL", (-0.28, 0.38, 0.73), (-0.32, 0.44, 0.4), "spine"),
        ("lower_leg.BL", (-0.32, 0.44, 0.4), (-0.33, 0.34, 0.08), "upper_leg.BL"),
        ("upper_leg.BR", (0.28, 0.38, 0.73), (0.32, 0.44, 0.4), "spine"),
        ("lower_leg.BR", (0.32, 0.44, 0.4), (0.33, 0.34, 0.08), "upper_leg.BR"),
        ("tail.1", (0, 0.58, 0.78), (0, 0.88, 0.96), "spine"),
        ("tail.2", (0, 0.88, 0.96), (0, 1.13, 1.22), "tail.1"),
        ("tail.3", (0, 1.13, 1.22), (0, 1.25, 1.48), "tail.2"),
        ("launcher.L", (-0.35, -0.08, 0.98), (-0.43, -0.28, 1.04), "spine"),
        ("launcher.R", (0.35, -0.08, 0.98), (0.43, -0.28, 1.04), "spine"),
    ]
    arm = build_armature("VerdigrisLanternJackal_Rig", bones)

    # Obsidian articulated core and overlapping oxidized-copper dorsal plates.
    ico("MineralBody", (0, 0.1, 0.81), (0.36, 0.66, 0.32), mats["stone"], arm, "spine", subdivisions=3)
    for index, (y, z, sx, sy, rotation_x) in enumerate(
        [
            (0.38, 1.0, 0.31, 0.22, -0.08),
            (0.08, 1.05, 0.35, 0.24, 0.01),
            (-0.22, 1.0, 0.33, 0.22, 0.1),
        ]
    ):
        cube(
            f"BackArmor_{index}",
            (0, y, z),
            (sx, sy, 0.105),
            mats["teal"],
            arm,
            "spine",
            rotation=(rotation_x, 0, 0),
            bevel=0.055,
        )
        cube(
            f"BackArmorRidge_{index}",
            (0, y - 0.012, z + 0.105),
            (0.025, sy * 0.82, 0.025),
            mats["copper_high"],
            arm,
            "spine",
            rotation=(rotation_x, 0, 0),
            bevel=0.008,
        )
    cube("ChestArmor", (0, -0.37, 0.88), (0.3, 0.22, 0.25), mats["teal"], arm, "neck", rotation=(-0.2, 0, 0), bevel=0.065)
    panel_xz(
        "ChestChevron",
        [(-0.28, 1.0), (0, 0.84), (0.28, 1.0), (0.2, 0.76), (0, 0.66), (-0.2, 0.76)],
        -0.59,
        0.03,
        mats["copper_high"],
        arm,
        "neck",
        bevel=0.012,
    )
    for index, (y, z, scale) in enumerate(
        [(-0.44, 1.02, 0.24), (-0.54, 1.1, 0.215), (-0.63, 1.16, 0.19)]
    ):
        ico(
            f"NeckSegment_{index}",
            (0, y, z),
            (scale, 0.15, 0.11),
            mats["stone_high" if index % 2 else "stone"],
            arm,
            "neck",
            subdivisions=1,
        )
        cube(
            f"NeckArmor_{index}",
            (0, y - 0.07, z + 0.055),
            (scale * 0.86, 0.055, 0.07),
            mats["teal"],
            arm,
            "neck",
            rotation=(0.12, 0, 0),
            bevel=0.03,
        )
    cylinder_between("SpineSeam", (0, 0.47, 1.12), (0, -0.24, 1.14), 0.018, mats["violet_soft"], arm, "spine", vertices=6)

    # Narrow jackal mask, layered cheek blades and luminous eyes.
    ico("HeadCore", (0, -0.76, 1.2), (0.22, 0.34, 0.23), mats["stone"], arm, "head", subdivisions=2)
    cone("SnoutCore", (0, -1.04, 1.13), 0.135, 0.045, 0.45, mats["stone_high"], arm, "head", vertices=8, rotation=(math.pi / 2, 0, 0))
    panel_xz(
        "FaceMask",
        [(-0.2, 1.35), (0, 1.43), (0.2, 1.35), (0.145, 1.1), (0, 1.02), (-0.145, 1.1)],
        -0.99,
        0.055,
        mats["teal"],
        arm,
        "head",
        bevel=0.025,
    )
    panel_xz(
        "FaceCopperTrim",
        [(-0.175, 1.34), (0, 1.405), (0.175, 1.34), (0.02, 1.31), (0, 1.34), (-0.02, 1.31)],
        -1.025,
        0.018,
        mats["copper_high"],
        arm,
        "head",
        bevel=0.006,
    )
    for side, sign in (("L", -1), ("R", 1)):
        panel_xz(
            f"Eye_{side}",
            [
                (sign * 0.155, 1.31),
                (sign * 0.045, 1.29),
                (sign * 0.065, 1.245),
                (sign * 0.17, 1.27),
            ],
            -1.035,
            0.014,
            mats["violet"],
            arm,
            "head",
            bevel=0.004,
        )
        armor_spike(
            f"CheekBlade_{side}",
            (sign * 0.16, -0.83, 1.25),
            (sign * 0.33, -0.78, 1.18),
            0.06,
            mats["teal_high"],
            arm,
            "head",
        )
        armor_spike(
            f"JawBlade_{side}",
            (sign * 0.12, -0.98, 1.12),
            (sign * 0.23, -0.92, 1.03),
            0.045,
            mats["copper"],
            arm,
            "head",
        )
    ico("ForeheadCore", (0, -1.035, 1.39), (0.065, 0.026, 0.07), mats["violet"], arm, "head", subdivisions=2)
    cube("NosePlate", (0, -1.255, 1.1), (0.07, 0.055, 0.06), mats["copper_high"], arm, "head", bevel=0.02)

    # Three-piece ears reproduce the reference's long segmented silhouette.
    for side, sign in (("L", -1), ("R", 1)):
        ear_bone = f"ear.{side}"
        ear_panels = [
            (1.24, 1.43, 0.12, 0.19),
            (1.43, 1.63, 0.105, 0.16),
            (1.62, 1.82, 0.09, 0.11),
        ]
        for index, (bottom, top, half_width, offset) in enumerate(ear_panels):
            center_x = sign * (0.14 + index * 0.025)
            points = [
                (center_x - half_width, bottom),
                (center_x + half_width, bottom + 0.025),
                (center_x + sign * offset * 0.35, top - 0.025),
                (center_x, top),
                (center_x - sign * offset * 0.35, top - 0.025),
            ]
            panel_xz(
                f"EarPlate_{side}_{index}",
                points,
                -0.61 + index * 0.008,
                0.065,
                mats["teal" if index != 1 else "teal_high"],
                arm,
                ear_bone,
                bevel=0.018,
            )
            cylinder_between(
                f"EarTrim_{side}_{index}",
                (center_x, -0.65, bottom + 0.035),
                (center_x, -0.65, top - 0.035),
                0.014,
                mats["copper_high"],
                arm,
                ear_bone,
                vertices=6,
            )
        panel_xz(
            f"EarInset_{side}",
            [
                (sign * 0.12, 1.29),
                (sign * 0.17, 1.7),
                (sign * 0.2, 1.76),
                (sign * 0.19, 1.34),
            ],
            -0.648,
            0.012,
            mats["stone"],
            arm,
            ear_bone,
            bevel=0.004,
        )

    # Articulated legs with joint discs, layered shin armor and individual claws.
    leg_data = [
        ("FL", -1, (-0.27, -0.33, 0.75), (-0.3, -0.4, 0.38), (-0.31, -0.49, 0.08)),
        ("FR", 1, (0.27, -0.33, 0.75), (0.3, -0.4, 0.38), (0.31, -0.49, 0.08)),
        ("BL", -1, (-0.29, 0.36, 0.75), (-0.32, 0.43, 0.4), (-0.33, 0.34, 0.08)),
        ("BR", 1, (0.29, 0.36, 0.75), (0.32, 0.43, 0.4), (0.33, 0.34, 0.08)),
    ]
    for label, sign, upper_start, knee, paw in leg_data:
        upper_bone = f"upper_leg.{label}"
        lower_bone = f"lower_leg.{label}"
        cylinder_between(f"UpperLeg_{label}", upper_start, knee, 0.095, mats["stone"], arm, upper_bone, vertices=9)
        cylinder_between(f"LowerLeg_{label}", knee, paw, 0.074, mats["stone_high"], arm, lower_bone, vertices=9)
        ico(f"Joint_{label}", knee, (0.115, 0.105, 0.11), mats["copper"], arm, upper_bone, subdivisions=1)
        cube(f"ThighArmor_{label}", upper_start, (0.14, 0.16, 0.19), mats["teal"], arm, upper_bone, rotation=(0.05, 0, sign * 0.08), bevel=0.045)
        cube(f"ShinArmor_{label}", ((knee[0] + paw[0]) * 0.5, (knee[1] + paw[1]) * 0.5 - 0.035, (knee[2] + paw[2]) * 0.5), (0.105, 0.085, 0.17), mats["teal_high"], arm, lower_bone, rotation=(0.05, 0, sign * 0.035), bevel=0.035)
        cube(f"Paw_{label}", (paw[0], paw[1] - 0.085, 0.075), (0.14, 0.2, 0.075), mats["stone"], arm, lower_bone, bevel=0.035)
        cylinder_between(
            f"ShinTrim_{label}",
            (paw[0] - sign * 0.075, paw[1] - 0.13, 0.2),
            (paw[0] + sign * 0.075, paw[1] - 0.13, 0.2),
            0.018,
            mats["copper_high"],
            arm,
            lower_bone,
            vertices=6,
        )
        for claw_index in (-1, 0, 1):
            armor_spike(
                f"Claw_{label}_{claw_index}",
                (paw[0] + claw_index * 0.07, paw[1] - 0.19, 0.085),
                (paw[0] + claw_index * 0.075, paw[1] - 0.34, 0.07),
                0.033,
                mats["copper_high"],
                arm,
                lower_bone,
            )

    # Large circular shoulder emitters with separated armor petals.
    for side, x in (("L", -0.43), ("R", 0.43)):
        launcher_bone = f"launcher.{side}"
        torus(f"LauncherOuter_{side}", (x, -0.12, 1.03), 0.175, 0.035, mats["copper_high"], arm, launcher_bone, rotation=(math.pi / 2, 0, 0))
        torus(f"LauncherInner_{side}", (x, -0.135, 1.03), 0.115, 0.024, mats["stone"], arm, launcher_bone, rotation=(math.pi / 2, 0, 0))
        ico(f"LauncherCore_{side}", (x, -0.18, 1.03), (0.105, 0.055, 0.105), mats["violet"], arm, launcher_bone, subdivisions=2)
        for fin in range(4):
            angle = fin * math.pi * 0.5
            px = x + math.cos(angle) * 0.205
            pz = 1.03 + math.sin(angle) * 0.205
            cube(
                f"LauncherPetal_{side}_{fin}",
                (px, -0.105, pz),
                (0.055, 0.045, 0.1),
                mats["teal"],
                arm,
                launcher_bone,
                rotation=(0, angle, angle),
                bevel=0.025,
            )

    # Segmented rising tail and faceted lantern crystal.
    tail_segments = [
        ("TailBase", (0, 0.54, 0.8), (0, 0.84, 0.95), 0.11, "stone", "tail.1"),
        ("TailMidA", (0, 0.84, 0.95), (0, 1.05, 1.15), 0.1, "teal", "tail.2"),
        ("TailMidB", (0, 1.05, 1.15), (0, 1.18, 1.36), 0.085, "teal_high", "tail.3"),
    ]
    for name, start, end, radius, material_key, bone in tail_segments:
        cylinder_between(name, start, end, radius, mats[material_key], arm, bone, vertices=9)
        torus(f"{name}Joint", start, radius * 1.05, radius * 0.18, mats["copper"], arm, bone)
    ico("TailCrystal", (0, 1.22, 1.5), (0.18, 0.15, 0.27), mats["violet"], arm, "tail.3", subdivisions=2)
    for index, angle in enumerate((0, math.pi * 0.5, math.pi, math.pi * 1.5)):
        start = (math.cos(angle) * 0.18, 1.22 + math.sin(angle) * 0.03, 1.32)
        tip = (math.cos(angle) * 0.13, 1.22 + math.sin(angle) * 0.03, 1.68)
        armor_spike(f"TailCage_{index}", start, tip, 0.05, mats["teal"], arm, "tail.3")
    torus("TailLanternRing", (0, 1.22, 1.5), 0.235, 0.025, mats["copper_high"], arm, "tail.3", rotation=(math.pi / 2, 0, 0))
    cube("WarningPlate_L", (-0.34, 0.25, 0.92), (0.075, 0.028, 0.105), mats["orange"], arm, "spine", bevel=0.022)
    cube("WarningPlate_R", (0.34, 0.25, 0.92), (0.075, 0.028, 0.105), mats["orange"], arm, "spine", bevel=0.022)

    monster_actions(arm)
    arm.animation_data.action = bpy.data.actions.get("Idle")
    return arm


def add_preview_environment(target=(0, 0, 0.8), camera_location=(3.6, -6.4, 2.8)):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.025, 0.035, 0.04)

    bpy.ops.object.camera_add(location=camera_location)
    camera = bpy.context.object
    camera.name = "PreviewCamera"
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera.data.lens = 58
    scene.camera = camera

    bpy.ops.object.light_add(type="AREA", location=(3.2, -3.5, 5.2))
    key = bpy.context.object
    key.name = "KeyLight"
    key.data.energy = 900
    key.data.shape = "DISK"
    key.data.size = 4.2
    key.data.color = (1.0, 0.55, 0.3)
    key.rotation_euler = (math.radians(28), 0, math.radians(38))

    bpy.ops.object.light_add(type="AREA", location=(-3.5, -1.2, 3.5))
    fill = bpy.context.object
    fill.name = "FillLight"
    fill.data.energy = 700
    fill.data.size = 4.5
    fill.data.color = (0.22, 0.75, 0.72)

    bpy.ops.object.light_add(type="AREA", location=(0, 3.8, 4.8))
    rim = bpy.context.object
    rim.name = "RimLight"
    rim.data.energy = 950
    rim.data.size = 3.2
    rim.data.color = (0.45, 0.28, 1.0)

    floor_mat = material("MAT_PreviewFloor", (0.035, 0.055, 0.06), roughness=0.94)
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
    floor = bpy.context.object
    floor.name = "PreviewFloor"
    floor.data.materials.append(floor_mat)


def export_asset(asset_name, armature, blend_name, preview_name, camera_location):
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.frame_set(12)
    blend_path = BLEND_DIR / blend_name
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    export_objects = [
        obj
        for obj in scene.objects
        if obj.get("phase2_asset") or obj.get("asset_root")
    ]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in export_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature

    glb_path = MODEL_DIR / f"{asset_name}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_materials="EXPORT",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_extra_animations=True,
        export_force_sampling=True,
        export_bake_animation=True,
        export_skins=True,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_apply=False,
    )

    bpy.ops.object.select_all(action="DESELECT")
    add_preview_environment(camera_location=camera_location)
    scene.render.filepath = str(PREVIEW_DIR / preview_name)
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print(f"EXPORTED {glb_path}")
    print(f"SAVED {blend_path}")
    print(f"RENDERED {scene.render.filepath}")


def main():
    hero = build_hero_v2()
    export_asset(
        "starforge-traveler-v2",
        hero,
        "starforge-traveler-v2.blend",
        "starforge-traveler-blender-v2.png",
        (3.1, -6.4, 2.65),
    )
    monster = build_monster_v2()
    export_asset(
        "verdigris-lantern-jackal-v2",
        monster,
        "verdigris-lantern-jackal-v2.blend",
        "verdigris-lantern-jackal-blender-v2.png",
        (3.2, -6.4, 2.55),
    )


if __name__ == "__main__":
    main()
