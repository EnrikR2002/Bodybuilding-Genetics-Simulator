# Candidate anatomical source: Mike Freeman

The model itself has **not** been downloaded or integrated.

Source: [PixelPete / Péter Józsa Jr., Mike Freeman](https://blendswap.com/blend/19700).
The author declares the asset CC0 and confirms public-domain release in
[the original announcement](https://forums.unrealengine.com/t/free-mike-freeman-human-basemesh-cc0/91876).
The listing offers a 13.3 MB Blender file; its download page requires sign-in.
The preview shows more developed pec, arm, back and leg forms than the current
MakeHuman cage. This is a candidate based on the preview, not an accepted
replacement or a claim that the asset will work unchanged.

Place the downloaded `.blend` (or its original ZIP) in this directory.
Retain all accompanying author and licence files. Blender can be run locally;
no Blender-control MCP is required to inspect or process the file.

An alternative is authenticated access to the
[BlendSwap MCP/API](https://blendswap.com/3d-mcp-api).
The provider documents Streamable HTTP at `https://blendswap.com/api/mcp`,
using a Bearer API key created after confirming the account email. Configure
credentials privately in the client; do not store keys in this repository.

Before integrating:

1. Inspect the original mesh and evaluated multiresolution surface separately.
2. Register the shoulder, elbow, wrist, hip, knee and ankle landmarks.
3. Compare detail transfer onto the current cage with a new visible mesh and
   retained internal rig driver. Preserve all controls and measurements.
4. Validate both biceps endpoints in relaxed and flexed poses; check the
   axilla, pec/deltoid transition, fingers and knees before accepting weights.
5. Bake and review skin, clay, front/side/back views and every principal pose.

The existing Blender Studio reference was also inspected at multiresolution
levels 0 and 2. Its higher subdivision level does not add the missing
bodybuilding musculature, so it remains a reference rather than a replacement.
