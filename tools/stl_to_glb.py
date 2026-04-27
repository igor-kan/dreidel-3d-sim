import argparse
import bpy
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert STL to GLB with Blender.")
    parser.add_argument("--input", required=True, help="Input STL path")
    parser.add_argument("--output", required=True, help="Output GLB path")
    parser.add_argument("--scale", type=float, default=1.0, help="Uniform scale")
    parser.add_argument("--smooth", action="store_true", help="Enable auto smooth")
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablock in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for item in datablock:
            if item.users == 0:
                datablock.remove(item)


def main() -> None:
    args = parse_args()

    clear_scene()

    bpy.ops.wm.stl_import(filepath=args.input)

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh objects imported from: {args.input}")

    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]

    if len(meshes) > 1:
        bpy.ops.object.join()

    obj = bpy.context.view_layer.objects.active
    if obj is None:
        raise RuntimeError("Unable to find active mesh object after import.")

    obj.scale = (args.scale, args.scale, args.scale)

    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    if args.smooth:
        mesh_data = obj.data
        for polygon in mesh_data.polygons:
            polygon.use_smooth = True

    bpy.ops.export_scene.gltf(
        filepath=args.output,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False
    )


if __name__ == "__main__":
    main()
