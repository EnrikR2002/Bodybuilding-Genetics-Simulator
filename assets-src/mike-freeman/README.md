# Mike Freeman — integrated anatomical source

The user-supplied `Mike_Freeman human basemesh.zip` was extracted into `source/` and inspected locally in Blender. The included `Mike_Freeman_License.txt` identifies the sculptor as **Péter Józsa Jr. (PixelPete)** and releases the mesh under **CC0**. Both original licence files are retained with the source.

The visible model in the main app is the evaluated `Mike_Freeman` object at multiresolution level 2: 154,442 vertices, 308,864 triangles. Its original proportions are retained and scaled to a nominal 180 cm. A fresh inspection rig, a softened coverage target and localized runtime trait deformations are added by this project. Separate eyes and eyebrows are included; the hair object is not displayed.

Rebuild with `npm run bake`, using `tools/blender/bake_freeman.py` and a local Blender executable. The source `.blend` is read but not overwritten. The generated files are `public/models/freeman.json` and `public/models/freeman.bin`; the original author licence is copied to `public/models/freeman-LICENSE.txt` for distribution.

No authenticated external service or MCP is needed for this asset pipeline. See [the quality notes](../../docs/ANATOMY_QUALITY.md) for validation and model limitations.
