"""Reconstruct Phase 2 concept meshes with official Stability AI Spaces.

This helper intentionally keeps inference separate from Blender cleanup.
Blender scripts then handle orientation, materials, rigging, actions, and the
final GLB export.
"""

from __future__ import annotations

import argparse
import shutil
import time
from pathlib import Path

from gradio_client import Client, handle_file


TRIPOSR_SPACE_URL = "https://stabilityai-triposr.hf.space"
SF3D_SPACE_URL = "https://stabilityai-stable-fast-3d.hf.space"


def call_with_retry(client: Client, api_name: str, *args: object) -> object:
    last_error: Exception | None = None
    for attempt in range(1, 5):
        try:
            return client.predict(*args, api_name=api_name)
        except Exception as error:  # transient Space/SSL/queue failures
            last_error = error
            print(f"{api_name} attempt {attempt} failed: {error}", flush=True)
            if attempt < 4:
                time.sleep(5 * attempt)
    raise RuntimeError(f"{api_name} failed after four attempts") from last_error


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_image", type=Path)
    parser.add_argument("output_glb", type=Path)
    parser.add_argument("--backend", choices=("triposr", "sf3d"), default="sf3d")
    parser.add_argument("--foreground-ratio", type=float, default=0.85)
    parser.add_argument("--resolution", type=int, default=256)
    parser.add_argument("--target-vertices", type=int, default=15000)
    parser.add_argument("--texture-size", type=int, default=1024)
    parser.add_argument("--remesh", choices=("None", "Triangle", "Quad"), default="None")
    args = parser.parse_args()

    input_image = args.input_image.resolve()
    output_glb = args.output_glb.resolve()
    output_glb.parent.mkdir(parents=True, exist_ok=True)

    space_url = SF3D_SPACE_URL if args.backend == "sf3d" else TRIPOSR_SPACE_URL
    print(f"Connecting to {space_url}", flush=True)
    client = Client(space_url, verbose=True)

    if args.backend == "sf3d":
        print(
            f"Generating {input_image.name} with Stable Fast 3D "
            f"({args.remesh} remesh, {args.target_vertices} target vertices, "
            f"{args.texture_size}px texture)",
            flush=True,
        )
        _processed, glb_path = call_with_retry(
            client,
            "/run_button",
            handle_file(input_image),
            args.foreground_ratio,
            args.remesh,
            args.target_vertices,
            args.texture_size,
        )
    else:
        print(f"Preprocessing {input_image.name}", flush=True)
        processed = call_with_retry(
            client,
            "/preprocess",
            handle_file(input_image),
            True,
            args.foreground_ratio,
        )

        print(f"Generating {input_image.name} at {args.resolution}", flush=True)
        _obj_path, glb_path = call_with_retry(
            client,
            "/generate",
            handle_file(processed),
            args.resolution,
        )

    shutil.copy2(Path(glb_path), output_glb)
    print(f"Saved {output_glb}", flush=True)


if __name__ == "__main__":
    main()
